import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSodexChainId } from './sodexOrderSigning';
import { ensureSodexChain } from './sodexWallet';

const originalMainnetRpcUrl = process.env.NEXT_PUBLIC_SODEX_MAINNET_RPC_URL;

afterEach(() => {
  if (originalMainnetRpcUrl === undefined) delete process.env.NEXT_PUBLIC_SODEX_MAINNET_RPC_URL;
  else process.env.NEXT_PUBLIC_SODEX_MAINNET_RPC_URL = originalMainnetRpcUrl;
});

describe('SoDEX wallet network selection', () => {
  it('does not request a chain switch when the wallet is already on Mainnet', async () => {
    const request = vi.fn().mockResolvedValue(`0x${getSodexChainId('mainnet').toString(16)}`);

    await ensureSodexChain('mainnet', { request });

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith({ method: 'eth_chainId' });
  });

  it('requires an explicit HTTPS RPC before adding Mainnet to a wallet', async () => {
    delete process.env.NEXT_PUBLIC_SODEX_MAINNET_RPC_URL;
    const request = vi.fn()
      .mockResolvedValueOnce('0x1')
      .mockRejectedValueOnce({ code: 4902 });

    await expect(ensureSodexChain('mainnet', { request }))
      .rejects.toThrow(/NEXT_PUBLIC_SODEX_MAINNET_RPC_URL/);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('adds the configured Mainnet using its own chain ID and RPC URL', async () => {
    process.env.NEXT_PUBLIC_SODEX_MAINNET_RPC_URL = 'https://rpc.example.test';
    const request = vi.fn()
      .mockResolvedValueOnce('0x1')
      .mockRejectedValueOnce({ code: 4902 })
      .mockResolvedValueOnce(null);

    await ensureSodexChain('mainnet', { request });

    expect(request).toHaveBeenNthCalledWith(3, {
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: `0x${getSodexChainId('mainnet').toString(16)}`,
        chainName: 'SoDEX Mainnet',
        nativeCurrency: { name: 'SOSO', symbol: 'SOSO', decimals: 18 },
        rpcUrls: ['https://rpc.example.test/'],
      }],
    });
  });
});
