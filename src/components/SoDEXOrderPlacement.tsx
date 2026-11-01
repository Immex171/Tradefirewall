'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TradeInput, Decision } from '@/lib/riskEngine';
import { toast } from '@/lib/toast';
import { ensureSodexChain, fetchSodexNetwork } from '@/lib/sodexWallet';
import type { SodexNetwork } from '@/lib/sodexOrderSigning';
import { getSodexOrderReviewSignature } from '@/lib/sodexOrderReview';
import { useWalletConnection } from '@/components/WalletConnectionProvider';

interface SoDEXOrderPlacementProps {
  tradeInput: TradeInput;
  riskScore: number;
  decision: Decision;
  exitQuantity?: number;
}

interface ExecutionPreviewData {
  estimatedPrice: number;
  estimatedSlippage: number;
  priceImpact: number;
  executionProbability: number;
  warnings: string[];
}

interface PreparedOrder {
  typedData: Record<string, unknown>;
  nonce: number;
  orderParams: Record<string, unknown>;
  preview: {
    symbol: string;
    side: string;
    quantity: string;
    protectionPrice: string;
    estimatedNotionalUsd: number;
    currentBid: number;
    currentAsk: number;
    slippagePct: number;
    orderType: string;
    timeInForce: string;
    network: SodexNetwork;
    builder: {
      enabled: boolean;
      builderID: string | null;
      requestedFeeRate: number;
      approvedFeeRate: number;
      estimatedFee: number;
      feeAsset: string;
      appliesToSide: boolean;
      note: string;
    };
  };
}

interface BuilderStatus {
  network: SodexNetwork;
  builderID: string | null;
  approvals: {
    spot: Array<{ builderID: string; feeRate: number }>;
    perps: Array<{ builderID: string; feeRate: number }>;
  };
}

interface OrderResult {
  success: boolean;
  orderID: number | null;
  clOrdID: string;
  error?: string;
  network: SodexNetwork;
  timestamp: number;
  submittedQuantity?: string;
  protectionPrice?: string;
}

type Stage = 'idle' | 'connecting' | 'connected' | 'preparing' | 'ready' | 'signing' | 'submitting' | 'done' | 'error';

export function SoDEXOrderPlacement({
  tradeInput,
  riskScore,
  decision,
  exitQuantity,
}: SoDEXOrderPlacementProps) {
  const [stage, setStage] = useState<Stage>('idle');
  const { walletAddress, connectWallet: requestWalletConnection } = useWalletConnection();
  const [executionPreview, setExecutionPreview] = useState<ExecutionPreviewData | null>(null);
  const [prepared, setPrepared] = useState<PreparedOrder | null>(null);
  const [preparedForAddress, setPreparedForAddress] = useState<string | null>(null);
  const [preparedReviewSignature, setPreparedReviewSignature] = useState<string | null>(null);
  const [result, setResult] = useState<OrderResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<string | null>(null);
  const [maxSlippagePct, setMaxSlippagePct] = useState(1);
  const [builderStatus, setBuilderStatus] = useState<BuilderStatus | null>(null);
  const [builderStatusAddress, setBuilderStatusAddress] = useState<string | null>(null);
  const [builderStatusError, setBuilderStatusError] = useState<string | null>(null);
  const [builderFeeRate, setBuilderFeeRate] = useState(90);
  const builderFeeRateRef = useRef(builderFeeRate);
  const [sodexNetwork, setSodexNetwork] = useState<SodexNetwork>('testnet');
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [builderOptInAddress, setBuilderOptInAddress] = useState<string | null>(null);
  const [builderActionBusy, setBuilderActionBusy] = useState(false);

  const canExecute = decision === 'APPROVE' || decision === 'CAUTION';
  const includeBuilderFee = !!walletAddress && builderOptInAddress === walletAddress;
  const reviewSignature = getSodexOrderReviewSignature({
    walletAddress,
    network: sodexNetwork,
    symbol: tradeInput.symbol,
    side: tradeInput.action,
    amount: tradeInput.amount,
    decision,
    riskScore,
    exitQuantity: exitQuantity ?? null,
    maxSlippagePct,
    includeBuilderFee,
    builderFeeRate,
  });
  const preparedReviewIsCurrent = preparedReviewSignature === reviewSignature;
  const visibleBuilderStatus = builderStatusAddress === walletAddress ? builderStatus : null;
  const activeSpotApproval = visibleBuilderStatus?.approvals.spot.find(
    (approval) => approval.builderID === visibleBuilderStatus.builderID
  );
  const approvedSpotFeeRate = activeSpotApproval?.feeRate ?? 0;

  const invalidatePreparedReview = useCallback(() => {
    setPrepared(null);
    setPreparedForAddress(null);
    setPreparedReviewSignature(null);
    setStage((current) => current === 'ready' ? 'connected' : current);
  }, []);

  useEffect(() => {
    builderFeeRateRef.current = builderFeeRate;
  }, [builderFeeRate]);

  const refreshBuilderStatus = useCallback(async () => {
    if (!walletAddress) return;
    try {
      const response = await fetch(`/api/sodex/builders?address=${encodeURIComponent(walletAddress)}`, {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to verify builder approval status.');
      setBuilderStatus(body as BuilderStatus);
      setSodexNetwork(body.network);
      setBuilderStatusAddress(walletAddress);
      setBuilderStatusError(null);
      const currentSpotApproval = body.approvals?.spot?.find(
        (approval: { builderID: string }) => approval.builderID === body.builderID
      );
      if (currentSpotApproval?.feeRate > 0 && currentSpotApproval.feeRate !== builderFeeRateRef.current) {
        invalidatePreparedReview();
        setBuilderFeeRate(currentSpotApproval.feeRate);
      }
    } catch (error) {
      setBuilderStatus(null);
      setBuilderStatusError(error instanceof Error ? error.message : 'Unable to verify builder approval status.');
    }
  }, [invalidatePreparedReview, walletAddress]);

  useEffect(() => {
    if (!walletAddress) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh approval state for the connected wallet
    void refreshBuilderStatus();
  }, [walletAddress, refreshBuilderStatus]);

  useEffect(() => {
    let active = true;
    void fetchSodexNetwork()
      .then((network) => {
        if (!active) return;
        setSodexNetwork(network);
        setNetworkError(null);
      })
      .catch((error: unknown) => {
        if (active) {
          setNetworkError(error instanceof Error ? error.message : 'Unable to load the configured SoDEX network.');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!walletAddress) return;

    let active = true;
    void fetch('/api/execution-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: tradeInput.symbol, action: tradeInput.action, amount: tradeInput.amount }),
    })
      .then(async (response) => {
        const preview = await response.json();
        if (active && response.ok) setExecutionPreview(preview as ExecutionPreviewData);
      })
      .catch((error: unknown) => {
        console.error('Unable to load SoDEX execution preview:', error);
      });

    return () => {
      active = false;
    };
  }, [walletAddress, tradeInput.symbol, tradeInput.action, tradeInput.amount]);

  const connectWallet = async () => {
    if (!window.ethereum) {
      toast.error('No injected wallet found. Install MetaMask or another EIP-1193 wallet to place a SoDEX order.');
      return;
    }
    setStage('connecting');
    try {
      const network = await fetchSodexNetwork();
      setSodexNetwork(network);
      setNetworkError(null);
      await requestWalletConnection();
      await ensureSodexChain(network);

      setStage('connected');
    } catch (error) {
      setStage('idle');
      toast.error(error instanceof Error ? error.message : 'Wallet connection failed');
    }
  };

  const prepareOrder = async () => {
    if (!walletAddress) return;
    const reviewSignatureAtPrepare = reviewSignature;
    setStage('preparing');
    setErrorMessage(null);
    setErrorType(null);
    try {
      const res = await fetch('/api/sodex/place-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'prepare',
          symbol: tradeInput.symbol,
          side: tradeInput.action,
          amountUsd: tradeInput.amount,
          walletAddress,
          maxSlippagePct: maxSlippagePct / 100,
          decision,
          exitQuantity,
          includeBuilderFee,
          builderFee: builderFeeRate,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorType(json.errorType ?? null);
        throw new Error(json.error || 'Failed to prepare order');
      }
      setPrepared(json);
      setSodexNetwork(json.preview.network);
      setPreparedForAddress(walletAddress);
      setPreparedReviewSignature(reviewSignatureAtPrepare);
      setStage('ready');
    } catch (error) {
      setStage('connected');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to prepare order');
    }
  };

  const manageBuilderApproval = async (maxFeeRate: number) => {
    if (!walletAddress || !window.ethereum) return;
    setBuilderActionBusy(true);
    setBuilderStatusError(null);
    try {
      const network = await fetchSodexNetwork();
      setSodexNetwork(network);
      await ensureSodexChain(network);
      const prepareResponse = await fetch('/api/sodex/builders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prepare', address: walletAddress, maxFeeRate }),
      });
      const preparedAction = await prepareResponse.json();
      if (!prepareResponse.ok) throw new Error(preparedAction.error || 'Unable to prepare builder action.');
      if (preparedAction.network !== network) {
        throw new Error('Configured SoDEX network changed. Refresh the page before signing.');
      }

      const signature = await window.ethereum.request({
        method: 'eth_signTypedData_v4',
        params: [walletAddress, JSON.stringify(preparedAction.typedData)],
      });
      const submitResponse = await fetch('/api/sodex/builders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit',
          address: walletAddress,
          maxFeeRate,
          nonce: preparedAction.nonce,
          signature,
          network: preparedAction.network,
        }),
      });
      const result = await submitResponse.json();
      await refreshBuilderStatus();
      if (!submitResponse.ok || !result.success) {
        throw new Error(result.error || 'SoDEX could not confirm the builder action.');
      }

      setBuilderOptInAddress(null);
      toast.success(maxFeeRate === 0 ? 'Builder approval revoked on SoDEX.' : 'Builder fee approval verified on SoDEX.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Builder approval action failed.';
      setBuilderStatusError(message);
      toast.error(message, 8000);
    } finally {
      setBuilderActionBusy(false);
    }
  };

  const signAndSubmit = async () => {
    if (!prepared || !walletAddress || !window.ethereum) return;
    if (
      preparedForAddress?.toLowerCase() !== walletAddress.toLowerCase() ||
      !preparedReviewIsCurrent
    ) {
      setErrorMessage('Order settings changed. Review the order again before signing.');
      invalidatePreparedReview();
      setStage('connected');
      return;
    }
    setStage('signing');
    setErrorMessage(null);
    setErrorType(null);
    try {
      // Defensive re-check — the user may have switched networks in their wallet
      // since connecting, and a stale chain would make the signature invalid.
      await ensureSodexChain(prepared.preview.network);

      const signature = (await window.ethereum.request({
        method: 'eth_signTypedData_v4',
        params: [walletAddress, JSON.stringify(prepared.typedData)],
      })) as string;

      setStage('submitting');
      const res = await fetch('/api/sodex/place-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit',
          orderParams: prepared.orderParams,
          nonce: prepared.nonce,
          signature,
          walletAddress,
          network: prepared.preview.network,
        }),
      });
      const json = await res.json();
      setResult({
        ...json,
        submittedQuantity: prepared.preview.quantity,
        protectionPrice: prepared.preview.protectionPrice,
      });
      setStage(json.success ? 'done' : 'error');
      if (!json.success) setErrorMessage(json.error || 'Order rejected by SoDEX');
    } catch (error) {
      setStage('ready');
      setErrorMessage(error instanceof Error ? error.message : 'Signing was cancelled or failed');
    }
  };

  if (!canExecute) {
    return (
      <Card className="terminal-card border-border">
        <CardContent className="pt-6 text-sm text-text-secondary">
          Execution is not available for {decision.replace('_', ' / ')} trades. {decision === 'BLOCK' ? 'This trade cannot proceed to execution.' : 'Reduce the position size and re-run analysis to unlock execution.'}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="terminal-card border-primary/20">
      <CardHeader>
        <CardTitle className="text-card-heading flex items-center justify-between">
          <span>SoDEX {sodexNetwork === 'testnet' ? 'Testnet' : 'Mainnet'} Execution</span>
          <Badge variant="outline" className="text-xs border-primary/40 text-primary">
            {sodexNetwork === 'testnet' ? 'Testnet — no real funds' : 'Mainnet — real funds'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {networkError && <p role="alert" className="text-sm text-danger">{networkError}</p>}
        {!walletAddress && stage !== 'connecting' && stage !== 'done' && stage !== 'error' && (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              Connect a wallet to place a signed order on SoDEX {sodexNetwork}. No wallet is required to analyze risk — only to execute.
            </p>
            <Button onClick={connectWallet} className="btn-primary w-full">Connect Wallet</Button>
          </div>
        )}

        {stage === 'connecting' && (
          <p className="text-sm text-text-secondary">
            Requesting wallet connection… Your wallet may ask to add or switch to the configured SoDEX {sodexNetwork} network — this is required to sign orders correctly.
          </p>
        )}

        {walletAddress && (
          <section className="space-y-3 rounded-lg border border-border p-3">
            <div>
              <h3 className="text-sm font-medium text-text-primary">Optional Builder Code</h3>
              <p className="mt-1 text-xs text-text-secondary">
                TradeFirewall uses its configured SoDEX Builder ID. Builder fees are only eligible on SoDEX Spot sells, and your wallet must approve a maximum fee before an eligible order can include it.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => void refreshBuilderStatus()}
              disabled={builderActionBusy}
              className="btn-secondary px-3 py-1.5 text-xs"
            >
              Refresh approval status
            </Button>
            {builderStatusError ? (
              <p className="text-xs text-danger" role="alert">{builderStatusError}</p>
            ) : visibleBuilderStatus?.builderID ? (
              <>
                <p className="text-xs text-text-secondary">
                  Builder account <span className="font-mono text-text-primary">{visibleBuilderStatus.builderID}</span>
                  {' · '}Spot approval {approvedSpotFeeRate > 0
                    ? `${(approvedSpotFeeRate / 1000).toFixed(3)}%`
                    : 'not active'}
                </p>
                {approvedSpotFeeRate > 0 && tradeInput.action === 'sell' && (
                  <label className="flex items-start gap-2 text-sm text-text-primary">
                    <input
                      type="checkbox"
                      checked={includeBuilderFee}
                      disabled={stage === 'preparing' || stage === 'signing' || stage === 'submitting'}
                      onChange={(event) => {
                        invalidatePreparedReview();
                        setBuilderOptInAddress(event.target.checked ? walletAddress : null);
                      }}
                      className="mt-1 accent-primary"
                    />
                    <span>
                      Include builder fee on this sell
                      <span className="block text-xs text-text-secondary">
                        The order requests {builderFeeRate} fee units ({(builderFeeRate / 1000).toFixed(3)}%), capped by your {approvedSpotFeeRate}-unit approval.
                      </span>
                    </span>
                  </label>
                )}
                {approvedSpotFeeRate > 0 && tradeInput.action === 'buy' && (
                  <p className="text-xs text-text-secondary">This Spot buy is not eligible for a builder fee.</p>
                )}
                <div className="space-y-2 border-t border-border pt-3">
                  <label htmlFor="builder-fee-rate" className="block text-xs text-text-secondary">
                    Maximum fee approval (tenths of a basis point; 50 = 0.05%)
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      id="builder-fee-rate"
                      type="number"
                      min={1}
                      max={2000}
                      step={1}
                      value={builderFeeRate}
                      disabled={stage === 'preparing' || stage === 'signing' || stage === 'submitting'}
                      onChange={(event) => {
                        invalidatePreparedReview();
                        setBuilderFeeRate(Number(event.target.value));
                      }}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-text-primary sm:w-40"
                      aria-describedby="builder-fee-rate-help"
                    />
                    <Button
                      type="button"
                      disabled={builderActionBusy || !Number.isSafeInteger(builderFeeRate) || builderFeeRate < 1 || builderFeeRate > 2000}
                      onClick={() => void manageBuilderApproval(builderFeeRate)}
                      className="btn-secondary"
                    >
                      {builderActionBusy ? 'Waiting for wallet…' : approvedSpotFeeRate > 0 ? 'Update approval' : 'Approve builder fee'}
                    </Button>
                    {approvedSpotFeeRate > 0 && (
                      <Button
                        type="button"
                        disabled={builderActionBusy}
                        onClick={() => void manageBuilderApproval(0)}
                        className="btn-secondary"
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                  <p id="builder-fee-rate-help" className="text-xs text-text-secondary">
                    Spot cap: 2000 units (2%). SoDEX checks builder eligibility when granting approval. Approval applies at the account level and is independently revocable.
                  </p>
                </div>
              </>
            ) : (
              <p className="text-xs text-text-secondary">
                {visibleBuilderStatus ? 'No Builder ID is available for this SoDEX account.' : 'Checking builder approval status…'}
              </p>
            )}
          </section>
        )}

        {(stage === 'connected' || stage === 'preparing' || stage === 'idle') && walletAddress && (
          <div className="space-y-4">
            <div className="text-xs text-text-secondary font-mono">Connected: {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}</div>

            {executionPreview && (
              <div className="p-3 bg-surface rounded-lg text-xs text-text-secondary space-y-1">
                <div className="text-text-primary font-medium mb-1">Execution Preview (SoDEX {sodexNetwork}, live)</div>
                <div>Estimated price: ${executionPreview.estimatedPrice.toLocaleString()}</div>
                <div>Estimated slippage: {(executionPreview.estimatedSlippage * 100).toFixed(2)}%</div>
                <div>Price impact: {(executionPreview.priceImpact * 100).toFixed(2)}%</div>
                <div>Execution probability: {Math.round(executionPreview.executionProbability * 100)}%</div>
                {executionPreview.warnings.length > 0 && (
                  <div className="text-warning">{executionPreview.warnings.join(' · ')}</div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="max-slippage" className="text-xs text-text-secondary">Max slippage protection: {maxSlippagePct.toFixed(1)}%</label>
              <input
                id="max-slippage"
                type="range"
                min={0.1}
                max={5}
                step={0.1}
                value={maxSlippagePct}
                onChange={(e) => {
                  invalidatePreparedReview();
                  setMaxSlippagePct(parseFloat(e.target.value));
                }}
                className="w-full accent-primary"
              />
            </div>

            {errorMessage && (
              <div className="text-xs text-danger space-y-1">
                <p>{errorMessage}</p>
                {errorType === 'NOT_ONBOARDED' && (
                  sodexNetwork === 'testnet' ? (
                    <a
                      href="https://testnet.sodex.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline-offset-2 hover:underline inline-block"
                    >
                      Open SoDEX Testnet to connect this wallet and claim faucet funds →
                    </a>
                  ) : (
                    <p>Connect this wallet to SoDEX Mainnet and fund its trading account before retrying.</p>
                  )
                )}
              </div>
            )}

            <Button onClick={prepareOrder} disabled={stage === 'preparing'} className="btn-primary w-full">
              {stage === 'preparing' ? 'Preparing order…' : 'Review Order'}
            </Button>
          </div>
        )}

        {(stage === 'ready' || stage === 'signing' || stage === 'submitting') && prepared && walletAddress && (
          <div className="space-y-4">
            {!preparedReviewIsCurrent && (
              <div className="space-y-2 text-sm text-warning">
                <p>Order settings changed. Review the updated order before signing.</p>
                <Button
                  type="button"
                  className="btn-secondary w-full"
                  onClick={() => {
                    invalidatePreparedReview();
                    setStage('connected');
                  }}
                >
                  Review order again
                </Button>
              </div>
            )}
            {preparedForAddress?.toLowerCase() !== walletAddress.toLowerCase() && (
              <div className="space-y-2 text-sm text-warning">
                <p>The connected wallet changed. Review this order again for the selected account.</p>
                <Button
                  type="button"
                  className="btn-secondary w-full"
                  onClick={() => {
                    setPrepared(null);
                    setPreparedForAddress(null);
                    setStage('connected');
                  }}
                >
                  Review order again
                </Button>
              </div>
            )}
            <div className="p-4 bg-surface rounded-lg space-y-2 text-sm">
              <div className="text-text-primary font-medium mb-1">Order Ticket — review before signing</div>
              <Row label="Symbol" value={prepared.preview.symbol} />
              <Row label="Side" value={prepared.preview.side} />
              <Row label="Order Type / TIF" value={`${prepared.preview.orderType} / ${prepared.preview.timeInForce}`} />
              <Row label="Quantity" value={prepared.preview.quantity} />
              {exitQuantity !== undefined && (
                <Row label="Exit" value="Sell from available SoDEX balance" />
              )}
              <Row label="Protection Price" value={`$${prepared.preview.protectionPrice}`} />
              <Row label="Max Slippage" value={`${(prepared.preview.slippagePct * 100).toFixed(1)}%`} />
              <Row label="Estimated Notional" value={`$${prepared.preview.estimatedNotionalUsd.toLocaleString()}`} />
              <Row label="Network" value={`SoDEX ${prepared.preview.network}`} />
              <Row label="Risk Score / Decision" value={`${riskScore}/100 — ${decision}`} />
              <Row
                label="Builder fee"
                value={prepared.preview.builder.enabled
                  ? `Enabled — ${prepared.preview.builder.requestedFeeRate} units (${(prepared.preview.builder.requestedFeeRate / 1000).toFixed(3)}%), estimated ${prepared.preview.builder.estimatedFee.toFixed(4)} ${prepared.preview.builder.feeAsset}`
                  : prepared.preview.builder.note}
              />
              {prepared.preview.builder.enabled && (
                <p className="text-xs text-text-secondary">
                  Approval max {prepared.preview.builder.approvedFeeRate} units. {prepared.preview.builder.note}
                </p>
              )}
            </div>

            {errorMessage && <p className="text-xs text-danger">{errorMessage}</p>}

            <Button
              onClick={signAndSubmit}
              disabled={
                stage !== 'ready' ||
                preparedForAddress?.toLowerCase() !== walletAddress.toLowerCase() ||
                !preparedReviewIsCurrent
              }
              className="btn-primary w-full"
            >
              {stage === 'signing'
                ? 'Waiting for wallet signature…'
                : stage === 'submitting'
                  ? `Submitting to SoDEX ${prepared.preview.network}…`
                  : 'Sign & Place Order'}
            </Button>
          </div>
        )}

        {(stage === 'done' || stage === 'error') && result && (
          <div className={`p-4 rounded-lg space-y-2 text-sm ${result.success ? 'bg-success/5 border border-success/30' : 'bg-danger/5 border border-danger/30'}`}>
            <div className={`font-medium ${result.success ? 'text-success' : 'text-danger'}`}>
              {result.success ? `Order placed on SoDEX ${result.network}` : 'Order failed'}
            </div>
            <Row label="Order ID" value={result.orderID ? String(result.orderID) : '—'} />
            <Row label="Client Order ID" value={result.clOrdID} />
            <Row label="Submitted size" value={result.submittedQuantity ?? '—'} />
            <Row label="Protection price" value={result.protectionPrice ? `$${result.protectionPrice}` : '—'} />
            <Row label="Risk score at execution" value={`${riskScore}/100 — ${decision}`} />
            <Row label="Timestamp" value={new Date(result.timestamp).toLocaleString()} />
            <Row label="Network" value={`SoDEX ${result.network}`} />
            {!result.success && result.error && <p className="text-xs text-danger">{result.error}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-secondary">{label}</span>
      <span className="text-text-primary font-mono text-xs">{value}</span>
    </div>
  );
}
