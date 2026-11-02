import { NextRequest, NextResponse } from 'next/server';
import { getConfiguredSodexNetwork, parseSodexNetwork } from '@/lib/sodexNetwork';

const NETWORK_COOKIE = 'sodex-network';

export async function GET(request: NextRequest) {
  return NextResponse.json({
    network: getConfiguredSodexNetwork(request.cookies.get(NETWORK_COOKIE)?.value),
  });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }
  const network = body && typeof body === 'object' && 'network' in body
    ? parseSodexNetwork(body.network)
    : null;
  if (!network) {
    return NextResponse.json({ error: 'Choose either Testnet or Mainnet.' }, { status: 400 });
  }

  const response = NextResponse.json({ network });
  response.cookies.set(NETWORK_COOKIE, network, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
  });
  return response;
}
