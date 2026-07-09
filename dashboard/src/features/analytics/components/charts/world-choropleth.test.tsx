import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorldChoropleth } from './WorldChoropleth';

// A tiny 3-country fixture (2 "real" + 1 with no geometry-matching data) stands in for the
// bundled 180-country geometry so tests stay deterministic and fast.
vi.mock('../../geo/world-countries.geo.json', () => ({
  default: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'USA',
        properties: { name: 'United States of America' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-100, 40],
              [-90, 40],
              [-90, 30],
              [-100, 30],
              [-100, 40],
            ],
          ],
        },
      },
      {
        type: 'Feature',
        id: 'FRA',
        properties: { name: 'France' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 50],
              [5, 50],
              [5, 45],
              [0, 45],
              [0, 50],
            ],
          ],
        },
      },
      {
        type: 'Feature',
        id: 'ATA',
        properties: { name: 'Antarctica' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, -80],
              [10, -80],
              [10, -85],
              [0, -85],
              [0, -80],
            ],
          ],
        },
      },
    ],
  },
}));

describe('WorldChoropleth', () => {
  it('renders an accessible labelled figure with one path per bundled country feature', () => {
    const { container } = render(
      <WorldChoropleth data={{ USA: 900, FRA: 100 }} ariaLabel="Installations by country" />,
    );
    expect(screen.getByRole('img', { name: 'Installations by country' })).toBeInTheDocument();
    expect(container.querySelectorAll('svg path')).toHaveLength(3);
  });

  it("gives a valued country's path an aria-label with the formatted value + valueLabel, mirrored in the table", () => {
    render(
      <WorldChoropleth
        data={{ USA: 1234, FRA: 100 }}
        ariaLabel="Installations by country"
        valueLabel="installs"
      />,
    );
    expect(
      screen.getByRole('img', { name: 'United States of America: 1,234 installs' }),
    ).toBeInTheDocument();

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    // header + USA + FRA
    expect(rows).toHaveLength(3);
    expect(within(table).getByText('1,234')).toBeInTheDocument();
    expect(within(table).getByText('United States of America')).toBeInTheDocument();
  });

  it('renders a no-data country path that reads "no data" rather than a value', () => {
    render(<WorldChoropleth data={{ USA: 900 }} ariaLabel="Installations by country" />);
    // France isn't in `data` -> no-data, never crashes, never picks up a stray value.
    expect(
      screen.getByRole('img', { name: 'France: no data' }),
    ).toBeInTheDocument();
  });

  it('renders the legend with a gradient scale and a distinct "No data" swatch', () => {
    render(<WorldChoropleth data={{ USA: 900, FRA: 100 }} ariaLabel="Installations by country" />);
    const legend = screen.getByTestId('choropleth-legend');
    expect(within(legend).getByText('No data')).toBeInTheDocument();
    expect(within(legend).getByText('900')).toBeInTheDocument(); // max label
  });

  it('shows a tooltip with the country name + value on hover', () => {
    render(
      <WorldChoropleth
        data={{ USA: 900 }}
        ariaLabel="Installations by country"
        valueLabel="installs"
      />,
    );
    const usaPath = screen.getByRole('img', { name: /United States of America/ });
    expect(screen.queryByTestId('choropleth-tooltip')).not.toBeInTheDocument();

    fireEvent.mouseEnter(usaPath);
    expect(within(screen.getByTestId('choropleth-tooltip')).getByText('900 installs')).toBeInTheDocument();

    fireEvent.mouseLeave(usaPath);
    expect(screen.queryByTestId('choropleth-tooltip')).not.toBeInTheDocument();
  });

  it('shows a tooltip reading "No data" on focus of a no-data country', () => {
    render(<WorldChoropleth data={{ USA: 900 }} ariaLabel="Installations by country" />);
    const franceElement = document.querySelector('path[aria-label="France: no data"]')!;
    fireEvent.focus(franceElement);
    expect(within(screen.getByTestId('choropleth-tooltip')).getByText('No data')).toBeInTheDocument();

    fireEvent.blur(franceElement);
    expect(screen.queryByTestId('choropleth-tooltip')).not.toBeInTheDocument();
  });

  it('is keyboard-focusable via tabIndex on every country path', () => {
    const { container } = render(
      <WorldChoropleth data={{ USA: 900 }} ariaLabel="Installations by country" />,
    );
    const paths = container.querySelectorAll('svg path');
    paths.forEach((path) => {
      expect(path.getAttribute('tabindex')).toBe('0');
    });
  });

  it('calls onSelectCountry with the ISO-3 code when a country is clicked', () => {
    const onSelectCountry = vi.fn();
    render(
      <WorldChoropleth
        data={{ USA: 900 }}
        ariaLabel="Installations by country"
        onSelectCountry={onSelectCountry}
      />,
    );
    fireEvent.click(screen.getByRole('img', { name: /United States of America/ }));
    expect(onSelectCountry).toHaveBeenCalledWith('USA');
  });

  it('never calls onSelectCountry when it is not provided (no crash on click)', () => {
    render(<WorldChoropleth data={{ USA: 900 }} ariaLabel="Installations by country" />);
    expect(() =>
      fireEvent.click(screen.getByRole('img', { name: /United States of America/ })),
    ).not.toThrow();
  });

  it('lists a country present in data but absent from geometry only in the table, not on the map', () => {
    render(
      <WorldChoropleth
        data={{ USA: 900, TWN: 50 }}
        ariaLabel="Installations by country"
      />,
    );
    const table = screen.getByRole('table');
    expect(within(table).getByText('Taiwan, Province of China')).toBeInTheDocument();
    // No matching feature was mocked for TWN, so the map itself never renders a path for it.
    expect(screen.queryByRole('img', { name: /Taiwan/ })).not.toBeInTheDocument();
  });

  it('computes table share % against the total of the values given', () => {
    render(<WorldChoropleth data={{ USA: 75, FRA: 25 }} ariaLabel="Installations by country" />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('75%')).toBeInTheDocument();
    expect(within(table).getByText('25%')).toBeInTheDocument();
  });
});
