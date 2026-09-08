import { cookies } from 'next/headers';
import { getPool } from './db';
import { MERCHANT_COOKIE_NAME, verifyMerchantToken } from './merchant-auth';

export async function getSessionMerchant(): Promise<any | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(MERCHANT_COOKIE_NAME)?.value;
  const verified = await verifyMerchantToken(token);
  if (!verified) return null;

  const pool = getPool();
  const res = await pool.query(
    `SELECT id, name, business_name, email, balance, total_earned, api_key, webhook_url, webhook_secret,
            payout_upi_id, payout_bank_acc, payout_ifsc, payout_holder_name, status
     FROM merchants
     WHERE id = $1 AND status = 'active'`,
    [verified.merchantId]
  );

  return res.rows[0] || null;
}
