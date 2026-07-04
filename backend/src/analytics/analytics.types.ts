/** POST /query/insights response (contracts §14). */
export interface InsightsSeriesPoint {
  t: string;
  value: number;
}

export interface InsightsSeries {
  name: string;
  breakdown_value: string | null;
  data: InsightsSeriesPoint[];
}

export interface InsightsResponse {
  series: InsightsSeries[];
}

/** GET /meta/events response (contracts §14). */
export interface EventsMetaResponse {
  events: string[];
}

/** GET /meta/properties response (contracts §14). */
export interface PropertyMeta {
  name: string;
  type: 'string' | 'number' | 'column';
}

export interface PropertiesMetaResponse {
  properties: PropertyMeta[];
}
