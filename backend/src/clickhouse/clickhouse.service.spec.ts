import { toChDateTime64 } from './clickhouse.service';

describe('toChDateTime64', () => {
  it('formats ms epoch as ClickHouse DateTime64(3) UTC literal', () => {
    expect(toChDateTime64(Date.UTC(2026, 6, 2, 12, 0, 0, 123))).toBe('2026-07-02 12:00:00.123');
  });

  it('zero-pads milliseconds', () => {
    expect(toChDateTime64(Date.UTC(2026, 0, 1, 0, 0, 0, 5))).toBe('2026-01-01 00:00:00.005');
  });
});
