import { afterEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildBuilderApprovalTypedData,
  fetchBuilderApprovals,
  fetchBuilderStats,
  getConfiguredBuilderAddress,
  getConfiguredBuilderID,
  getSodexTestnetApiRoot,
  normalizeBuilderID,
  recoverBuilderApprovalSigner,
  toSodexBuilderApiSign,
  validateBuilderFeeRate,
} from './sodexBuilder';

const originalSpotUrl = process.env.SODEX_TESTNET_SPOT_URL;
const originalBuilderID = process.env.SODEX_BUILDER_ID;
const originalBuilderAddress = process.env.SODEX_BUILDER_ADDRESS;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalSpotUrl === undefined) delete process.env.SODEX_TESTNET_SPOT_URL;
  else process.env.SODEX_TESTNET_SPOT_URL = originalSpotUrl;
  if (originalBuilderID === undefined) delete process.env.SODEX_BUILDER_ID;
  else process.env.SODEX_BUILDER_ID = originalBuilderID;
  if (originalBuilderAddress === undefined) delete process.env.SODEX_BUILDER_ADDRESS;
  else process.env.SODEX_BUILDER_ADDRESS = originalBuilderAddress;
});

describe('builder fee validation', () => {
  it('accepts zero and integer tenths-of-a-basis-point Spot rates up to the cap', () => {
    expect(validateBuilderFeeRate(0)).toBe(0);
    expect(validateBuilderFeeRate(50)).toBe(50);
    expect(validateBuilderFeeRate(2000)).toBe(2000);
  });

  it('rejects fractional, negative, and above-cap rates', () => {
    for (const rate of [-1, 0.5, 2001, Number.NaN]) {
      expect(() => validateBuilderFeeRate(rate)).toThrow(/integer/);
    }
  });

  it('preserves uint64 builder IDs and rejects invalid values', () => {
    expect(normalizeBuilderID('18446744073709551615')).toBe('18446744073709551615');
    expect(() => normalizeBuilderID('18446744073709551616')).toThrow(/uint64/);
    expect(() => normalizeBuilderID('01')).toThrow(/uint64/);
    expect(() => normalizeBuilderID(2 ** 53)).toThrow(/uint64/);
  });

  it('loads the configured builder ID as a validated server-side account ID', () => {
    process.env.SODEX_BUILDER_ID = '60497';
    expect(getConfiguredBuilderID()).toBe('60497');

    process.env.SODEX_BUILDER_ID = 'invalid';
    expect(() => getConfiguredBuilderID()).toThrow(/uint64/);

    delete process.env.SODEX_BUILDER_ID;
    expect(getConfiguredBuilderID()).toBeNull();
  });

  it('validates the configured builder owner address', () => {
    process.env.SODEX_BUILDER_ADDRESS = '0x0000000000000000000000000000000000000001';
    expect(getConfiguredBuilderAddress()).toBe('0x0000000000000000000000000000000000000001');
    process.env.SODEX_BUILDER_ADDRESS = 'invalid';
    expect(() => getConfiguredBuilderAddress()).toThrow(/valid EVM wallet address/);
    delete process.env.SODEX_BUILDER_ADDRESS;
    expect(getConfiguredBuilderAddress()).toBeNull();
  });
});

describe('builder approval typed data', () => {
  const typedData = buildBuilderApprovalTypedData({
    accountID: 101,
    builderID: '202',
    maxFeeRate: 50,
    nonce: 1760373925003,
  });

  it('matches the universal domain, network IDs, primary type, and field order', () => {
    expect(typedData.domain).toEqual({
      name: 'universal',
      version: '1',
      chainId: 138565,
      verifyingContract: '0x0000000000000000000000000000000000000000',
    });
    expect(typedData.primaryType).toBe('ApproveBuilderFeeAction');
    expect(typedData.types.ApproveBuilderFeeAction).toEqual([
      { name: 'chainID', type: 'uint64' },
      { name: 'nonce', type: 'uint64' },
      { name: 'accountID', type: 'uint64' },
      { name: 'builderID', type: 'uint64' },
      { name: 'maxFeeRate', type: 'uint64' },
    ]);
    expect(typedData.message).toEqual({
      chainID: 138565,
      nonce: 1760373925003,
      accountID: 101,
      builderID: '202',
      maxFeeRate: 50,
    });
  });

  it('recovers the approving master wallet from a signed action', async () => {
    const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
    const signature = await account.signTypedData({
      domain: typedData.domain,
      types: { ApproveBuilderFeeAction: typedData.types.ApproveBuilderFeeAction },
      primaryType: typedData.primaryType,
      message: {
        chainID: BigInt(typedData.message.chainID),
        nonce: BigInt(typedData.message.nonce),
        accountID: BigInt(typedData.message.accountID),
        builderID: BigInt(typedData.message.builderID),
        maxFeeRate: BigInt(typedData.message.maxFeeRate),
      },
    });

    await expect(recoverBuilderApprovalSigner(typedData, signature)).resolves.toBe(account.address);
  });

  it('uses the universal-action signature prefix and normalizes v 27/28', () => {
    const signature = `0x${'ab'.repeat(64)}1c`;
    expect(toSodexBuilderApiSign(signature)).toBe(`0x02${'ab'.repeat(64)}01`);
    expect(() => toSodexBuilderApiSign('0x1234')).toThrow(/65-byte/);
  });
});

describe('builder API configuration and status parsing', () => {
  it('derives the universal API root from the configured Spot URL', () => {
    process.env.SODEX_TESTNET_SPOT_URL = 'https://testnet-gw.sodex.dev/api/v1/spot';
    expect(getSodexTestnetApiRoot()).toBe('https://testnet-gw.sodex.dev/api/v1');

    process.env.SODEX_TESTNET_SPOT_URL = 'http://example.test/api/v1/spot';
    expect(() => getSodexTestnetApiRoot()).toThrow(/HTTPS SoDEX testnet/);
  });

  it('parses approval arrays and preserves builder IDs as decimal strings', async () => {
    process.env.SODEX_TESTNET_SPOT_URL = 'https://testnet-gw.sodex.dev/api/v1/spot';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: {
        spot: [{ userID: 7, builderID: '18446744073709551615', feeRate: 50 }],
        perps: [],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const status = await fetchBuilderApprovals('0x0000000000000000000000000000000000000001');
    expect(status.spot[0]?.builderID).toBe('18446744073709551615');
    expect(status.spot[0]?.feeRate).toBe(50);
    expect(status.perps).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://testnet-gw.sodex.dev/api/v1/user/0x0000000000000000000000000000000000000001/builders',
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('fetches official builder summary and daily chart responses without deriving fees', async () => {
    process.env.SODEX_TESTNET_SPOT_URL = 'https://testnet-gw.sodex.dev/api/v1/spot';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          name: 'TradeFirewall',
          builderCode: '60497',
          userCount: '2',
          builderFee: '1.23',
          tradeCount: '4',
          tradeVolume: '123.45',
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: [{
          date: '2026-10-26',
          userCount: '1',
          builderFee: '0.23',
          tradeCount: '1',
          tradeVolume: '23.45',
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchBuilderStats(
      '0x0000000000000000000000000000000000000001',
      '60497'
    )).resolves.toEqual({
      summary: {
        name: 'TradeFirewall',
        builderCode: '60497',
        userCount: '2',
        builderFee: '1.23',
        tradeCount: '4',
        tradeVolume: '123.45',
      },
      dailyChart: [{
        date: '2026-10-26',
        userCount: '1',
        builderFee: '0.23',
        tradeCount: '1',
        tradeVolume: '23.45',
      }],
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://testnet-gw.sodex.dev/api/v1/user/0x0000000000000000000000000000000000000001/builder/summary?accountID=60497',
      expect.objectContaining({ cache: 'no-store' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://testnet-gw.sodex.dev/api/v1/user/0x0000000000000000000000000000000000000001/builder/daily-chart?accountID=60497&limit=90',
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('rejects Builder statistics that do not match the documented response schema', async () => {
    process.env.SODEX_TESTNET_SPOT_URL = 'https://testnet-gw.sodex.dev/api/v1/spot';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { builderFee: '1.23' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchBuilderStats(
      '0x0000000000000000000000000000000000000001',
      '60497'
    )).rejects.toThrow(/invalid Builder fee summary/);
  });

  it('reports an upstream HTTP error before attempting to parse a non-JSON body', async () => {
    process.env.SODEX_TESTNET_SPOT_URL = 'https://testnet-gw.sodex.dev/api/v1/spot';
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response('404 page not found', { status: 404, headers: { 'Content-Type': 'text/plain' } })
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchBuilderStats(
      '0x0000000000000000000000000000000000000001',
      '60497'
    )).rejects.toThrow(
      'SoDEX currently returns 404 for its Testnet Builder statistics endpoints. The documented statistics API is not available on Testnet yet.'
    );
  });

  it('reports malformed JSON clearly when the upstream returns a successful status', async () => {
    process.env.SODEX_TESTNET_SPOT_URL = 'https://testnet-gw.sodex.dev/api/v1/spot';
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response('nullnull', { status: 200, headers: { 'Content-Type': 'application/json' } })
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchBuilderStats(
      '0x0000000000000000000000000000000000000001',
      '60497'
    )).rejects.toThrow('SoDEX returned malformed JSON for Builder statistics.');
  });
});
