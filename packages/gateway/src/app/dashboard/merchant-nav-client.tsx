'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const MerchantNavClient: React.FC = () => {
  const pathname = usePathname();

  const navItems = [
    { label: 'OVERVIEW', href: '/dashboard' },
    { label: 'WITHDRAWALS', href: '/dashboard/withdrawals' },
    { label: 'COUPONS', href: '/dashboard/coupons' },
    { label: 'PAYMENT LINKS', href: '/dashboard/links' },
    { label: 'API KEYS & WEBHOOKS', href: '/dashboard/apikeys' },
    { label: 'TEST SIMULATOR', href: '/dashboard/simulator' },
  ];

  return (
    <nav className="flex items-center gap-1">
      {navItems.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`px-3 py-1.5 rounded text-xs font-mono transition ${
              isActive
                ? 'bg-[#27272a] text-[#f4f4f5] font-bold border border-[#3f3f46]'
                : 'text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#18181b]'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
};
