import { getSodexChainId, type SodexNetwork } from '@/lib/sodexNetwork';

export interface SodexWalletProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: 'accountsChanged', listener: (accounts: unknown) => void) => void;
  removeListener?: (event: 'accountsChanged', listener: (accounts: unknown) => void) => void;
}

export async function fetchSodexNetwork(): Promise<SodexNetwork> {
  const response = await fetch('/api/sodex/account/identity', { cache: 'no-store' });
  const payload: unknown = await response.json();
  if (!response.ok || !payload || typeof payload !== 'object') {
    const message = payload && typeof payload === 'object' && 'error' in payload
      ? String(payload.error)
      : 'Unable to load the configured SoDEX network.';
    throw new Error(message);
  }
  const network = (payload as { network?: unknown }).network;
  if (network !== 'testnet' && network !== 'mainnet') {
    throw new Error('SoDEX returned an invalid configured network.');
  }
  return network;
}

declare global {
  interface Window {
    ethereum?: SodexWalletProvider;
  }
}

export const VALUECHAIN_TESTNET_PARAMS = {
  chainId: '0x21d45',
  chainName: 'ValueChain Testnet',
  nativeCurrency: { name: 'SOSO', symbol: 'SOSO', decimals: 18 },
  rpcUrls: ['https://testnet.valuechain.xyz'],
  blockExplorerUrls: ['https://test-scan.valuechain.xyz'],
};

function getSodexMainnetParams() {
  const rpcUrl = process.env.NEXT_PUBLIC_SODEX_MAINNET_RPC_URL?.trim();
  if (!rpcUrl) {
    throw new Error(
      'Set NEXT_PUBLIC_SODEX_MAINNET_RPC_URL to the official SoDEX Mainnet RPC before connecting a wallet to Mainnet.'
    );
  }
  const parsedUrl = new URL(rpcUrl);
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
    throw new Error('NEXT_PUBLIC_SODEX_MAINNET_RPC_URL must be an HTTPS URL without embedded credentials.');
  }
  return {
    chainId: `0x${getSodexChainId('mainnet').toString(16)}`,
    chainName: 'SoDEX Mainnet',
    nativeCurrency: { name: 'SOSO', symbol: 'SOSO', decimals: 18 },
    rpcUrls: [parsedUrl.toString()],
  };
}

export async function ensureSodexChain(
  network: SodexNetwork = 'testnet',
  provider: SodexWalletProvider | undefined = window.ethereum
): Promise<void> {
  if (!provider) throw new Error('No injected wallet found');
  const chainId = `0x${getSodexChainId(network).toString(16)}`;
  const currentChainId = (await provider.request({ method: 'eth_chainId' })) as string;
  if (currentChainId.toLowerCase() === chainId) return;

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId }],
    });
  } catch (switchError) {
    const code = (switchError as { code?: number })?.code;
    if (code !== 4902) throw switchError;
    const chainParams = network === 'testnet' ? VALUECHAIN_TESTNET_PARAMS : getSodexMainnetParams();
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [chainParams],
    });
  }
}

export const ensureSodexTestnetChain = (
  provider?: SodexWalletProvider
): Promise<void> => ensureSodexChain('testnet', provider);
