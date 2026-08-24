import { describe, expect, it } from 'vitest';
import { clampTail, demuxDockerLogs, parseK8sLogLines } from './logs';

describe('clampTail', () => {
  it('defaults, floors, and caps', () => {
    expect(clampTail(undefined)).toBe(500);
    expect(clampTail('abc')).toBe(500);
    expect(clampTail('250.7')).toBe(250);
    expect(clampTail(999999)).toBe(2000);
    expect(clampTail(-5)).toBe(500);
  });
});

describe('parseK8sLogLines', () => {
  it('splits lines and extracts RFC3339 timestamps', () => {
    const raw = '2026-08-24T20:00:00.123456789Z hello world\n2026-08-24T20:00:01Z second\n';
    const lines = parseK8sLogLines(raw);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ ts: '2026-08-24T20:00:00.123456789Z', text: 'hello world' });
    expect(lines[1].text).toBe('second');
  });
  it('keeps unstamped lines whole and handles empty input', () => {
    expect(parseK8sLogLines('plain line no timestamp')[0]).toEqual({ ts: null, text: 'plain line no timestamp' });
    expect(parseK8sLogLines('')).toEqual([]);
  });
});

describe('demuxDockerLogs', () => {
  it('reassembles multiplexed frames', () => {
    const frame = (stream: number, text: string): Buffer => {
      const payload = Buffer.from(text);
      const head = Buffer.alloc(8);
      head[0] = stream;
      head.writeUInt32BE(payload.length, 4);
      return Buffer.concat([head, payload]);
    };
    const buf = Buffer.concat([frame(1, 'out line\n'), frame(2, 'err line\n')]);
    expect(demuxDockerLogs(buf)).toBe('out line\nerr line\n');
  });
  it('passes through plain (TTY) output and truncated frames safely', () => {
    expect(demuxDockerLogs(Buffer.from('plain tty output'))).toBe('plain tty output');
    const head = Buffer.alloc(8);
    head[0] = 1;
    head.writeUInt32BE(100, 4); // claims 100 bytes, only 3 present
    expect(demuxDockerLogs(Buffer.concat([head, Buffer.from('abc')]))).toBe('abc');
    expect(demuxDockerLogs(Buffer.alloc(0))).toBe('');
  });
});
