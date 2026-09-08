import React from 'react';
import { notFound } from 'next/navigation';
import { getPool } from '@/lib/db';
import { LinkCheckoutView } from '@/components/link-checkout-view';

interface PageProps {
  params: Promise<{ linkId: string }>;
}

export default async function PaymentLinkPage({ params }: PageProps) {
  const { linkId } = await params;
  const pool = getPool();

  const linkRes = await pool.query(
    `SELECT l.*, COALESCE(m.business_name, m.name) as merchant_name 
     FROM payment_links l
     JOIN merchants m ON l.merchant_id = m.id
     WHERE l.id = $1 AND l.is_active = true`,
    [linkId]
  );

  if (linkRes.rows.length === 0) {
    notFound();
  }

  const link = linkRes.rows[0];

  return (
    <LinkCheckoutView
      link={{
        id: link.id,
        merchantId: link.merchant_id,
        merchantName: link.merchant_name,
        title: link.title,
        description: link.description,
        amount: parseFloat(link.amount),
      }}
    />
  );
}
