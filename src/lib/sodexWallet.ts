export interface SodexWalletProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: 'accountsChanged', listener: (accounts: unknown) => void) => void;
  removeListener?: (event: 'accountsChanged', listener: (accounts: unknown) => void) => void;
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

export async function ensureSodexTestnetChain(
  provider: SodexWalletProvider | undefined = window.ethereum
): Promise<void> {
  if (!provider) throw new Error('No injected wallet found');
  const currentChainId = (await provider.request({ method: 'eth_chainId' })) as string;
  if (currentChainId.toLowerCase() === VALUECHAIN_TESTNET_PARAMS.chainId) return;

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: VALUECHAIN_TESTNET_PARAMS.chainId }],
    });
  } catch (switchError) {
    const code = (switchError as { code?: number })?.code;
    if (code !== 4902) throw switchError;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [VALUECHAIN_TESTNET_PARAMS],
    });
  }
}
