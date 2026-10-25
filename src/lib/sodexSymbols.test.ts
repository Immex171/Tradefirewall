import { describe, expect, it } from 'vitest';
import { getSodexSpotSymbolError } from './sodexSymbols';

describe('getSodexSpotSymbolError', () => {
  it('explains that USDC is a quote currency rather than a tradable base asset', () => {
    expect(getSodexSpotSymbolError('USDC')).toContain('quote currency');
    expect(getSodexSpotSymbolError(' usdc ')).toContain('BTC, ETH, or SOL');
  });

  it('allows tradable base-asset symbols', () => {
    expect(getSodexSpotSymbolError('BTC')).toBeNull();
    expect(getSodexSpotSymbolError('ETH')).toBeNull();
    expect(getSodexSpotSymbolError('SOL')).toBeNull();
  });
});
