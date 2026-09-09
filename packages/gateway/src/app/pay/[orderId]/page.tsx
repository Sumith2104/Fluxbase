import React from 'react';
import { notFound } from 'next/navigation';
import { getPool } from '@/lib/db';
import { CheckoutView } from '@/components/checkout-view';

interface PageProps {
  params: Promise<{ orderId: string }>;
}

export default async function OrderPaymentPage({ params }: PageProps) {
  const { orderId } = await params;
  const pool = getPool();

  const res = await pool.query(
    `SELECT o.id, o.merchant_id, o.base_amount, o.offset_cents, o.final_amount, o.status,
            o.callback_url, o.utr, o.expires_at, o.metadata, v.vpa_address, COALESCE(m.business_name, m.name) as merchant_name
     FROM orders o
     JOIN vpas v ON o.vpa_id = v.id
     JOIN merchants m ON o.merchant_id = m.id
     WHERE o.id = $1`,
    [orderId]
  );

  if (res.rows.length === 0) {
    notFound();
  }

  const order = res.rows[0];
  const planName = metadata?.plan_name || (metadata?.plan ? `${metadata.plan.toUpperCase()} PLAN SUBSCRIPTION` : undefined);

  return (
    <CheckoutView
      order={{
        id: order.id,
        merchantId: order.merchant_id,
        merchant: order.merchant_name,
        title: planName,
        amount: parseFloat(order.base_amount),
        final_amount: parseFloat(order.final_amount),
        vpa: order.vpa_address,
        status: order.status,
        expires_at: order.expires_at.toISOString(),
        callback_url: order.callback_url,
        utr: order.utr,
        coupon: metadata?.coupon || null,
        metadata: metadata,
      }}
    />
  );
}
