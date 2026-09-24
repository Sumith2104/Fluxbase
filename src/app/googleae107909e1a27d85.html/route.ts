export async function GET() {
  return new Response('google-site-verification: googleae107909e1a27d85.html', {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
