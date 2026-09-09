import { getPool } from './db';
import { releaseSlot } from './slot-engine';
import { dispatchWebhook } from './webhook-dispatcher';

export interface PaymentMatchResult {
  matched: boolean;
  orderId?: string;
  amount?: number;
  utr?: string;
  receiptId?: string;
  reason?: string;
}

export function parsePaymentAlert(rawText: string): {
  utr: string | null;
  amount: number | null;
  accountSuffixHint: string | null;
  vpaHint: string | null;
} {
  const text = rawText.trim();

  // 1. Extract 12-digit UTR
  let utr: string | null = null;
  const utrMatch =
    text.match(/(?:UPI\s*Ref\s*No\.?|Ref\s*No\.?|UPI|IMPS|Ref|UTR|Txn|Transaction\s*ID|RRN)[:\s;#\.]*(\d{12})/i) ||
    text.match(/\b(\d{12})\b/);
  if (utrMatch) {
    utr = utrMatch[1];
  }

  // 2. Extract Exact Decimal Amount (e.g. ₹499.12 or 499.12)
  let amount: number | null = null;
  const amtMatch =
    text.match(/(?:sent|amount of|credited with|credited|received|paid you|paid|payment\s+of|deposited)\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i) ||
    text.match(/(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i) ||
    text.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:INR|Rs\.?|₹)/i) ||
    text.match(/([\d]+\.\d{2})/);

  if (amtMatch) {
    const cleanAmt = amtMatch[1].replace(/,/g, '');
    const parsed = parseFloat(cleanAmt);
    if (!isNaN(parsed) && parsed > 0) {
      amount = parsed;
    }
  }

  // 3. Extract VPA or Account Suffix Hint
  let accountSuffixHint: string | null = null;
  const suffixMatch = text.match(/(?:A\/c|Acct|Account|ending\s+in|a\/c\s*no\.?)\s*[X\*\s]*(\d{3,6})/i);
  if (suffixMatch) {
    accountSuffixHint = suffixMatch[1];
  }

  let vpaHint: string | null = null;
  const vpaMatch = text.match(/[\w\.\-]+@(waaxis|okaxis|okhdfcbank|okicici|paytm|ybl|ibl|axl|upi)/i);
  if (vpaMatch) {
    vpaHint = vpaMatch[0].toLowerCase();
  }

  return { utr, amount, accountSuffixHint, vpaHint };
}

export async function matchAndFulfillPayment(params: {
  rawMessage: string;
  sender?: string;
  utr?: string;
  amount?: number;
}): Promise<PaymentMatchResult> {
  const pool = getPool();
  const rawText = params.rawMessage || '';
  const parsed = parsePaymentAlert(rawText);

  const finalUtr = params.utr || parsed.utr || null;
  const finalAmount = params.amount || parsed.amount;

  if (!finalAmount || finalAmount <= 0) {
    return {
      matched: false,
      reason: 'Could not extract a valid positive amount from incoming alert.',
    };
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Insert raw receipt into payment_receipts
    const receiptRes = await client.query(
      `INSERT INTO payment_receipts (utr, raw_message, sender, amount, matched)
       VALUES ($1, $2, $3, $4, false)
       RETURNING id`,
      [finalUtr, rawText, params.sender || 'ALERT', finalAmount]
    );
    const receiptId = receiptRes.rows[0].id;

    // 2. Query matching pending orders with FOR UPDATE SKIP LOCKED
    // We prioritize matching the VPA hint or account suffix if present
    const ordersRes = await client.query(
      `SELECT o.*, v.vpa_address, v.account_suffix
       FROM orders o
       JOIN vpas v ON o.vpa_id = v.id
       WHERE o.status = 'pending'
         AND o.final_amount = $1
         AND (o.expires_at > NOW() OR o.created_at > (NOW() - INTERVAL '30 minutes'))
       ORDER BY (o.expires_at > NOW()) DESC, o.created_at DESC
       FOR UPDATE SKIP LOCKED`,
      [finalAmount]
    );

    if (ordersRes.rows.length === 0) {
      await client.query('COMMIT');
      return {
        matched: false,
        amount: finalAmount,
        utr: finalUtr || undefined,
        receiptId,
        reason: `No pending order found matching amount ₹${finalAmount}.`,
      };
    }

    // If multiple pending orders match the amount (e.g. across multiple VPAs), select the one matching VPA/suffix
    let matchedOrder = ordersRes.rows[0];
    if (ordersRes.rows.length > 1 && (parsed.vpaHint || parsed.accountSuffixHint)) {
      const specificMatch = ordersRes.rows.find((o) => {
        const vpaMatch = parsed.vpaHint && o.vpa_address.toLowerCase().includes(parsed.vpaHint);
        const suffixMatch = parsed.accountSuffixHint && o.account_suffix === parsed.accountSuffixHint;
        return vpaMatch || suffixMatch;
      });
      if (specificMatch) {
        matchedOrder = specificMatch;
      }
    }

    // 3. Mark order as PAID
    await client.query(
      `UPDATE orders 
       SET status = 'paid', utr = $1, paid_at = NOW() 
       WHERE id = $2`,
      [finalUtr, matchedOrder.id]
    );

    // 3.5 Credit Merchant Wallet Balance (base_amount)
    await client.query(
      `UPDATE merchants 
       SET balance = balance + $1, total_earned = total_earned + $1 
       WHERE id = $2`,
      [matchedOrder.base_amount, matchedOrder.merchant_id]
    );

    // 4. Update receipt
    await client.query(
      `UPDATE payment_receipts 
       SET matched = true, order_id = $1 
       WHERE id = $2`,
      [matchedOrder.id, receiptId]
    );

    await client.query('COMMIT');

    // 5. Instant Slot Recycling: Immediately release Redis lock
    const meta = typeof matchedOrder.metadata === 'string' ? JSON.parse(matchedOrder.metadata) : (matchedOrder.metadata || {});
    const origBase = meta?.coupon?.original_amount ? Math.round(parseFloat(meta.coupon.original_amount)) : matchedOrder.base_amount;

    await releaseSlot(
      matchedOrder.vpa_address,
      matchedOrder.base_amount,
      matchedOrder.offset_cents,
      matchedOrder.vpa_id,
      matchedOrder.id
    );

    if (origBase !== matchedOrder.base_amount) {
      await releaseSlot(
        matchedOrder.vpa_address,
        origBase,
        matchedOrder.offset_cents,
        matchedOrder.vpa_id,
        matchedOrder.id
      );
    }

    // 6. Trigger outgoing merchant webhook asynchronously
    dispatchWebhook(matchedOrder.id).catch((err) => {
      console.error(`[Match Engine] Webhook dispatch error for order ${matchedOrder.id}:`, err);
    });

    console.log(
      `[Match Engine] Payment Verified! Order: ${matchedOrder.id} | Amount: ₹${finalAmount} | UTR: ${finalUtr || 'N/A'}`
    );

    return {
      matched: true,
      orderId: matchedOrder.id,
      amount: finalAmount,
      utr: finalUtr || undefined,
      receiptId,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
