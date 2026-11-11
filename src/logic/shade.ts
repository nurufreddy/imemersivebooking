import type { Beat } from '../config/types';

/** Below this the shade counts as open. */
export const SHADE_OPEN = 0.06;
/** Above this the shade counts as closed. */
export const SHADE_CLOSED = 0.97;

export interface Feedback {
  /** Stable key so the UI only cross-fades when the message really changes. */
  key: string;
  title: string;
  detail: string;
}

export const shadePercent = (shade: number) => Math.round(shade * 20) * 5;

/** True when the shade's lower edge is below the sun disc (both measured from the top of the opening). */
export function sunHidden(beat: Beat, shade: number): boolean {
  if (!beat.sun) return false;
  return shade >= beat.sun.y + beat.sun.radius;
}

/**
 * Copy for the window sheet, derived from the scene on screen and the real shade position.
 * The reference states: at ~70% during sunset → "Sunset, without the glare · Shade at 70% · sun hidden".
 */
export function windowFeedback(beat: Beat, shade: number): Feedback {
  const pct = shadePercent(shade);
  if (shade < SHADE_OPEN) return { key: `${beat.id}:open`, title: beat.title, detail: beat.detail };

  if (shade >= SHADE_CLOSED) {
    return beat.sun
      ? { key: `${beat.id}:closed`, title: 'Shade closed', detail: 'Glare blocked · raise it to see the sunset' }
      : { key: `${beat.id}:closed`, title: 'Shade closed', detail: `Raise it to see ${beat.label}` };
  }

  if (beat.sun) {
    return sunHidden(beat, shade)
      ? { key: `${beat.id}:hidden:${pct}`, title: 'Sunset, without the glare', detail: `Shade at ${pct}% · sun hidden` }
      : { key: `${beat.id}:partial:${pct}`, title: beat.title, detail: `Shade at ${pct}% · sun still in view` };
  }

  return { key: `${beat.id}:partial:${pct}`, title: beat.title, detail: `Shade at ${pct}% · view partly covered` };
}

/** Whether the message family changed (ignores percentage-only changes, which update in place). */
export const feedbackFamily = (key: string) => key.split(':').slice(0, 2).join(':');
