import { afterEach, describe, expect, it } from 'vitest';
import { getConfiguredSodexNetwork, parseSodexNetwork } from './sodexNetwork';

const originalUseTestnet = process.env.SODEX_USE_TESTNET;

afterEach(() => {
  if (originalUseTestnet === undefined) delete process.env.SODEX_USE_TESTNET;
  else process.env.SODEX_USE_TESTNET = originalUseTestnet;
});

describe('SoDEX network selection', () => {
  it('accepts only known network names', () => {
    expect(parseSodexNetwork('testnet')).toBe('testnet');
    expect(parseSodexNetwork('mainnet')).toBe('mainnet');
    expect(parseSodexNetwork('invalid')).toBeNull();
    expect(parseSodexNetwork(undefined)).toBeNull();
  });

  it('honors a browser selection and otherwise defaults to configured Testnet', () => {
    process.env.SODEX_USE_TESTNET = 'false';
    expect(getConfiguredSodexNetwork('testnet')).toBe('testnet');
    expect(getConfiguredSodexNetwork('mainnet')).toBe('mainnet');
    expect(getConfiguredSodexNetwork()).toBe('mainnet');

    delete process.env.SODEX_USE_TESTNET;
    expect(getConfiguredSodexNetwork()).toBe('testnet');
  });
});
