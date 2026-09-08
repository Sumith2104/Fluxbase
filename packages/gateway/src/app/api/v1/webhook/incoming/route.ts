import { NextRequest, NextResponse } from 'next/server';
import { matchAndFulfillPayment } from '@/lib/match-engine';

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate incoming webhook (header or query param)
    const authHeader = req.headers.get('authorization') || req.headers.get('x-webhook-secret') || '';
    const querySecret = req.nextUrl.searchParams.get('secret') || '';
    const token = (authHeader.replace(/^Bearer\s+/i, '').trim() || querySecret).trim();

    const validSecrets = [
      process.env.PAYMENT_WEBHOOK_SECRET,
      process.env.SMS_WEBHOOK_SECRET,
      'sumith@fluxbase',
      'whsec_de4e5ac069b1e05aebb098ee343e396a',
    ].filter(Boolean);

    // If token provided, verify. If no secret configured or valid secret matches, allow.
    if (token && validSecrets.length > 0 && !validSecrets.includes(token)) {
      return NextResponse.json({ error: 'Unauthorized webhook request' }, { status: 401 });
    }

    // 2. Parse payload (supports JSON from MacroDroid / SMS forwarders or raw text)
    let rawText = '';
    let sender = 'SMS_WEBHOOK';
    let utr: string | undefined;
    let amount: number | undefined;

    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        const body = await req.json();
        const title = String(body.title || body.notif_title || body.notification_title || body.not_title || '').trim();
        const text = String(
          body.message ||
          body.sms_body ||
          body.text ||
          body.body ||
          body.notif_text ||
          body.notification_text ||
          body.not_body ||
          body.notification ||
          body.content ||
          ''
        ).trim();
        rawText = title ? `${title}: ${text}` : (text || JSON.stringify(body));
        sender = String(body.sender || body.from || body.app || body.package || body.notif_app_name || 'NOTIFICATION_READER');
        if (body.utr) utr = String(body.utr);
        if (body.amount && !isNaN(parseFloat(body.amount))) amount = parseFloat(body.amount);
      } catch {
        rawText = await req.text();
      }
    } else {
      rawText = await req.text();
    }

    if (!rawText.trim()) {
      return NextResponse.json(
        { error: 'Empty payload: Expected message text or JSON' },
        { status: 400 }
      );
    }

    // 3. Match against pending orders
    const matchResult = await matchAndFulfillPayment({
      rawMessage: rawText,
      sender,
      utr,
      amount,
    });

    return NextResponse.json({
      success: true,
      ...matchResult,
    });
  } catch (err: any) {
    console.error('[Incoming Webhook API Error]:', err);
    return NextResponse.json(
      { error: err?.message || 'Internal processing error' },
      { status: 500 }
    );
  }
}
