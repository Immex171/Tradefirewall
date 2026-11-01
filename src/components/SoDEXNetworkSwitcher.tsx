'use client';

import { useEffect, useState } from 'react';
import type { SodexNetwork } from '@/lib/sodexNetwork';

export function SoDEXNetworkSwitcher() {
  const [network, setNetwork] = useState<SodexNetwork>('testnet');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch('/api/sodex/network', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || (body.network !== 'testnet' && body.network !== 'mainnet')) {
          throw new Error(body.error || 'Unable to load the selected SoDEX network.');
        }
        if (active) setNetwork(body.network);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load the selected SoDEX network.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const changeNetwork = async (value: string) => {
    if (value !== 'testnet' && value !== 'mainnet') return;
    const nextNetwork = value;
    if (nextNetwork === network) return;
    if (
      nextNetwork === 'mainnet' &&
      !window.confirm('Switch to SoDEX Mainnet? Mainnet uses real funds. Confirm all order details before signing.')
    ) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/sodex/network', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ network: nextNetwork }),
      });
      const body = await response.json();
      if (!response.ok || body.network !== nextNetwork) {
        throw new Error(body.error || 'Unable to change the SoDEX network.');
      }
      window.location.reload();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to change the SoDEX network.');
      setSaving(false);
    }
  };

  return (
    <section className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4" aria-label="SoDEX network selection">
      <label htmlFor="sodex-network" className="text-sm font-medium text-text-primary">
        SoDEX network
      </label>
      <select
        id="sodex-network"
        value={network}
        disabled={loading || saving}
        onChange={(event) => void changeNetwork(event.target.value)}
        className="rounded-md border border-border bg-background px-3 py-2 text-sm text-text-primary"
      >
        <option value="testnet">Testnet</option>
        <option value="mainnet">Mainnet</option>
      </select>
      <span className="text-xs text-text-secondary">
        {loading
          ? 'Loading selected network…'
          : network === 'mainnet'
            ? 'Mainnet uses real funds.'
            : 'Testnet is the default; no real funds.'}
      </span>
      {saving && <span role="status" className="text-xs text-text-secondary">Switching network…</span>}
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </section>
  );
}
