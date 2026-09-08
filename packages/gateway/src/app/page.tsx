'use client';

import React, { useState } from 'react';
import Link from 'next/link';

export default function LandingPage() {
  const [activeTab, setActiveTab] = useState<'curl' | 'node' | 'python'>('curl');
  const [copied, setCopied] = useState(false);

  const codeSnippets = {
    curl: `curl -X POST https://payments.fluxbasedb.me/api/v1/orders/create \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sec_live_merchant_key" \\
  -d '{
    "amount": 499.00,
    "customer_name": "Rajesh Kumar",
    "customer_email": "rajesh@example.com",
    "customer_phone": "9876543210",
    "redirect_url": "https://myapp.com/checkout/success"
  }'`,
    node: `import axios from 'axios';

const { data } = await axios.post(
  'https://payments.fluxbasedb.me/api/v1/orders/create',
  {
    amount: 499.00,
    customer_name: 'Rajesh Kumar',
    customer_email: 'rajesh@example.com',
    customer_phone: '9876543210',
    redirect_url: 'https://myapp.com/checkout/success'
  },
  {
    headers: {
      'Authorization': 'Bearer sec_live_merchant_key'
    }
  }
);

console.log('Payment Link:', data.order.payment_url);`,
    python: `import requests

res = requests.post(
    "https://payments.fluxbasedb.me/api/v1/orders/create",
    headers={"Authorization": "Bearer sec_live_merchant_key"},
    json={
        "amount": 499.00,
        "customer_name": "Rajesh Kumar",
        "customer_email": "rajesh@example.com",
        "customer_phone": "9876543210",
        "redirect_url": "https://myapp.com/checkout/success"
    }
)

order = res.json()["order"]
print("Payment URL:", order["payment_url"])`
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#0b0b0b] text-[#f4f4f5] flex flex-col selection:bg-[#ff6600] selection:text-black">
      {/* Top Banner */}
      <div className="bg-[#121214] border-b border-[#27272a] text-center py-2 px-4 text-[11px] font-mono text-[#a1a1aa] flex items-center justify-center gap-3">
        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <span className="text-[#f4f4f5] font-semibold">GATEWAY ONLINE</span>
        <span className="text-[#3f3f46]">|</span>
        <span>6 STATE BANK OF INDIA VPAs ACTIVE IN ROTATION</span>
        <span className="text-[#3f3f46]">|</span>
        <span className="text-[#ff6600]">0% TRANSACTION COMMISSIONS</span>
      </div>

      {/* Main Navigation */}
      <header className="border-b border-[#27272a] bg-[#0b0b0b]/90 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex flex-col">
              <span className="text-[10px] font-mono text-[#ff6600] uppercase tracking-widest font-bold">
                FLUXPAY // GATEWAY
              </span>
              <span className="text-base font-bold text-[#f4f4f5] tracking-tight font-mono">
                PAYMENTS.FLUXBASEDB.ME
              </span>
            </Link>

            <nav className="hidden md:flex items-center gap-6 text-xs font-mono text-[#a1a1aa]">
              <a href="#features" className="hover:text-[#f4f4f5] transition">FEATURES</a>
              <a href="#architecture" className="hover:text-[#f4f4f5] transition">ARCHITECTURE</a>
              <Link href="/docs" className="hover:text-[#f4f4f5] transition text-[#ff6600]">API_DOCS</Link>
              <a href="#settlement" className="hover:text-[#f4f4f5] transition">SETTLEMENTS</a>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="px-4 py-2 text-xs font-mono font-semibold uppercase bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[#f4f4f5] rounded transition"
            >
              CLIENT LOGIN
            </Link>
            <Link
              href="/signup"
              style={{ backgroundColor: '#ff6600', color: '#000000' }}
              className="px-4 py-2 text-xs font-mono font-bold uppercase rounded hover:bg-[#ff7a1a] transition"
            >
              CREATE ACCOUNT -&gt;
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-20 pb-16 px-6 border-b border-[#27272a] overflow-hidden">
        {/* Subtle grid background */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[radial-gradient(#ff6600_1px,transparent_1px)] [background-size:16px_16px]"></div>

        <div className="max-w-7xl mx-auto relative">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#121214] border border-[#27272a] rounded text-[11px] font-mono text-[#ff6600] mb-6">
            <span>[SYS_V1.0]</span>
            <span className="text-[#a1a1aa]">HIGH-CONCURRENCY SLOT RECYCLING UPI AGGREGATOR</span>
          </div>

          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-[#f4f4f5] max-w-4xl leading-tight">
            Direct UPI Payments to Your Bank Account. <span className="text-[#ff6600]">Zero Intermediary Deductions.</span>
          </h1>

          <p className="mt-6 text-base text-[#a1a1aa] max-w-2xl leading-relaxed">
            Eliminate traditional payment aggregator gateway fees. Accept instant UPI payments across multi-VPA bank handles, auto-reconciled in real time through native device SMS webhooks and Fluxbase high-speed database engine.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/signup"
              style={{ backgroundColor: '#ff6600', color: '#000000' }}
              className="px-6 py-3 text-sm font-mono font-bold uppercase rounded hover:bg-[#ff7a1a] transition shadow-lg"
            >
              START INTEGRATING NOW -&gt;
            </Link>

            <Link
              href="/login"
              className="px-6 py-3 text-sm font-mono font-semibold uppercase bg-[#121214] hover:bg-[#18181b] border border-[#27272a] text-[#f4f4f5] rounded transition"
            >
              OPEN MERCHANT DASHBOARD
            </Link>
          </div>

          {/* Quick Stats Grid */}
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-[#121214] border border-[#27272a] rounded">
              <div className="text-[10px] font-mono text-[#71717a] uppercase">TRANSACTION FEE</div>
              <div className="text-2xl font-bold font-mono text-[#ff6600] mt-1">0.00%</div>
              <div className="text-[11px] text-[#a1a1aa] mt-0.5">Keep 100% of merchant revenue</div>
            </div>

            <div className="p-4 bg-[#121214] border border-[#27272a] rounded">
              <div className="text-[10px] font-mono text-[#71717a] uppercase">RECONCILIATION SPEED</div>
              <div className="text-2xl font-bold font-mono text-[#f4f4f5] mt-1">&lt; 1.5 SEC</div>
              <div className="text-[11px] text-[#a1a1aa] mt-0.5">Automated MacroDroid SMS ingest</div>
            </div>

            <div className="p-4 bg-[#121214] border border-[#27272a] rounded">
              <div className="text-[10px] font-mono text-[#71717a] uppercase">ACTIVE VPA POOL</div>
              <div className="text-2xl font-bold font-mono text-[#f4f4f5] mt-1">6 VPAs</div>
              <div className="text-[11px] text-[#a1a1aa] mt-0.5">State Bank of India round-robin</div>
            </div>

            <div className="p-4 bg-[#121214] border border-[#27272a] rounded">
              <div className="text-[10px] font-mono text-[#71717a] uppercase">SETTLEMENT MODEL</div>
              <div className="text-2xl font-bold font-mono text-[#f4f4f5] mt-1">MONTHLY</div>
              <div className="text-[11px] text-[#a1a1aa] mt-0.5">Self-serve wallet withdrawal</div>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive API / Code Section */}
      <section id="api" className="py-16 px-6 border-b border-[#27272a] bg-[#0e0e10]">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
            <div>
              <div className="text-[10px] font-mono text-[#ff6600] uppercase tracking-widest font-bold">
                DEVELOPER INTEGRATION
              </div>
              <h2 className="text-2xl font-bold text-[#f4f4f5] mt-1">
                Dead Simple RESTful API
              </h2>
              <p className="text-xs text-[#a1a1aa] mt-1">
                Generate dynamic payment links, check live order statuses, and listen to authenticated webhooks.
              </p>
            </div>

            {/* Code Tabs */}
            <div className="flex items-center gap-1 bg-[#121214] border border-[#27272a] p-1 rounded font-mono text-xs">
              {(['curl', 'node', 'python'] as const).map((tab) => (
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

          <div className="bg-[#121214] border border-[#27272a] rounded-lg overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#27272a] bg-[#18181b] text-xs font-mono text-[#a1a1aa]">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#ff6600]"></span>
                <span className="text-[#f4f4f5] font-semibold">POST /api/v1/orders/create</span>
              </div>
              <button
                onClick={() => handleCopy(codeSnippets[activeTab])}
                className="px-2 py-1 bg-[#27272a] hover:bg-[#3f3f46] text-[#f4f4f5] rounded text-[10px] transition uppercase"
              >
                {copied ? '[COPIED]' : '[COPY CODE]'}
              </button>
            </div>
            <pre className="p-6 text-xs font-mono text-[#d4d4d8] overflow-x-auto leading-relaxed">
              <code>{codeSnippets[activeTab]}</code>
            </pre>
          </div>

          {/* Response Payload Preview */}
          <div className="mt-4 bg-[#121214] border border-[#27272a] rounded-lg p-4 font-mono text-xs">
            <div className="text-[10px] text-[#71717a] uppercase mb-2">SAMPLE JSON RESPONSE:</div>
            <pre className="text-[#a1a1aa] text-[11px] overflow-x-auto">
{`{
  "success": true,
  "order": {
    "id": "ord_8f921b7c",
    "amount": 499.00,
    "assigned_vpa": "sumith0909@ibl",
    "status": "PENDING",
    "payment_url": "https://payments.fluxbasedb.me/pay/ord_8f921b7c",
    "expires_at": "2026-09-09T01:30:00.000Z"
  }
}`}
            </pre>
          </div>
        </div>
      </section>

      {/* How It Works Architecture */}
      <section id="architecture" className="py-16 px-6 border-b border-[#27272a]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <div className="text-[10px] font-mono text-[#ff6600] uppercase tracking-widest font-bold">
              END-TO-END WORKFLOW
            </div>
            <h2 className="text-3xl font-bold text-[#f4f4f5] mt-2">
              Automated Bank Reconciliation Pipeline
            </h2>
            <p className="text-xs text-[#a1a1aa] mt-2">
              How FluxPay securely bridges client transactions directly to your personal bank account without third-party escrow.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-[#121214] border border-[#27272a] p-6 rounded-lg space-y-3">
              <div className="text-xs font-mono text-[#ff6600] font-bold">[STEP 01]</div>
              <h3 className="text-base font-bold text-[#f4f4f5]">Order Creation &amp; VPA Rotation</h3>
              <p className="text-xs text-[#a1a1aa] leading-relaxed">
                When a checkout order is initiated, FluxPay assigns the optimal State Bank of India VPA from the 6-handle pool and generates an instant dynamic UPI deep-link QR.
              </p>
            </div>

            <div className="bg-[#121214] border border-[#27272a] p-6 rounded-lg space-y-3">
              <div className="text-xs font-mono text-[#ff6600] font-bold">[STEP 02]</div>
              <h3 className="text-base font-bold text-[#f4f4f5]">SMS Hook Ingestion</h3>
              <p className="text-xs text-[#a1a1aa] leading-relaxed">
                As soon as the customer transfers funds, your phone receives the SBI credit notification. MacroDroid immediately forwards the SMS payload to FluxPay&apos;s ingestion endpoint.
              </p>
            </div>

            <div className="bg-[#121214] border border-[#27272a] p-6 rounded-lg space-y-3">
              <div className="text-xs font-mono text-[#ff6600] font-bold">[STEP 03]</div>
              <h3 className="text-base font-bold text-[#f4f4f5]">Instant Credit &amp; Notification</h3>
              <p className="text-xs text-[#a1a1aa] leading-relaxed">
                The gateway regex matches the amount and UTR number, flags the order as PAID, increments your merchant dashboard balance, and fires outbound webhooks.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-16 px-6 border-b border-[#27272a] bg-[#0e0e10]">
        <div className="max-w-7xl mx-auto">
          <div className="mb-12">
            <div className="text-[10px] font-mono text-[#ff6600] uppercase tracking-widest font-bold">
              PLATFORM FEATURES
            </div>
            <h2 className="text-2xl font-bold text-[#f4f4f5] mt-1">
              Engineered For Reliability &amp; Control
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="p-6 bg-[#121214] border border-[#27272a] rounded-lg">
              <div className="text-xs font-mono text-[#ff6600] mb-2">[ROTATION_POOL]</div>
              <h3 className="text-sm font-bold text-[#f4f4f5] mb-2">Multi-VPA Load Balancing</h3>
              <p className="text-xs text-[#a1a1aa] leading-relaxed">
                Spreads high volume across multiple handles (IBL, AXL, YBL) to eliminate per-handle bank velocity limitations.
              </p>
            </div>

            <div className="p-6 bg-[#121214] border border-[#27272a] rounded-lg">
              <div className="text-xs font-mono text-[#ff6600] mb-2">[SLOT_RECYCLING]</div>
              <h3 className="text-sm font-bold text-[#f4f4f5] mb-2">Dynamic Slot Recycling</h3>
              <p className="text-xs text-[#a1a1aa] leading-relaxed">
                Re-uses order slots with intelligent expiry windows, preventing unfulfilled orders from clogging the pipeline.
              </p>
            </div>

            <div className="p-6 bg-[#121214] border border-[#27272a] rounded-lg">
              <div className="text-xs font-mono text-[#ff6600] mb-2">[DIRECT_DEPOSIT]</div>
              <h3 className="text-sm font-bold text-[#f4f4f5] mb-2">Zero Intermediary Risk</h3>
              <p className="text-xs text-[#a1a1aa] leading-relaxed">
                Funds never sit in third-party gateway escrow. Customer payments land directly into your own bank account immediately.
              </p>
            </div>

            <div className="p-6 bg-[#121214] border border-[#27272a] rounded-lg">
              <div className="text-xs font-mono text-[#ff6600] mb-2">[SECURITY]</div>
              <h3 className="text-sm font-bold text-[#f4f4f5] mb-2">HMAC Webhook Signatures</h3>
              <p className="text-xs text-[#a1a1aa] leading-relaxed">
                Every outbound webhook event is signed with your merchant secret key, preventing replay attacks and spoofing.
              </p>
            </div>

            <div className="p-6 bg-[#121214] border border-[#27272a] rounded-lg">
              <div className="text-xs font-mono text-[#ff6600] mb-2">[WALLET_LEDGER]</div>
              <h3 className="text-sm font-bold text-[#f4f4f5] mb-2">Merchant Balance &amp; Payouts</h3>
              <p className="text-xs text-[#a1a1aa] leading-relaxed">
                Track exact earnings with self-serve monthly withdrawal requests directly within the client dashboard.
              </p>
            </div>

            <div className="p-6 bg-[#121214] border border-[#27272a] rounded-lg">
              <div className="text-xs font-mono text-[#ff6600] mb-2">[DATABASE_CORE]</div>
              <h3 className="text-sm font-bold text-[#f4f4f5] mb-2">Fluxbase Cloud Engine</h3>
              <p className="text-xs text-[#a1a1aa] leading-relaxed">
                Powered by Fluxbase relational tenant schemas on AWS RDS PostgreSQL with millisecond query response times.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Settlements Section */}
      <section id="settlement" className="py-16 px-6 border-b border-[#27272a]">
        <div className="max-w-7xl mx-auto bg-[#121214] border border-[#27272a] rounded-lg p-8 md:p-12">
          <div className="max-w-3xl">
            <div className="text-[10px] font-mono text-[#ff6600] uppercase tracking-widest font-bold">
              FINANCIAL SETTLEMENT RULES
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-[#f4f4f5] mt-2">
              Transparent Monthly Settlements
            </h2>
            <p className="text-xs md:text-sm text-[#a1a1aa] mt-3 leading-relaxed">
              Every successfully confirmed payment is immediately booked to your merchant account balance. At the end of each calendar billing cycle, you can submit a withdrawal request directly to your registered bank account with 0 hidden deductions.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/signup"
                style={{ backgroundColor: '#ff6600', color: '#000000' }}
                className="px-6 py-3 text-xs font-mono font-bold uppercase rounded hover:bg-[#ff7a1a] transition"
              >
                OPEN FREE MERCHANT ACCOUNT -&gt;
              </Link>
              <Link
                href="/login"
                className="px-6 py-3 text-xs font-mono font-semibold uppercase bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[#f4f4f5] rounded transition"
              >
                SIGN IN TO DASHBOARD
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 px-6 bg-[#0b0b0b] border-t border-[#27272a] text-xs font-mono text-[#71717a]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <div className="text-[#f4f4f5] font-bold text-sm">FLUXPAY // UPI GATEWAY</div>
            <div className="text-[11px] text-[#71717a] mt-1">
              Self-Hosted High Performance Automated UPI Engine
            </div>
          </div>

          <div className="flex items-center gap-6 text-[11px]">
            <Link href="/login" className="hover:text-[#f4f4f5] transition">LOGIN</Link>
            <Link href="/signup" className="hover:text-[#f4f4f5] transition">SIGNUP</Link>
            <Link href="/docs" className="hover:text-[#f4f4f5] transition text-[#ff6600]">DOCUMENTATION</Link>
            <span className="text-[#3f3f46]">|</span>
            <span className="text-emerald-500 font-semibold">[ALL SYSTEMS NORMAL]</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
