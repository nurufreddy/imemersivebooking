import { BEATS, CABIN, SCENERY, SEATS, SEAT_BY_ID } from '../config/demoFlight';
import type { SeatDef } from '../config/types';
import type { ShadeHandleInfo, StageLayout, StageLike } from '../app/types';
import { beatMixAt, clamp } from '../logic/timeline';

const BASE = import.meta.env.BASE_URL;

interface Events {
  onProgress(p: number, target: 0 | 1): void;
  onSettled(view: 'map' | 'preview'): void;
  onFrame(): void;
}

/**
 * DOM-only stage used when WebGL is unavailable: a scrollable seat map and a
 * simple window (photo + shade) driven by the same controller and state.
 */
export class FallbackStage implements StageLike {
  private readonly mapEl: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly glass: HTMLElement;
  private readonly imgA: HTMLImageElement;
  private readonly imgB: HTMLImageElement;
  private readonly shadeEl: HTMLElement;
  private readonly windowEl: HTMLElement;
  private readonly wallEl: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private seat: SeatDef | null = null;
  private p = 0;
  private target: 0 | 1 = 0;
  private raf = 0;
  private last = 0;
  private minutes = 0;
  private shade = 0;
  private layout: StageLayout | null = null;

  constructor(private readonly root: HTMLElement, private readonly events: Events) {
    root.hidden = false;
    root.innerHTML = '';
    this.mapEl = document.createElement('div');
    this.mapEl.className = 'fb-map';
    const fus = document.createElement('div');
    fus.className = 'fb-fuselage';
    for (let row = 1; row <= CABIN.rows; row++) {
      const r = document.createElement('div');
      r.className = 'fb-row';
      SEATS.filter((s) => s.row === row).forEach((s, i) => {
        if (i === 3) {
          const n = document.createElement('span');
          n.className = 'num';
          n.textContent = String(row);
          r.appendChild(n);
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'fb-seat' + (s.available ? '' : ' is-taken');
        b.dataset.seat = s.id;
        b.tabIndex = -1;
        b.setAttribute('aria-hidden', 'true');
        this.buttons.set(s.id, b);
        r.appendChild(b);
      });
      fus.appendChild(r);
    }
    this.mapEl.appendChild(fus);
    root.appendChild(this.mapEl);

    this.preview = document.createElement('div');
    this.preview.className = 'fb-preview';
    this.preview.hidden = true;
    this.windowEl = document.createElement('div');
    this.windowEl.className = 'fb-window';
    this.glass = document.createElement('div');
    this.glass.className = 'fb-glass';
    this.imgA = new Image();
    this.imgB = new Image();
    this.imgA.alt = this.imgB.alt = '';
    this.shadeEl = document.createElement('div');
    this.shadeEl.className = 'fb-shade';
    this.glass.append(this.imgA, this.imgB, this.shadeEl);
    this.windowEl.appendChild(this.glass);
    this.wallEl = document.createElement('div');
    this.wallEl.className = 'fb-wall';
    this.preview.append(this.windowEl, this.wallEl);
    root.appendChild(this.preview);
  }

  setLayout(l: StageLayout) {
    this.layout = l;
    this.mapEl.style.paddingTop = `${l.headerBottom + 12}px`;
    this.mapEl.style.paddingBottom = `${l.height - l.mapSheetTop + 40}px`;
    this.preview.style.paddingBottom = `${l.height - l.previewSheetTop}px`;
    this.events.onFrame();
  }

  setReducedMotion() {}

  setSeatStates(selected: string | null, confirmed: string | null) {
    for (const [id, b] of this.buttons) b.classList.toggle('is-selected', id === selected || id === confirmed);
  }

  setHover() {}

  setFocusSeat(id: string | null) {
    if (id) this.revealSeat(id);
  }

  pick(clientX: number, clientY: number): SeatDef | null {
    if (!this.mapInteractive) return null;
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const id = el?.closest<HTMLElement>('[data-seat]')?.dataset.seat;
    return id ? SEAT_BY_ID.get(id) ?? null : null;
  }

  beginDrag() {}
  dragBy(_dx: number, dy: number) {
    this.root.scrollTop -= dy;
  }
  endDrag() {}
  scrollBy(px: number) {
    this.root.scrollTop += px;
  }
  resetMapView() {
    this.root.scrollTo({ top: 0, behavior: 'smooth' });
  }
  revealSeat(id: string) {
    this.buttons.get(id)?.scrollIntoView({ block: 'nearest' });
  }

  seatScreen(id: string) {
    const r = this.buttons.get(id)?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top } : null;
  }

  enterSeat(seat: SeatDef) {
    if (this.p > 0 && this.seat && this.seat.id !== seat.id) return false;
    this.seat = seat;
    this.windowEl.hidden = seat.view === 'no-window';
    this.wallEl.hidden = seat.view !== 'no-window';
    this.setTime(this.minutes);
    this.go(1);
    return true;
  }

  exitToMap() {
    this.go(0);
  }

  private go(t: 0 | 1) {
    this.target = t;
    this.preview.hidden = false;
    this.events.onProgress(this.p, t);
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number) => {
    this.raf = 0;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    this.p = this.target ? Math.min(1, this.p + dt / 0.35) : Math.max(0, this.p - dt / 0.3);
    this.preview.style.opacity = String(this.p);
    this.mapEl.style.opacity = String(1 - this.p);
    this.events.onProgress(this.p, this.target);
    if (this.p === this.target) {
      this.last = 0;
      this.preview.hidden = this.target === 0;
      this.events.onSettled(this.target ? 'preview' : 'map');
      this.events.onFrame();
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  setTime(minutes: number) {
    this.minutes = minutes;
    const seat = this.seat;
    if (!seat || seat.view === 'no-window') return;
    const beats = BEATS[seat.side];
    const mix = beatMixAt(beats, minutes);
    const a = SCENERY[beats[mix.a].imageId];
    const b = SCENERY[beats[mix.b].imageId];
    if (this.imgA.dataset.src !== a.src) {
      this.imgA.src = BASE + a.src;
      this.imgA.dataset.src = a.src;
    }
    if (this.imgB.dataset.src !== b.src) {
      this.imgB.src = BASE + b.src;
      this.imgB.dataset.src = b.src;
    }
    this.imgB.style.opacity = String(mix.t);
    this.preview.style.backgroundColor = beats[mix.t < 0.5 ? mix.a : mix.b].ink === 'light' ? '#474a59' : '#b7b0a8';
  }

  setShade(s: number) {
    this.shade = clamp(s, 0, 1);
    this.shadeEl.style.height = `${this.shade * 100}%`;
    this.events.onFrame();
  }

  shadeHandle(): ShadeHandleInfo | null {
    if (!this.settledPreview || !this.seat || this.seat.view === 'no-window') return null;
    const r = this.glass.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + this.shade * r.height, yOpen: r.top, yClosed: r.bottom, width: r.width };
  }

  hintAnchor() {
    if (!this.settledPreview) return null;
    const r = this.glass.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + 6 };
  }

  preloadFor() {}

  get mapInteractive() {
    return this.p === 0 && this.target === 0;
  }
  get settledPreview() {
    return this.p === 1 && this.target === 1;
  }
  get canPan() {
    return true;
  }
  get progress() {
    return this.p;
  }

  /** Unused layout accessor kept for parity with the WebGL stage. */
  get currentLayout() {
    return this.layout;
  }
}
