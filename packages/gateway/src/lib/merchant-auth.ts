export const MERCHANT_COOKIE_NAME = 'gw_merchant_session';

const AUTH_SECRET =
  process.env.GATEWAY_SESSION_SECRET ||
  process.env.JWT_SECRET ||
  'fluxpay_super_secret_auth_key_2026';

export async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  const hashHex = Array.from(new Uint8Array(derivedBits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored || !stored.includes(':')) return false;

  const [saltHex, expectedHashHex] = stored.split(':');
  const saltMatch = saltHex.match(/.{1,2}/g);
  if (!saltMatch) return false;
  const salt = new Uint8Array(saltMatch.map((byte) => parseInt(byte, 16)));

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  const computedHashHex = Array.from(new Uint8Array(derivedBits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return computedHashHex === expectedHashHex;
}

export async function createMerchantToken(
  merchantId: string,
  email: string
): Promise<string> {
  const enc = new TextEncoder();
  const payload = JSON.stringify({
    merchantId,
    email,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30, // 30 days
  });

  const payloadB64 = btoa(payload);

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(AUTH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64));
  const sigHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `${payloadB64}.${sigHex}`;
}

export async function verifyMerchantToken(
  token: string | undefined
): Promise<{ merchantId: string; email: string } | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sigHex] = parts;
  const enc = new TextEncoder();

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(AUTH_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigMatch = sigHex.match(/.{1,2}/g);
    if (!sigMatch) return null;
    const sigBytes = new Uint8Array(sigMatch.map((byte) => parseInt(byte, 16)));

    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payloadB64));
    if (!valid) return null;

    const data = JSON.parse(atob(payloadB64));
    if (data.exp && data.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }

    return { merchantId: data.merchantId, email: data.email };
  } catch {
    return null;
  }
}
