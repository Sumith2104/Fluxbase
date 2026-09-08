'use client';

import React, { useState } from 'react';

export const ApiKeysClient: React.FC<{ merchant: any }> = ({ merchant }) => {
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState(merchant.webhook_url || '');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const copyKey = () => {
    navigator.clipboard.writeText(merchant.api_key);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const copySecret = () => {
    navigator.clipboard.writeText(merchant.webhook_secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  const handleSaveWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavedMsg('');
    setSaving(true);

    try {
      const res = await fetch('/api/v1/merchant/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_url: webhookUrl }),
      });

      if (!res.ok) throw new Error('Failed to update webhook URL');
      setSavedMsg('Webhook endpoint saved successfully.');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* API Key Card */}
      <div className="bg-[#121214] border border-[#27272a] rounded-lg p-6 space-y-4">
        <h2 className="text-sm font-bold font-mono uppercase tracking-wider text-[#f4f4f5]">
          LIVE API CREDENTIALS
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
              LIVE SECRET KEY (BEARER TOKEN)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={merchant.api_key}
                style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
                className="flex-1 bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-[#f4f4f5]"
              />
              <button
                type="button"
                onClick={copyKey}
                className="px-4 py-2 bg-[#27272a] hover:bg-[#3f3f46] text-[#f4f4f5] text-xs font-mono rounded transition"
              >
                {copiedKey ? 'COPIED' : 'COPY KEY'}
              </button>
            </div>
            <p className="text-[11px] font-mono text-[#71717a] mt-1">
              Include as Authorization: Bearer header when calling POST /api/v1/orders
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
              WEBHOOK SIGNING SECRET (HMAC-SHA256)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={merchant.webhook_secret}
                style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
                className="flex-1 bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-[#f4f4f5]"
              />
              <button
                type="button"
                onClick={copySecret}
                className="px-4 py-2 bg-[#27272a] hover:bg-[#3f3f46] text-[#f4f4f5] text-xs font-mono rounded transition"
              >
                {copiedSecret ? 'COPIED' : 'COPY SECRET'}
              </button>
            </div>
            <p className="text-[11px] font-mono text-[#71717a] mt-1">
              Used to verify signature in X-FluxPay-Signature header
            </p>
          </div>
        </div>
      </div>

      {/* Webhook Configuration Card */}
      <div className="bg-[#121214] border border-[#27272a] rounded-lg p-6 space-y-4">
        <h2 className="text-sm font-bold font-mono uppercase tracking-wider text-[#f4f4f5]">
          OUTGOING WEBHOOK ENDPOINT
        </h2>
        <p className="text-xs text-[#71717a]">
          FluxPay will automatically send a POST request to this URL when an incoming UPI payment is verified.
        </p>

        {savedMsg && (
          <div className="p-2.5 bg-emerald-950/40 border border-emerald-800/60 rounded text-xs font-mono text-emerald-400">
            {savedMsg}
          </div>
        )}

        <form onSubmit={handleSaveWebhook} className="space-y-3">
          <div>
            <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
              WEBHOOK URL
            </label>
            <input
              type="url"
              placeholder="https://yourapp.com/api/payment-webhook"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
              className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            style={{ backgroundColor: '#ff6600', color: '#000000' }}
            className="px-5 py-2 bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-semibold text-xs font-mono rounded transition disabled:opacity-50"
          >
            {saving ? 'SAVING...' : 'SAVE WEBHOOK ENDPOINT'}
          </button>
        </form>
      </div>

      {/* Integration Code Sample */}
      <div className="bg-[#121214] border border-[#27272a] rounded-lg p-6 space-y-3">
        <h2 className="text-sm font-bold font-mono uppercase tracking-wider text-[#f4f4f5]">
          QUICK INTEGRATION CODE
        </h2>
        <pre className="text-xs font-mono bg-[#0b0b0b] p-4 rounded border border-[#27272a] text-zinc-300 overflow-x-auto">
{`// 1. Create a payment order from your backend:
const res = await fetch("https://payments.fluxbasedb.me/api/v1/orders", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${merchant.api_key}",
    "Idempotency-Key": "unique-order-uuid",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    amount: 499,
    customer_name: "John Doe",
    callback_url: "https://myapp.com/success",
    metadata: { plan: "pro", user_id: "usr_123" }
  })
});

const data = await res.json();
// 2. Redirect user to data.checkout_url (Hosted QR + mobile UPI deep links)`}
        </pre>
      </div>
    </div>
  );
};
