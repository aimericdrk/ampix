import type { VariantComparison } from './experiment-stats';

/** One arm of the test: its label, how many users entered it, and how many converted. */
export interface ExperimentVariantResult {
  variant: string;
  exposed: number;
  converted: number;
  /** `converted / exposed` as a proportion in [0, 1]. */
  conversion_rate: number;
  /** True for the arm every other arm is compared against. Exactly one arm has this. */
  is_control: boolean;
  /** Below MIN_SAMPLE_PER_VARIANT exposures the normal approximation is not trustworthy; the
   *  numbers are still reported, flagged, rather than withheld. */
  underpowered: boolean;
  /** Null on the control arm itself — there is nothing for it to be compared against. */
  comparison: VariantComparison | null;
}

export interface ExperimentResponse {
  /** The arm used as the baseline; null when the experiment has no participants at all. */
  control_variant: string | null;
  total_exposed: number;
  total_converted: number;
  /** Arms ordered by exposure, largest first — the control is normally the first row. */
  variants: ExperimentVariantResult[];
  /** True when EVERY arm cleared MIN_SAMPLE_PER_VARIANT; the readout is decision-grade only then. */
  has_enough_data: boolean;
}
