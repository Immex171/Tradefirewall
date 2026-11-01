import { NextRequest, NextResponse } from 'next/server';
import { getSodexAPI } from '@/lib/sodex';
import { getConfiguredBuilderID } from '@/lib/sodexBuilder';
import { getConfiguredSodexNetwork } from '@/lib/sodexNetwork';

const WALLET_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export async function GET(request: NextRequest) {
  const network = getConfiguredSodexNetwork(request.cookies.get('sodex-network')?.value);
  const sodexAPI = getSodexAPI(network);

  const address = request.nextUrl.searchParams.get('address');
  if (address && !WALLET_ADDRESS.test(address)) {
    return NextResponse.json({ error: 'Provide a valid wallet address.' }, { status: 400 });
  }

  try {
    const account = address ? await sodexAPI.getAccountState(address) : null;
    return NextResponse.json({
      network,
      accountID: account?.accountID ?? null,
      builderID: getConfiguredBuilderID(network),
    });
  } catch (error) {
    console.error('SoDEX account identity lookup failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load SoDEX account identity.' },
      { status: 502 }
    );
  }
}
