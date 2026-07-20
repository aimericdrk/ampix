import { computePromotionalExpiresAt } from './promotional-duration';

describe('computePromotionalExpiresAt', () => {
  const grantedAt = new Date('2026-07-20T12:00:00.000Z');

  it('daily -> +1 UTC day', () => {
    expect(computePromotionalExpiresAt(grantedAt, 'daily')).toEqual(new Date('2026-07-21T12:00:00.000Z'));
  });

  it('three_day -> +3 UTC days', () => {
    expect(computePromotionalExpiresAt(grantedAt, 'three_day')).toEqual(new Date('2026-07-23T12:00:00.000Z'));
  });

  it('weekly -> +7 UTC days', () => {
    expect(computePromotionalExpiresAt(grantedAt, 'weekly')).toEqual(new Date('2026-07-27T12:00:00.000Z'));
  });

  it('monthly -> +1 UTC calendar month', () => {
    expect(computePromotionalExpiresAt(grantedAt, 'monthly')).toEqual(new Date('2026-08-20T12:00:00.000Z'));
  });

  it('two_month -> +2 UTC calendar months', () => {
    expect(computePromotionalExpiresAt(grantedAt, 'two_month')).toEqual(new Date('2026-09-20T12:00:00.000Z'));
  });

  it('three_month -> +3 UTC calendar months', () => {
    expect(computePromotionalExpiresAt(grantedAt, 'three_month')).toEqual(new Date('2026-10-20T12:00:00.000Z'));
  });

  it('six_month -> +6 UTC calendar months', () => {
    expect(computePromotionalExpiresAt(grantedAt, 'six_month')).toEqual(new Date('2027-01-20T12:00:00.000Z'));
  });

  it('yearly -> +1 UTC calendar year', () => {
    expect(computePromotionalExpiresAt(grantedAt, 'yearly')).toEqual(new Date('2027-07-20T12:00:00.000Z'));
  });

  it('lifetime -> null (never expires)', () => {
    expect(computePromotionalExpiresAt(grantedAt, 'lifetime')).toBeNull();
  });

  it('monthly from a month-end date rolls forward across a shorter next month (plain calendar-month arithmetic, no clamping)', () => {
    const jan31 = new Date('2026-01-31T00:00:00.000Z');
    // 2026 is not a leap year: Feb has 28 days, so day 31 overflows to Mar 3.
    expect(computePromotionalExpiresAt(jan31, 'monthly')).toEqual(new Date('2026-03-03T00:00:00.000Z'));
  });
});
