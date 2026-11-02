import type { SodexNetwork } from './sodexNetwork';

export interface SodexOrderReviewState {
  walletAddress: string | null;
  network: SodexNetwork;
  symbol: string;
  side: string;
  amount: number;
  decision: string;
  riskScore: number;
  exitQuantity: number | null;
  maxSlippagePct: number;
  includeBuilderFee: boolean;
  builderFeeRate: number;
}

export function getSodexOrderReviewSignature(state: SodexOrderReviewState): string {
  return JSON.stringify({
    ...state,
    walletAddress: state.walletAddress?.toLowerCase() ?? null,
  });
}
