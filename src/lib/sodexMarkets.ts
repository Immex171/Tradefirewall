export interface SodexSpotMarketOption {
  symbol: string;
  name: string;
  sodexSymbol: string;
  baseCoin: string;
  baseCoinID?: number;
}

interface SodexSpotMarketRow {
  name?: unknown;
  displayName?: unknown;
  baseCoin?: unknown;
  baseCoinID?: unknown;
  quoteCoin?: unknown;
  status?: unknown;
}

function canonicalBaseSymbol(row: SodexSpotMarketRow): string {
  const displayName = typeof row.displayName === 'string' ? row.displayName : '';
  const displayBase = displayName.split('/')[0]?.trim();
  if (displayBase) return displayBase.toUpperCase();

  const baseCoin = typeof row.baseCoin === 'string' ? row.baseCoin : '';
  return baseCoin.replace(/^[vaw](?=[A-Z])/, '').toUpperCase();
}

export function listTradableSodexSpotMarkets<T extends SodexSpotMarketRow>(rows: T[]): SodexSpotMarketOption[] {
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const sodexSymbol = typeof row.name === 'string' ? row.name : '';
    const status = typeof row.status === 'string' ? row.status : '';
    const quoteCoin = typeof row.quoteCoin === 'string' ? row.quoteCoin : '';
    const symbol = canonicalBaseSymbol(row);

    if (
      status !== 'TRADING' ||
      quoteCoin !== 'vUSDC' ||
      !sodexSymbol.endsWith('_vUSDC') ||
      !symbol ||
      symbol === 'USDC' ||
      seen.has(symbol)
    ) {
      return [];
    }

    seen.add(symbol);
    return [{
      symbol,
      name: typeof row.displayName === 'string' ? row.displayName : `${symbol}/USDC`,
      sodexSymbol,
      baseCoin: typeof row.baseCoin === 'string' ? row.baseCoin : '',
      baseCoinID: typeof row.baseCoinID === 'number' ? row.baseCoinID : undefined,
    }];
  }).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function filterSodexMarketsBySupportedSymbols(
  markets: SodexSpotMarketOption[],
  supportedSymbols: Iterable<string>
): SodexSpotMarketOption[] {
  const supported = new Set(
    Array.from(supportedSymbols, (symbol) => symbol.trim().toUpperCase())
  );
  return markets.filter((market) => supported.has(market.symbol.toUpperCase()));
}

export function findSodexMarketSymbol(
  rows: SodexSpotMarketRow[],
  symbol: string
): string | null {
  const requested = symbol.trim().toUpperCase();
  const market = listTradableSodexSpotMarkets(rows).find((option) => option.symbol === requested);
  return market?.sodexSymbol ?? null;
}
