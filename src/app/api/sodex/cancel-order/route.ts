import { NextRequest, NextResponse } from 'next/server';
import { sodexAPI, SodexSpotAccountOrder } from '@/lib/sodex';
import { listTradableSodexSpotMarkets, SodexSpotMarketOption } from '@/lib/sodexMarkets';
import { getSodexSpotSymbolError } from '@/lib/sodexSymbols';
import {
  BatchCancelOrderParams,
  buildBatchCancelOrderParams,
  buildExchangeActionTypedData,
  computeActionPayloadHash,
  SODEX_TESTNET_CHAIN_ID,
  toSodexApiSign,
} from '@/lib/sodexOrderSigning';

const WALLET_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const SODEX_TESTNET_SPOT_URL = (
  process.env.SODEX_TESTNET_SPOT_URL || 'https://testnet-gw.sodex.dev/api/v1/spot'
).replace(/\/$/, '');

export async function POST(request: NextRequest) {
  if (sodexAPI.configuredNetwork !== 'testnet') {
    return NextResponse.json(
      { error: 'SoDEX order cancellation is currently available on Testnet only.' },
      { status: 403 }
    );
  }

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    if (!isRecord(body)) {
      return NextResponse.json({ error: 'Invalid cancellation request body.' }, { status: 400 });
    }
    if (body.action === 'prepare') return await prepareCancellation(body);
    if (body.action === 'submit') return await submitCancellation(body);
    return NextResponse.json({ error: 'Unknown action. Use "prepare" or "submit".' }, { status: 400 });
  } catch (error) {
    console.error('SoDEX order cancellation failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Order cancellation failed.' },
      { status: 500 }
    );
  }
}

async function prepareCancellation(body: {
  address?: unknown;
  symbol?: unknown;
  orderID?: unknown;
  clOrdID?: unknown;
}) {
  const { address, symbol, orderID, clOrdID } = body;
  if (
    typeof address !== 'string' ||
    typeof symbol !== 'string' ||
    typeof orderID !== 'number' ||
    typeof clOrdID !== 'string'
  ) {
    return NextResponse.json(
      { error: 'Valid wallet, symbol, order ID, and client order ID are required.' },
      { status: 400 }
    );
  }
  const inputError = getSodexSpotSymbolError(symbol);
  if (
    !WALLET_ADDRESS.test(address) ||
    inputError ||
    !Number.isSafeInteger(orderID) ||
    orderID <= 0 ||
    !/^[0-9a-zA-Z_-]{1,36}$/.test(clOrdID)
  ) {
    return NextResponse.json(
      { error: inputError || 'Valid wallet, symbol, order ID, and client order ID are required.' },
      { status: 400 }
    );
  }

  const [account, orders, rules, symbolRows] = await Promise.all([
    sodexAPI.getAccountState(address),
    sodexAPI.getSpotAccountOrders(address),
    sodexAPI.getSpotSymbolRules(symbol),
    sodexAPI.getSpotSymbols(),
  ]);
  const market = listTradableSodexSpotMarkets(symbolRows)
    .find((item) => item.symbol === symbol.toUpperCase());
  if (!market) {
    return NextResponse.json({ error: `No active SoDEX Spot market found for ${symbol}.` }, { status: 404 });
  }

  const order = orders.find(
    (item) => item.orderID === orderID && item.clOrdID === clOrdID && orderMatchesMarket(item, market)
  );
  if (!order) {
    return NextResponse.json(
      { error: 'That order is no longer open on this wallet and market. Refresh the account view.' },
      { status: 409 }
    );
  }

  const params = buildBatchCancelOrderParams({
    accountID: account.accountID,
    symbolID: rules.symbolID,
    clOrdID: order.clOrdID,
    orderID: order.orderID,
  });
  const nonce = Date.now();
  const payloadHash = computeActionPayloadHash('batchCancelOrder', params);
  return NextResponse.json({
    params,
    nonce,
    typedData: buildExchangeActionTypedData(payloadHash, nonce, SODEX_TESTNET_CHAIN_ID),
    order: { symbol, orderID: order.orderID, clOrdID: order.clOrdID },
    network: 'testnet',
  });
}

async function submitCancellation(body: {
  address?: unknown;
  params?: unknown;
  nonce?: unknown;
  signature?: unknown;
}) {
  const { address, params: rawParams, nonce, signature } = body;
  if (
    typeof address !== 'string' ||
    !WALLET_ADDRESS.test(address) ||
    typeof nonce !== 'number' ||
    typeof signature !== 'string' ||
    !isRecord(rawParams)
  ) {
    return NextResponse.json(
      { error: 'Wallet address, signed cancellation parameters, nonce, and signature are required.' },
      { status: 400 }
    );
  }
  const rawCancels = rawParams.cancels;
  const rawCancel = Array.isArray(rawCancels) ? rawCancels[0] : undefined;
  if (
    !Number.isSafeInteger(nonce) ||
    typeof rawParams.accountID !== 'number' ||
    !Number.isSafeInteger(rawParams.accountID) ||
    !isRecord(rawCancel) ||
    typeof rawCancel.symbolID !== 'number' ||
    !Number.isSafeInteger(rawCancel.symbolID) ||
    typeof rawCancel.orderID !== 'number' ||
    !Number.isSafeInteger(rawCancel.orderID) ||
    typeof rawCancel.clOrdID !== 'string'
  ) {
    return NextResponse.json({ error: 'Invalid cancellation payload.' }, { status: 400 });
  }
  let params: BatchCancelOrderParams;
  try {
    params = buildBatchCancelOrderParams({
      accountID: rawParams.accountID,
      symbolID: rawCancel.symbolID,
      clOrdID: rawCancel.clOrdID,
      orderID: rawCancel.orderID,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid order cancellation fields.' }, { status: 400 });
  }
  const cancel = params.cancels[0];

  const [account, orders, symbolRows] = await Promise.all([
    sodexAPI.getAccountState(address),
    sodexAPI.getSpotAccountOrders(address),
    sodexAPI.getSpotSymbols(),
  ]);
  if (account.accountID !== params.accountID) {
    return NextResponse.json({ error: 'Cancellation account does not match the connected wallet.' }, { status: 403 });
  }

  const market = listTradableSodexSpotMarkets(symbolRows).find((item) => {
    const order = orders.find(
      (candidate) =>
        candidate.orderID === cancel.orderID &&
        candidate.clOrdID === cancel.clOrdID &&
        orderMatchesMarket(candidate, item)
    );
    return !!order;
  });
  if (!market) {
    return NextResponse.json(
      { error: 'That order is no longer open on this wallet. Refresh the account view.' },
      { status: 409 }
    );
  }
  const rules = await sodexAPI.getSpotSymbolRules(market.symbol);
  if (rules.symbolID !== cancel.symbolID) {
    return NextResponse.json({ error: 'Cancellation market does not match the open order.' }, { status: 403 });
  }

  let apiSign: string;
  try {
    apiSign = toSodexApiSign(signature);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid wallet signature.' },
      { status: 400 }
    );
  }

  const response = await fetch(`${SODEX_TESTNET_SPOT_URL}/trade/orders/batch`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-API-Sign': apiSign,
      'X-API-Nonce': String(nonce),
      'X-API-Chain': String(SODEX_TESTNET_CHAIN_ID),
    },
    body: JSON.stringify(params),
  });
  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok || raw === null) {
    return NextResponse.json(
      { error: `SoDEX cancellation failed (HTTP ${response.status}).` },
      { status: 502 }
    );
  }

  const container = raw as { code?: number; message?: string; data?: unknown };
  const results = Array.isArray(raw) ? raw : Array.isArray(container.data) ? container.data : [raw];
  const result = results[0] as { code?: number; clOrdID?: string; orderID?: number; error?: string } | undefined;
  const success = container.code === 0 && result?.code === 0;
  return NextResponse.json(
    {
      success,
      orderID: result?.orderID ?? cancel.orderID,
      clOrdID: result?.clOrdID ?? cancel.clOrdID,
      error: success ? undefined : result?.error || container.message || 'SoDEX rejected the cancellation.',
      network: 'testnet',
      timestamp: Date.now(),
    },
    { status: success ? 200 : 502 }
  );
}

function orderMatchesMarket(order: SodexSpotAccountOrder, market: SodexSpotMarketOption): boolean {
  const orderSymbol = order.symbol.trim().toUpperCase();
  return [market.symbol, market.name, market.sodexSymbol]
    .some((value) => value.toUpperCase() === orderSymbol);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
