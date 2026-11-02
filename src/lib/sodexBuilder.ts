import { recoverTypedDataAddress } from 'viem';
import { getConfiguredSodexNetwork, getSodexChainId, type SodexNetwork } from '@/lib/sodexNetwork';
export { getConfiguredSodexNetwork } from '@/lib/sodexNetwork';

export const SODEX_SPOT_BUILDER_FEE_LIMIT = 2000;
const UINT64_MAX = BigInt(2) ** BigInt(64) - BigInt(1);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const API_ROOTS: Record<SodexNetwork, string> = {
  testnet: 'https://testnet-gw.sodex.dev/api/v1',
  mainnet: 'https://mainnet-gw.sodex.dev/api/v1',
};
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

export function verifyBuilderApprovalState(
  approvals: BuilderApprovals,
  builderID: string,
  maxFeeRate: number
): boolean {
  const spotApproval = approvals.spot.find((item) => item.builderID === builderID);
  const perpsApproval = approvals.perps.find((item) => item.builderID === builderID);
  return maxFeeRate === 0
    ? spotApproval === undefined && perpsApproval === undefined
    : spotApproval?.feeRate === maxFeeRate && perpsApproval?.feeRate === maxFeeRate;
}

export interface BuilderStats {
  summary: BuilderFeeStats | null;
  dailyChart: BuilderFeeDailyStats[];
}

export interface BuilderFeeStats {
  address?: string;
  name: string;
  builderCode: string;
  userCount: string;
  builderFee: string;
  tradeCount: string;
  tradeVolume: string;
}

export interface BuilderFeeDailyStats {
  date: string;
  userCount: string;
  builderFee: string;
  tradeCount: string;
  tradeVolume: string;
}

export class SodexBuilderStatsUnavailableError extends Error {
  constructor(network: SodexNetwork = 'testnet') {
    const networkName = network === 'testnet' ? 'Testnet' : 'Mainnet';
    super(`SoDEX currently returns 404 for its ${networkName} Builder statistics endpoints. The documented statistics API is not available on ${networkName} yet.`);
    this.name = 'SodexBuilderStatsUnavailableError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBuilderFeeStats(value: unknown): value is BuilderFeeStats {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === 'string' &&
    typeof value.builderCode === 'string' &&
    typeof value.userCount === 'string' &&
    typeof value.builderFee === 'string' &&
    typeof value.tradeCount === 'string' &&
    typeof value.tradeVolume === 'string' &&
    (value.address === undefined || typeof value.address === 'string')
  );
}

function isBuilderFeeDailyStats(value: unknown): value is BuilderFeeDailyStats {
  return (
    isRecord(value) &&
    typeof value.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
    typeof value.userCount === 'string' &&
    typeof value.builderFee === 'string' &&
    typeof value.tradeCount === 'string' &&
    typeof value.tradeVolume === 'string'
  );
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

export function getConfiguredBuilderID(
  network: SodexNetwork = getConfiguredSodexNetwork()
): string | null {
  const configuredID = process.env[
    network === 'testnet' ? 'SODEX_BUILDER_ID' : 'SODEX_MAINNET_BUILDER_ID'
  ]?.trim();
  if (!configuredID) return null;
  return normalizeBuilderID(configuredID);
}

export function getConfiguredBuilderAddress(
  network: SodexNetwork = getConfiguredSodexNetwork()
): string | null {
  const address = process.env[
    network === 'testnet' ? 'SODEX_BUILDER_ADDRESS' : 'SODEX_MAINNET_BUILDER_ADDRESS'
  ]?.trim();
  if (!address) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error(
      `${network === 'testnet' ? 'SODEX_BUILDER_ADDRESS' : 'SODEX_MAINNET_BUILDER_ADDRESS'} must be a valid EVM wallet address.`
    );
  }
  return address;
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
  network?: SodexNetwork;
}): BuilderApprovalTypedData {
  if (!Number.isSafeInteger(input.accountID) || input.accountID <= 0) {
    throw new Error('SoDEX account ID must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(input.nonce) || input.nonce <= 0) {
    throw new Error('SoDEX nonce must be a positive safe integer.');
  }

  const builderID = normalizeBuilderID(input.builderID);
  const maxFeeRate = validateBuilderFeeRate(input.maxFeeRate);
  const network = input.network ?? 'testnet';
  return {
    domain: {
      name: 'universal',
      version: '1',
      chainId: getSodexChainId(network),
      verifyingContract: ZERO_ADDRESS,
    },
    types: BUILDER_APPROVAL_TYPES,
    primaryType: 'ApproveBuilderFeeAction',
    message: {
      chainID: getSodexChainId(network),
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

export function getSodexApiRoot(network: SodexNetwork = getConfiguredSodexNetwork()): string {
  const configured = process.env[
    network === 'testnet' ? 'SODEX_TESTNET_SPOT_URL' : 'SODEX_MAINNET_SPOT_URL'
  ] || `${API_ROOTS[network]}/spot`;
  const url = new URL(configured);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== new URL(API_ROOTS[network]).hostname ||
    !url.pathname.endsWith('/api/v1/spot')
  ) {
    throw new Error(
      `${network === 'testnet' ? 'SODEX_TESTNET_SPOT_URL' : 'SODEX_MAINNET_SPOT_URL'} must be an HTTPS SoDEX ${network} Spot API URL ending in /api/v1/spot.`
    );
  }
  return `${url.origin}${url.pathname.slice(0, -'/spot'.length)}`;
}

export function getSodexTestnetApiRoot(): string {
  return getSodexApiRoot('testnet');
}

export function getSodexSpotApiUrl(network: SodexNetwork = getConfiguredSodexNetwork()): string {
  return `${getSodexApiRoot(network)}/spot`;
}

export async function fetchBuilderApprovals(
  userAddress: string,
  network: SodexNetwork = getConfiguredSodexNetwork()
): Promise<BuilderApprovals> {
  const root = getSodexApiRoot(network);
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

export async function fetchBuilderStats(
  userAddress: string,
  builderID: string,
  limit = 90,
  network: SodexNetwork = getConfiguredSodexNetwork()
): Promise<BuilderStats> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 300) {
    throw new Error('Builder daily chart limit must be an integer from 1 to 300.');
  }
  const root = getSodexApiRoot(network);
  const path = `/user/${encodeURIComponent(userAddress)}/builder`;
  const query = `accountID=${encodeURIComponent(normalizeBuilderID(builderID))}`;
  const request = async (endpoint: string): Promise<unknown> => {
    const response = await fetch(`${root}${endpoint}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404) throw new SodexBuilderStatsUnavailableError(network);
    if (!response.ok) throw new Error(`SoDEX Builder statistics unavailable (HTTP ${response.status}).`);
    const body = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new Error('SoDEX returned malformed JSON for Builder statistics.');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('SoDEX returned an invalid Builder statistics response.');
    }
    const envelope = payload as { code?: number; error?: string; message?: string; data?: unknown };
    if (envelope.code !== 0) {
      throw new Error(envelope.error || envelope.message || 'SoDEX did not return Builder statistics.');
    }
    return envelope.data;
  };
  const [summaryData, dailyData] = await Promise.all([
    request(`${path}/summary?${query}`),
    request(`${path}/daily-chart?${query}&limit=${limit}`),
  ]);
  let summary: BuilderFeeStats | null = null;
  if (summaryData !== null) {
    if (!isBuilderFeeStats(summaryData)) {
      throw new Error('SoDEX returned an invalid Builder fee summary.');
    }
    summary = summaryData;
  }
  if (!Array.isArray(dailyData) || !dailyData.every(isBuilderFeeDailyStats)) {
    throw new Error('SoDEX returned an invalid Builder daily chart.');
  }
  return {
    summary,
    dailyChart: dailyData,
  };
}
