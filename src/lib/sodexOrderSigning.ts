// Server-only EIP-712 payload construction for SoDEX's authenticated spot order API.
// Ported directly from SoDEX's public Go SDK (github.com/sodex-tech/sodex-go-sdk-public):
//   common/types/action_payload.go  — payloadHash = keccak256(compact JSON({type, params}))
//   common/types/eip712.go          — EIP-712 domain + ExchangeAction(bytes32,uint64)
//   spot/types/batch_new_order_request.go — exact field order for batchNewOrder
//   references/authentication.md    — headers, nonce rules, v-byte normalization
//
// No signing happens here — this only builds what the browser wallet needs to sign
// (typed data) and, after the wallet signs, what SoDEX needs to verify it (headers).
// The private key never leaves the browser.

import { keccak256, stringToHex } from 'viem';

export const SODEX_TESTNET_CHAIN_ID = 138565;
export const SODEX_MAINNET_CHAIN_ID = 286623;

export const OrderSide = { BUY: 1, SELL: 2 } as const;
export const OrderType = { LIMIT: 1, MARKET: 2 } as const;
export const TimeInForce = { GTC: 1, FOK: 2, IOC: 3, GTX: 4 } as const;
export const SODEX_SPOT_MAX_BUILDER_FEE_RATE = 2000;
const UINT64_MAX = BigInt(2) ** BigInt(64) - BigInt(1);

export interface BuilderOrderParams {
  id: number | string;
  fee: number;
}

export interface BatchNewOrderItemParams {
  symbolID: number;
  clOrdID: string;
  side: number;
  type: number;
  timeInForce: number;
  price?: string;
  quantity?: string;
  funds?: string;
}

export interface BatchNewOrderParams {
  accountID: number;
  orders: BatchNewOrderItemParams[];
  builder?: BuilderOrderParams;
}

export interface BatchCancelOrderItemParams {
  symbolID: number;
  clOrdID: string;
  orderID?: number;
  origClOrdID?: string;
}

export interface BatchCancelOrderParams {
  accountID: number;
  cancels: BatchCancelOrderItemParams[];
}

/** Strips trailing zeros — SoDEX rejects "0.4060", requires "0.406". */
export function formatDecimalString(value: number, precision: number): string {
  const fixed = value.toFixed(Math.max(0, precision));
  if (!fixed.includes('.')) return fixed;
  return fixed.replace(/0+$/, '').replace(/\.$/, '');
}

/** Snaps a raw value down to the nearest step/tick multiple, then formats. */
export function snapToStep(value: number, step: number, precision: number): string {
  if (step <= 0) return formatDecimalString(value, precision);
  const snapped = Math.floor(value / step) * step;
  return formatDecimalString(snapped, precision);
}

/**
 * Builds the exact params object for a single-order batchNewOrder request, in the
 * Go struct's declared field order (symbolID, clOrdID, side, type, timeInForce,
 * price, quantity) — object key order matters because the server re-marshals to
 * verify the signature, and JSON.stringify preserves string-key insertion order.
 */
export function buildBatchNewOrderParams(input: {
  accountID: number;
  symbolID: number;
  clOrdID: string;
  side: number;
  type: number;
  timeInForce: number;
  price?: string;
  quantity?: string;
  builder?: BuilderOrderParams;
}): BatchNewOrderParams {
  if (input.builder !== undefined) {
    normalizeBuilderAccountID(input.builder.id);
    if (
      !Number.isSafeInteger(input.builder.fee) ||
      input.builder.fee < 0 ||
      input.builder.fee > SODEX_SPOT_MAX_BUILDER_FEE_RATE
    ) {
      throw new Error(
        `Spot builder fee must be an integer from 0 to ${SODEX_SPOT_MAX_BUILDER_FEE_RATE} in tenths of a basis point`
      );
    }
  }

  const item: BatchNewOrderItemParams = {
    symbolID: input.symbolID,
    clOrdID: input.clOrdID,
    side: input.side,
    type: input.type,
    timeInForce: input.timeInForce,
  };
  if (input.price !== undefined) item.price = input.price;
  if (input.quantity !== undefined) item.quantity = input.quantity;
  const params: BatchNewOrderParams = { accountID: input.accountID, orders: [item] };
  if (input.builder !== undefined) {
    params.builder = { id: input.builder.id, fee: input.builder.fee };
  }
  return params;
}

const BATCH_NEW_ORDER_ACTION_NAME = 'batchNewOrder';

function normalizeBuilderAccountID(id: number | string): string {
  if (typeof id === 'number') {
    if (!Number.isSafeInteger(id) || id < 0) {
      throw new Error('Builder account ID must be a non-negative safe integer or uint64 decimal string');
    }
    return String(id);
  }
  if (!/^(0|[1-9]\d*)$/.test(id) || BigInt(id) > UINT64_MAX) {
    throw new Error('Builder account ID must be an unsigned uint64 decimal integer');
  }
  return id;
}

/** Serializes the exact params object used in the signed payload and HTTP body. */
export function serializeBatchNewOrderParams(params: BatchNewOrderParams): string {
  if (params.builder === undefined) return JSON.stringify(params);

  const builderID = normalizeBuilderAccountID(params.builder.id);
  if (
    !Number.isSafeInteger(params.builder.fee) ||
    params.builder.fee < 0 ||
    params.builder.fee > SODEX_SPOT_MAX_BUILDER_FEE_RATE
  ) {
    throw new Error(
      `Spot builder fee must be an integer from 0 to ${SODEX_SPOT_MAX_BUILDER_FEE_RATE} in tenths of a basis point`
    );
  }

  const serializedOrders = JSON.stringify({ accountID: params.accountID, orders: params.orders });
  return `${serializedOrders.slice(0, -1)},"builder":{"id":${builderID},"fee":${params.builder.fee}}}`;
}

export function buildBatchCancelOrderParams(input: {
  accountID: number;
  symbolID: number;
  clOrdID: string;
  orderID: number;
}): BatchCancelOrderParams {
  if (!Number.isSafeInteger(input.accountID) || input.accountID <= 0) {
    throw new Error('SoDEX account ID must be a positive safe integer');
  }
  if (!Number.isSafeInteger(input.symbolID) || input.symbolID <= 0) {
    throw new Error('SoDEX symbol ID must be a positive safe integer');
  }
  if (!Number.isSafeInteger(input.orderID) || input.orderID <= 0) {
    throw new Error('SoDEX order ID must be a positive safe integer');
  }
  if (!/^[0-9a-zA-Z_-]{1,36}$/.test(input.clOrdID)) {
    throw new Error('SoDEX client order ID must contain 1-36 letters, digits, underscores, or hyphens');
  }
  return {
    accountID: input.accountID,
    cancels: [{
      symbolID: input.symbolID,
      clOrdID: input.clOrdID,
      orderID: input.orderID,
    }],
  };
}

export function serializeBatchCancelOrderParams(params: BatchCancelOrderParams): string {
  return JSON.stringify(params);
}

export function computeActionPayloadHash(actionType: string, params: unknown): `0x${string}` {
  if (!actionType) throw new Error('SoDEX action type is required');
  const compactJson = JSON.stringify({ type: actionType, params });
  return keccak256(stringToHex(compactJson));
}

/** payloadHash = keccak256(compact_json({type, params})) — must be byte-identical to Go's json.Marshal. */
export function computePayloadHash(params: BatchNewOrderParams): `0x${string}` {
  const compactJson = `{"type":"${BATCH_NEW_ORDER_ACTION_NAME}","params":${serializeBatchNewOrderParams(params)}}`;
  return keccak256(stringToHex(compactJson));
}

export function generateClOrdID(): string {
  return `tf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Nonce = current ms timestamp; SoDEX requires it strictly increasing and within (now-2d, now+1d). */
export function generateNonce(): number {
  return Date.now();
}

export interface ExchangeActionTypedData {
  domain: {
    name: 'spot';
    version: '1';
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: {
    EIP712Domain: Array<{ name: string; type: string }>;
    ExchangeAction: Array<{ name: string; type: string }>;
  };
  primaryType: 'ExchangeAction';
  message: { payloadHash: `0x${string}`; nonce: number };
}

const ZERO_ADDRESS: `0x${string}` = '0x0000000000000000000000000000000000000000';

/** Builds the EIP-712 typed-data object for the browser wallet's eth_signTypedData_v4. */
export function buildExchangeActionTypedData(payloadHash: `0x${string}`, nonce: number, chainId: number): ExchangeActionTypedData {
  return {
    domain: { name: 'spot', version: '1', chainId, verifyingContract: ZERO_ADDRESS },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      ExchangeAction: [
        { name: 'payloadHash', type: 'bytes32' },
        { name: 'nonce', type: 'uint64' },
      ],
    },
    primaryType: 'ExchangeAction',
    message: { payloadHash, nonce },
  };
}

/**
 * Converts a wallet-produced 65-byte ECDSA signature (r ‖ s ‖ v, v=27/28) into
 * SoDEX's 66-byte wire format (0x01 ‖ r ‖ s ‖ v', v'=0/1).
 */
export function toSodexApiSign(walletSignatureHex: string): string {
  const hex = walletSignatureHex.startsWith('0x') ? walletSignatureHex.slice(2) : walletSignatureHex;
  if (hex.length !== 130) {
    throw new Error(`Expected a 65-byte (130 hex char) wallet signature, got ${hex.length} hex chars`);
  }
  const rs = hex.slice(0, 128);
  let v = parseInt(hex.slice(128, 130), 16);
  if (v === 27 || v === 28) v -= 27;
  if (v !== 0 && v !== 1) {
    throw new Error(`Unexpected signature recovery byte: ${v}`);
  }
  const vHex = v.toString(16).padStart(2, '0');
  return `0x01${rs}${vHex}`;
}
