import { describe, expect, it } from 'vitest';
import { buildTickerFromKlines, type SodexKline } from './sodex';

const kline = (values: Partial<SodexKline> & Pick<SodexKline, 'openTime' | 'open' | 'close'>): SodexKline => ({
  openTime: values.openTime,
  open: values.open,
  close: values.close,
  high: values.high ?? values.close,
  low: values.low ?? values.open,
  volume: values.volume ?? '0',
  closeTime: values.closeTime ?? values.openTime + 1,
  quoteAssetVolume: values.quoteAssetVolume ?? '0',
  numberOfTrades: values.numberOfTrades ?? 0,
  takerBuyBaseAssetVolume: values.takerBuyBaseAssetVolume ?? '0',
  takerBuyQuoteAssetVolume: values.takerBuyQuoteAssetVolume ?? '0',
});

describe('buildTickerFromKlines', () => {
  it('uses the latest actual candle and aggregates the supplied 24-hour volume', () => {
    const ticker = buildTickerFromKlines('vETH_vUSDC', [
      kline({
        openTime: 200,
        open: '11',
        close: '12',
        high: '13',
        low: '10',
        volume: '3',
        quoteAssetVolume: '34',
        numberOfTrades: 4,
      }),
      kline({
        openTime: 100,
        open: '10',
        close: '11',
        high: '12',
        low: '9',
        volume: '2',
        quoteAssetVolume: '21',
        numberOfTrades: 3,
      }),
    ]);

    expect(ticker).toMatchObject({
      symbol: 'vETH_vUSDC',
      openPrice: '10',
      lastPrice: '12',
      priceChange: '2',
      priceChangePercent: '20',
      highPrice: '13',
      lowPrice: '9',
      volume: '5',
      quoteVolume: '55',
      count: 7,
    });
  });

  it('returns null when there is no valid candle price', () => {
    expect(buildTickerFromKlines('vETH_vUSDC', [])).toBeNull();
    expect(buildTickerFromKlines('vETH_vUSDC', [kline({ openTime: 1, open: '0', close: '0' })])).toBeNull();
  });
});
