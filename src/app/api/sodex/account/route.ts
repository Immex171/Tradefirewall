import { NextRequest, NextResponse } from 'next/server';
import { getSodexAPI } from '@/lib/sodex';
import { getConfiguredSodexNetwork } from '@/lib/sodexNetwork';
import { sosoValueAPI } from '@/lib/sosovalue';
import { listTradableSodexSpotMarkets } from '@/lib/sodexMarkets';

const WALLET_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export async function GET(request: NextRequest) {
  const network = getConfiguredSodexNetwork(request.cookies.get('sodex-network')?.value);
  const sodexAPI = getSodexAPI(network);
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
      network,
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
