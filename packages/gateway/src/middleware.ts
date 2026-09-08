import { NextRequest, NextResponse } from 'next/server';
import { MERCHANT_COOKIE_NAME, verifyMerchantToken } from './lib/merchant-auth';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Client Merchant Dashboard Routes
  if (pathname.startsWith('/dashboard')) {
    const merchantToken = req.cookies.get(MERCHANT_COOKIE_NAME)?.value;
    const merchant = await verifyMerchantToken(merchantToken);

    if (!merchant) {
      const loginUrl = new URL('/login', req.url);
      loginUrl.searchParams.set('from', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
