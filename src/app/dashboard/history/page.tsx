'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';
import { DashboardTabs } from '@/components/DashboardTabs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { storageManager, type SavedReport } from '@/lib/storage';
import { toTradeCheckRows, type TradeCheckRow } from '@/lib/tradeCheckRow';

function getDecisionBadge(decision: string) {
  const variants: Record<string, string> = {
    APPROVE: 'bg-success text-background',
    CAUTION: 'bg-warning text-background',
    REDUCE_OR_WAIT: 'bg-orange-risk text-white',
    BLOCK: 'bg-danger text-white',
    Approve: 'bg-success text-background',
    Caution: 'bg-warning text-background',
    Block: 'bg-danger text-white',
  };
  return variants[decision] || 'bg-surface text-text-primary';
}

export default function TradeHistoryPage() {
  const [reports, setReports] = useState<TradeCheckRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadReports = () => {
      try {
        const savedReports: SavedReport[] = storageManager.getReports();
        setReports(toTradeCheckRows(savedReports));
        setError(null);
      } catch (loadError) {
        console.error('Trade history loading error:', loadError);
        setError('Failed to load trade history.');
      } finally {
        setIsLoading(false);
      }
    };

    loadReports();
    window.addEventListener('focus', loadReports);
    window.addEventListener('tradefirewall-reports-changed', loadReports);
    return () => {
      window.removeEventListener('focus', loadReports);
      window.removeEventListener('tradefirewall-reports-changed', loadReports);
    };
  }, []);

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
          <h1 className="text-section-heading mb-1">Trade history</h1>
          <p className="text-body">Review your saved trade checks and decisions.</p>
        </div>
        <DashboardTabs active="/dashboard/history" />

        <Card className="terminal-card">
          <CardHeader>
            <CardTitle className="text-card-heading">All trade checks</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="py-8 text-center text-body" role="status">Loading trade history…</p>
            ) : error ? (
              <p className="py-8 text-center text-danger" role="alert">{error}</p>
            ) : reports.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-body mb-4">Your saved trade checks will appear here.</p>
                <Link href="/check-trade">
                  <Button className="btn-primary">Check your first trade</Button>
                </Link>
              </div>
            ) : (
              <div className="terminal-table overflow-x-auto" tabIndex={0} aria-label="All trade checks, horizontally scrollable">
                <table className="w-full min-w-[560px]">
                  <caption className="sr-only">All saved trade checks, newest first</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="text-left">Date</th>
                      <th scope="col" className="text-left">Asset</th>
                      <th scope="col" className="text-left">Action</th>
                      <th scope="col" className="text-left">Amount</th>
                      <th scope="col" className="text-left">Risk score</th>
                      <th scope="col" className="text-left">Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((report) => (
                      <tr key={report.id}>
                        <td className="text-text-secondary">{report.time}</td>
                        <td className="font-medium text-text-primary">{report.asset}</td>
                        <td className="capitalize text-text-secondary">{report.action}</td>
                        <td className="text-text-secondary">{report.amount}</td>
                        <td className="text-text-primary">{report.riskScore}/100</td>
                        <td>
                          <Badge className={`${getDecisionBadge(report.decision)} rounded px-2 py-1 text-xs`}>
                            {report.decision}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
