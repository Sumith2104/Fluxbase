import { getPool } from './db';
import { generateApiKey, generateWebhookSecret } from './utils';

let _migrationDone = false;

export async function runMigrations(): Promise<void> {
  if (_migrationDone) return;

  const pool = getPool();
  const client = await pool.connect();

  try {
    console.log('[Gateway Migrate] Initializing schema and tables...');

    await client.query(`
      CREATE SCHEMA IF NOT EXISTS gateway;

      CREATE TABLE IF NOT EXISTS gateway.merchants (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(100) NOT NULL,
          email VARCHAR(255) UNIQUE,
          password_hash VARCHAR(255),
          business_name VARCHAR(255),
          phone VARCHAR(20),
          balance NUMERIC(12, 2) DEFAULT 0.00,
          total_earned NUMERIC(12, 2) DEFAULT 0.00,
          payout_upi_id VARCHAR(100),
          payout_bank_acc VARCHAR(50),
          payout_ifsc VARCHAR(20),
          payout_holder_name VARCHAR(100),
          status VARCHAR(20) DEFAULT 'active',
          api_key VARCHAR(64) NOT NULL UNIQUE,
          webhook_url TEXT,
          webhook_secret VARCHAR(64),
          rate_limit_per_min INT DEFAULT 30,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Ensure columns exist if table was already created in prior migration
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE;
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS business_name VARCHAR(255);
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS balance NUMERIC(12, 2) DEFAULT 0.00;
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS total_earned NUMERIC(12, 2) DEFAULT 0.00;
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS payout_upi_id VARCHAR(100);
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS payout_bank_acc VARCHAR(50);
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS payout_ifsc VARCHAR(20);
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS payout_holder_name VARCHAR(100);
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';

      CREATE TABLE IF NOT EXISTS gateway.vpas (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          vpa_address VARCHAR(100) NOT NULL UNIQUE,
          label VARCHAR(50),
          account_suffix VARCHAR(10),
          is_active BOOLEAN DEFAULT true,
          current_load INT DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS gateway.orders (
          id VARCHAR(30) PRIMARY KEY,
          merchant_id UUID NOT NULL REFERENCES gateway.merchants(id),
          idempotency_key VARCHAR(64),
          base_amount INT NOT NULL,
          offset_cents INT NOT NULL,
          final_amount NUMERIC(10,2) NOT NULL,
          vpa_id UUID NOT NULL REFERENCES gateway.vpas(id),
          tier SMALLINT DEFAULT 1,
          status VARCHAR(20) DEFAULT 'pending',
          customer_name VARCHAR(100),
          customer_email VARCHAR(100),
          customer_phone VARCHAR(20),
          metadata JSONB DEFAULT '{}',
          callback_url TEXT,
          merchant_webhook_url TEXT,
          utr VARCHAR(30),
          expires_at TIMESTAMPTZ NOT NULL,
          paid_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          CONSTRAINT uq_gateway_idempotency UNIQUE (merchant_id, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS idx_gw_orders_pending ON gateway.orders (final_amount, vpa_id)
          WHERE status = 'pending';
      CREATE INDEX IF NOT EXISTS idx_gw_orders_expires ON gateway.orders (expires_at)
          WHERE status = 'pending';
      CREATE INDEX IF NOT EXISTS idx_gw_orders_merchant ON gateway.orders (merchant_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS gateway.payment_receipts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id VARCHAR(30) REFERENCES gateway.orders(id),
          utr VARCHAR(30),
          raw_message TEXT,
          sender VARCHAR(100),
          amount NUMERIC(10,2),
          matched BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS gateway.webhook_deliveries (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id VARCHAR(30) NOT NULL REFERENCES gateway.orders(id),
          merchant_id UUID NOT NULL REFERENCES gateway.merchants(id),
          url TEXT NOT NULL,
          payload JSONB NOT NULL,
          signature TEXT NOT NULL,
          status VARCHAR(20) DEFAULT 'pending',
          attempts INT DEFAULT 0,
          max_attempts INT DEFAULT 5,
          last_attempt_at TIMESTAMPTZ,
          next_retry_at TIMESTAMPTZ,
          last_error TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_gw_webhook_retry ON gateway.webhook_deliveries (next_retry_at)
          WHERE status = 'pending' OR status = 'failed';

      CREATE TABLE IF NOT EXISTS gateway.settlements (
          id VARCHAR(32) PRIMARY KEY,
          merchant_id UUID NOT NULL REFERENCES gateway.merchants(id),
          amount NUMERIC(12, 2) NOT NULL,
          status VARCHAR(20) DEFAULT 'pending',
          payout_method VARCHAR(20) DEFAULT 'upi',
          payout_address TEXT NOT NULL,
          utr_reference VARCHAR(64),
          notes TEXT,
          requested_at TIMESTAMPTZ DEFAULT NOW(),
          settled_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_gw_settlements_merchant ON gateway.settlements (merchant_id, requested_at DESC);

      CREATE TABLE IF NOT EXISTS gateway.payment_links (
          id VARCHAR(32) PRIMARY KEY,
          merchant_id UUID NOT NULL REFERENCES gateway.merchants(id),
          title VARCHAR(255) NOT NULL,
          description TEXT,
          amount NUMERIC(10, 2) NOT NULL,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_gw_payment_links_merchant ON gateway.payment_links (merchant_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS gateway.coupons (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          merchant_id UUID NOT NULL REFERENCES gateway.merchants(id) ON DELETE CASCADE,
          code VARCHAR(50) NOT NULL,
          discount_type VARCHAR(20) NOT NULL DEFAULT 'percentage',
          discount_value NUMERIC(10, 2) NOT NULL,
          min_order_amount NUMERIC(10, 2) DEFAULT 0.00,
          max_discount_amount NUMERIC(10, 2),
          usage_limit INT,
          used_count INT DEFAULT 0,
          is_active BOOLEAN DEFAULT true,
          expires_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          CONSTRAINT uq_gateway_coupon_merchant UNIQUE (merchant_id, code)
      );

      CREATE INDEX IF NOT EXISTS idx_gw_coupons_merchant ON gateway.coupons (merchant_id, is_active);

      CREATE OR REPLACE VIEW gateway.vpa_health AS
      SELECT
          v.id,
          v.vpa_address,
          v.label,
          v.current_load,
          v.is_active,
          COUNT(o.id) FILTER (WHERE o.status = 'paid') as paid_count,
          COUNT(o.id) FILTER (WHERE o.status = 'expired') as expired_count,
          ROUND(
              COALESCE(
                  (COUNT(o.id) FILTER (WHERE o.status = 'paid')::numeric /
                  NULLIF(COUNT(o.id) FILTER (WHERE o.status IN ('paid', 'expired')), 0)) * 100,
                  100.0
              ), 1
          ) as success_rate
      FROM gateway.vpas v
      LEFT JOIN gateway.orders o ON o.vpa_id = v.id
          AND o.created_at > NOW() - INTERVAL '24 hours'
      GROUP BY v.id, v.vpa_address, v.label, v.current_load, v.is_active;
    `);

    // Seed active VPAs from environment (supports single or multiple comma-separated VPAs)
    // Format: UPI_VPAS="vpa1@bank:suffix1, vpa2@bank:suffix2, ..."
    const upiListEnv = process.env.UPI_VPAS || '';
    const vpasToSeed: Array<{ address: string; suffix: string | null; label: string }> = [];

    if (upiListEnv) {
      const entries = upiListEnv.split(',').map((s) => s.trim()).filter(Boolean);
      for (let i = 0; i < entries.length; i++) {
        const parts = entries[i].split(':');
        const address = parts[0].trim().toLowerCase();
        const suffix = parts[1] ? parts[1].trim() : (process.env.DEFAULT_UPI_SUFFIX || null);
        if (address.includes('@')) {
          vpasToSeed.push({ address, suffix, label: `UPI Channel ${i + 1}` });
        }
      }
    }

    if (vpasToSeed.length === 0) {
      const defaultUpi = (process.env.DEFAULT_UPI_ID || '918310870493@waaxis').trim().toLowerCase();
      const defaultSuffix = (process.env.DEFAULT_UPI_SUFFIX || '0493').trim();
      vpasToSeed.push({ address: defaultUpi, suffix: defaultSuffix, label: 'Primary UPI Handle' });
    }

    for (const vpa of vpasToSeed) {
      await client.query(
        `INSERT INTO vpas (vpa_address, label, account_suffix, is_active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (vpa_address) DO UPDATE SET 
           account_suffix = COALESCE(EXCLUDED.account_suffix, vpas.account_suffix),
           is_active = true`,
        [vpa.address, vpa.label, vpa.suffix]
      );
      console.log(`[Gateway Migrate] Configured active VPA: ${vpa.address} (suffix: ${vpa.suffix || 'any'})`);
    }

    _migrationDone = true;
    console.log('[Gateway Migrate] Razorpay-style multi-tenant migrations completed successfully.');
  } catch (err) {
    console.error('[Gateway Migrate] Migration error:', err);
    throw err;
  } finally {
    client.release();
  }
}
