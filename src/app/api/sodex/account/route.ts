import { NextRequest, NextResponse } from 'next/server';
import { sodexAPI } from '@/lib/sodex';
import { sosoValueAPI } from '@/lib/sosovalue';
import { listTradableSodexSpotMarkets } from '@/lib/sodexMarkets';

const WALLET_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export async function GET(request: NextRequest) {
  if (sodexAPI.configuredNetwork !== 'testnet') {
    return NextResponse.json(
      { error: 'SoDEX account management is currently available on Testnet only.' },
      { status: 403 }
    );
  }

  const address = request.nextUrl.searchParams.get('address') ?? '';
  if (!WALLET_ADDRESS.test(address)) {
    return NextResponse.json({ error: 'Provide a valid wallet address.' }, { status: 400 });
  }

  try {
    const [account, balances, orders, history, trades, symbolRows] = await Promise.all([
      sodexAPI.getAccountState(address),
      sodexAPI.getSpotAccountBalances(address),
      sodexAPI.getSpotAccountOrders(address),
      sodexAPI.getSpotAccountOrderHistory(address, 20),
      sodexAPI.getSpotAccountTrades(address, 20),
      sodexAPI.getSpotSymbols(),
    ]);

    let supportedSymbols: string[] = [];
    let marketIntelligenceAvailable = true;
    try {
      supportedSymbols = await sosoValueAPI.getCurrencySymbols();
    } catch (error) {
      marketIntelligenceAvailable = false;
      console.error('SoSoValue symbol coverage unavailable for SoDEX account view:', error);
    }

    const markets = listTradableSodexSpotMarkets(symbolRows);
    const analysisCoverage = new Set(supportedSymbols.map((symbol) => symbol.toUpperCase()));
    return NextResponse.json({
      network: 'testnet',
      accountID: account.accountID,
      balances,
      orders,
      history,
      trades,
      markets: markets.map((market) => ({
        ...market,
        analysisSupported:
          marketIntelligenceAvailable && analysisCoverage.has(market.symbol.toUpperCase()),
      })),
      marketIntelligenceAvailable,
      snapshotAt: Date.now(),
    });
  } catch (error) {
    console.error('SoDEX account snapshot failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load SoDEX account data.' },
      { status: 502 }
    );
  }
}
