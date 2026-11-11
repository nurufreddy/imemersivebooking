import type { TimelineMarker } from '../config/types';
import { clamp, fractionToTime, timeToFraction } from '../logic/timeline';

export interface TimelineOptions {
  start: number;
  end: number;
  markers: TimelineMarker[];
  /** Continuous updates while dragging or stepping. */
  onInput(minutes: number): void;
  /** Pointer released or keyboard step finished. */
  onCommit(minutes: number): void;
  /** Text for aria-valuetext, e.g. "16:40, Cruise, The Pyrenees on your left". */
  describe(minutes: number): string;
}

/** Thin flight-timeline slider: drag, click the track, or use the keyboard. */
export class TimelineControl {
  private value: number;
  private pointerId: number | null = null;
  private readonly thumb: HTMLElement;

  constructor(private readonly el: HTMLElement, labelsEl: HTMLElement, private readonly o: TimelineOptions) {
    this.value = o.start;
    this.thumb = el.querySelector<HTMLElement>('.thumb')!;
    const track = el.querySelector<HTMLElement>('.track')!;
    el.setAttribute('aria-valuemin', '0');
    el.setAttribute('aria-valuemax', String(Math.round(o.end - o.start)));

    const fractions = [...o.markers.map((m) => timeToFraction(o.start, o.end, m.minutes)), 1];
    for (const f of fractions) {
      const tick = document.createElement('span');
      tick.className = 'tick';
      tick.style.left = `${f * 100}%`;
      track.appendChild(tick);
    }
    labelsEl.textContent = '';
    o.markers.forEach((m, i) => {
      const span = document.createElement('span');
      span.textContent = m.label;
      const f = timeToFraction(o.start, o.end, m.minutes);
      span.style.left = i === 0 ? '10px' : `${f * 100}%`;
      labelsEl.appendChild(span);
    });

    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('lostpointercapture', this.onLost);
    el.addEventListener('keydown', this.onKey);
    this.render();
    this.updateAria(true);
  }

  get minutes() {
    return this.value;
  }

  /** Set from the outside (no events emitted). */
  set(minutes: number) {
    this.value = clamp(minutes, this.o.start, this.o.end);
    this.render();
    this.updateAria(this.pointerId === null);
  }

  private render() {
    const f = timeToFraction(this.o.start, this.o.end, this.value);
    this.thumb.style.left = `${f * 100}%`;
  }

  private updateAria(withText: boolean) {
    this.el.setAttribute('aria-valuenow', String(Math.round(this.value - this.o.start)));
    if (withText) this.el.setAttribute('aria-valuetext', this.o.describe(this.value));
  }

  private fromClientX(x: number) {
    const r = this.el.getBoundingClientRect();
    return fractionToTime(this.o.start, this.o.end, (x - r.left) / Math.max(1, r.width));
  }

  private emit(minutes: number) {
    const v = clamp(minutes, this.o.start, this.o.end);
    if (v === this.value) return;
    this.value = v;
    this.render();
    this.updateAria(this.pointerId === null);
    this.o.onInput(v);
  }

  private readonly onDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.el.setPointerCapture(e.pointerId);
    this.el.classList.add('is-active');
    e.preventDefault();
    this.el.focus({ preventScroll: true });
    this.emit(this.fromClientX(e.clientX));
  };

  private readonly onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.emit(this.fromClientX(e.clientX));
  };

  private readonly onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.release();
  };

  private readonly onLost = (e: PointerEvent) => {
    if (e.pointerId === this.pointerId) this.release();
  };

  private release() {
    if (this.pointerId !== null && this.el.hasPointerCapture(this.pointerId)) this.el.releasePointerCapture(this.pointerId);
    this.pointerId = null;
    this.el.classList.remove('is-active');
    this.updateAria(true);
    this.o.onCommit(this.value);
  }

  private readonly onKey = (e: KeyboardEvent) => {
    const big = e.shiftKey ? 5 : 1;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = Math.floor(this.value + 1e-6) + big;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = Math.ceil(this.value - 1e-6) - big;
        break;
      case 'PageUp':
        next = this.value + 10;
        break;
      case 'PageDown':
        next = this.value - 10;
        break;
      case 'Home':
        next = this.o.start;
        break;
      case 'End':
        next = this.o.end;
        break;
      default:
        return;
    }
    e.preventDefault();
    this.emit(next);
    this.updateAria(true);
    this.o.onCommit(this.value);
  };
}
