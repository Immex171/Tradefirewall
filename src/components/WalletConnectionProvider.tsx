'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { SodexWalletProvider } from '@/lib/sodexWallet';

const WALLET_ADDRESS_KEY = 'tradefirewall_wallet_address';

interface WalletConnection {
  walletAddress: string | null;
  connectWallet: () => Promise<string>;
}

const WalletConnectionContext = createContext<WalletConnection | null>(null);

function isWalletAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function getAccounts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isWalletAddress) : [];
}

function getStoredWalletAddress(): string | null {
  try {
    const storedAddress = window.localStorage.getItem(WALLET_ADDRESS_KEY);
    return isWalletAddress(storedAddress) ? storedAddress : null;
  } catch (error) {
    console.warn('Unable to read the remembered wallet address:', error);
    return null;
  }
}

function rememberWalletAddress(address: string | null) {
  try {
    if (address) {
      window.localStorage.setItem(WALLET_ADDRESS_KEY, address);
    } else {
      window.localStorage.removeItem(WALLET_ADDRESS_KEY);
    }
  } catch (error) {
    console.warn('Unable to save the remembered wallet address:', error);
  }
}

function selectAuthorizedAccount(accounts: string[], preferredAddress: string | null): string | null {
  if (preferredAddress) {
    const preferredAccount = accounts.find(
      (account) => account.toLowerCase() === preferredAddress.toLowerCase()
    );
    if (preferredAccount) return preferredAccount;
  }
  return accounts[0] ?? null;
}

export function WalletConnectionProvider({ children }: { children: ReactNode }) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;

    let active = true;
    let receivedAccountsChanged = false;
    const updateWallet = (accounts: unknown, preferRememberedAccount: boolean) => {
      const availableAccounts = getAccounts(accounts);
      const selectedAccount = preferRememberedAccount
        ? selectAuthorizedAccount(availableAccounts, getStoredWalletAddress())
        : availableAccounts[0] ?? null;
      setWalletAddress(selectedAccount);
      rememberWalletAddress(selectedAccount);
    };

    const handleAccountsChanged = (accounts: unknown) => {
      receivedAccountsChanged = true;
      updateWallet(accounts, false);
    };
    provider.on?.('accountsChanged', handleAccountsChanged);

    void provider.request({ method: 'eth_accounts' })
      .then((accounts) => {
        if (active && !receivedAccountsChanged) updateWallet(accounts, true);
      })
      .catch((error: unknown) => {
        console.error('Unable to restore the connected wallet:', error);
      });

    return () => {
      active = false;
      provider.removeListener?.('accountsChanged', handleAccountsChanged);
    };
  }, []);

  const connectWallet = useCallback(async () => {
    const provider: SodexWalletProvider | undefined = window.ethereum;
    if (!provider) throw new Error('No injected wallet found. Install an EIP-1193 wallet to continue.');

    const accounts = getAccounts(await provider.request({ method: 'eth_requestAccounts' }));
    const selectedAccount = accounts[0];
    if (!selectedAccount) throw new Error('No wallet account was authorized.');

    setWalletAddress(selectedAccount);
    rememberWalletAddress(selectedAccount);
    return selectedAccount;
  }, []);

  const value = useMemo(
    () => ({ walletAddress, connectWallet }),
    [walletAddress, connectWallet]
  );

  return (
    <WalletConnectionContext.Provider value={value}>
      {children}
    </WalletConnectionContext.Provider>
  );
}

export function useWalletConnection() {
  const context = useContext(WalletConnectionContext);
  if (!context) {
    throw new Error('useWalletConnection must be used within WalletConnectionProvider.');
  }
  return context;
}
