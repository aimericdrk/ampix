import { describe, expect, it } from 'vitest';
import { TOOLS, allGroups, toolForPathname, toolGroups } from './nav-model';

const labels = (groups: ReturnType<typeof allGroups>) => groups.flatMap((g) => g.items).map((i) => i.label);

describe('nav-model tools', () => {
  it('exposes MyAmplitude and MyRevenueCat', () => {
    expect(TOOLS.map((t) => t.id)).toEqual(['amplitude', 'revenuecat']);
    expect(TOOLS.map((t) => t.label)).toEqual(['MyAmplitude', 'MyRevenueCat']);
  });

  it('keeps Revenue in MyAmplitude — it reads SDK purchase events, not RevenueCat data', () => {
    expect(labels(toolGroups('amplitude', { rcEnabled: true }))).toContain('Revenue');
    expect(labels(toolGroups('revenuecat', { rcEnabled: true }))).not.toContain('Revenue');
  });

  it('surfaces the previously unreachable Flows route under Explore', () => {
    const explore = toolGroups('amplitude', { rcEnabled: true }).find((g) => g.heading === 'Explore');
    expect(explore?.items.map((i) => i.label)).toContain('Flows');
  });

  it('always shows the MyRevenueCat clone pages — the self-hosted clone has no connect gate', () => {
    // `rcEnabled` is the legacy real-RevenueCat-connected flag; the clone reads mobile_purchase and
    // must never gate on it. The pages appear regardless of the flag (or its absence).
    for (const opts of [{ rcEnabled: false }, { rcEnabled: true }, undefined] as const) {
      const shown = labels(toolGroups('revenuecat', opts));
      expect(shown).toContain('Overview');
      expect(shown).toContain('Customers');
      expect(shown).toContain('Conversion');
      expect(shown).toContain('Integration settings');
    }
  });

  it('allGroups spans both tools; toolGroups spans exactly one', () => {
    const all = labels(allGroups({ rcEnabled: true }));
    expect(all).toContain('Insights');
    expect(all).toContain('Overview');
    expect(labels(toolGroups('amplitude', { rcEnabled: true }))).not.toContain('Overview');
  });

  it('allGroups() with no options returns every page ungated (module-scope caller)', () => {
    expect(labels(allGroups())).toContain('Overview');
  });

  it('derives the active tool from the pathname', () => {
    expect(toolForPathname('/projects/abc/insights')).toBe('amplitude');
    expect(toolForPathname('/projects/abc/rc/overview')).toBe('revenuecat');
    expect(toolForPathname('/projects')).toBe('amplitude');
  });

  it('every lettered shortcut label still resolves — NAV_SHORTCUT_LETTERS is silently lossy', () => {
    const all = labels(allGroups());
    for (const label of ['Home', 'Insights', 'Funnels', 'Retention', 'Users', 'Dashboards', 'Revenue']) {
      expect(all).toContain(label);
    }
  });
});
