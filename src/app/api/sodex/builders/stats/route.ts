import { NextRequest, NextResponse } from 'next/server';
import { getSodexAPI } from '@/lib/sodex';
import { getConfiguredSodexNetwork } from '@/lib/sodexNetwork';
import {
  fetchBuilderStats,
  getConfiguredBuilderAddress,
  getConfiguredBuilderID,
  SodexBuilderStatsUnavailableError,
} from '@/lib/sodexBuilder';

export async function GET(request: NextRequest) {
  const network = getConfiguredSodexNetwork(request.cookies.get('sodex-network')?.value);
  const sodexAPI = getSodexAPI(network);

  try {
    const builderID = getConfiguredBuilderID(network);
    const builderAddress = getConfiguredBuilderAddress(network);
    if (!builderID || !builderAddress) {
      return NextResponse.json(
        {
          error: `Configure the ${network === 'testnet' ? 'SODEX_BUILDER_ID and SODEX_BUILDER_ADDRESS' : 'SODEX_MAINNET_BUILDER_ID and SODEX_MAINNET_BUILDER_ADDRESS'} values to load Builder statistics.`,
        },
        { status: 503 }
      );
    }
    const builderAccount = await sodexAPI.getAccountState(builderAddress);
    if (String(builderAccount.accountID) !== builderID) {
      return NextResponse.json(
        {
          error: `Configured ${network} Builder owner address resolves to account ${builderAccount.accountID}, not Builder ID ${builderID}.`,
        },
        { status: 409 }
      );
    }
    const [statsResult, balanceResult] = await Promise.allSettled([
      fetchBuilderStats(builderAddress, builderID, 90, network),
      sodexAPI.getSpotAccountBalances(builderAddress),
    ]);
    if (balanceResult.status === 'rejected') throw balanceResult.reason;
    return NextResponse.json({
      network,
      builderID,
      builderAddress,
      spotBalances: balanceResult.value,
      summary: statsResult.status === 'fulfilled' ? statsResult.value.summary : null,
      dailyChart: statsResult.status === 'fulfilled' ? statsResult.value.dailyChart : [],
      statsError: statsResult.status === 'rejected'
        ? statsResult.reason instanceof Error
          ? statsResult.reason.message
          : 'Unable to load SoDEX Builder statistics.'
        : null,
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
