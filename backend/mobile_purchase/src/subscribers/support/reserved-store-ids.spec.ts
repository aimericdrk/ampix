import { appReservedStoreIds } from './reserved-store-ids';

describe('appReservedStoreIds', () => {
  it('includes publicSdkKey, bundleId, and packageName when all are set', () => {
    expect(
      appReservedStoreIds({ publicSdkKey: 'mp_pub_abc', bundleId: 'com.a.b', packageName: 'com.a.b.android' }),
    ).toEqual(['mp_pub_abc', 'com.a.b', 'com.a.b.android']);
  });

  it('omits a null bundleId (Android app)', () => {
    expect(appReservedStoreIds({ publicSdkKey: 'mp_pub_abc', bundleId: null, packageName: 'com.a.b' })).toEqual([
      'mp_pub_abc',
      'com.a.b',
    ]);
  });

  it('omits a null packageName (iOS app)', () => {
    expect(appReservedStoreIds({ publicSdkKey: 'mp_pub_abc', bundleId: 'com.a.b', packageName: null })).toEqual([
      'mp_pub_abc',
      'com.a.b',
    ]);
  });

  it('omits empty-string identifiers', () => {
    expect(appReservedStoreIds({ publicSdkKey: 'mp_pub_abc', bundleId: '', packageName: null })).toEqual([
      'mp_pub_abc',
    ]);
  });
});
