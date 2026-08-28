import { describe, expect, it } from 'vitest';
import { iso3Name, toIso3 } from './country-codes';

describe('toIso3', () => {
  it.each([
    ['TWN', 'TWN'],
    ['USA', 'USA'],
    ['FRA', 'FRA'],
  ])('passes an ISO-3 code through (%s)', (input, expected) => {
    expect(toIso3(input)).toBe(expected);
  });

  it.each([
    ['TW', 'TWN'],
    ['US', 'USA'],
    ['FR', 'FRA'],
    ['tw', 'TWN'],
  ])('resolves an ISO-2 code (%s)', (input, expected) => {
    expect(toIso3(input)).toBe(expected);
  });

  it.each([
    ['United States of America', 'USA'],
    ['France', 'FRA'],
    ['Japan', 'JPN'],
  ])('resolves the formal ISO name (%s)', (input, expected) => {
    expect(toIso3(input)).toBe(expected);
  });

  /**
   * The regression this file exists for. The generated ISO-3166 list only knows the FORMAL names —
   * "Taiwan, Province of China", "United States of America" — so a project whose SDK set `country`
   * to "Taiwan" resolved nothing, everything rolled into the Unknown bucket, and the world map
   * rendered its "no resolvable country" empty state over perfectly good data.
   */
  it.each([
    ['Taiwan', 'TWN'],
    ['United States', 'USA'],
    ['Turkey', 'TUR'],
    ['Netherlands', 'NLD'],
    ['South Korea', 'KOR'],
    ['Vietnam', 'VNM'],
    ['Czech Republic', 'CZE'],
    ['Palestine', 'PSE'],
    ['Brunei', 'BRN'],
    ['Cape Verde', 'CPV'],
    ['DR Congo', 'COD'],
    ['East Timor', 'TLS'],
    ['Vatican City', 'VAT'],
    ['Great Britain', 'GBR'],
    ['England', 'GBR'],
  ])('resolves the everyday short name (%s)', (input, expected) => {
    expect(toIso3(input)).toBe(expected);
  });

  it.each([
    ['United-States', 'USA'],
    ['united states', 'USA'],
    ['UNITED_STATES', 'USA'],
    ['  Taiwan  ', 'TWN'],
    ['türkiye', 'TUR'],
    ['Curacao', 'CUW'],
  ])('ignores case, punctuation and surrounding space (%s)', (input, expected) => {
    expect(toIso3(input)).toBe(expected);
  });

  it.each([[''], ['   '], [null], [undefined], ['Atlantis'], ['XX'], ['ZZZ']])(
    'returns null for an unresolvable value (%s)',
    (input) => {
      expect(toIso3(input)).toBeNull();
    },
  );

  it('never lets an alias override what ISO already says', () => {
    // "georgia" is the country in the generated list, not the US state; the alias table must not
    // be able to shadow a real ISO name.
    expect(toIso3('Georgia')).toBe('GEO');
  });
});

describe('iso3Name', () => {
  it.each([
    ['USA', 'United States'],
    ['GBR', 'United Kingdom'],
    ['TWN', 'Taiwan'],
    ['KOR', 'South Korea'],
    ['NLD', 'Netherlands'],
    ['RUS', 'Russia'],
  ])('uses the short name where the ISO name reads badly (%s)', (iso3, expected) => {
    expect(iso3Name(iso3)).toBe(expected);
  });

  it('keeps the ISO name where it is already readable', () => {
    expect(iso3Name('FRA')).toBe('France');
    expect(iso3Name('JPN')).toBe('Japan');
  });

  it('falls back to the code itself for an unknown one', () => {
    expect(iso3Name('ZZZ')).toBe('ZZZ');
  });

  it('round-trips every short name back to its own code', () => {
    // A display name the resolver cannot read back would break copy-paste from the table.
    for (const iso3 of ['USA', 'GBR', 'TWN', 'KOR', 'NLD', 'RUS', 'VNM', 'PSE', 'BRN']) {
      expect(toIso3(iso3Name(iso3))).toBe(iso3);
    }
  });
});
