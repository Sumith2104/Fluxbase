import { getPool } from './db';
import { redis } from './redis';

export interface AllocatedSlot {
  vpaId: string;
  vpaAddress: string;
  offsetCents: number;
  tier: 1 | 2;
  finalAmount: number;
  slotKey: string;
}

export class CapacityError extends Error {
  constructor(message = 'All payment channels are currently occupied. Please try again shortly.') {
    super(message);
    this.name = 'CapacityError';
  }
}

/**
 * Atomically allocates a unique paisa-offset slot using Redis SETNX with a 90-second TTL.
 * Uses round-robin / least-loaded VPA routing and falls back to Tier-2 micro-discount if Tier-1 is full.
 */
export async function allocateSlot(
  baseAmount: number,
  orderId: string
): Promise<AllocatedSlot> {
  const pool = getPool();

  // 1. Fetch active VPAs ordered by current active load ASC
  const vpaRes = await pool.query(
    `SELECT id, vpa_address, current_load 
     FROM vpas 
     WHERE is_active = true 
     ORDER BY current_load ASC, created_at ASC`
  );

  if (vpaRes.rows.length === 0) {
    throw new Error('No active UPI VPAs configured in payment gateway.');
  }

  const vpas = vpaRes.rows;

  // 2. Try Tier-1: Exact base amount with offset 1..99 across all VPAs
  for (const vpa of vpas) {
    for (let offset = 1; offset <= 99; offset++) {
      const slotKey = `slot:${vpa.vpa_address}:${baseAmount}:${offset}`;
      const locked = await redis.set(slotKey, orderId, { nx: true, ex: 90 });

      if (locked === 'OK') {
        // Successfully acquired atomic slot
        await pool.query(
          'UPDATE vpas SET current_load = current_load + 1 WHERE id = $1',
          [vpa.id]
        );

        const finalAmount = parseFloat((baseAmount + offset / 100).toFixed(2));
        return {
          vpaId: vpa.id,
          vpaAddress: vpa.vpa_address,
          offsetCents: offset,
          tier: 1,
          finalAmount,
          slotKey,
        };
      }
    }
  }

  // 3. Try Tier-2: Micro-discount (baseAmount - 1) with offset 1..99
  const discountedBase = Math.max(1, baseAmount - 1);
  for (const vpa of vpas) {
    for (let offset = 1; offset <= 99; offset++) {
      const slotKey = `slot:${vpa.vpa_address}:${discountedBase}:${offset}`;
      const locked = await redis.set(slotKey, orderId, { nx: true, ex: 90 });

      if (locked === 'OK') {
        await pool.query(
          'UPDATE vpas SET current_load = current_load + 1 WHERE id = $1',
          [vpa.id]
        );

        const finalAmount = parseFloat((discountedBase + offset / 100).toFixed(2));
        return {
          vpaId: vpa.id,
          vpaAddress: vpa.vpa_address,
          offsetCents: offset,
          tier: 2,
          finalAmount,
          slotKey,
        };
      }
    }
  }

  // All 198 slots per VPA across all VPAs are currently claimed
  throw new CapacityError();
}

/**
 * Instantly frees the atomic Redis slot when payment is confirmed or order canceled.
 */
export async function releaseSlot(
  vpaAddress: string,
  baseAmount: number,
  offsetCents: number,
  vpaId?: string
): Promise<void> {
  const slotKey = `slot:${vpaAddress}:${baseAmount}:${offsetCents}`;
  await redis.del(slotKey);

  if (vpaId) {
    const pool = getPool();
    await pool.query(
      'UPDATE vpas SET current_load = GREATEST(0, current_load - 1) WHERE id = $1',
      [vpaId]
    ).catch(() => {});
  }
}
