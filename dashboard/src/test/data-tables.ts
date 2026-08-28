import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Chart data tables render inside a `CollapsibleTable` and start collapsed, so the exact
 * per-bucket numbers are behind a toggle. Open every such disclosure currently on screen —
 * identified by its `aria-controls` region containing a `<table>`, so unrelated disclosures
 * (filter popovers, `CollapsibleSection`s) are left alone.
 */
export async function openDataTables(): Promise<void> {
  const toggles = screen.queryAllByRole('button', { expanded: false }).filter((button) => {
    const regionId = button.getAttribute('aria-controls');
    return regionId ? Boolean(document.getElementById(regionId)?.querySelector('table')) : false;
  });
  for (const toggle of toggles) {
    await userEvent.click(toggle);
  }
}
