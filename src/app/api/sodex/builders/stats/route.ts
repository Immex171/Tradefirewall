import { NextResponse } from 'next/server';
import { sodexAPI } from '@/lib/sodex';
import {
  fetchBuilderStats,
  getConfiguredBuilderAddress,
  getConfiguredBuilderID,
  SodexBuilderStatsUnavailableError,
} from '@/lib/sodexBuilder';

export async function GET() {
  if (sodexAPI.configuredNetwork !== 'testnet') {
    return NextResponse.json({ error: 'Builder statistics are available on Testnet only.' }, { status: 403 });
  }

  try {
    const builderID = getConfiguredBuilderID();
    const builderAddress = getConfiguredBuilderAddress();
    if (!builderID || !builderAddress) {
      return NextResponse.json(
        { error: 'Configure SODEX_BUILDER_ID and SODEX_BUILDER_ADDRESS to load Builder statistics.' },
        { status: 503 }
      );
    }
    const stats = await fetchBuilderStats(builderAddress, builderID);
    return NextResponse.json({
      network: 'testnet',
      builderID,
      ...stats,
      fetchedAt: Date.now(),
    });
  } catch (error) {
    console.error('SoDEX Builder statistics lookup failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load SoDEX Builder statistics.' },
      { status: error instanceof SodexBuilderStatsUnavailableError ? 503 : 502 }
    );
  }
}
