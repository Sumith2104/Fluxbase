import crypto from 'crypto';

export function generateOrderId(): string {
  const hex = crypto.randomBytes(8).toString('hex');
  return `ord_${hex}`;
}

export function generateApiKey(): string {
  const hex = crypto.randomBytes(16).toString('hex');
  return `sec_live_${hex}`;
}

export function generateWebhookSecret(): string {
  const hex = crypto.randomBytes(16).toString('hex');
  return `whsec_${hex}`;
}

export function computeHmac(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
