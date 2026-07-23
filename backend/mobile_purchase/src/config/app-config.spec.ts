import { describeConfig, loadConfig } from './app-config';

const BASE_ENV = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' } as NodeJS.ProcessEnv;

describe('loadConfig — DASHBOARD_ORIGINS (CORS allowlist)', () => {
  it('defaults to the dashboard dev server origin when DASHBOARD_ORIGINS is unset', () => {
    const config = loadConfig({ ...BASE_ENV });
    expect(config.dashboardOrigins).toEqual(['http://localhost:5173']);
  });

  it('splits a comma-separated allowlist, trimming whitespace and dropping empty entries', () => {
    const config = loadConfig({
      ...BASE_ENV,
      DASHBOARD_ORIGINS: 'http://localhost:5173, https://app.myampix.example , ',
    });
    expect(config.dashboardOrigins).toEqual([
      'http://localhost:5173',
      'https://app.myampix.example',
    ]);
  });

  it('surfaces the configured origins in the redacted boot description', () => {
    const config = loadConfig({
      ...BASE_ENV,
      DASHBOARD_ORIGINS: 'https://app.myampix.example',
    });
    expect(describeConfig(config).DASHBOARD_ORIGINS).toBe('https://app.myampix.example');
  });

  it('defaults SCHEDULER_ENABLED to true and EXPIRY_SWEEP_CRON to every 5 minutes', () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://u:p@localhost:5433/db' });
    expect(config.schedulerEnabled).toBe(true);
    expect(config.expirySweepCron).toBe('*/5 * * * *');
  });

  it('parses SCHEDULER_ENABLED=false and a custom EXPIRY_SWEEP_CRON', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
      SCHEDULER_ENABLED: 'false',
      EXPIRY_SWEEP_CRON: '*/10 * * * *',
    });
    expect(config.schedulerEnabled).toBe(false);
    expect(config.expirySweepCron).toBe('*/10 * * * *');
  });
});
