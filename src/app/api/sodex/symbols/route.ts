import { NextResponse } from 'next/server';
import { sodexAPI } from '@/lib/sodex';
import { sosoValueAPI } from '@/lib/sosovalue';
import {
  filterSodexMarketsBySupportedSymbols,
  listTradableSodexSpotMarkets,
} from '@/lib/sodexMarkets';

export async function GET() {
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
      network: sodexAPI.configuredNetwork,
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
