import { fitsGrid } from '../dashboards/dashboard.schema';
import { validateReportDefinition } from '../reports/report.schema';
import {
  TEMPLATE_CATALOG,
  findTemplate,
  kindCounts,
} from './template-catalog';

const DATE_RANGE = { from: '2026-06-01', to: '2026-06-30' };

describe('template catalog (contracts §19)', () => {
  it('exposes exactly the fixed Amplitude-parity catalog', () => {
    expect(TEMPLATE_CATALOG.map((t) => t.id)).toEqual([
      'acquisition',
      'activation-funnel',
      'engagement',
      'retention',
      'revenue',
      'product-usage',
      'user-paths',
    ]);
  });

  it('every bundled report definition validates against its §14/§15 kind schema', () => {
    for (const spec of TEMPLATE_CATALOG) {
      for (const report of spec.reports) {
        // The definitions omit date_range (injected at apply); merge one to validate the full shape.
        expect(() =>
          validateReportDefinition(report.kind, { ...report.definition, date_range: DATE_RANGE }),
        ).not.toThrow();
      }
    }
  });

  it('every tile references a real report and fits the 12-column grid', () => {
    for (const spec of TEMPLATE_CATALOG) {
      for (const tile of spec.tiles) {
        expect(spec.reports[tile.reportRef]).toBeDefined();
        expect(fitsGrid({ x: tile.x, w: tile.w })).toBe(true);
      }
    }
  });

  it('findTemplate resolves ids and rejects unknowns; kindCounts tallies report kinds', () => {
    expect(findTemplate('revenue')?.name).toBe('Revenue');
    expect(findTemplate('nope')).toBeUndefined();
    expect(kindCounts(findTemplate('acquisition')!)).toEqual({ insights: 2 });
    expect(kindCounts(findTemplate('activation-funnel')!)).toEqual({ funnel: 1 });
  });
});
