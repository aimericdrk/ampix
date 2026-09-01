/**
 * The statistics behind the A/B readout: a two-proportion z-test per variant against the control.
 *
 * This is the one thing a cohort or a funnel breakdown genuinely cannot give you. Two conversion
 * rates always differ by SOMETHING; the question an experiment asks is whether the difference is
 * larger than the noise you would expect from splitting the same population in two. Everything
 * here is pure arithmetic over four integers (control converted/exposed, variant converted/exposed)
 * — no ClickHouse, no I/O — so it is exhaustively testable.
 *
 * The test is the standard normal-approximation one used by every experimentation tool:
 *
 *   pooled p̂ = (c₁ + c₂) / (n₁ + n₂)
 *   SE_pooled = √( p̂(1−p̂) (1/n₁ + 1/n₂) )
 *   z         = (p₂ − p₁) / SE_pooled
 *   p-value   = 2(1 − Φ(|z|))          (two-tailed: a variant can be worse, not just better)
 *
 * The confidence interval on the DIFFERENCE deliberately uses the UNPOOLED standard error
 * (√(p₁(1−p₁)/n₁ + p₂(1−p₂)/n₂)). Pooling assumes the null hypothesis "both arms share one true
 * rate", which is right for the test statistic and wrong for an interval that is trying to estimate
 * how big the difference actually is.
 */

/** Below this many users per arm the normal approximation stops being trustworthy (the usual
 *  rule of thumb is ≥5 expected successes AND ≥5 expected failures per arm; 30 exposures is a
 *  cheap, honest proxy). Reported, not enforced — the numbers are still returned, flagged. */
export const MIN_SAMPLE_PER_VARIANT = 30;

/** The threshold `significant` is decided at: the conventional two-tailed 95% confidence. */
export const SIGNIFICANCE_LEVEL = 0.05;

/** z for a two-tailed 95% interval. */
const Z_95 = 1.959964;

export interface VariantComparison {
  /** (variantRate − controlRate) / controlRate, i.e. relative lift. Null when the control rate is
   *  0 — the lift over nothing is undefined, not infinite, and rendering ∞% helps no one. */
  relative_uplift: number | null;
  /** variantRate − controlRate, in percentage points. Always defined. */
  absolute_uplift: number;
  /** Two-tailed p-value from the pooled z-test. Null when either arm has zero exposures. */
  p_value: number | null;
  z_score: number | null;
  /** 95% confidence interval on `absolute_uplift`, unpooled. Null when either arm is empty. */
  confidence_interval: { low: number; high: number } | null;
  /** `p_value < SIGNIFICANCE_LEVEL`. False whenever the p-value is null. */
  significant: boolean;
}

/**
 * Standard normal CDF Φ(x), via the Abramowitz & Stegun 7.1.26 error-function approximation
 * (|ε| < 1.5e-7 — far below the precision anyone reads a p-value at). Used instead of a stats
 * dependency: this is the only special function the whole readout needs.
 */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * absX);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

/** Conversion rate as a proportion in [0, 1]; 0 for an empty arm (no users, so no conversions). */
export function conversionRate(converted: number, exposed: number): number {
  return exposed > 0 ? converted / exposed : 0;
}

/**
 * Compares one variant arm against the control arm. Every field is null-or-false when a comparison
 * is not defined (an empty arm), rather than a fabricated zero — "we cannot tell" and "there is no
 * difference" are different answers and the UI renders them differently.
 */
export function compareVariant(
  control: { converted: number; exposed: number },
  variant: { converted: number; exposed: number },
): VariantComparison {
  const p1 = conversionRate(control.converted, control.exposed);
  const p2 = conversionRate(variant.converted, variant.exposed);
  const n1 = control.exposed;
  const n2 = variant.exposed;

  const absoluteUplift = p2 - p1;
  const relativeUplift = p1 > 0 ? absoluteUplift / p1 : null;

  if (n1 === 0 || n2 === 0) {
    return {
      relative_uplift: relativeUplift,
      absolute_uplift: absoluteUplift,
      p_value: null,
      z_score: null,
      confidence_interval: null,
      significant: false,
    };
  }

  const pooled = (control.converted + variant.converted) / (n1 + n2);
  const pooledSe = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  // pooledSe is 0 exactly when the pooled rate is 0 or 1 — every user in both arms converted, or
  // none did. There is then no observed difference and no variance to test against, so the honest
  // answer is p = 1 (nothing distinguishes the arms) rather than a division by zero.
  const zScore = pooledSe > 0 ? absoluteUplift / pooledSe : 0;
  const pValue = pooledSe > 0 ? 2 * (1 - normalCdf(Math.abs(zScore))) : 1;

  const unpooledSe = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
  const margin = Z_95 * unpooledSe;

  return {
    relative_uplift: relativeUplift,
    absolute_uplift: absoluteUplift,
    p_value: pValue,
    z_score: zScore,
    confidence_interval: { low: absoluteUplift - margin, high: absoluteUplift + margin },
    significant: pValue < SIGNIFICANCE_LEVEL,
  };
}
