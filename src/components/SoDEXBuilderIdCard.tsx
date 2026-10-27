'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useWalletConnection } from '@/components/WalletConnectionProvider';
import { toast } from '@/lib/toast';

interface BuilderIdentity {
  network: 'testnet';
  accountID: number;
}

export function SoDEXBuilderIdCard() {
  const { walletAddress, connectWallet } = useWalletConnection();
  const [identity, setIdentity] = useState<BuilderIdentity | null>(null);
  const [identityAddress, setIdentityAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadIdentity = useCallback(async () => {
    if (!walletAddress) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/sodex/account/identity?address=${encodeURIComponent(walletAddress)}`,
        { cache: 'no-store' }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to load your SoDEX Builder ID.');
      setIdentity(body as BuilderIdentity);
      setIdentityAddress(walletAddress);
    } catch (loadError) {
      setIdentity(null);
      setIdentityAddress(walletAddress);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load your SoDEX Builder ID.');
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load the connected wallet's SoDEX identity
    void loadIdentity();
  }, [walletAddress, loadIdentity]);

  const visibleIdentity = identityAddress === walletAddress ? identity : null;
  const visibleError = identityAddress === walletAddress ? error : null;

  const copyBuilderID = async () => {
    if (!visibleIdentity) return;
    try {
      await navigator.clipboard.writeText(String(visibleIdentity.accountID));
      toast.success('SoDEX Builder ID copied.');
    } catch {
      toast.error('Unable to copy the Builder ID. Select and copy it manually.');
    }
  };

  return (
    <Card className="terminal-card mb-8 border-primary/30">
      <CardHeader>
        <CardTitle className="text-card-heading">Your SoDEX Builder ID</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!walletAddress ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-text-secondary">
              Connect your SoDEX Testnet wallet to look up the account ID other users can use as your Builder ID.
            </p>
            <Button onClick={() => void connectWallet().catch((connectError: unknown) => {
              toast.error(connectError instanceof Error ? connectError.message : 'Wallet connection failed.');
            })} className="btn-primary">
              Connect wallet
            </Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-text-secondary">
              Your SoDEX account ID is also your Builder ID. Share this number with users who want to reference you as a builder.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <output
                aria-label="Your SoDEX Builder ID"
                className="rounded-md border border-border bg-background px-3 py-2 font-mono text-lg text-text-primary"
              >
                {loading ? 'Loading…' : visibleIdentity?.accountID ?? '—'}
              </output>
              <Button
                onClick={() => void copyBuilderID()}
                disabled={!visibleIdentity}
                className="btn-secondary"
              >
                Copy ID
              </Button>
              <Button
                onClick={() => void loadIdentity()}
                disabled={loading}
                className="btn-secondary"
              >
                {loading ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
            {visibleError && <p role="alert" className="text-sm text-danger">{visibleError}</p>}
            <p className="text-xs text-text-secondary">Testnet account ID</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
