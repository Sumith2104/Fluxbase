'use client';

import React, { useState } from 'react';

export default function SimulatorPage() {
  const [smsText, setSmsText] = useState(
    'Dear Customer, A/c *0493 credited by Rs 499.12 on 08-09-26 by UPI/412345678901/Ref. Bal: INR 12,450.00'
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const samples = [
    {
      title: 'Axis Bank SMS (*0493)',
      text: 'Dear Customer, A/c *0493 credited by Rs 499.12 on 08-09-26 by UPI/412345678901/Ref. Bal: INR 12,450.00',
    },
    {
      title: 'HDFC Bank SMS (xx1234)',
      text: 'Rs 499.12 credited to HDFC Bank A/c xx1234 on 08-Sep-26 via UPI ref 498765432109 from buyer@okaxis.',
    },
    {
      title: 'WhatsApp Notification',
      text: 'Received Rs 499.12 from Sumith via UPI. UPI Ref No: 412398765412.',
    },
  ];

  const handleSimulate = async () => {
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/v1/webhook/incoming', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer sumith@fluxbase',
        },
        body: JSON.stringify({
          message: smsText,
          sender: 'SIMULATOR_TEST',
        }),
      });

      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-[#f4f4f5]">
          SMS & WHATSAPP WEBHOOK SIMULATOR
        </h1>
        <p className="text-xs text-[#a1a1aa] font-mono mt-0.5">
          Test real-time alert ingestion, regex parsing, composite order matching, and instant slot recycling without sending real bank transfers.
        </p>
      </div>

      <div className="bg-[#121214] border border-[#27272a] rounded-lg p-6 space-y-6">
        {/* Preset Sample Buttons */}
        <div>
          <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-2">
            PRELOAD SAMPLE ALERTS
          </label>
          <div className="flex flex-wrap gap-2">
            {samples.map((s, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setSmsText(s.text)}
                className="px-3 py-1.5 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] rounded text-xs font-mono text-[#f4f4f5] transition"
              >
                {s.title}
              </button>
            ))}
          </div>
        </div>

        {/* Input Area */}
        <div>
          <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
            RAW BANK SMS / WHATSAPP MESSAGE TEXT
          </label>
          <textarea
            rows={4}
            value={smsText}
            onChange={(e) => setSmsText(e.target.value)}
            className="w-full bg-[#0b0b0b] border border-[#27272a] rounded p-3 text-xs font-mono text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
          />
        </div>

        {/* Action Button */}
        <button
          type="button"
          disabled={loading || !smsText.trim()}
          onClick={handleSimulate}
          className="px-6 py-2.5 bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-semibold text-xs font-mono rounded transition disabled:opacity-50"
        >
          {loading ? 'PROCESSING ALERT...' : 'SIMULATE INCOMING ALERT'}
        </button>

        {/* Result Visualizer */}
        {result && (
          <div className="pt-4 border-t border-[#27272a] space-y-3">
            <div className="text-[11px] font-mono text-[#a1a1aa] uppercase">
              PARSER & MATCHING ENGINE OUTPUT
            </div>

            <div
              className={`p-4 rounded border font-mono text-xs ${
                result.matched
                  ? 'bg-emerald-950/30 border-emerald-800/50 text-emerald-400'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-300'
              }`}
            >
              <div className="flex items-center gap-2 font-bold mb-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    result.matched ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                />
                {result.matched
                  ? 'MATCH SUCCESSFUL // PAYMENT VERIFIED'
                  : 'RECEIVED // NO MATCHING PENDING ORDER'}
              </div>

              <pre className="text-[11px] overflow-x-auto text-zinc-300 bg-[#0b0b0b] p-3 rounded border border-zinc-800/80">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
