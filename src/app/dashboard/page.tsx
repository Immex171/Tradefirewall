'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';
import { DashboardTabs } from '@/components/DashboardTabs';
import { SoDEXBuilderIdCard } from '@/components/SoDEXBuilderIdCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { storageManager, type SavedReport, type WatchlistItem } from '@/lib/storage';
import { isHighRisk, riskBand, type RiskBand } from '@/lib/riskBand';
import { toTradeCheckRows, type TradeCheckRow } from '@/lib/tradeCheckRow';
import { toast } from '@/lib/toast';

// Types for real data
interface DashboardMetrics {
  averageRiskScore: number | null;
  blockedTrades: number;
  reducedSizeRecommendations: number;
  highRiskAlerts: number;
  /** Sum of user-entered trade amounts for reports with decision BLOCK (not a PnL claim) */
  blockedNotionalUsd: number;
  tradesChecked: number;
}

const EMPTY_METRICS: DashboardMetrics = {
  averageRiskScore: null,
  blockedTrades: 0,
  reducedSizeRecommendations: 0,
  highRiskAlerts: 0,
  blockedNotionalUsd: 0,
  tradesChecked: 0,
};

interface RiskAlert {
  id: string;
  message: string;
  severity: 'high' | 'medium';
  time: string;
}

function calculateMetricsFromReports(reports: SavedReport[]): DashboardMetrics {
  if (reports.length === 0) {
    return EMPTY_METRICS;
  }

  const totalRiskScore = reports.reduce((sum, report) => sum + report.riskScore, 0);
  const averageRiskScore = Math.round(totalRiskScore / reports.length);
  const blockedTrades = reports.filter(report => report.decision === 'BLOCK').length;
  const reducedSizeRecommendations = reports.filter(report =>
    report.recommendedAction.toLowerCase().includes('reduce')
  ).length;

  const blockedReports = reports.filter((report) => report.decision === 'BLOCK');
  const blockedNotionalUsd = Math.round(
    blockedReports.reduce((sum, report) => sum + (Number(report.amount) || 0), 0)
  );

  const highRiskAlerts = reports.filter((report) => isHighRisk(report.riskScore)).length;

  return {
    averageRiskScore,
    blockedTrades,
    reducedSizeRecommendations,
    highRiskAlerts,
    blockedNotionalUsd,
    tradesChecked: reports.length
  };
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics>(EMPTY_METRICS);
  const [recentTradeChecks, setRecentTradeChecks] = useState<TradeCheckRow[]>([]);
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = (showFullPageLoader: boolean) => {
      try {
        if (showFullPageLoader) {
          setIsLoading(true);
        }
        setError(null);

        // Load real data from localStorage using storageManager (guarded against SSR)
        let savedReports: Awaited<ReturnType<typeof storageManager.getReports>> = [];
        let savedWatchlist: Awaited<ReturnType<typeof storageManager.getWatchlist>> = [];
        if (typeof window !== 'undefined') {
          try {
            savedReports = storageManager.getReports();
            savedWatchlist = storageManager.getWatchlist();
          } catch (e) {
            console.warn('Failed to load localStorage data:', e);
          }
        }

        // Reports are stored newest-first; the dashboard defaults to a short recent list.
        setRecentTradeChecks(toTradeCheckRows(savedReports, 10));
        setMetrics(calculateMetricsFromReports(savedReports));

        setWatchlist(savedWatchlist);

        // Generate alerts based on recent high-risk reports
        const highRiskReports = savedReports.filter(r => isHighRisk(r.riskScore));
        const generatedAlerts = highRiskReports.slice(0, 5).map(report => ({
          id: `alert_${report.id}`,
          message: `High risk detected for ${report.symbol} trade (${report.riskScore}/100)`,
          severity: riskBand(report.riskScore) === 'critical' ? 'high' as const : 'medium' as const,
          time: new Date(report.createdAt).toLocaleDateString()
        }));
        setAlerts(generatedAlerts);

      } catch (err) {
        setError('Failed to load dashboard data');
        console.error('Dashboard data loading error:', err);
      } finally {
        if (showFullPageLoader) {
          setIsLoading(false);
        }
      }
    };

    loadData(true);
    const onFocus = () => loadData(false);
    const onReportsChanged = () => loadData(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('tradefirewall-reports-changed', onReportsChanged as EventListener);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('tradefirewall-reports-changed', onReportsChanged as EventListener);
    };
  }, []);

  const downloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke on the next tick — revoking synchronously after click() races the
    // download start in some browsers and cancels it.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const exportFilename = (ext: 'json' | 'csv') =>
    `tradefirewall-reports-${new Date().toISOString().split('T')[0]}.${ext}`;

  const handleExportJSON = () => {
    const data = storageManager.exportData();
    if (!data) {
      toast.error('No data to export.');
      return;
    }
    downloadFile(data, exportFilename('json'), 'application/json');
    toast.success('Reports exported successfully.');
  };

  const handleExportCSV = () => {
    const csvData = storageManager.exportReportsToCSV();
    if (!csvData) {
      toast.error('No reports to export.');
      return;
    }
    downloadFile(csvData, exportFilename('csv'), 'text/csv');
    toast.success('CSV exported successfully.');
  };

  const getDecisionBadge = (decision: string) => {
    const variants = {
      'APPROVE': 'bg-success text-background',
      'CAUTION': 'bg-warning text-background',
      'REDUCE_OR_WAIT': 'bg-orange-risk text-white',
      'BLOCK': 'bg-danger text-white',
      'Approve': 'bg-success text-background',
      'Caution': 'bg-warning text-background',
      'Block': 'bg-danger text-white'
    };
    return variants[decision as keyof typeof variants] || 'bg-surface text-text-primary';
  };
  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <SiteNav
          actions={
            <Link href="/check-trade">
              <Button className="btn-primary px-4 py-2 text-sm">Check New Trade</Button>
            </Link>
          }
        />

        <main className="max-w-4xl mx-auto px-4 py-24">
          <div className="text-center">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-body">Loading dashboard...</p>
          </div>
        </main>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <SiteNav
          actions={
            <Link href="/check-trade">
              <Button className="btn-primary px-4 py-2 text-sm">Check New Trade</Button>
            </Link>
          }
        />

        <main className="max-w-4xl mx-auto px-4 py-24">
          <div className="text-center">
            <div className="w-24 h-24 bg-danger/10 rounded-full flex items-center justify-center mx-auto mb-8">
              <span className="text-danger text-xl">⚠</span>
            </div>
            <h1 className="text-section-heading mb-4">Dashboard Error</h1>
            <p className="text-body mb-8">{error}</p>
            <Button onClick={() => window.location.reload()} className="btn-primary px-8 py-3">
              Try Again
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <SiteNav
          actions={
            <Link href="/check-trade">
              <Button className="btn-primary px-4 py-2 text-sm">Check New Trade</Button>
            </Link>
          }
        />

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-section-heading mb-1">Dashboard</h1>
            <p className="text-body">A quick view of your trade checks and risk.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/check-trade">
              <Button className="btn-primary px-5 py-2">Check a trade</Button>
            </Link>
            {metrics.tradesChecked > 0 && (
              <details className="relative">
                <summary className="btn-secondary px-4 py-2 cursor-pointer list-none">Export</summary>
                <div className="absolute right-0 z-10 mt-2 flex min-w-36 flex-col gap-1 rounded-lg border border-border bg-background p-2 shadow-lg">
                  <Button className="btn-secondary justify-start px-3 py-2 text-sm" onClick={handleExportCSV}>Download CSV</Button>
                  <Button className="btn-secondary justify-start px-3 py-2 text-sm" onClick={handleExportJSON}>Download JSON</Button>
                </div>
              </details>
            )}
          </div>
        </div>
        <DashboardTabs active="/dashboard" />
        <SoDEXBuilderIdCard />

        {metrics.tradesChecked === 0 && (
          <Card className="terminal-card mb-8 border-primary/30">
            <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-card-heading">Your dashboard is ready</h2>
                <p className="text-body mt-1">
                  Run your first trade check to see your risk history and metrics here.
                </p>
              </div>
              <Link href="/check-trade">
                <Button className="btn-primary">Check your first trade</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 mb-8">
          <Card className="terminal-card">
            <CardContent className="flex items-center justify-between p-4">
              <span className="text-label">Trade checks</span>
              <span className="text-2xl font-bold text-text-primary">{metrics.tradesChecked}</span>
            </CardContent>
          </Card>
          <Card className="terminal-card">
            <CardContent className="flex items-center justify-between p-4">
              <span className="text-label">Average risk</span>
              <span className="text-2xl font-bold text-text-primary">
                {metrics.averageRiskScore !== null ? `${metrics.averageRiskScore}/100` : '—'}
              </span>
            </CardContent>
          </Card>
          <Card className="terminal-card">
            <CardContent className="flex items-center justify-between p-4">
              <span className="text-label">Blocked</span>
              <span className="text-2xl font-bold text-danger">{metrics.blockedTrades}</span>
            </CardContent>
          </Card>
        </div>

        {recentTradeChecks.length > 0 && (
        <details className="mb-8 rounded-xl border border-border bg-surface/30">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-text-primary">
            More risk insights
            <span className="ml-2 text-xs font-normal text-text-secondary">Distribution and analysis details</span>
          </summary>
          {recentTradeChecks.length > 0 && (
            <div className="grid gap-5 border-t border-border p-4 lg:grid-cols-2">
            <Card className="terminal-card">
              <CardHeader>
                <CardTitle className="text-card-heading">Additional metrics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-text-secondary">Reduced-size recommendations</span>
                  <span className="font-medium text-warning">{metrics.reducedSizeRecommendations}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-text-secondary">High-risk checks</span>
                  <span className="font-medium text-orange-risk">{metrics.highRiskAlerts}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-text-secondary">Blocked trade amount</span>
                  <span className="font-medium text-text-primary">
                    {metrics.blockedNotionalUsd > 0 ? `$${metrics.blockedNotionalUsd.toLocaleString()}` : '—'}
                  </span>
                </div>
                <p className="text-xs text-text-secondary">
                  Sum of blocked trade sizes, not a simulated P&amp;L.
                </p>
              </CardContent>
            </Card>

            <Card className="terminal-card">
              <CardHeader>
                <CardTitle className="text-card-heading">Risk Distribution</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm text-text-secondary mb-4">
                  Distribution across your {recentTradeChecks.length} most recent trade checks
                </div>
                <div className="space-y-3">
                  {(() => {
                    const byBand = (band: RiskBand) =>
                      recentTradeChecks.filter((t) => riskBand(t.riskScore) === band).length;
                    const lowRisk = byBand('low');
                    const mediumRisk = byBand('moderate');
                    const highRisk = byBand('high');
                    const criticalRisk = byBand('critical');
                    const total = recentTradeChecks.length;

                    return (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-body">Low Risk (0-25)</span>
                          <div className="flex items-center space-x-3">
                            <div className="w-24 bg-surface rounded-full h-2">
                              <div className="bg-success h-2 rounded-full" style={{ width: `${(lowRisk / total) * 100}%` }}></div>
                            </div>
                            <span className="text-sm text-text-primary min-w-[3ch]">{Math.round((lowRisk / total) * 100)}%</span>
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between">
                          <span className="text-body">Medium Risk (26-50)</span>
                          <div className="flex items-center space-x-3">
                            <div className="w-24 bg-surface rounded-full h-2">
                              <div className="bg-warning h-2 rounded-full" style={{ width: `${(mediumRisk / total) * 100}%` }}></div>
                            </div>
                            <span className="text-sm text-text-primary min-w-[3ch]">{Math.round((mediumRisk / total) * 100)}%</span>
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between">
                          <span className="text-body">High Risk (51-75)</span>
                          <div className="flex items-center space-x-3">
                            <div className="w-24 bg-surface rounded-full h-2">
                              <div className="bg-orange-risk h-2 rounded-full" style={{ width: `${(highRisk / total) * 100}%` }}></div>
                            </div>
                            <span className="text-sm text-text-primary min-w-[3ch]">{Math.round((highRisk / total) * 100)}%</span>
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between">
                          <span className="text-body">Critical Risk (76-100)</span>
                          <div className="flex items-center space-x-3">
                            <div className="w-24 bg-surface rounded-full h-2">
                              <div className="bg-danger h-2 rounded-full" style={{ width: `${(criticalRisk / total) * 100}%` }}></div>
                            </div>
                            <span className="text-sm text-text-primary min-w-[3ch]">{Math.round((criticalRisk / total) * 100)}%</span>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>
            </div>
          )}
        </details>
        )}
        {recentTradeChecks.length > 0 && (
          <Card id="reports" className="terminal-card mb-8 scroll-mt-24">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-card-heading">Recent trade checks</CardTitle>
              <Link href="/dashboard/history" className="text-sm text-primary hover:underline">View all</Link>
            </CardHeader>
            <CardContent>
              <div className="terminal-table overflow-x-auto" tabIndex={0} aria-label="Recent trade checks, horizontally scrollable">
                <table className="w-full min-w-[560px]">
                  <caption className="sr-only">Your most recent saved trade checks</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="text-left">Time</th>
                      <th scope="col" className="text-left">Asset</th>
                      <th scope="col" className="text-left">Action</th>
                      <th scope="col" className="text-left">Amount</th>
                      <th scope="col" className="text-left">Risk Score</th>
                      <th scope="col" className="text-left">Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentTradeChecks.slice(0, 5).map((check) => (
                      <tr key={check.id}>
                        <td className="text-text-secondary">{check.time}</td>
                        <td className="text-text-primary font-medium">{check.asset}</td>
                        <td className="text-text-secondary capitalize">{check.action}</td>
                        <td className="text-text-secondary">{check.amount}</td>
                        <td className="text-text-primary">{check.riskScore}/100</td>
                        <td>
                          <Badge className={`${getDecisionBadge(check.decision)} px-2 py-1 text-xs rounded`}>
                            {check.decision}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/dashboard/history" className="group">
            <Card className="terminal-card h-full transition-colors group-hover:ring-primary/40">
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <h2 className="font-medium text-text-primary">Trade history</h2>
                  <p className="mt-1 text-sm text-text-secondary">Review all {metrics.tradesChecked} saved checks</p>
                </div>
                <span aria-hidden="true" className="text-primary">→</span>
              </CardContent>
            </Card>
          </Link>
          <Link href="/dashboard/watchlist" className="group">
            <Card className="terminal-card h-full transition-colors group-hover:ring-primary/40">
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <h2 className="font-medium text-text-primary">Watchlist</h2>
                  <p className="mt-1 text-sm text-text-secondary">
                    {watchlist.length} {watchlist.length === 1 ? 'asset' : 'assets'} saved
                  </p>
                </div>
                <span aria-hidden="true" className="text-primary">→</span>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Alerts remain available without taking over the dashboard. */}
        {alerts.length > 0 && (
          <details className="mb-8 rounded-xl border border-border bg-surface/30">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-text-primary">
              Risk alerts <span className="ml-1 text-text-secondary">({alerts.length})</span>
            </summary>
            <div className="space-y-3 border-t border-border p-4">
              {alerts.map((alert) => (
                <div key={alert.id} className={`rounded-lg border p-3 ${
                  alert.severity === 'high' ? 'border-danger/30 bg-danger/5' : 'border-warning/30 bg-warning/5'
                }`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className={`text-sm font-medium ${alert.severity === 'high' ? 'text-danger' : 'text-warning'}`}>
                        {alert.message}
                      </div>
                      <div className="mt-1 text-xs text-text-secondary">{alert.time}</div>
                    </div>
                    <Badge className={`${alert.severity === 'high' ? 'bg-danger text-white' : 'bg-warning text-background'} text-xs`}>
                      {alert.severity}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}

      </main>
    </div>
  );
}