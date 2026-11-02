export const SODEX_TESTNET_CHAIN_ID = 138565;
export const SODEX_MAINNET_CHAIN_ID = 286623;

export type SodexNetwork = 'testnet' | 'mainnet';

export function parseSodexNetwork(value: unknown): SodexNetwork | null {
  return value === 'testnet' || value === 'mainnet' ? value : null;
}

export function getConfiguredSodexNetwork(override?: unknown): SodexNetwork {
  const selected = parseSodexNetwork(override);
  if (selected) return selected;
  return (process.env.SODEX_USE_TESTNET ?? 'true').toLowerCase() === 'false'
    ? 'mainnet'
    : 'testnet';
}

export function getSodexChainId(network: SodexNetwork): number {
  return network === 'mainnet' ? SODEX_MAINNET_CHAIN_ID : SODEX_TESTNET_CHAIN_ID;
}
