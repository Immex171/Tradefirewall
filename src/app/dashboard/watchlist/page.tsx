'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';
import { DashboardTabs } from '@/components/DashboardTabs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { storageManager, type WatchlistItem } from '@/lib/storage';
import { toast } from '@/lib/toast';

export default function DashboardWatchlistPage() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [symbol, setSymbol] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  useEffect(() => {
    const loadWatchlist = () => setWatchlist(storageManager.getWatchlist());
    loadWatchlist();
    window.addEventListener('focus', loadWatchlist);
    window.addEventListener('tradefirewall-reports-changed', loadWatchlist);
    return () => {
      window.removeEventListener('focus', loadWatchlist);
      window.removeEventListener('tradefirewall-reports-changed', loadWatchlist);
    };
  }, []);

  const handleAddAsset = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!/^[A-Z]{2,10}$/.test(normalizedSymbol)) {
      setInputError('Enter 2–10 letters, such as BTC, ETH, or SOL.');
      return;
    }

    setInputError(null);
    const result = storageManager.addToWatchlist({ symbol: normalizedSymbol, source: 'manual' });
    if (result.success) {
      setWatchlist(storageManager.getWatchlist());
      setSymbol('');
      toast.success(result.message);
    } else {
      toast.info(result.message);
    }
  };

  const handleRemoveAsset = (assetSymbol: string) => {
    const result = storageManager.removeFromWatchlist(assetSymbol);
    if (result.success) {
      setWatchlist(storageManager.getWatchlist());
      toast.success(result.message);
    } else {
      toast.error(result.message);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteNav
        actions={
          <Link href="/check-trade">
            <Button className="btn-primary px-4 py-2 text-sm">Check a trade</Button>
          </Link>
        }
      />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-section-heading mb-1">Watchlist</h1>
          <p className="text-body">Keep the assets you follow easy to find.</p>
        </div>
        <DashboardTabs active="/dashboard/watchlist" />

        <Card className="terminal-card">
          <CardHeader>
            <CardTitle className="text-card-heading">Your assets <span className="text-sm font-normal text-text-secondary">({watchlist.length})</span></CardTitle>
          </CardHeader>
          <CardContent>
            {watchlist.length === 0 ? (
              <p className="mb-5 text-sm text-text-secondary">No assets yet. Add a symbol to get started.</p>
            ) : (
              <ul className="mb-6 space-y-3">
                {watchlist.map((item) => (
                  <li key={`${item.symbol}-${item.addedAt}`} className="flex flex-col gap-3 rounded-lg bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20">
                        <span className="text-xs font-medium text-primary">{item.symbol}</span>
                      </div>
                      <div>
                        <span className="font-medium text-text-primary">{item.symbol}</span>
                        {item.latestRiskScore != null && (
                          <div className="text-xs text-text-secondary">Latest risk: {item.latestRiskScore}/100</div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-text-secondary">
                        Added {Number.isFinite(item.addedAt) ? new Date(item.addedAt).toLocaleDateString() : 'date unavailable'}
                      </span>
                      <Button
                        type="button"
                        aria-label={`Remove ${item.symbol} from watchlist`}
                        onClick={() => handleRemoveAsset(item.symbol)}
                        className="border border-danger/30 bg-danger/10 px-2 py-1 text-xs text-danger hover:bg-danger/20"
                      >
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={handleAddAsset} className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="watchlist-symbol" className="mb-1 block text-sm font-medium text-text-primary">
                  Add an asset
                </label>
                <Input
                  id="watchlist-symbol"
                  name="symbol"
                  value={symbol}
                  onChange={(event) => {
                    setSymbol(event.target.value);
                    setInputError(null);
                  }}
                  placeholder="e.g. BTC"
                  autoComplete="off"
                  autoCapitalize="characters"
                  maxLength={10}
                  aria-invalid={inputError ? true : undefined}
                  aria-describedby={inputError ? 'watchlist-symbol-error' : 'watchlist-symbol-help'}
                />
                {inputError ? (
                  <p id="watchlist-symbol-error" className="mt-1 text-sm text-danger" role="alert">{inputError}</p>
                ) : (
                  <p id="watchlist-symbol-help" className="mt-1 text-xs text-text-secondary">Use 2–10 letters.</p>
                )}
              </div>
              <Button type="submit" className="btn-secondary">Add to watchlist</Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
