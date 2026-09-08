import React from 'react';
import { redirect } from 'next/navigation';
import { getSessionMerchant } from '@/lib/merchant-session';
import { ApiKeysClient } from './apikeys-client';

export const revalidate = 0;

export default async function ApiKeysPage() {
  const merchant = await getSessionMerchant();
  if (!merchant) {
    redirect('/login');
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-[#f4f4f5]">
          DEVELOPER API KEYS & WEBHOOKS
        </h1>
        <p className="text-xs text-[#a1a1aa] font-mono mt-0.5">
          Integrate FluxPay automated UPI payments directly into your apps using your scoped merchant API credentials.
        </p>
      </div>

      <ApiKeysClient merchant={merchant} />
    </div>
  );
}
