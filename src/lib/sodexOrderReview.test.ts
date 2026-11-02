import { describe, expect, it } from 'vitest';
import { getSodexOrderReviewSignature, type SodexOrderReviewState } from './sodexOrderReview';

const walletAddress = '0x0000000000000000000000000000000000000001';
const review: SodexOrderReviewState = {
  walletAddress,
  network: 'testnet',
  symbol: 'BTC',
  side: 'sell',
  amount: 100,
  decision: 'APPROVE',
  riskScore: 15,
  exitQuantity: null,
  maxSlippagePct: 1,
  includeBuilderFee: false,
  builderFeeRate: 90,
};

describe('prepared SoDEX order review signature', () => {
  it('changes when Builder fee consent or rate changes', () => {
    const original = getSodexOrderReviewSignature(review);

    expect(getSodexOrderReviewSignature({ ...review, includeBuilderFee: true })).not.toBe(original);
    expect(getSodexOrderReviewSignature({ ...review, builderFeeRate: 91 })).not.toBe(original);
  });

  it('normalizes wallet casing and tracks the configured network', () => {
    expect(getSodexOrderReviewSignature({
      ...review,
      walletAddress: walletAddress.toUpperCase().replace('0X', '0x'),
    })).toBe(getSodexOrderReviewSignature(review));
    expect(getSodexOrderReviewSignature({ ...review, network: 'mainnet' }))
      .not.toBe(getSodexOrderReviewSignature(review));
  });
});
