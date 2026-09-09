import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSessionMerchant } from '@/lib/merchant-session';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const merchant = await getSessionMerchant();
    if (!merchant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { orderId } = await params;
    const body = await req.json();

    const pool = getPool();

    // Check existing order
    const checkRes = await pool.query(
      `SELECT id, status, base_amount, final_amount, utr, paid_at
       FROM orders
       WHERE id = $1 AND merchant_id = $2`,
      [orderId, merchant.id]
    );

    if (checkRes.rows.length === 0) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const currentOrder = checkRes.rows[0];
    const newStatus = body.status ? String(body.status).toLowerCase().trim() : currentOrder.status;
    const newUtr = body.utr !== undefined ? (String(body.utr).trim() || null) : currentOrder.utr;
    
    let newBaseAmount = currentOrder.base_amount;
    let newFinalAmount = currentOrder.final_amount;
    if (body.base_amount !== undefined) {
      newBaseAmount = Math.floor(parseFloat(body.base_amount) || currentOrder.base_amount);
    }
    if (body.final_amount !== undefined) {
      newFinalAmount = parseFloat(body.final_amount) || currentOrder.final_amount;
    }

    const customerName = body.customer_name !== undefined ? (String(body.customer_name).trim() || null) : undefined;
    const customerEmail = body.customer_email !== undefined ? (String(body.customer_email).trim() || null) : undefined;

    let newPaidAt = currentOrder.paid_at;
    if (newStatus === 'paid' && currentOrder.status !== 'paid') {
      newPaidAt = new Date().toISOString();
      // Credit merchant balance
      await pool.query(
        `UPDATE merchants
         SET balance = balance + $1,
             total_earned = total_earned + $1
         WHERE id = $2`,
        [newBaseAmount, merchant.id]
      );
    } else if (newStatus !== 'paid' && currentOrder.status === 'paid') {
      newPaidAt = null;
      // Revert merchant balance if un-marking paid
      await pool.query(
        `UPDATE merchants
         SET balance = GREATEST(0, balance - $1),
             total_earned = GREATEST(0, total_earned - $1)
         WHERE id = $2`,
        [currentOrder.base_amount, merchant.id]
      );
    }

    // Dynamic update query
    const updates: string[] = [
      `status = $1`,
      `utr = $2`,
      `base_amount = $3`,
      `final_amount = $4`,
      `paid_at = $5`,
    ];
    const queryParams: any[] = [newStatus, newUtr, newBaseAmount, newFinalAmount, newPaidAt];

    if (customerName !== undefined) {
      queryParams.push(customerName);
      updates.push(`customer_name = $${queryParams.length}`);
    }
    if (customerEmail !== undefined) {
      queryParams.push(customerEmail);
      updates.push(`customer_email = $${queryParams.length}`);
    }

    queryParams.push(orderId, merchant.id);
    const updateSql = `
      UPDATE orders
      SET ${updates.join(', ')}
      WHERE id = $${queryParams.length - 1} AND merchant_id = $${queryParams.length}
      RETURNING *
    `;

    const updateRes = await pool.query(updateSql, queryParams);

    return NextResponse.json({
      success: true,
      order: updateRes.rows[0],
    });
  } catch (err: any) {
    console.error('[Dashboard Order PATCH Error]:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const merchant = await getSessionMerchant();
    if (!merchant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { orderId } = await params;
    const pool = getPool();

    // Check order exists
    const checkRes = await pool.query(
      `SELECT id, status, base_amount FROM orders WHERE id = $1 AND merchant_id = $2`,
      [orderId, merchant.id]
    );

    if (checkRes.rows.length === 0) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Delete any associated receipts first
    await pool.query(`DELETE FROM payment_receipts WHERE order_id = $1`, [orderId]);

    // Delete order
    await pool.query(
      `DELETE FROM orders WHERE id = $1 AND merchant_id = $2`,
      [orderId, merchant.id]
    );

    return NextResponse.json({
      success: true,
      deletedOrderId: orderId,
    });
  } catch (err: any) {
    console.error('[Dashboard Order DELETE Error]:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
