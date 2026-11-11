import { describe, expect, it } from 'vitest';
import { BEATS, TIMELINE } from '../../src/config/demoFlight';
import { beatMixAt, formatClock, fractionToTime, phaseAt, textBeatIndex, timeToFraction } from '../../src/logic/timeline';

const hm = (h: number, m: number) => h * 60 + m;
const port = BEATS.port;
const textAt = (m: number) => port[textBeatIndex(port, m)].title;

describe('flight clock', () => {
  it('formats minutes with tabular HH:MM and floors to the shown minute', () => {
    expect(formatClock(hm(16, 5))).toBe('16:05');
    expect(formatClock(hm(17, 55))).toBe('17:55');
    expect(formatClock(hm(16, 39) + 0.99)).toBe('16:39');
  });

  it('runs 16:05 → 17:55 with markers where the reference places them', () => {
    expect(TIMELINE.start).toBe(hm(16, 5));
    expect(TIMELINE.end).toBe(hm(17, 55));
    const f = (m: number) => timeToFraction(TIMELINE.start, TIMELINE.end, m);
    // reference track: Pyrenees ≈ 31.7%, Sunset ≈ 63.6%, Paris ≈ 90.8%
    expect(f(hm(16, 40))).toBeCloseTo(0.318, 2);
    expect(f(hm(17, 15))).toBeCloseTo(0.636, 2);
    expect(f(hm(17, 45))).toBeCloseTo(0.909, 2);
    expect(fractionToTime(TIMELINE.start, TIMELINE.end, 2)).toBe(TIMELINE.end);
    expect(fractionToTime(TIMELINE.start, TIMELINE.end, -1)).toBe(TIMELINE.start);
  });
});

describe('flight phases (as observed in the reference)', () => {
  const cases: [number, string][] = [
    [hm(16, 5), 'Takeoff'],
    [hm(16, 10), 'Takeoff'],
    [hm(16, 15), 'Climb'],
    [hm(16, 21), 'Climb'],
    [hm(16, 28), 'Cruise'],
    [hm(17, 32), 'Cruise'],
    [hm(17, 37), 'Descent'],
    [hm(17, 44), 'Descent'],
    [hm(17, 46), 'Approach'],
    [hm(17, 53), 'Approach'],
    [hm(17, 54), 'Landing'],
    [hm(17, 55), 'Landing'],
  ];
  it.each(cases)('%i → %s', (m, phase) => expect(phaseAt(TIMELINE.phases, m)).toBe(phase));
});

describe('story beats (port side, seat 23A)', () => {
  it('shows the reference copy at the reference moments', () => {
    expect(textAt(hm(16, 5))).toBe('Barcelona and the sea');
    expect(textAt(hm(16, 21))).toBe('Barcelona and the sea');
    expect(textAt(hm(16, 40))).toBe('The Pyrenees on your left');
    expect(textAt(hm(17, 15))).toBe('Sunset right in your window');
    expect(textAt(hm(17, 37))).toBe('Blue hour over France');
    expect(textAt(hm(17, 45))).toBe('Paris lights on your left');
    expect(textAt(hm(17, 55))).toBe('Touchdown at CDG');
  });

  it('holds one image inside a beat and blends between beats', () => {
    expect(beatMixAt(port, hm(16, 40))).toEqual({ a: 1, b: 1, t: 0 });
    const mid = beatMixAt(port, hm(16, 29));
    expect(mid.a).toBe(0);
    expect(mid.b).toBe(1);
    expect(mid.t).toBeGreaterThan(0.3);
    expect(mid.t).toBeLessThan(0.7);
  });

  it('is a pure function of time, so scrubbing backwards matches scrubbing forwards', () => {
    const forward: unknown[] = [];
    for (let m = TIMELINE.start; m <= TIMELINE.end; m += 0.25) forward.push([beatMixAt(port, m), textBeatIndex(port, m)]);
    const backward: unknown[] = [];
    for (let m = TIMELINE.end; m >= TIMELINE.start - 1e-9; m -= 0.25) backward.unshift([beatMixAt(port, m), textBeatIndex(port, m)]);
    expect(backward).toEqual(forward);
  });

  it('blends monotonically without jumps', () => {
    let prev = { a: 0, b: 0, t: 0 };
    for (let m = TIMELINE.start; m <= TIMELINE.end; m += 0.1) {
      const cur = beatMixAt(port, m);
      const prevPos = prev.a + prev.t;
      const curPos = cur.a + cur.t;
      expect(curPos).toBeGreaterThanOrEqual(prevPos - 1e-9);
      expect(curPos - prevPos).toBeLessThan(0.12);
      prev = cur;
    }
  });

  it('keeps both sides in the same time ranges', () => {
    expect(BEATS.starboard.map((b) => b.hold)).toEqual(BEATS.port.map((b) => b.hold));
  });
});
