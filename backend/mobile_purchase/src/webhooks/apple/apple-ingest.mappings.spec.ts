import { mapAppleEnvironment, mapAppleTransactionType, mapOwnershipType } from './apple-ingest.mappings';

describe('mapAppleTransactionType', () => {
  it.each([
    ['Auto-Renewable Subscription', 'AUTO_RENEWABLE_SUBSCRIPTION'],
    ['Non-Renewing Subscription', 'NON_RENEWING_SUBSCRIPTION'],
    ['Consumable', 'CONSUMABLE'],
    ['Non-Consumable', 'NON_CONSUMABLE'],
    [undefined, 'NON_CONSUMABLE'],
    ['some-future-apple-type', 'NON_CONSUMABLE'],
  ])('%s -> %s', (appleType, expected) => {
    expect(mapAppleTransactionType(appleType)).toBe(expected);
  });
});

describe('mapAppleEnvironment', () => {
  it('maps "Production" to PRODUCTION', () => {
    expect(mapAppleEnvironment('Production')).toBe('PRODUCTION');
  });

  it.each(['Sandbox', 'unexpected', ''])('maps %j to SANDBOX (conservative default)', (raw) => {
    expect(mapAppleEnvironment(raw)).toBe('SANDBOX');
  });
});

describe('mapOwnershipType', () => {
  it('maps FAMILY_SHARED verbatim', () => {
    expect(mapOwnershipType('FAMILY_SHARED')).toBe('FAMILY_SHARED');
  });

  it.each(['PURCHASED', undefined])('defaults %j to PURCHASED', (raw) => {
    expect(mapOwnershipType(raw as 'PURCHASED' | undefined)).toBe('PURCHASED');
  });
});
