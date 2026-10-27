import { describe, expect, it } from 'vitest';
import {
  filterSodexMarketsBySupportedSymbols,
  findSodexMarketSymbol,
  listTradableSodexSpotMarkets,
} from './sodexMarkets';

const markets: Record<string, unknown>[] = [
  { name: 'vBTC_vUSDC', displayName: 'BTC/USDC', baseCoin: 'vBTC', quoteCoin: 'vUSDC', status: 'TRADING' },
  { name: 'aCXMT_vUSDC', displayName: 'CXMT/USDC', baseCoin: 'aCXMT', quoteCoin: 'vUSDC', status: 'TRADING' },
  { name: 'TESTBTC_vUSDC', displayName: 'TESTBTC/USDC', baseCoin: 'TESTBTC', quoteCoin: 'vUSDC', status: 'TRADING' },
  { name: 'vDELISTED_vUSDC', displayName: 'DELISTED/USDC', baseCoin: 'vDELISTED', quoteCoin: 'vUSDC', status: 'BREAK' },
  { name: 'vUSDC_vUSDC', displayName: 'USDC/USDC', baseCoin: 'vUSDC', quoteCoin: 'vUSDC', status: 'TRADING' },
  { name: 'vBTC_vUSDT', displayName: 'BTC/USDT', baseCoin: 'vBTC', quoteCoin: 'vUSDT', status: 'TRADING' },
];

describe('listTradableSodexSpotMarkets', () => {
  it('lists all active USDC-quoted SoDEX Spot tokens using their user-facing symbols', () => {
    expect(listTradableSodexSpotMarkets(markets)).toEqual([
      { symbol: 'BTC', name: 'BTC/USDC', sodexSymbol: 'vBTC_vUSDC', baseCoin: 'vBTC' },
      { symbol: 'CXMT', name: 'CXMT/USDC', sodexSymbol: 'aCXMT_vUSDC', baseCoin: 'aCXMT' },
      { symbol: 'TESTBTC', name: 'TESTBTC/USDC', sodexSymbol: 'TESTBTC_vUSDC', baseCoin: 'TESTBTC' },
    ]);
  });
});

describe('findSodexMarketSymbol', () => {
  it('resolves a selected symbol to the exact market name', () => {
    expect(findSodexMarketSymbol(markets, 'cxmt')).toBe('aCXMT_vUSDC');
    expect(findSodexMarketSymbol(markets, 'unknown')).toBeNull();
  });
});

describe('filterSodexMarketsBySupportedSymbols', () => {
  it('keeps only SoDEX markets also supported by SoSoValue, case-insensitively', () => {
    const sodexMarkets = listTradableSodexSpotMarkets(markets);
    expect(filterSodexMarketsBySupportedSymbols(sodexMarkets, ['btc', 'TESTBTC'])).toEqual([
      { symbol: 'BTC', name: 'BTC/USDC', sodexSymbol: 'vBTC_vUSDC', baseCoin: 'vBTC' },
      { symbol: 'TESTBTC', name: 'TESTBTC/USDC', sodexSymbol: 'TESTBTC_vUSDC', baseCoin: 'TESTBTC' },
    ]);
  });
});
