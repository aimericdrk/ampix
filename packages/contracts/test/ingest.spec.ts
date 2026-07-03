import {
  eventContextSchema,
  ingestEventSchema,
  ingestEventsRequestSchema,
  ingestProfilesRequestSchema,
  profileOperationSchema,
  propertyValueSchema,
  RESERVED_EVENTS,
  SDK_TOKEN_REGEX,
} from '../src';

const validEvent = {
  insert_id: '018f6b2e-7c1a-7f3b-9c4d-1a2b3c4d5e6f',
  event: 'checkout_completed',
  distinct_id: 'u_42',
  anon_id: '018f6b2e-aaaa-7f3b-9c4d-1a2b3c4d5e6f',
  session_id: '018f6b2e-bbbb-7f3b-9c4d-1a2b3c4d5e6f',
  timestamp: 1751462400123,
  properties: { plan: 'pro', value: 9.99 },
  context: {
    app_version: '1.4.2',
    app_build: '142',
    os: 'ios',
    os_version: '18.5',
    device_model: 'iPhone16,2',
    device_manufacturer: 'Apple',
    locale: 'fr_FR',
    timezone: 'Europe/Paris',
    screen_width: 393,
    screen_height: 852,
    network: 'wifi',
    sdk_version: '0.1.0',
    utm_source: 'tiktok',
    utm_medium: 'paid',
    utm_campaign: 'summer',
    utm_content: null,
    utm_term: null,
    first_utm_source: 'meta',
    first_utm_campaign: 'launch',
    install_referrer: 'utm_source=facebook&utm_campaign=x',
  },
};

describe('ingestEventSchema', () => {
  it('accepts the shared-contracts §4 example event', () => {
    expect(ingestEventSchema.safeParse(validEvent).success).toBe(true);
  });

  it('accepts a minimal event without properties/context', () => {
    const { properties, context, ...minimal } = validEvent;
    expect(ingestEventSchema.safeParse(minimal).success).toBe(true);
  });

  it('rejects a missing insert_id', () => {
    const { insert_id, ...bad } = validEvent;
    const result = ingestEventSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['insert_id']);
    }
  });

  it('rejects a non-UUID insert_id', () => {
    expect(ingestEventSchema.safeParse({ ...validEvent, insert_id: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects an event name longer than 255 chars', () => {
    expect(ingestEventSchema.safeParse({ ...validEvent, event: 'x'.repeat(256) }).success).toBe(false);
  });

  it('rejects an empty event name', () => {
    expect(ingestEventSchema.safeParse({ ...validEvent, event: '' }).success).toBe(false);
  });

  it('rejects a non-integer timestamp', () => {
    expect(ingestEventSchema.safeParse({ ...validEvent, timestamp: 'now' }).success).toBe(false);
  });

  it('accepts null UTM fields in context', () => {
    expect(eventContextSchema.safeParse({ utm_content: null, utm_term: null }).success).toBe(true);
  });

  it('rejects a negative screen_width in context', () => {
    expect(eventContextSchema.safeParse({ screen_width: -1 }).success).toBe(false);
  });

  it('rejects a screen_width above 65535 in context', () => {
    expect(eventContextSchema.safeParse({ screen_width: 70000 }).success).toBe(false);
  });
});

describe('propertyValueSchema (flat properties)', () => {
  it.each(['pro', 9.99, true, null])('accepts scalar %p', (value) => {
    expect(propertyValueSchema.safeParse(value).success).toBe(true);
  });

  it('accepts an array of scalars', () => {
    expect(propertyValueSchema.safeParse(['a', 1, true, null]).success).toBe(true);
  });

  it('rejects a nested object value', () => {
    expect(propertyValueSchema.safeParse({ tier: 'pro' }).success).toBe(false);
  });

  it('rejects an array containing an object', () => {
    expect(propertyValueSchema.safeParse(['a', { tier: 'pro' }]).success).toBe(false);
  });

  it('rejects an array containing a nested array', () => {
    expect(propertyValueSchema.safeParse([['a']]).success).toBe(false);
  });

  it('rejects an event with a nested object property value', () => {
    expect(
      ingestEventSchema.safeParse({ ...validEvent, properties: { plan: { tier: 'pro' } } }).success,
    ).toBe(false);
  });

  it('rejects a profile operation with a nested object property value', () => {
    const op = {
      distinct_id: 'u_42',
      op: 'set',
      properties: { plan: { tier: 'pro' } },
      timestamp: 1751462400123,
    };
    expect(profileOperationSchema.safeParse(op).success).toBe(false);
  });
});

describe('profileOperationSchema', () => {
  const validOp = {
    distinct_id: 'u_42',
    op: 'set',
    properties: { plan: 'pro' },
    timestamp: 1751462400123,
  };

  it.each(['set', 'set_once', 'increment', 'append', 'unset', 'delete'])('accepts op %s', (op) => {
    expect(profileOperationSchema.safeParse({ ...validOp, op }).success).toBe(true);
  });

  it('rejects an unknown op', () => {
    expect(profileOperationSchema.safeParse({ ...validOp, op: 'merge' }).success).toBe(false);
  });

  it('rejects a missing distinct_id', () => {
    const { distinct_id, ...bad } = validOp;
    expect(profileOperationSchema.safeParse(bad).success).toBe(false);
  });
});

describe('request envelopes', () => {
  it('requires a non-empty events array', () => {
    expect(ingestEventsRequestSchema.safeParse({ events: [] }).success).toBe(false);
    expect(ingestEventsRequestSchema.safeParse({}).success).toBe(false);
    expect(ingestEventsRequestSchema.safeParse({ events: [{}] }).success).toBe(true);
  });

  it('requires a non-empty operations array', () => {
    expect(ingestProfilesRequestSchema.safeParse({ operations: [] }).success).toBe(false);
    expect(ingestProfilesRequestSchema.safeParse({ operations: [{}] }).success).toBe(true);
  });
});

describe('SDK_TOKEN_REGEX', () => {
  it('matches mam_ + 32 hex chars', () => {
    expect(SDK_TOKEN_REGEX.test('mam_' + 'a1b2c3d4'.repeat(4))).toBe(true);
  });

  it.each(['mam_short', 'MAM_' + 'a'.repeat(32), 'mam_' + 'g'.repeat(32), 'a'.repeat(36)])(
    'rejects %s',
    (token) => {
      expect(SDK_TOKEN_REGEX.test(token)).toBe(false);
    },
  );
});

describe('reserved names', () => {
  it('exports the shared-contracts §4 reserved event list', () => {
    expect(RESERVED_EVENTS).toEqual(
      expect.arrayContaining(['$first_open', '$session_start', '$session_end', '$screen_view', '$tap']),
    );
  });
});
