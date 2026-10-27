'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useWalletConnection } from '@/components/WalletConnectionProvider';
import { toast } from '@/lib/toast';
import type { BuilderFeeDailyStats, BuilderFeeStats } from '@/lib/sodexBuilder';

interface BuilderIdentity {
  network: 'testnet';
  accountID: number | null;
  builderID: string | null;
}

interface BuilderStatsResponse {
  network: 'testnet';
  builderID: string;
  summary: BuilderFeeStats | null;
  dailyChart: BuilderFeeDailyStats[];
  fetchedAt: number;
}

export function SoDEXBuilderIdCard() {
  const { walletAddress, connectWallet } = useWalletConnection();
  const [identity, setIdentity] = useState<BuilderIdentity | null>(null);
  const [identityAddress, setIdentityAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<BuilderStatsResponse | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  const loadIdentity = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/sodex/account/identity${walletAddress ? `?address=${encodeURIComponent(walletAddress)}` : ''}`,
        { cache: 'no-store' }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to load TradeFirewall’s SoDEX Builder ID.');
      setIdentity(body as BuilderIdentity);
      setIdentityAddress(walletAddress ?? '');
    } catch (loadError) {
      setIdentity(null);
      setIdentityAddress(walletAddress ?? '');
      setError(loadError instanceof Error ? loadError.message : 'Unable to load TradeFirewall’s SoDEX Builder ID.');
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    setStatsError(null);
    try {
      const response = await fetch('/api/sodex/builders/stats', { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to load SoDEX Builder statistics.');
      setStats(body as BuilderStatsResponse);
    } catch (loadError) {
      setStats(null);
      setStatsError(loadError instanceof Error ? loadError.message : 'Unable to load SoDEX Builder statistics.');
    } finally {
      setLoadingStats(false);
    }
  }, []);

  const refresh = () => {
    void loadIdentity();
    void loadStats();
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load the connected wallet's SoDEX identity
    void loadIdentity();
  }, [walletAddress, loadIdentity]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load public SoDEX Builder statistics
    void loadStats();
  }, [loadStats]);

  const visibleIdentity = identityAddress === (walletAddress ?? '') ? identity : null;
  const visibleError = identityAddress === (walletAddress ?? '') ? error : null;

  const copyBuilderID = async () => {
    if (!visibleIdentity) return;
    try {
      if (!visibleIdentity.builderID) throw new Error('TradeFirewall Builder ID is not configured.');
      await navigator.clipboard.writeText(visibleIdentity.builderID);
      toast.success('TradeFirewall Builder ID copied.');
    } catch {
      toast.error('Unable to copy the Builder ID. Select and copy it manually.');
    }
  };

  return (
    <Card className="terminal-card mb-8 border-primary/30">
      <CardHeader>
        <CardTitle className="text-card-heading">TradeFirewall Builder ID</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-text-secondary">
          This is TradeFirewall’s fee-receiving SoDEX Testnet account. Users must approve this ID before eligible orders can request a builder fee.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <output
            aria-label="TradeFirewall Builder ID"
            className="rounded-md border border-border bg-background px-3 py-2 font-mono text-lg text-text-primary"
          >
            {loading ? 'Loading…' : visibleIdentity?.builderID ?? 'Not configured'}
          </output>
          <Button
            onClick={() => void copyBuilderID()}
            disabled={!visibleIdentity?.builderID}
            className="btn-secondary"
          >
            Copy ID
          </Button>
          <Button
            onClick={refresh}
            disabled={loading || loadingStats}
            className="btn-secondary"
          >
            {loading || loadingStats ? 'Refreshing…' : 'Refresh'}
          </Button>
          {!walletAddress && (
            <Button onClick={() => void connectWallet().catch((connectError: unknown) => {
              toast.error(connectError instanceof Error ? connectError.message : 'Wallet connection failed.');
            })} className="btn-primary">
              Connect wallet
            </Button>
          )}
        </div>
        {visibleError && <p role="alert" className="text-sm text-danger">{visibleError}</p>}
        {visibleIdentity?.accountID && (
          <p className="text-xs text-text-secondary">
            Connected user account ID: <span className="font-mono">{visibleIdentity.accountID}</span>
          </p>
        )}
        <p className="text-xs text-text-secondary">TradeFirewall Testnet Builder ID</p>
        <section className="space-y-3 border-t border-border pt-4" aria-label="SoDEX-reported Builder statistics">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-text-primary">Builder performance</h3>
            <span className="text-xs text-text-secondary">
              {stats ? `SoDEX Testnet · updated ${new Date(stats.fetchedAt).toLocaleTimeString()}` : 'Reported by SoDEX'}
            </span>
          </div>
          {loadingStats && <p className="text-sm text-text-secondary">Loading Builder statistics…</p>}
          {statsError && <p role="alert" className="text-sm text-danger">{statsError}</p>}
          {!loadingStats && stats && (
            <>
              {stats.summary ? (
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <BuilderStat label="Builder fees" value={stats.summary.builderFee} />
                  <BuilderStat label="Attributed fills" value={stats.summary.tradeCount} />
                  <BuilderStat label="Traded notional" value={stats.summary.tradeVolume} />
                  <BuilderStat label="Builder users" value={stats.summary.userCount} />
                  <BuilderStat label="Builder name" value={stats.summary.name} />
                  <BuilderStat label="Builder account" value={stats.summary.builderCode} />
                </dl>
              ) : (
                <p className="text-sm text-text-secondary">SoDEX has no Builder fee summary for this account yet.</p>
              )}
              <p className="text-xs text-text-secondary">
                Values are the SoDEX-reported summary; the configured approval rate is not used to estimate earnings.
              </p>
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-text-primary">Daily activity (UTC)</h4>
                {stats.dailyChart.length === 0 ? (
                  <p className="text-sm text-text-secondary">No daily Builder activity returned.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left text-xs">
                      <thead className="text-text-secondary">
                        <tr>
                          <th className="p-2">Date</th>
                          <th className="p-2">Builder fees</th>
                          <th className="p-2">Fills</th>
                          <th className="p-2">Notional</th>
                          <th className="p-2">Users</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.dailyChart.slice(-7).map((day) => (
                          <tr key={day.date} className="border-t border-border">
                            <td className="p-2 font-mono">{day.date}</td>
                            <td className="p-2 font-mono">{day.builderFee}</td>
                            <td className="p-2 font-mono">{day.tradeCount}</td>
                            <td className="p-2 font-mono">{day.tradeVolume}</td>
                            <td className="p-2 font-mono">{day.userCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {stats.dailyChart.length > 7 && (
                      <p className="pt-2 text-xs text-text-secondary">Showing the latest 7 of {stats.dailyChart.length} SoDEX daily records.</p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function BuilderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className="mt-1 break-all font-mono text-sm text-text-primary">{value}</dd>
    </div>
  );
}
