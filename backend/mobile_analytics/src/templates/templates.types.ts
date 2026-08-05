/** GET /api/v1/templates catalog item (contracts §19). */
export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  /** Number of saved reports per kind in the bundle, e.g. `{ insights: 2 }`. */
  kind_counts: Record<string, number>;
}

export interface TemplateCatalogResponse {
  templates: TemplateSummary[];
}

/** POST .../templates/:id/apply response (contracts §19). */
export interface ApplyTemplateResponse {
  dashboard_id: string;
}
