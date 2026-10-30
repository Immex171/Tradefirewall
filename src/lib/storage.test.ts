import { describe, expect, it } from 'vitest';
import { escapeCsvCell } from './storage';

describe('escapeCsvCell', () => {
  it('quotes cells and escapes embedded quotes', () => {
    expect(escapeCsvCell('Trader "A"')).toBe('"Trader ""A"""');
  });

  it.each(['=1+1', '+SUM(A1:A2)', '-cmd|payload', '@SUM(A1)', ' \t=1+1'])(
    'neutralizes spreadsheet formulas beginning with %s',
    (value) => {
      expect(escapeCsvCell(value)).toBe(`"'${value}"`);
    }
  );

  it('does not alter ordinary values or numeric cells', () => {
    expect(escapeCsvCell('BTC')).toBe('"BTC"');
    expect(escapeCsvCell(1250)).toBe('"1250"');
  });
});
