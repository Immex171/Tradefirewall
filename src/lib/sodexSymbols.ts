export function getSodexSpotSymbolError(symbol: string): string | null {
  if (symbol.trim().toUpperCase() === 'USDC') {
    return 'USDC is the quote currency on SoDEX Spot, not a tradable asset here. Choose a base asset such as BTC, ETH, or SOL; your trade will be quoted in USDC.';
  }
  return null;
}
