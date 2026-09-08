import { NextResponse } from 'next/server';
import { MERCHANT_COOKIE_NAME } from '@/lib/merchant-auth';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete(MERCHANT_COOKIE_NAME);
  return response;
}
