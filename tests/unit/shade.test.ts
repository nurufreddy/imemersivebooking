import { describe, expect, it } from 'vitest';
import { BEATS } from '../../src/config/demoFlight';
import { feedbackFamily, shadePercent, sunHidden, windowFeedback } from '../../src/logic/shade';

const sunset = BEATS.port.find((b) => b.id === 'sunset')!;
const pyrenees = BEATS.port.find((b) => b.id === 'pyrenees')!;

describe('shade feedback', () => {
  it('keeps the scene copy while the shade is open', () => {
    const fb = windowFeedback(sunset, 0);
    expect(fb.title).toBe('Sunset right in your window');
    expect(fb.detail).toBe('Bright glare 16:55–17:20');
  });

  it('matches the reference at ~70% during sunset', () => {
    const fb = windowFeedback(sunset, 0.7);
    expect(fb.title).toBe('Sunset, without the glare');
    expect(fb.detail).toBe('Shade at 70% · sun hidden');
  });

  it('is computed from the real position, not a fixed claim', () => {
    expect(sunHidden(sunset, 0.2)).toBe(false);
    const partial = windowFeedback(sunset, 0.2);
    expect(partial.title).toBe('Sunset right in your window');
    expect(partial.detail).toBe('Shade at 20% · sun still in view');
    expect(windowFeedback(sunset, 0.55).detail).toBe('Shade at 55% · sun hidden');
    expect(windowFeedback(sunset, 1).title).toBe('Shade closed');
  });

  it('restores the sunset copy when the shade rises again', () => {
    expect(windowFeedback(sunset, 0.7).title).toBe('Sunset, without the glare');
    expect(windowFeedback(sunset, 0.02).title).toBe('Sunset right in your window');
  });

  it('describes partial cover for scenes without the sun', () => {
    expect(windowFeedback(pyrenees, 0.5).detail).toBe('Shade at 50% · view partly covered');
    expect(windowFeedback(pyrenees, 1).detail).toBe('Raise it to see the Pyrenees');
  });

  it('rounds the percentage to 5% steps and groups message families', () => {
    expect(shadePercent(0.68)).toBe(70);
    expect(shadePercent(0.71)).toBe(70);
    expect(feedbackFamily(windowFeedback(sunset, 0.6).key)).toBe(feedbackFamily(windowFeedback(sunset, 0.8).key));
    expect(feedbackFamily(windowFeedback(sunset, 0.1).key)).not.toBe(feedbackFamily(windowFeedback(sunset, 0.8).key));
  });

  it('never claims a sun on the side that cannot see it', () => {
    for (const beat of BEATS.starboard) expect(beat.sun).toBeUndefined();
  });
});
