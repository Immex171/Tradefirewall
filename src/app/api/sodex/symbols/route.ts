import { NextRequest, NextResponse } from 'next/server';
import { getSodexAPI } from '@/lib/sodex';
import { sosoValueAPI } from '@/lib/sosovalue';
import { getConfiguredSodexNetwork } from '@/lib/sodexNetwork';
import {
  filterSodexMarketsBySupportedSymbols,
  listTradableSodexSpotMarkets,
} from '@/lib/sodexMarkets';

export async function GET(request: NextRequest) {
  const network = getConfiguredSodexNetwork(request.cookies.get('sodex-network')?.value);
  const sodexAPI = getSodexAPI(network);
  try {
    const [rows, supportedSymbols] = await Promise.all([
      sodexAPI.getSpotSymbols(),
      sosoValueAPI.getCurrencySymbols(),
    ]);
    const markets = filterSodexMarketsBySupportedSymbols(
      listTradableSodexSpotMarkets(rows),
      supportedSymbols
    );
    return NextResponse.json({
      network,
      markets,
      symbols: markets.map(({ symbol, name }) => ({ symbol, name })),
    });
  } catch (error) {
    console.error('Supported SoDEX Spot market listing failed:', error);
    return NextResponse.json(
      { error: 'Unable to load SoDEX Spot markets supported by both providers.' },
      { status: 502 }
    );
  }
}
