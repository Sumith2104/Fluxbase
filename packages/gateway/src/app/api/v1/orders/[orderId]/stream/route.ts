import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;
  const pool = getPool();

  const responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  const encoder = new TextEncoder();

  let isClosed = false;

  const closeStream = async () => {
    if (!isClosed) {
      isClosed = true;
      try {
        await writer.close();
      } catch {}
    }
  };

  req.signal.addEventListener('abort', closeStream);

  (async () => {
    try {
      let loops = 0;
      // Stream for up to 120 seconds (covering full 90s window + buffer)
      while (!isClosed && loops < 120) {
        loops++;

        const res = await pool.query(
          `SELECT status, utr, callback_url, expires_at, paid_at
           FROM orders
           WHERE id = $1`,
          [orderId]
        );

        if (res.rows.length === 0) {
          await writer.write(
            encoder.encode(`data: ${JSON.stringify({ error: 'Order not found' })}\n\n`)
          );
          break;
        }

        const order = res.rows[0];
        const isExpired =
          order.status === 'pending' && new Date(order.expires_at).getTime() < Date.now();
        const currentStatus = isExpired ? 'expired' : order.status;

        const remainingSeconds = Math.max(
          0,
          Math.floor((new Date(order.expires_at).getTime() - Date.now()) / 1000)
        );

        const data = {
          status: currentStatus,
          utr: order.utr,
          callback_url: order.callback_url,
          remaining_seconds: remainingSeconds,
        };

        await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

        if (currentStatus === 'paid' || currentStatus === 'expired') {
          // Terminal state reached
          break;
        }

        // Wait 1 second before next poll
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (err) {
      // Connection dropped or stream terminated
    } finally {
      await closeStream();
    }
  })();

  return new Response(responseStream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
