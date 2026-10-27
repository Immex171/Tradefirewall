import { recoverTypedDataAddress } from 'viem';
import { SODEX_TESTNET_CHAIN_ID } from '@/lib/sodexOrderSigning';

export const SODEX_SPOT_BUILDER_FEE_LIMIT = 2000;
const UINT64_MAX = BigInt(2) ** BigInt(64) - BigInt(1);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const TESTNET_API_ROOT = 'https://testnet-gw.sodex.dev/api/v1';
const BUILDER_APPROVAL_TYPES = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ],
  ApproveBuilderFeeAction: [
    { name: 'chainID', type: 'uint64' },
    { name: 'nonce', type: 'uint64' },
    { name: 'accountID', type: 'uint64' },
    { name: 'builderID', type: 'uint64' },
    { name: 'maxFeeRate', type: 'uint64' },
  ],
} as const;

export interface BuilderApproval {
  userID: number;
  builderID: string;
  feeRate: number;
}

export interface BuilderApprovals {
  spot: BuilderApproval[];
  perps: BuilderApproval[];
}

export interface BuilderApprovalTypedData {
  domain: {
    name: 'universal';
    version: '1';
    chainId: number;
    verifyingContract: typeof ZERO_ADDRESS;
  };
  types: typeof BUILDER_APPROVAL_TYPES;
  primaryType: 'ApproveBuilderFeeAction';
  message: {
    chainID: number;
    nonce: number;
    accountID: number;
    builderID: string;
    maxFeeRate: number;
  };
}

export function normalizeBuilderID(value: unknown): string {
  const id = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string'
      ? value
      : '';
  if (!/^[1-9]\d*$/.test(id) || BigInt(id) > UINT64_MAX) {
    throw new Error('Builder account ID must be a non-zero uint64 decimal integer.');
  }
  return id;
}

export function getConfiguredBuilderID(): string | null {
  const configuredID = process.env.SODEX_BUILDER_ID?.trim();
  if (!configuredID) return null;
  return normalizeBuilderID(configuredID);
}

export function validateBuilderFeeRate(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > SODEX_SPOT_BUILDER_FEE_LIMIT
  ) {
    throw new Error(`Spot builder fee must be an integer from 0 to ${SODEX_SPOT_BUILDER_FEE_LIMIT} in tenths of a basis point.`);
  }
  return value;
}

export function buildBuilderApprovalTypedData(input: {
  accountID: number;
  builderID: string;
  maxFeeRate: number;
  nonce: number;
}): BuilderApprovalTypedData {
  if (!Number.isSafeInteger(input.accountID) || input.accountID <= 0) {
    throw new Error('SoDEX account ID must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(input.nonce) || input.nonce <= 0) {
    throw new Error('SoDEX nonce must be a positive safe integer.');
  }

  const builderID = normalizeBuilderID(input.builderID);
  const maxFeeRate = validateBuilderFeeRate(input.maxFeeRate);
  return {
    domain: {
      name: 'universal',
      version: '1',
      chainId: SODEX_TESTNET_CHAIN_ID,
      verifyingContract: ZERO_ADDRESS,
    },
    types: BUILDER_APPROVAL_TYPES,
    primaryType: 'ApproveBuilderFeeAction',
    message: {
      chainID: SODEX_TESTNET_CHAIN_ID,
      nonce: input.nonce,
      accountID: input.accountID,
      builderID,
      maxFeeRate,
    },
  };
}

export function toSodexBuilderApiSign(walletSignatureHex: string): string {
  const hex = walletSignatureHex.startsWith('0x') ? walletSignatureHex.slice(2) : walletSignatureHex;
  if (!/^[0-9a-fA-F]{130}$/.test(hex)) {
    throw new Error('Expected a 65-byte wallet signature for the builder action.');
  }
  const rAndS = hex.slice(0, 128);
  let recovery = Number.parseInt(hex.slice(128), 16);
  if (recovery === 27 || recovery === 28) recovery -= 27;
  if (recovery !== 0 && recovery !== 1) {
    throw new Error(`Unexpected signature recovery byte: ${recovery}`);
  }
  return `0x02${rAndS}${recovery.toString(16).padStart(2, '0')}`;
}

export function recoverBuilderApprovalSigner(
  typedData: BuilderApprovalTypedData,
  signature: `0x${string}`
): Promise<`0x${string}`> {
  return recoverTypedDataAddress({
    domain: { ...typedData.domain, chainId: BigInt(typedData.domain.chainId) },
    types: { ApproveBuilderFeeAction: BUILDER_APPROVAL_TYPES.ApproveBuilderFeeAction },
    primaryType: typedData.primaryType,
    message: {
      chainID: BigInt(typedData.message.chainID),
      nonce: BigInt(typedData.message.nonce),
      accountID: BigInt(typedData.message.accountID),
      builderID: BigInt(typedData.message.builderID),
      maxFeeRate: BigInt(typedData.message.maxFeeRate),
    },
    signature,
  });
}

export function getSodexTestnetApiRoot(): string {
  const configured = process.env.SODEX_TESTNET_SPOT_URL || `${TESTNET_API_ROOT}/spot`;
  const url = new URL(configured);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'testnet-gw.sodex.dev' ||
    !url.pathname.endsWith('/api/v1/spot')
  ) {
    throw new Error('SODEX_TESTNET_SPOT_URL must be an HTTPS SoDEX testnet Spot API URL ending in /api/v1/spot.');
  }
  return `${url.origin}${url.pathname.slice(0, -'/spot'.length)}`;
}

export async function fetchBuilderApprovals(userAddress: string): Promise<BuilderApprovals> {
  const root = getSodexTestnetApiRoot();
  const response = await fetch(
    `${root}/user/${encodeURIComponent(userAddress)}/builders`,
    { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8000) }
  );
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(`SoDEX builder approvals unavailable (HTTP ${response.status}).`);

  if (!payload || typeof payload !== 'object') {
    throw new Error('SoDEX returned an invalid builder approval response.');
  }
  const envelope = payload as { code?: number; message?: string; data?: unknown };
  if (envelope.code !== 0) {
    throw new Error(envelope.message || 'SoDEX did not return builder approval status.');
  }
  if (!envelope.data || typeof envelope.data !== 'object') {
    throw new Error('SoDEX returned an invalid builder approval response.');
  }
  const data = envelope.data as { spot?: unknown; perps?: unknown };
  const parseRows = (rows: unknown): BuilderApproval[] => {
    if (rows === undefined || rows === null) return [];
    if (!Array.isArray(rows)) throw new Error('SoDEX returned an invalid builder approval list.');
    return rows.map((row: unknown) => {
      if (!row || typeof row !== 'object') throw new Error('SoDEX returned an invalid builder approval.');
      const approval = row as { userID?: unknown; builderID?: unknown; feeRate?: unknown };
      if (
        (typeof approval.feeRate !== 'number' && typeof approval.feeRate !== 'string') ||
        !/^\d+$/.test(String(approval.feeRate))
      ) {
        throw new Error('SoDEX returned an invalid builder fee rate.');
      }
      return {
        userID: Number(approval.userID),
        builderID: normalizeBuilderID(approval.builderID),
        feeRate: validateBuilderFeeRate(Number(approval.feeRate)),
      };
    });
  };

  return { spot: parseRows(data.spot), perps: parseRows(data.perps) };
}
