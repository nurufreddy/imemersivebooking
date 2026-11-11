import type { Beat, Phase } from '../config/types';

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** "16:05" from minutes after midnight (floored to the displayed minute). */
export function formatClock(minutes: number): string {
  const m = Math.floor(minutes + 1e-6);
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function phaseAt(phases: Phase[], minutes: number): string {
  for (const p of phases) if (minutes < p.until) return p.name;
  return phases[phases.length - 1].name;
}

export interface BeatMix {
  /** Index of the beat being blended from. */
  a: number;
  /** Index of the beat being blended to (equals `a` inside a hold range). */
  b: number;
  /** 0 → fully `a`, 1 → fully `b`. */
  t: number;
}

/** Which two beats are on screen at a moment, and how far the blend between them has progressed. */
export function beatMixAt(beats: Beat[], minutes: number): BeatMix {
  if (minutes <= beats[0].hold[1]) return { a: 0, b: 0, t: 0 };
  for (let i = 0; i < beats.length - 1; i++) {
    const cur = beats[i];
    const next = beats[i + 1];
    if (minutes <= cur.hold[1]) return { a: i, b: i, t: 0 };
    if (minutes < next.hold[0]) {
      return { a: i, b: i + 1, t: smoothstep(cur.hold[1], next.hold[0], minutes) };
    }
  }
  const last = beats.length - 1;
  return { a: last, b: last, t: 0 };
}

/** Beat whose copy is shown: copy switches half-way through each blend. */
export function textBeatIndex(beats: Beat[], minutes: number): number {
  const mix = beatMixAt(beats, minutes);
  if (mix.a === mix.b) return mix.a;
  const mid = (beats[mix.a].hold[1] + beats[mix.b].hold[0]) / 2;
  return minutes < mid ? mix.a : mix.b;
}

/** Normalised position (0..1) of a time on the timeline track. */
export function timeToFraction(start: number, end: number, minutes: number): number {
  return clamp((minutes - start) / (end - start), 0, 1);
}

export function fractionToTime(start: number, end: number, f: number): number {
  return start + clamp(f, 0, 1) * (end - start);
}
