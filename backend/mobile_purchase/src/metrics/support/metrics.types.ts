export interface RevenueSeriesPoint {
  bucket: string; // ISO date, bucket start (UTC)
  amountCents: number;
}
export interface CurrencyTotal {
  currency: string;
  totalCents: number;
}
export interface RevenueMetrics {
  currency: string | null; // dominant currency; null if no data
  totalCents: number; // sum over range, dominant currency
  series: RevenueSeriesPoint[];
  byCurrency: CurrencyTotal[]; // full multi-currency breakdown (null-currency excluded)
}

export interface MrrSeriesPoint {
  bucket: string;
  mrrCents: number;
}
export interface MrrMetrics {
  currency: string | null;
  mrrCents: number; // CURRENT MRR (as of `to`), dominant currency
  series: MrrSeriesPoint[]; // window-approximated
  unattributedActiveCount: number; // active subs with no importable Product/period, excluded from MRR
  approximate: true;
}

export interface ActiveSubscriptionsSeriesPoint {
  bucket: string;
  count: number;
}
export interface ActiveSubscriptionsMetrics {
  current: number; // active subs as of `to`
  series: ActiveSubscriptionsSeriesPoint[]; // window-approximated
  approximate: true;
}
