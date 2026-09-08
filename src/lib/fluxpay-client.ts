import crypto from 'crypto';

const log = {
  info: (...args: any[]) => console.log('[FluxPay Client]', ...args),
  warn: (...args: any[]) => console.warn('[FluxPay Client]', ...args),
  error: (...args: any[]) => console.error('[FluxPay Client]', ...args),
};

const FLUXPAY_GATEWAY_URL = process.env.FLUXPAY_GATEWAY_URL || 'https://payments.fluxbasedb.me';
const FLUXPAY_API_KEY = process.env.FLUXPAY_API_KEY || 'sec_live_359d2fab51a60facb9d6e5e838714e8d';
const FLUXPAY_WEBHOOK_SECRET = process.env.FLUXPAY_WEBHOOK_SECRET || 'whsec_de4e5ac069b1e05aebb098ee343e396a';

export interface FluxPayOrderParams {
  amount: number;
  couponCode?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  callbackUrl?: string;
  webhookUrl?: string;
  metadata?: Record<string, any>;
}

export interface FluxPayOrderResult {
  orderId: string;
  baseAmount: number;
  finalAmount: number;
  vpa: string;
  checkoutUrl: string;
  expiresAt: string;
  coupon?: {
    code: string;
    discount: number;
    original_amount: number;
  } | null;
}

/**
 * Creates an order on FluxPay automated UPI payment gateway.
 */
export async function createFluxPayOrder(params: FluxPayOrderParams): Promise<FluxPayOrderResult> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.fluxbasedb.me';
  const defaultWebhookUrl = `${appUrl}/api/webhooks/fluxpay`;

  const payload = {
    amount: params.amount,
    coupon_code: params.couponCode || undefined,
    customer_name: params.customerName || undefined,
    customer_email: params.customerEmail || undefined,
    customer_phone: params.customerPhone || undefined,
    callback_url: params.callbackUrl || `${appUrl}/checkout`,
    webhook_url: params.webhookUrl || defaultWebhookUrl,
    metadata: params.metadata || {},
  };

  log.info(`Initiating order with amount: ₹${params.amount}, gateway: ${FLUXPAY_GATEWAY_URL}`);

  const res = await fetch(`${FLUXPAY_GATEWAY_URL}/api/v1/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${FLUXPAY_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to create order on FluxPay gateway');
  }

  let rawCheckoutUrl = String(data.checkout_url || '').trim();
  let checkoutUrl = rawCheckoutUrl;
  if (checkoutUrl) {
    if (checkoutUrl.startsWith('//')) {
      checkoutUrl = `https:${checkoutUrl}`;
    } else if (checkoutUrl.startsWith('/')) {
      checkoutUrl = `${FLUXPAY_GATEWAY_URL.replace(/\/+$/, '')}${checkoutUrl}`;
    } else if (!/^https?:\/\//i.test(checkoutUrl)) {
      checkoutUrl = `https://${checkoutUrl}`;
    }
  }

  return {
    orderId: data.order_id || data.order?.id,
    baseAmount: data.amount,
    finalAmount: data.final_amount,
    vpa: data.vpa || data.order?.vpa,
    checkoutUrl,
    expiresAt: data.expires_at,
    coupon: data.coupon || data.order?.coupon || null,
  };
}

/**
 * Verifies the X-FluxPay-Signature HMAC signature on incoming webhooks.
 */
export function verifyFluxPayWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secretOverride?: string
): boolean {
  if (!signatureHeader) return false;

  const secret = secretOverride || FLUXPAY_WEBHOOK_SECRET;
  if (!secret) return false;

  // Format: "t=1725839000,v1=hash..."
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((kv) => kv.split('='))
  );

  const timestamp = parts['t'];
  const expectedSig = parts['v1'];
  if (!timestamp || !expectedSig) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const computedSig = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(computedSig), Buffer.from(expectedSig));
  } catch {
    return false;
  }
}
