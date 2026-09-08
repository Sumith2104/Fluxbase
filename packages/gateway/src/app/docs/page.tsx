'use client';

import React, { useState } from 'react';
import Link from 'next/link';

export default function DocsPage() {
  const [activeTab, setActiveTab] = useState<'node' | 'python' | 'curl'>('node');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const createOrderCurl = `curl -X POST https://payments.fluxbasedb.me/api/v1/orders \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sec_live_YOUR_MERCHANT_KEY" \\
  -d '{
    "amount": 499.00,
    "customer_name": "Rajesh Kumar",
    "customer_email": "rajesh@example.com",
    "customer_phone": "9876543210",
    "callback_url": "https://yourapp.com/checkout/success",
    "webhook_url": "https://yourapp.com/api/webhooks/fluxpay",
    "metadata": {
      "user_id": "usr_94812",
      "plan": "starter_monthly"
    }
  }'`;

  const createOrderNode = `import axios from 'axios';

// 1. Initiate Payment Order
export async function createPaymentOrder() {
  const res = await axios.post(
    'https://payments.fluxbasedb.me/api/v1/orders',
    {
      amount: 499.00,
      customer_name: 'Rajesh Kumar',
      customer_email: 'rajesh@example.com',
      customer_phone: '9876543210',
      callback_url: 'https://yourapp.com/checkout/success',
      webhook_url: 'https://yourapp.com/api/webhooks/fluxpay',
      metadata: {
        userId: 'usr_94812',
        cartId: 'cart_0982'
      }
    },
    {
      headers: {
        'Authorization': \`Bearer \${process.env.FLUXPAY_API_KEY}\`,
        'Content-Type': 'application/json'
      }
    }
  );

  const { order_id, checkout_url } = res.data;
  
  // 2. Redirect user or render embedded checkout
  console.log('Order created:', order_id);
  return checkout_url; // e.g. https://payments.fluxbasedb.me/pay/ord_xxxx
}`;

  const createOrderPython = `import os
import requests

def create_fluxpay_order():
    api_key = os.getenv("FLUXPAY_API_KEY")
    
    payload = {
        "amount": 499.00,
        "customer_name": "Rajesh Kumar",
        "customer_email": "rajesh@example.com",
        "customer_phone": "9876543210",
        "callback_url": "https://yourapp.com/checkout/success",
        "webhook_url": "https://yourapp.com/api/webhooks/fluxpay",
        "metadata": {
            "user_id": "usr_94812"
        }
    }
    
    response = requests.post(
        "https://payments.fluxbasedb.me/api/v1/orders",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        },
        json=payload
    )
    
    data = response.json()
    print("Redirect customer to:", data["checkout_url"])
    return data["checkout_url"]`;

  const webhookVerifyNode = `import crypto from 'crypto';

// Next.js App Router Webhook Route: src/app/api/webhooks/fluxpay/route.ts
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signatureHeader = req.headers.get('x-fluxpay-signature') || '';
  
  // Parse header: "t=1725839000,v1=abc123hash..."
  const parts = Object.fromEntries(
    signatureHeader.split(',').map(kv => kv.split('='))
  );
  
  const timestamp = parts['t'];
  const expectedSig = parts['v1'];
  const secret = process.env.FLUXPAY_WEBHOOK_SECRET!; // From dashboard Settings
  
  // Compute expected HMAC SHA-256
  const signedPayload = \`\${timestamp}.\${rawBody}\`;
  const computedSig = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  if (computedSig !== expectedSig) {
    return new Response('Invalid webhook signature', { status: 400 });
  }

  const event = JSON.parse(rawBody);
  
  if (event.event === 'payment.succeeded') {
    const { order_id, amount, utr, metadata } = event;
    console.log(\`Order \${order_id} PAID: ₹\${amount} (UTR: \${utr})\`);
    
    // Unlock customer features or deliver order
    // await db.fulfillOrder(metadata.userId);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}`;

  const webhookVerifyPython = `import hmac
import hashlib
import json
from flask import Flask, request, jsonify

app = Flask(__name__)
WEBHOOK_SECRET = "whsec_your_secret_from_settings"

@app.route("/api/webhooks/fluxpay", methods=["POST"])
def fluxpay_webhook():
    raw_body = request.get_data(as_text=True)
    signature_header = request.headers.get("X-FluxPay-Signature", "")
    
    # Parse header: "t=1725839000,v1=hash..."
    parts = dict(item.split("=") for item in signature_header.split(",") if "=" in item)
    timestamp = parts.get("t", "")
    expected_sig = parts.get("v1", "")
    
    # Compute HMAC SHA-256
    signed_payload = f"{timestamp}.{raw_body}".encode("utf-8")
    computed_sig = hmac.new(
        WEBHOOK_SECRET.encode("utf-8"),
        signed_payload,
        hashlib.sha256
    ).hexdigest()
    
    if computed_sig != expected_sig:
        return "Invalid signature", 400
        
    data = json.loads(raw_body)
    if data.get("event") == "payment.succeeded":
        order_id = data.get("order_id")
        amount = data.get("amount")
        utr = data.get("utr")
        print(f"Payment received for order {order_id}: ₹{amount}, UTR: {utr}")
        
    return jsonify({"received": True}), 200`;

  return (
    <div className="min-h-screen bg-[#0b0b0b] text-[#f4f4f5] flex flex-col selection:bg-[#ff6600] selection:text-black">
      {/* Header */}
      <header className="border-b border-[#27272a] bg-[#121214] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex flex-col">
              <span className="text-[10px] font-mono text-[#ff6600] uppercase tracking-widest font-bold">
                FLUXPAY // DOCUMENTATION
              </span>
              <span className="text-sm font-bold text-[#f4f4f5] tracking-tight font-mono">
                DEVELOPER API REFERENCE
              </span>
            </Link>

            <nav className="hidden md:flex items-center gap-6 text-xs font-mono text-[#a1a1aa]">
              <a href="#quickstart" className="hover:text-[#f4f4f5] transition">QUICKSTART</a>
              <a href="#create-order" className="hover:text-[#f4f4f5] transition">CREATE ORDER</a>
              <a href="#check-status" className="hover:text-[#f4f4f5] transition">CHECK STATUS</a>
              <a href="#webhooks" className="hover:text-[#f4f4f5] transition">WEBHOOKS</a>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/apikeys"
              className="px-3 py-1.5 text-xs font-mono font-semibold uppercase bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[#f4f4f5] rounded transition"
            >
              GET API KEYS
            </Link>
            <Link
              href="/dashboard"
              style={{ backgroundColor: '#ff6600', color: '#000000' }}
              className="px-3 py-1.5 text-xs font-mono font-bold uppercase rounded hover:bg-[#ff7a1a] transition"
            >
              DASHBOARD
            </Link>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="max-w-7xl w-full mx-auto px-6 py-12 flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Sidebar Nav */}
        <aside className="lg:col-span-3 space-y-6">
          <div className="bg-[#121214] border border-[#27272a] p-4 rounded-lg space-y-3 sticky top-24">
            <div className="text-[10px] font-mono text-[#71717a] uppercase font-bold tracking-wider">
              DOCUMENTATION INDEX
            </div>
            <nav className="flex flex-col space-y-2 text-xs font-mono text-[#a1a1aa]">
              <a href="#quickstart" className="hover:text-[#ff6600] transition">1. Quickstart Guide</a>
              <a href="#authentication" className="hover:text-[#ff6600] transition">2. Authentication</a>
              <a href="#create-order" className="hover:text-[#ff6600] transition">3. Create Payment Order</a>
              <a href="#check-status" className="hover:text-[#ff6600] transition">4. Polling &amp; SSE Stream</a>
              <a href="#webhooks" className="hover:text-[#ff6600] transition">5. Outbound Webhooks</a>
              <a href="#signature" className="hover:text-[#ff6600] transition">6. Signature Verification</a>
              <a href="#errors" className="hover:text-[#ff6600] transition">7. Error Handling</a>
            </nav>

            <div className="pt-4 border-t border-[#27272a]">
              <div className="text-[10px] font-mono text-[#71717a] uppercase">BASE PRODUCTION URL</div>
              <div className="text-[11px] font-mono text-[#ff6600] mt-1 break-all select-all">
                https://payments.fluxbasedb.me
              </div>
            </div>
          </div>
        </aside>

        {/* Content Area */}
        <main className="lg:col-span-9 space-y-12">
          {/* Quickstart */}
          <section id="quickstart" className="space-y-4">
            <div className="text-[10px] font-mono text-[#ff6600] uppercase font-bold tracking-wider">
              [SECTION 01]
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-[#f4f4f5]">
              Quickstart Integration
            </h1>
            <p className="text-sm text-[#a1a1aa] leading-relaxed">
              Integrate real-time UPI payments into your application in three simple steps:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="bg-[#121214] border border-[#27272a] p-4 rounded space-y-2">
                <div className="text-xs font-mono text-[#ff6600] font-bold">STEP 1</div>
                <div className="text-sm font-semibold text-[#f4f4f5]">Get Live API Key</div>
                <p className="text-xs text-[#a1a1aa]">
                  Sign up and grab your <code className="text-[#ff6600]">sec_live_...</code> API key from the Dashboard.
                </p>
              </div>

              <div className="bg-[#121214] border border-[#27272a] p-4 rounded space-y-2">
                <div className="text-xs font-mono text-[#ff6600] font-bold">STEP 2</div>
                <div className="text-sm font-semibold text-[#f4f4f5]">Create Payment Order</div>
                <p className="text-xs text-[#a1a1aa]">
                  Call <code className="text-[#ff6600]">POST /api/v1/orders</code> and redirect your user to the generated <code className="text-[#f4f4f5]">checkout_url</code>.
                </p>
              </div>

              <div className="bg-[#121214] border border-[#27272a] p-4 rounded space-y-2">
                <div className="text-xs font-mono text-[#ff6600] font-bold">STEP 3</div>
                <div className="text-sm font-semibold text-[#f4f4f5]">Receive Webhook</div>
                <p className="text-xs text-[#a1a1aa]">
                  Listen for <code className="text-[#ff6600]">payment.succeeded</code> webhook on your server with HMAC verification.
                </p>
              </div>
            </div>
          </section>

          {/* Authentication */}
          <section id="authentication" className="space-y-4 pt-6 border-t border-[#27272a]">
            <div className="text-[10px] font-mono text-[#ff6600] uppercase font-bold tracking-wider">
              [SECTION 02]
            </div>
            <h2 className="text-2xl font-bold text-[#f4f4f5]">Authentication</h2>
            <p className="text-xs text-[#a1a1aa] leading-relaxed">
              All REST API requests require your merchant API key passed via the <code className="text-[#ff6600]">Authorization</code> header or <code className="text-[#ff6600]">x-api-key</code> header.
            </p>
            <div className="bg-[#121214] border border-[#27272a] p-4 rounded font-mono text-xs text-[#d4d4d8]">
              <code>Authorization: Bearer sec_live_YOUR_MERCHANT_KEY</code>
            </div>
          </section>

          {/* Create Order */}
          <section id="create-order" className="space-y-6 pt-6 border-t border-[#27272a]">
            <div>
              <div className="text-[10px] font-mono text-[#ff6600] uppercase font-bold tracking-wider">
                [SECTION 03]
              </div>
              <h2 className="text-2xl font-bold text-[#f4f4f5]">Create Payment Order</h2>
              <div className="flex items-center gap-2 mt-2">
                <span className="px-2 py-0.5 bg-emerald-950 border border-emerald-800 text-emerald-400 font-mono text-xs font-bold rounded">
                  POST
                </span>
                <span className="font-mono text-xs text-[#f4f4f5]">/api/v1/orders</span>
              </div>
            </div>

            {/* Request Parameters Table */}
            <div className="overflow-x-auto border border-[#27272a] rounded-lg">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#18181b] text-[#a1a1aa] border-b border-[#27272a]">
                  <tr>
                    <th className="p-3">PARAMETER</th>
                    <th className="p-3">TYPE</th>
                    <th className="p-3">REQUIRED</th>
                    <th className="p-3">DESCRIPTION</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#27272a] bg-[#121214] text-[#d4d4d8]">
                  <tr>
                    <td className="p-3 text-[#ff6600]">amount</td>
                    <td className="p-3 text-[#71717a]">number</td>
                    <td className="p-3 text-rose-400">Yes</td>
                    <td className="p-3">The integer or decimal order amount in INR (e.g. 499.00)</td>
                  </tr>
                  <tr>
                    <td className="p-3 text-[#ff6600]">coupon_code</td>
                    <td className="p-3 text-[#71717a]">string</td>
                    <td className="p-3 text-[#71717a]">No</td>
                    <td className="p-3">Optional discount coupon (e.g. "SAVE20", "FLAT50") automatically validated and deducted</td>
                  </tr>
                  <tr>
                    <td className="p-3 text-[#ff6600]">customer_name</td>
                    <td className="p-3 text-[#71717a]">string</td>
                    <td className="p-3 text-[#71717a]">No</td>
                    <td className="p-3">Payer's full name</td>
                  </tr>
                  <tr>
                    <td className="p-3 text-[#ff6600]">customer_email</td>
                    <td className="p-3 text-[#71717a]">string</td>
                    <td className="p-3 text-[#71717a]">No</td>
                    <td className="p-3">Payer's email address for notifications</td>
                  </tr>
                  <tr>
                    <td className="p-3 text-[#ff6600]">customer_phone</td>
                    <td className="p-3 text-[#71717a]">string</td>
                    <td className="p-3 text-[#71717a]">No</td>
                    <td className="p-3">10-digit mobile number</td>
                  </tr>
                  <tr>
                    <td className="p-3 text-[#ff6600]">callback_url</td>
                    <td className="p-3 text-[#71717a]">string</td>
                    <td className="p-3 text-[#71717a]">No</td>
                    <td className="p-3">Redirect destination after customer completes payment</td>
                  </tr>
                  <tr>
                    <td className="p-3 text-[#ff6600]">webhook_url</td>
                    <td className="p-3 text-[#71717a]">string</td>
                    <td className="p-3 text-[#71717a]">No</td>
                    <td className="p-3">Override default webhook destination for this specific order</td>
                  </tr>
                  <tr>
                    <td className="p-3 text-[#ff6600]">metadata</td>
                    <td className="p-3 text-[#71717a]">object</td>
                    <td className="p-3 text-[#71717a]">No</td>
                    <td className="p-3">Arbitrary key-value JSON stored and returned with webhooks</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Code Switcher */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-mono text-[#a1a1aa]">IMPLEMENTATION EXAMPLE:</div>
                <div className="flex items-center gap-1 bg-[#121214] border border-[#27272a] p-1 rounded font-mono text-xs">
                  {(['node', 'python', 'curl'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-3 py-1 rounded transition uppercase ${
                        activeTab === tab
                          ? 'bg-[#ff6600] text-black font-bold'
                          : 'text-[#a1a1aa] hover:text-[#f4f4f5]'
                      }`}
                    >
                      {tab === 'node' ? 'Node.js' : tab}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-[#121214] border border-[#27272a] rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-[#18181b] border-b border-[#27272a] text-xs font-mono">
                  <span className="text-[#a1a1aa]">Create Order Code</span>
                  <button
                    onClick={() =>
                      handleCopy(
                        'createOrder',
                        activeTab === 'node'
                          ? createOrderNode
                          : activeTab === 'python'
                          ? createOrderPython
                          : createOrderCurl
                      )
                    }
                    className="px-2 py-0.5 bg-[#27272a] hover:bg-[#3f3f46] text-[#f4f4f5] rounded text-[10px] uppercase"
                  >
                    {copiedId === 'createOrder' ? '[COPIED]' : '[COPY]'}
                  </button>
                </div>
                <pre className="p-4 text-xs font-mono text-[#d4d4d8] overflow-x-auto leading-relaxed">
                  <code>
                    {activeTab === 'node' && createOrderNode}
                    {activeTab === 'python' && createOrderPython}
                    {activeTab === 'curl' && createOrderCurl}
                  </code>
                </pre>
              </div>
            </div>

            {/* Sample Success Response */}
            <div className="space-y-2">
              <div className="text-xs font-mono text-[#a1a1aa]">SUCCESS RESPONSE (201 CREATED):</div>
              <div className="bg-[#121214] border border-[#27272a] rounded-lg p-4 font-mono text-xs text-[#a1a1aa] overflow-x-auto">
                <pre>
{`{
  "success": true,
  "order_id": "ord_8f921b7c",
  "order": {
    "id": "ord_8f921b7c",
    "amount": 499,
    "final_amount": 499.14,
    "vpa": "sumith0909@ibl",
    "status": "pending",
    "expires_at": "2026-09-09T01:30:00.000Z"
  },
  "checkout_url": "https://payments.fluxbasedb.me/pay/ord_8f921b7c"
}`}
                </pre>
              </div>
            </div>
          </section>

          {/* Polling & SSE Stream */}
          <section id="check-status" className="space-y-6 pt-6 border-t border-[#27272a]">
            <div>
              <div className="text-[10px] font-mono text-[#ff6600] uppercase font-bold tracking-wider">
                [SECTION 04]
              </div>
              <h2 className="text-2xl font-bold text-[#f4f4f5]">Checking Order Status</h2>
              <p className="text-xs text-[#a1a1aa] mt-1">
                You can query the order state on-demand or subscribe to live server-sent events (SSE).
              </p>
            </div>

            <div className="space-y-4">
              <div className="p-4 bg-[#121214] border border-[#27272a] rounded space-y-2">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-blue-950 border border-blue-800 text-blue-400 font-mono text-xs font-bold rounded">
                    GET
                  </span>
                  <span className="font-mono text-xs text-[#f4f4f5]">/api/v1/orders/{'{order_id}'}</span>
                </div>
                <p className="text-xs text-[#a1a1aa]">
                  Returns the latest order JSON with status: <code className="text-[#ff6600]">pending</code>, <code className="text-emerald-400">paid</code>, or <code className="text-rose-400">expired</code>.
                </p>
              </div>

              <div className="p-4 bg-[#121214] border border-[#27272a] rounded space-y-2">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-purple-950 border border-purple-800 text-purple-400 font-mono text-xs font-bold rounded">
                    SSE
                  </span>
                  <span className="font-mono text-xs text-[#f4f4f5]">/api/v1/orders/{'{order_id}'}/stream</span>
                </div>
                <p className="text-xs text-[#a1a1aa]">
                  Standard EventSource stream that emits payment confirmation the exact millisecond the bank SMS reconciles.
                </p>
              </div>
            </div>
          </section>

          {/* Outbound Webhooks & HMAC */}
          <section id="webhooks" className="space-y-6 pt-6 border-t border-[#27272a]">
            <div>
              <div className="text-[10px] font-mono text-[#ff6600] uppercase font-bold tracking-wider">
                [SECTION 05]
              </div>
              <h2 className="text-2xl font-bold text-[#f4f4f5]">Outbound Webhooks</h2>
              <p className="text-xs text-[#a1a1aa] mt-1">
                When an order is successfully matched, FluxPay dispatches an automated HTTP POST request to your webhook URL.
              </p>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-mono text-[#a1a1aa]">WEBHOOK PAYLOAD SCHEMA:</div>
              <div className="bg-[#121214] border border-[#27272a] rounded-lg p-4 font-mono text-xs text-[#a1a1aa] overflow-x-auto">
                <pre>
{`{
  "event": "payment.succeeded",
  "order_id": "ord_8f921b7c",
  "amount": 499.14,
  "base_amount": 499.00,
  "utr": "625374829102",
  "paid_at": "2026-09-09T01:25:34.000Z",
  "customer": {
    "name": "Rajesh Kumar",
    "email": "rajesh@example.com",
    "phone": "9876543210"
  },
  "metadata": {
    "user_id": "usr_94812"
  }
}`}
                </pre>
              </div>
            </div>

            {/* Signature Verification */}
            <div id="signature" className="space-y-4 pt-4">
              <h3 className="text-lg font-bold text-[#f4f4f5]">
                Verifying Webhook Signatures
              </h3>
              <p className="text-xs text-[#a1a1aa] leading-relaxed">
                FluxPay includes the <code className="text-[#ff6600]">X-FluxPay-Signature</code> header with every webhook delivery in the format <code className="text-[#f4f4f5]">t=timestamp,v1=signature</code>. Always verify this signature on your server before trusting the event.
              </p>

              <div className="bg-[#121214] border border-[#27272a] rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-[#18181b] border-b border-[#27272a] text-xs font-mono">
                  <span className="text-[#a1a1aa]">Node.js / Next.js Verification Code</span>
                  <button
                    onClick={() => handleCopy('webhookVerify', webhookVerifyNode)}
                    className="px-2 py-0.5 bg-[#27272a] hover:bg-[#3f3f46] text-[#f4f4f5] rounded text-[10px] uppercase"
                  >
                    {copiedId === 'webhookVerify' ? '[COPIED]' : '[COPY]'}
                  </button>
                </div>
                <pre className="p-4 text-xs font-mono text-[#d4d4d8] overflow-x-auto leading-relaxed">
                  <code>{webhookVerifyNode}</code>
                </pre>
              </div>

              <div className="bg-[#121214] border border-[#27272a] rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-[#18181b] border-b border-[#27272a] text-xs font-mono">
                  <span className="text-[#a1a1aa]">Python / Flask Verification Code</span>
                  <button
                    onClick={() => handleCopy('webhookVerifyPy', webhookVerifyPython)}
                    className="px-2 py-0.5 bg-[#27272a] hover:bg-[#3f3f46] text-[#f4f4f5] rounded text-[10px] uppercase"
                  >
                    {copiedId === 'webhookVerifyPy' ? '[COPIED]' : '[COPY]'}
                  </button>
                </div>
                <pre className="p-4 text-xs font-mono text-[#d4d4d8] overflow-x-auto leading-relaxed">
                  <code>{webhookVerifyPython}</code>
                </pre>
              </div>
            </div>
          </section>

          {/* Footer inside main */}
          <section className="pt-8 border-t border-[#27272a] flex items-center justify-between text-xs font-mono text-[#71717a]">
            <div>FLUXPAY // DEVELOPER DOCUMENTATION</div>
            <Link href="/dashboard" className="text-[#ff6600] hover:underline">
              GO TO MERCHANT DASHBOARD -&gt;
            </Link>
          </section>
        </main>
      </div>
    </div>
  );
}
