import { NextRequest, NextResponse } from 'next/server';
import { sodexAPI } from '@/lib/sodex';
import { getConfiguredBuilderID } from '@/lib/sodexBuilder';

const WALLET_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export async function GET(request: NextRequest) {
  if (sodexAPI.configuredNetwork !== 'testnet') {
    return NextResponse.json(
      { error: 'SoDEX account identity is currently available on Testnet only.' },
      { status: 403 }
    );
  }

  const address = request.nextUrl.searchParams.get('address');
  if (address && !WALLET_ADDRESS.test(address)) {
    return NextResponse.json({ error: 'Provide a valid wallet address.' }, { status: 400 });
  }

  try {
    const account = address ? await sodexAPI.getAccountState(address) : null;
    return NextResponse.json({
      network: 'testnet',
      accountID: account?.accountID ?? null,
      builderID: getConfiguredBuilderID(),
    });
  } catch (error) {
    console.error('SoDEX account identity lookup failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load SoDEX account identity.' },
      { status: 502 }
    );
  }
}
