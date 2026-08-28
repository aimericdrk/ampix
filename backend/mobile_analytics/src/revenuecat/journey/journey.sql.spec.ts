import {
  daysToOutcomeSql,
  frequencySql,
  outcomeSpec,
  pathSql,
  screensSql,
  summarySql,
} from './journey.sql';

const ALL_STATEMENTS = (outcome: 'subscribe' | 'refund') => {
  const spec = outcomeSpec(outcome);
  return {
    summary: summarySql(spec),
    days: daysToOutcomeSql(spec),
    path: pathSql(spec),
    frequency: frequencySql(spec),
    screens: screensSql(spec),
  };
};

describe('journey SQL', () => {
  it.each([['subscribe'], ['refund']] as const)(
    'binds project and range as params in every %s statement',
    (outcome) => {
      for (const sql of Object.values(ALL_STATEMENTS(outcome))) {
        expect(sql).toContain('{projectId:UUID}');
        expect(sql).toContain('{from:DateTime64}');
        expect(sql).toContain('{toExclusive:DateTime64}');
        expect(sql).toContain('{windowDays:UInt16}');
      }
    },
  );

  /**
   * Regression guard, found by running these statements against a real ClickHouse with a seeded
   * scenario: the control is anchored on its LAST event, so a strict `<` on both groups silently
   * dropped one event from every control user and biased every comparison toward the cohort. The
   * cohort's anchor is the outcome event and must stay excluded; the control's must not.
   */
  it.each([['subscribe'], ['refund']] as const)(
    'excludes the anchor for the %s cohort but keeps it for the control',
    (outcome) => {
      for (const sql of Object.values(ALL_STATEMENTS(outcome))) {
        expect(sql).toContain(
          "if(a.grp = 'cohort', e.timestamp < a.anchor, e.timestamp <= a.anchor)",
        );
      }
    },
  );

  it('bounds the window scan by literal timestamps so ClickHouse can prune partitions', () => {
    // The per-user anchor bound alone is correct but opaque to the partition index; without this
    // the scan reads every partition the project has ever written.
    for (const sql of Object.values(ALL_STATEMENTS('subscribe'))) {
      expect(sql).toContain('e.timestamp >= {from:DateTime64} - toIntervalDay({windowDays:UInt16})');
    }
  });

  it('excludes subscription lifecycle events from the behavioural window', () => {
    for (const sql of Object.values(ALL_STATEMENTS('subscribe'))) {
      expect(sql).toContain("e.event NOT LIKE '$rc%'");
    }
  });

  describe('refund', () => {
    it('matches a CUSTOMER_SUPPORT cancellation or expiration, never a plain unsubscribe', () => {
      const sql = ALL_STATEMENTS('refund').summary;
      expect(sql).toContain("e.event = '$rc_cancellation'");
      expect(sql).toContain("e.event = '$rc_expiration'");
      expect(sql).toContain("'CUSTOMER_SUPPORT'");
      expect(sql).not.toContain('UNSUBSCRIBE');
    });

    it('restricts the control to other subscribers', () => {
      // Comparing a refunder against someone who never paid answers a different question.
      const sql = ALL_STATEMENTS('refund').summary;
      expect(sql).toContain('control_required AS');
      expect(sql).toContain('uid IN (SELECT uid FROM control_required)');
    });

    it('measures elapsed time from the purchase, not from first-seen', () => {
      expect(ALL_STATEMENTS('refund').days).toContain("e.event = '$rc_initial_purchase'");
      expect(outcomeSpec('refund').daysToOutcomeDefinition).toContain('$rc_initial_purchase');
    });
  });

  describe('subscribe', () => {
    it('excludes anyone who ever purchased from the control, not just in-range buyers', () => {
      const sql = ALL_STATEMENTS('subscribe').summary;
      expect(sql).toContain('ever_outcome AS');
      expect(sql).toContain('uid NOT IN (SELECT uid FROM ever_outcome)');
      // No control_required clause: for subscribing, everyone who never bought is a fair control.
      expect(sql).not.toContain('control_required AS');
    });

    it('measures elapsed time from the user first being seen at all', () => {
      const spec = outcomeSpec('subscribe');
      expect(spec.originPredicate).toBeNull();
      expect(spec.daysToOutcomeDefinition).toContain('first event of any kind');
    });
  });
});
