import type { ShadeHandleInfo } from '../app/types';
import { clamp } from '../logic/timeline';
import { shadePercent } from '../logic/shade';

export interface ShadeOptions {
  onInput(shade: number): void;
  onCommit(shade: number): void;
}

/**
 * Invisible, focusable grab area that sits exactly on the 3D shade's handle.
 * Pointer capture keeps the drag stable if the finger leaves the handle.
 */
export class ShadeControl {
  private value = 0;
  private pointerId: number | null = null;
  private grabOffset = 0;
  private info: ShadeHandleInfo | null = null;

  constructor(private readonly el: HTMLElement, private readonly o: ShadeOptions) {
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('lostpointercapture', this.onLost);
    el.addEventListener('keydown', this.onKey);
  }

  get dragging() {
    return this.pointerId !== null;
  }

  set(shade: number) {
    this.value = clamp(shade, 0, 1);
    this.updateAria();
  }

  /** Place over the projected handle, or hide when the window is not on screen. */
  position(info: ShadeHandleInfo | null) {
    this.info = info;
    if (!info) {
      if (!this.el.hidden) this.el.hidden = true;
      this.el.tabIndex = -1;
      return;
    }
    if (this.el.hidden) this.el.hidden = false;
    this.el.tabIndex = 0;
    const w = Math.max(96, Math.min(220, info.width * 0.86));
    this.el.style.width = `${w}px`;
    this.el.style.marginLeft = `${-w / 2}px`;
    this.el.style.transform = `translate3d(${info.x}px, ${info.y}px, 0)`;
  }

  private updateAria() {
    const pct = shadePercent(this.value);
    this.el.setAttribute('aria-valuenow', String(pct));
    this.el.setAttribute('aria-valuetext', pct <= 0 ? 'Shade open' : pct >= 100 ? 'Shade closed' : `Shade ${pct}% closed`);
  }

  private fromClientY(y: number) {
    if (!this.info) return this.value;
    const span = this.info.yClosed - this.info.yOpen;
    if (Math.abs(span) < 1) return this.value;
    return clamp((y - this.grabOffset - this.info.yOpen) / span, 0, 1);
  }

  private emit(v: number) {
    if (v === this.value) return;
    this.value = v;
    this.o.onInput(v);
  }

  private readonly onDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.pointerId !== null || !this.info) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.el.setPointerCapture(e.pointerId);
    this.grabOffset = e.clientY - this.info.y;
    this.el.classList.add('is-dragging');
  };

  private readonly onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.emit(this.fromClientY(e.clientY));
  };

  private readonly onUp = (e: PointerEvent) => {
    if (e.pointerId === this.pointerId) this.release();
  };

  private readonly onLost = (e: PointerEvent) => {
    if (e.pointerId === this.pointerId) this.release();
  };

  private release() {
    if (this.pointerId !== null && this.el.hasPointerCapture(this.pointerId)) this.el.releasePointerCapture(this.pointerId);
    this.pointerId = null;
    this.el.classList.remove('is-dragging');
    this.updateAria();
    this.o.onCommit(this.value);
  }

  private readonly onKey = (e: KeyboardEvent) => {
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowDown':
        next = this.value + 0.1;
        break;
      case 'ArrowUp':
        next = this.value - 0.1;
        break;
      case 'PageDown':
        next = this.value + 0.25;
        break;
      case 'PageUp':
        next = this.value - 0.25;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = 1;
        break;
      case 'Enter':
      case ' ':
        next = this.value > 0.5 ? 0 : 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    this.emit(clamp(Math.round(next * 20) / 20, 0, 1));
    this.updateAria();
    this.o.onCommit(this.value);
  };
}
