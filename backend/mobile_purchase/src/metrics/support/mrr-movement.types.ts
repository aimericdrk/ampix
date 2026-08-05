/**
 * MRR movement (design: "MRR Movement" chart). Decomposes the change in monthly recurring revenue
 * over each bucket into the standard RevenueCat-style categories.
 *
 * Sign convention (so a stacked bar renders directly): the three gain categories are `>= 0`, the two
 * loss categories are `<= 0`, and `net_cents` is their sum (the bucket's ΔMRR).
 */
export interface MrrMovementBucket {
  bucket: string; // ISO date, bucket start (UTC) — aligns with the MRR series buckets
  new_cents: number; // first-time subscribers who became active this bucket (>= 0)
  reactivation_cents: number; // lapsed subscribers who returned this bucket (>= 0)
  expansion_cents: number; // active subs whose price increased this bucket (>= 0)
  contraction_cents: number; // active subs whose price decreased this bucket (<= 0)
  churn_cents: number; // subs that stopped being active this bucket (<= 0)
  net_cents: number; // sum of the five above
}

export interface MrrMovementTotals {
  new_cents: number;
  reactivation_cents: number;
  expansion_cents: number;
  contraction_cents: number;
  churn_cents: number;
  net_cents: number;
}

export interface MrrMovementMetrics {
  currency: string | null; // dominant currency; null if there is no attributable MRR
  buckets: MrrMovementBucket[];
  totals: MrrMovementTotals; // per-category sums across every bucket
  approximate: true; // window-approximated, like the MRR series (see the service doc-comment)
}
