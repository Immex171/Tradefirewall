'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/lib/toast';
import { ensureSodexTestnetChain } from '@/lib/sodexWallet';
import { useWalletConnection } from '@/components/WalletConnectionProvider';

interface AccountBalance {
  id: number;
  coin: string;
  total: string;
  locked: string;
}

interface AccountOrder {
  symbol: string;
  orderID: number;
  clOrdID: string;
  side: string;
  type: string;
  timeInForce: string;
  price?: string;
  origQty?: string;
  status: string;
  executedQty: string;
  executedValue: string;
  createdAt: number;
  updatedAt: number;
}

interface AccountMarket {
  symbol: string;
  name: string;
  sodexSymbol: string;
  baseCoin: string;
  analysisSupported: boolean;
}

interface AccountSnapshot {
  network: 'testnet';
  accountID: number;
  balances: AccountBalance[];
  orders: AccountOrder[];
  history: AccountOrder[];
  trades: Array<Record<string, unknown>>;
  markets: AccountMarket[];
  marketIntelligenceAvailable: boolean;
  snapshotAt: number;
}

interface SoDEXAccountManagementProps {
  onAnalyzeExit: (input: { symbol: string; quantity: number; amountUsd: number }) => void;
}

export function SoDEXAccountManagement({ onAnalyzeExit }: SoDEXAccountManagementProps) {
  const { walletAddress, connectWallet: requestWalletConnection } = useWalletConnection();
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyOrder, setBusyOrder] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshInProgress = useRef(false);

  const refreshAccount = useCallback(async () => {
    if (!walletAddress || refreshInProgress.current) return;
    refreshInProgress.current = true;
    setLoading(true);
    try {
      const response = await fetch(`/api/sodex/account?address=${encodeURIComponent(walletAddress)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to load SoDEX account activity.');
      setSnapshot(body as AccountSnapshot);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load SoDEX account activity.');
    } finally {
      refreshInProgress.current = false;
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch the selected wallet's account snapshot
    void refreshAccount();
    const timer = window.setInterval(() => void refreshAccount(), 15_000);
    return () => window.clearInterval(timer);
  }, [walletAddress, refreshAccount]);

  const connectWallet = async () => {
    if (!window.ethereum) {
      setError('Install an EIP-1193 wallet such as MetaMask to view your SoDEX Testnet account.');
      return;
    }
    setError(null);
    try {
      await requestWalletConnection();
      await ensureSodexTestnetChain();
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'Wallet connection failed.');
    }
  };

  const cancelOrder = async (order: AccountOrder, symbol: string) => {
    if (!walletAddress || !window.ethereum) return;
    if (!window.confirm(`Cancel open ${order.side} order ${order.orderID} for ${symbol}?`)) return;
    setBusyOrder(order.orderID);
    setError(null);
    try {
      const accounts = (await window.ethereum.request({ method: 'eth_accounts' })) as string[];
      if (accounts?.[0]?.toLowerCase() !== walletAddress.toLowerCase()) {
        throw new Error('The connected wallet changed. Reconnect the wallet that owns this SoDEX account.');
      }
      await ensureSodexTestnetChain();

      const preparedResponse = await fetch('/api/sodex/cancel-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'prepare',
          address: walletAddress,
          symbol,
          orderID: order.orderID,
          clOrdID: order.clOrdID,
        }),
      });
      const prepared = await preparedResponse.json();
      if (!preparedResponse.ok) throw new Error(prepared.error || 'Unable to prepare cancellation.');

      const signature = await window.ethereum.request({
        method: 'eth_signTypedData_v4',
        params: [walletAddress, JSON.stringify(prepared.typedData)],
      });
      const submitResponse = await fetch('/api/sodex/cancel-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit',
          address: walletAddress,
          params: prepared.params,
          nonce: prepared.nonce,
          signature,
        }),
      });
      const result = await submitResponse.json();
      if (!submitResponse.ok || !result.success) {
        throw new Error(result.error || 'SoDEX did not confirm the cancellation.');
      }
      toast.success(`Order ${order.orderID} cancellation submitted.`);
      await refreshAccount();
    } catch (cancelError) {
      const message = cancelError instanceof Error ? cancelError.message : 'Order cancellation failed.';
      setError(message);
      toast.error(message, 8000);
    } finally {
      setBusyOrder(null);
    }
  };

  const analyzeExit = async (position: {
    symbol: string;
    available: number;
    analysisSupported: boolean;
  }) => {
    if (!position.analysisSupported) {
      setError(`${position.symbol} is not currently supported by both SoDEX and the risk-analysis provider.`);
      return;
    }
    setError(null);
    try {
      const response = await fetch('/api/execution-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: position.symbol, action: 'sell', amount: 1 }),
      });
      const preview = await response.json();
      if (!response.ok) throw new Error(preview.error || 'Unable to estimate the exit value.');
      const price = Number(preview.estimatedPrice);
      if (!Number.isFinite(price) || price <= 0) throw new Error('SoDEX did not return a usable price for this position.');
      const amountUsd = position.available * price;
      if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error('The available position has no valid estimated value.');
      onAnalyzeExit({ symbol: position.symbol, quantity: position.available, amountUsd });
    } catch (exitError) {
      setError(exitError instanceof Error ? exitError.message : 'Unable to prepare exit analysis.');
    }
  };

  const positions = (snapshot?.balances ?? []).flatMap((balance) => {
    const market = snapshot?.markets.find(
      (item) => {
        const coin = balance.coin.toUpperCase();
        const baseCoin = item.baseCoin.toUpperCase();
        const unwrappedBase = baseCoin.replace(/^[VAW](?=[A-Z])/, '');
        return coin === baseCoin || coin === item.symbol.toUpperCase() || coin === unwrappedBase;
      }
    );
    const total = Number(balance.total);
    const locked = Number(balance.locked);
    const available = total - locked;
    if (!market || !Number.isFinite(available) || available <= 0) return [];
    return [{
      symbol: market.symbol,
      coin: balance.coin,
      total,
      locked,
      available,
      analysisSupported: market.analysisSupported,
    }];
  });

  const symbolForOrder = (order: AccountOrder) => {
    const market = snapshot?.markets.find((item) =>
      [item.symbol, item.name, item.sodexSymbol]
        .some((value) => value.toUpperCase() === order.symbol.toUpperCase())
    );
    return market?.symbol ?? order.symbol;
  };

  const copyAccountID = async () => {
    if (!snapshot) return;
    try {
      await navigator.clipboard.writeText(String(snapshot.accountID));
      toast.success('SoDEX account ID copied.');
    } catch {
      toast.error('Unable to copy the account ID. Select and copy it manually.');
    }
  };

  return (
    <Card className="terminal-card border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-card-heading">
          <span>SoDEX Testnet Account</span>
          <span className="text-xs font-normal text-text-secondary">
            {walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : 'Wallet not connected'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {!walletAddress ? (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              Connect the wallet used for your SoDEX Testnet trades to monitor open orders, fills, and available Spot balances.
            </p>
            <Button onClick={connectWallet} className="btn-primary">Connect wallet</Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="text-sm text-text-secondary">
                  SoDEX account ID <span className="font-mono font-semibold text-text-primary">{snapshot?.accountID ?? '…'}</span>
                </p>
                <Button
                  onClick={() => void copyAccountID()}
                  disabled={!snapshot}
                  className="btn-secondary h-8 px-3 text-xs"
                >
                  Copy account ID
                </Button>
                <p className="text-xs text-text-secondary">
                  Auto-refreshes every 15 seconds
                  {snapshot ? ` · updated ${new Date(snapshot.snapshotAt).toLocaleTimeString()}` : ''}
                </p>
              </div>
              <Button onClick={() => void refreshAccount()} disabled={loading} className="btn-secondary text-sm">
                {loading ? 'Refreshing…' : 'Refresh account'}
              </Button>
            </div>

            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            {!snapshot && loading && <p className="text-sm text-text-secondary">Loading account activity…</p>}

            {snapshot && (
              <>
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-text-primary">Open orders ({snapshot.orders.length})</h3>
                  {snapshot.orders.length === 0 ? (
                    <p className="text-sm text-text-secondary">No open Spot orders.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[720px] text-left text-xs">
                        <thead className="text-text-secondary">
                          <tr><th className="p-2">Market</th><th className="p-2">Side</th><th className="p-2">Order ID</th><th className="p-2">Price</th><th className="p-2">Filled</th><th className="p-2">Status</th><th className="p-2">Action</th></tr>
                        </thead>
                        <tbody>
                          {snapshot.orders.map((order) => {
                            const symbol = symbolForOrder(order);
                            return (
                              <tr key={`${order.orderID}-${order.clOrdID}`} className="border-t border-border">
                                <td className="p-2 font-mono">{symbol}</td>
                                <td className="p-2">{order.side}</td>
                                <td className="p-2 font-mono">{order.orderID}</td>
                                <td className="p-2 font-mono">{order.price ?? 'Market'}</td>
                                <td className="p-2 font-mono">{order.executedQty} / {order.origQty ?? '—'}</td>
                                <td className="p-2">{order.status}</td>
                                <td className="p-2">
                                  <Button
                                    onClick={() => void cancelOrder(order, symbol)}
                                    disabled={busyOrder !== null}
                                    className="btn-secondary h-8 px-2 text-xs"
                                  >
                                    {busyOrder === order.orderID ? 'Signing…' : 'Cancel'}
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-text-primary">Available Spot balances</h3>
                  {positions.length === 0 ? (
                    <p className="text-sm text-text-secondary">No available token balances with an active SoDEX Spot market.</p>
                  ) : (
                    <div className="space-y-2">
                      {positions.map((position) => (
                        <div key={position.coin} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                          <div className="text-sm">
                            <span className="font-medium text-text-primary">{position.symbol}</span>
                            <span className="ml-2 font-mono text-text-secondary">{formatQuantity(position.available)} available</span>
                            {position.locked > 0 && (
                              <span className="ml-2 text-xs text-text-secondary">({formatQuantity(position.locked)} locked)</span>
                            )}
                          </div>
                          <Button
                            onClick={() => void analyzeExit(position)}
                            disabled={loading || !position.analysisSupported}
                            className="btn-secondary text-xs"
                          >
                            Analyze full exit
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  {!snapshot.marketIntelligenceAvailable && (
                    <p className="text-xs text-warning">Risk-provider symbol coverage is unavailable; exit analysis is disabled until it can be checked.</p>
                  )}
                  <p className="text-xs text-text-secondary">
                    Exit starts a sell risk analysis. It does not submit an order; the existing risk gate and wallet signature are still required.
                  </p>
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-text-primary">Recent order history</h3>
                  {snapshot.history.length === 0 ? (
                    <p className="text-sm text-text-secondary">No historical Spot orders returned.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[600px] text-left text-xs">
                        <thead className="text-text-secondary">
                          <tr><th className="p-2">Market</th><th className="p-2">Side</th><th className="p-2">Order ID</th><th className="p-2">Filled</th><th className="p-2">Status</th><th className="p-2">Updated</th></tr>
                        </thead>
                        <tbody>
                          {snapshot.history.slice(0, 10).map((order) => (
                            <tr key={`${order.orderID}-${order.clOrdID}`} className="border-t border-border">
                              <td className="p-2 font-mono">{symbolForOrder(order)}</td>
                              <td className="p-2">{order.side}</td>
                              <td className="p-2 font-mono">{order.orderID}</td>
                              <td className="p-2 font-mono">{order.executedQty} / {order.origQty ?? '—'}</td>
                              <td className="p-2">{order.status}</td>
                              <td className="p-2">{formatTimestamp(order.updatedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-text-primary">Recent fills</h3>
                  {snapshot.trades.length === 0 ? (
                    <p className="text-sm text-text-secondary">No recent Spot fills returned.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] text-left text-xs">
                        <thead className="text-text-secondary">
                          <tr><th className="p-2">Time</th><th className="p-2">Market</th><th className="p-2">Side</th><th className="p-2">Price</th><th className="p-2">Quantity</th><th className="p-2">Total fee</th><th className="p-2">Builder fee</th></tr>
                        </thead>
                        <tbody>
                          {snapshot.trades.slice(0, 10).map((trade, index) => (
                            <tr key={String(trade.id ?? trade.tradeID ?? index)} className="border-t border-border">
                              <td className="p-2">{formatTimestamp(firstDefined(trade, ['time', 'timestamp', 'createdAt', 'T']))}</td>
                              <td className="p-2 font-mono">{String(firstDefined(trade, ['symbol', 's']) ?? '—')}</td>
                              <td className="p-2">{String(firstDefined(trade, ['side', 'S']) ?? '—')}</td>
                              <td className="p-2 font-mono">{String(firstDefined(trade, ['price', 'p']) ?? '—')}</td>
                              <td className="p-2 font-mono">{String(firstDefined(trade, ['quantity', 'qty', 'q']) ?? '—')}</td>
                              <td className="p-2 font-mono">{String(firstDefined(trade, ['fee', 'f']) ?? '—')}</td>
                              <td className="p-2 font-mono">{String(firstDefined(trade, ['builderFee', 'bf']) ?? '—')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="pt-2 text-xs text-text-secondary">
                        SoDEX reports builder fees separately; they are included in the total fee and must not be added to it again.
                      </p>
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function firstDefined(record: Record<string, unknown>, keys: string[]): unknown {
  return keys.map((key) => record[key]).find((value) => value !== undefined && value !== null);
}

function formatQuantity(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function formatTimestamp(value: unknown): string {
  const timestamp = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '—';
  return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp).toLocaleString();
}
