import {
  compareVariant,
  conversionRate,
  normalCdf,
  SIGNIFICANCE_LEVEL,
} from './experiment-stats';

describe('experiment-stats', () => {
  describe('normalCdf', () => {
    it('is 0.5 at the mean', () => {
      expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    });

    it.each([
      [1.959964, 0.975],
      [1.644854, 0.95],
      [2.575829, 0.995],
      [-1.959964, 0.025],
    ])('matches the standard normal table at z=%p', (z, expected) => {
      expect(normalCdf(z)).toBeCloseTo(expected, 5);
    });
  });

  describe('conversionRate', () => {
    it('divides converted by exposed', () => {
      expect(conversionRate(25, 100)).toBe(0.25);
    });

    it('is 0 for an empty arm rather than NaN', () => {
      expect(conversionRate(0, 0)).toBe(0);
    });
  });

  describe('compareVariant', () => {
    it('reports a clearly better variant as significant', () => {
      // 10% vs 15% on 2000 users an arm — a textbook detectable difference.
      const result = compareVariant(
        { converted: 200, exposed: 2000 },
        { converted: 300, exposed: 2000 },
      );
      expect(result.absolute_uplift).toBeCloseTo(0.05, 10);
      expect(result.relative_uplift).toBeCloseTo(0.5, 10);
      expect(result.p_value!).toBeLessThan(SIGNIFICANCE_LEVEL);
      expect(result.significant).toBe(true);
      expect(result.z_score!).toBeGreaterThan(0);
    });

    it('reports a tiny difference on a small sample as NOT significant', () => {
      const result = compareVariant(
        { converted: 10, exposed: 100 },
        { converted: 12, exposed: 100 },
      );
      expect(result.p_value!).toBeGreaterThan(SIGNIFICANCE_LEVEL);
      expect(result.significant).toBe(false);
    });

    it('signs the uplift and z-score negative when the variant is worse', () => {
      const result = compareVariant(
        { converted: 300, exposed: 2000 },
        { converted: 200, exposed: 2000 },
      );
      expect(result.absolute_uplift).toBeLessThan(0);
      expect(result.z_score!).toBeLessThan(0);
      // Two-tailed: a variant that is significantly WORSE is still a significant result.
      expect(result.significant).toBe(true);
    });

    it('brackets the observed difference with the 95% interval', () => {
      const result = compareVariant(
        { converted: 200, exposed: 2000 },
        { converted: 300, exposed: 2000 },
      );
      const ci = result.confidence_interval!;
      expect(ci.low).toBeLessThan(result.absolute_uplift);
      expect(ci.high).toBeGreaterThan(result.absolute_uplift);
      // A significant result's interval must not straddle "no difference".
      expect(ci.low).toBeGreaterThan(0);
    });

    it('lets a non-significant interval straddle zero', () => {
      const result = compareVariant(
        { converted: 10, exposed: 100 },
        { converted: 12, exposed: 100 },
      );
      const ci = result.confidence_interval!;
      expect(ci.low).toBeLessThan(0);
      expect(ci.high).toBeGreaterThan(0);
    });

    it('returns nulls, not fabricated zeros, when an arm has no users', () => {
      const result = compareVariant({ converted: 0, exposed: 0 }, { converted: 5, exposed: 50 });
      expect(result.p_value).toBeNull();
      expect(result.z_score).toBeNull();
      expect(result.confidence_interval).toBeNull();
      expect(result.significant).toBe(false);
    });

    it('leaves relative uplift null when the control never converted', () => {
      const result = compareVariant({ converted: 0, exposed: 500 }, { converted: 25, exposed: 500 });
      expect(result.relative_uplift).toBeNull();
      // The absolute difference is still perfectly well defined, and still testable.
      expect(result.absolute_uplift).toBeCloseTo(0.05, 10);
      expect(result.significant).toBe(true);
    });

    it('calls identical arms a p-value of 1 with no significance', () => {
      const result = compareVariant(
        { converted: 100, exposed: 1000 },
        { converted: 100, exposed: 1000 },
      );
      expect(result.absolute_uplift).toBe(0);
      // 6dp, not exact: the A&S erf approximation carries ~1e-9 of error, far below the precision
      // any p-value is ever read at.
      expect(result.p_value).toBeCloseTo(1, 6);
      expect(result.significant).toBe(false);
    });

    it('reports p = 1 when nobody in either arm converted (no variance to test)', () => {
      const result = compareVariant(
        { converted: 0, exposed: 500 },
        { converted: 0, exposed: 500 },
      );
      expect(result.p_value).toBe(1);
      expect(result.z_score).toBe(0);
      expect(result.significant).toBe(false);
    });

    it('reports p = 1 when everyone in both arms converted', () => {
      const result = compareVariant(
        { converted: 500, exposed: 500 },
        { converted: 500, exposed: 500 },
      );
      expect(result.p_value).toBe(1);
      expect(result.significant).toBe(false);
    });

    it('is symmetric: swapping the arms flips the sign but keeps the p-value', () => {
      const a = compareVariant({ converted: 200, exposed: 2000 }, { converted: 300, exposed: 2000 });
      const b = compareVariant({ converted: 300, exposed: 2000 }, { converted: 200, exposed: 2000 });
      expect(b.absolute_uplift).toBeCloseTo(-a.absolute_uplift, 10);
      expect(b.p_value!).toBeCloseTo(a.p_value!, 10);
    });
  });
});
