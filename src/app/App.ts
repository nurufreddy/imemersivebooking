import { BEATS, COPY, CURRENCY, ITINERARY, SEAT_BY_ID, TIMELINE } from '../config/demoFlight';
import type { SeatDef } from '../config/types';
import { shadePercent, windowFeedback } from '../logic/shade';
import { formatClock, phaseAt, textBeatIndex } from '../logic/timeline';
import { $, Announcer, prefersReducedMotion } from '../ui/dom';
import { SeatGrid, seatDescription } from '../ui/SeatGrid';
import { ShadeControl } from '../ui/ShadeControl';
import { HeaderUI, SheetUI, previewOpacity } from '../ui/Sheet';
import { TimelineControl } from '../ui/Timeline';
import type { AppState, StageLike } from './types';

const TAP_SLOP = 7;
const HINT_MS = 3800;
const NOTICE_MS = 4500;

interface DownState {
  id: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  lastT: number;
  dragging: boolean;
}

export class App {
  readonly state: AppState = {
    view: 'map',
    previewSeat: null,
    selectedSeat: null,
    confirmedSeat: null,
    notice: null,
    minutes: TIMELINE.start,
    shade: 0,
    shadeUsed: false,
    transitioning: false,
  };
  private stage!: StageLike;
  private readonly sheet: SheetUI;
  private readonly header: HeaderUI;
  private readonly timeline: TimelineControl;
  private readonly shadeCtl: ShadeControl;
  private readonly grid: SeatGrid;
  private readonly announcer: Announcer;
  private readonly hint: HTMLElement;
  private readonly focusLabel: HTMLElement;
  private readonly canvas: HTMLElement;
  private down: DownState | null = null;
  private keyboardEntry = false;
  private hintTimer = 0;
  private hintBeat: string | null = null;
  private noticeTimer = 0;
  private progress = 0;
  private lastFeedbackTitle = '';
  private readonly embedded = window.parent !== window;

  constructor(private readonly root: HTMLElement, interactionSurface: HTMLElement) {
    this.canvas = interactionSurface;
    this.sheet = new SheetUI(root);
    this.header = new HeaderUI(root, {
      long: ITINERARY.flightLabel,
      short: ITINERARY.flightLabelShort,
      route: `${ITINERARY.origin} → ${ITINERARY.destination}`,
      routeShort: `${ITINERARY.originCode} → ${ITINERARY.destinationCode}`,
      date: ITINERARY.date,
    });
    this.header.setTitles(COPY.mapTitle, '');
    this.announcer = new Announcer($('#announcer', root));
    this.hint = $('#hint', root);
    this.hint.textContent = COPY.shadeHint;
    this.focusLabel = $('#focus-label', root);

    this.timeline = new TimelineControl($('#timeline', root), $('#timeline-labels', root), {
      start: TIMELINE.start,
      end: TIMELINE.end,
      markers: TIMELINE.markers,
      onInput: (m) => this.setMinutes(m),
      onCommit: (m) => this.setMinutes(m),
      describe: (m) => this.describeTime(m),
    });

    this.shadeCtl = new ShadeControl($('#shade-handle', root), {
      onInput: (s) => this.setShade(s, false),
      onCommit: (s) => this.setShade(s, true),
    });

    this.grid = new SeatGrid($('#seat-grid', root), {
      onActivate: (id) => {
        this.keyboardEntry = true;
        this.activateSeat(id);
      },
      onFocusSeat: (id) => this.onGridFocus(id),
    });

    $('#back', root).addEventListener('click', () => this.back());
    $('#change-seat', root).addEventListener('click', () => this.back());
    $('#keep-wall', root).addEventListener('click', () => this.keep());
    $('#keep-window', root).addEventListener('click', () => this.keep());
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.state.view === 'preview') {
        e.preventDefault();
        this.keyboardEntry = true;
        this.back();
      }
    });

    const c = this.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onCancel);
    c.addEventListener('pointerleave', () => {
      if (!this.down) this.stage.setHover(null);
    });
    c.addEventListener('wheel', this.onWheel, { passive: false });

    this.refreshMapCopy();
    this.sheet.setTransition(0);
    this.header.setTransition(0);
  }

  /** Attach (or swap to) a stage implementation. */
  attach(stage: StageLike) {
    this.stage = stage;
    stage.setReducedMotion(prefersReducedMotion());
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => stage.setReducedMotion(e.matches));
    stage.setSeatStates(this.state.selectedSeat, this.state.confirmedSeat);
    stage.setTime(this.state.minutes);
    this.relayout();
  }

  /* ------------------------------ layout ------------------------------ */

  relayout() {
    if (!this.stage) return;
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    const headerBottom = Math.round($('#itinerary', this.root).getBoundingClientRect().bottom + 8);
    this.sheet.measure(h, headerBottom);
    // short landscape: the sheet is right-aligned (CSS) and the preview frames the space beside it
    const rect = this.sheet.el.getBoundingClientRect();
    const side = rect.right > w - 40 && rect.left > w * 0.3 && rect.width < w * 0.6;
    this.stage.setLayout({
      width: w,
      height: h,
      headerBottom,
      mapSheetTop: h - this.sheet.mapHeight,
      previewSheetTop: h - this.sheet.previewHeight,
      previewRight: side ? Math.round(rect.left - 12) : undefined,
    });
  }

  /* ------------------------------ map input ------------------------------ */

  private readonly onDown = (e: PointerEvent) => {
    if (this.state.view !== 'map' || !this.stage.mapInteractive) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.keyboardEntry = false;
    this.down = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), dragging: false };
    this.canvas.setPointerCapture(e.pointerId);
    if (e.pointerType !== 'mouse') {
      // immediate touch feedback on the seat under the finger
      const seat = this.stage.pick(e.clientX, e.clientY);
      this.stage.setHover(seat?.available ? seat.id : null);
    }
  };

  private readonly onMove = (e: PointerEvent) => {
    const d = this.down;
    if (d && e.pointerId === d.id) {
      const now = performance.now();
      if (!d.dragging && Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP && this.stage.canPan) {
        d.dragging = true;
        this.stage.beginDrag();
        this.stage.setHover(null);
        this.canvas.classList.add('is-grabbing');
      }
      if (d.dragging) this.stage.dragBy(e.clientX - d.lastX, e.clientY - d.lastY, (now - d.lastT) / 1000);
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      d.lastT = now;
      return;
    }
    if (e.pointerType === 'mouse' && this.state.view === 'map' && this.stage.mapInteractive) {
      const seat = this.stage.pick(e.clientX, e.clientY);
      this.stage.setHover(seat?.available ? seat.id : null);
      this.canvas.classList.toggle('is-pointer', !!seat?.available);
      this.canvas.classList.toggle('is-blocked', !!seat && !seat.available);
    }
  };

  private readonly onUp = (e: PointerEvent) => {
    const d = this.down;
    if (!d || e.pointerId !== d.id) return;
    this.down = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.canvas.classList.remove('is-grabbing');
    if (d.dragging) {
      this.stage.endDrag();
      return;
    }
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP) return;
    const seat = this.stage.pick(e.clientX, e.clientY);
    if (e.pointerType !== 'mouse') this.stage.setHover(null);
    if (seat) this.activateSeat(seat.id);
  };

  private readonly onCancel = (e: PointerEvent) => {
    if (!this.down || e.pointerId !== this.down.id) return;
    if (this.down.dragging) this.stage.endDrag();
    this.down = null;
    this.canvas.classList.remove('is-grabbing');
    this.stage.setHover(null);
  };

  private readonly onWheel = (e: WheelEvent) => {
    if (this.state.view !== 'map' || !this.stage.mapInteractive || !this.stage.canPan) return;
    e.preventDefault();
    this.stage.scrollBy(Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX);
  };

  private onGridFocus(id: string | null) {
    this.stage.setFocusSeat(id);
    if (id) this.stage.revealSeat(id);
    this.updateFocusLabel();
  }

  /* ------------------------------ actions ------------------------------ */

  activateSeat(id: string) {
    const s = this.state;
    if (s.view !== 'map' || !this.stage.mapInteractive) return;
    const seat = SEAT_BY_ID.get(id);
    if (!seat) return;
    if (!seat.available) return this.showNotice('taken', seat);
    if (seat.position !== 'window') return this.showNotice(seat.position === 'aisle' ? 'aisle' : 'middle', seat);

    window.clearTimeout(this.noticeTimer);
    s.notice = null;
    if (s.previewSeat !== id) {
      s.shade = 0;
    }
    s.selectedSeat = id;
    s.previewSeat = id;
    s.view = 'preview';
    s.transitioning = true;
    this.stage.setHover(null);
    this.stage.setFocusSeat(null);
    this.focusLabel.classList.remove('is-on');
    this.stage.setSeatStates(s.selectedSeat, s.confirmedSeat);
    this.grid.setStates(s.selectedSeat, s.confirmedSeat);
    this.grid.setEnabled(false);
    this.preparePreview(seat);
    this.stage.setShade(s.shade);
    this.shadeCtl.set(s.shade);
    this.stage.setTime(s.minutes);
    if (!this.stage.enterSeat(seat)) {
      // another flight is still resolving; stay on the map
      s.view = 'map';
      s.transitioning = false;
      this.grid.setEnabled(true);
      return;
    }
    this.header.setBackLabel('Back to seat map');
    this.root.dataset.view = 'preview';
  }

  private preparePreview(seat: SeatDef) {
    const confirmed = this.state.confirmedSeat === seat.id;
    this.header.setTitles(COPY.mapTitle, COPY.previewTitle(seat.id));
    if (seat.view === 'no-window') {
      this.sheet.setPreviewKind('wall');
      this.sheet.setWallSeat(seat, confirmed);
    } else {
      this.sheet.setPreviewKind('window');
      this.sheet.setWindowSeat(seat, confirmed);
      this.timeline.set(this.state.minutes);
      this.updateWindowCopy(true);
    }
    this.relayout();
  }

  back() {
    const s = this.state;
    if (s.view === 'preview') {
      s.view = 'map';
      s.transitioning = true;
      this.hideHint();
      this.stage.exitToMap();
      this.root.dataset.view = 'map';
      return;
    }
    if (!this.stage.mapInteractive) return;
    if (this.embedded) {
      window.parent.postMessage({ type: 'rwandair-seat-preview:back' }, '*');
      return;
    }
    // standalone: predictable reset to the overview
    window.clearTimeout(this.noticeTimer);
    s.notice = null;
    if (s.selectedSeat !== s.confirmedSeat) s.selectedSeat = null;
    this.stage.setSeatStates(s.selectedSeat, s.confirmedSeat);
    this.grid.setStates(s.selectedSeat, s.confirmedSeat);
    this.stage.resetMapView();
    this.refreshMapCopy();
    this.announcer.say('Seat map view reset');
  }

  keep() {
    const s = this.state;
    if (s.view !== 'preview' || !this.stage.settledPreview || !s.previewSeat) return;
    if (s.confirmedSeat === s.previewSeat) return; // no duplicate confirmations
    const seat = SEAT_BY_ID.get(s.previewSeat)!;
    s.confirmedSeat = seat.id;
    this.sheet.confirm(seat);
    this.stage.setSeatStates(s.selectedSeat, s.confirmedSeat);
    this.grid.setStates(s.selectedSeat, s.confirmedSeat);
    this.refreshMapCopy();
    this.announcer.say(`${COPY.confirmed(seat.id)}. Kept for this demo — no booking was made.`);
  }

  private showNotice(kind: 'aisle' | 'middle' | 'taken', seat: SeatDef) {
    this.state.notice = { kind, seat: seat.id };
    this.refreshMapCopy();
    const copy = kind === 'taken' ? COPY.takenNotice(seat.id) : kind === 'aisle' ? COPY.aisleNotice(seat.id) : COPY.middleNotice(seat.id);
    this.announcer.say(`${copy.title}. ${copy.detail}`);
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => {
      this.state.notice = null;
      this.refreshMapCopy();
    }, NOTICE_MS);
  }

  private refreshMapCopy() {
    const s = this.state;
    let copy = COPY.mapPrompt;
    let confirmed = false;
    if (s.notice) {
      const id = s.notice.seat;
      copy = s.notice.kind === 'taken' ? COPY.takenNotice(id) : s.notice.kind === 'aisle' ? COPY.aisleNotice(id) : COPY.middleNotice(id);
    } else if (s.confirmedSeat) {
      copy = COPY.confirmedNotice(s.confirmedSeat);
      confirmed = true;
    }
    this.sheet.setMapCopy(copy.title, copy.detail, confirmed);
  }

  /* ------------------------------ timeline & shade ------------------------------ */

  private currentSeat(): SeatDef | null {
    return this.state.previewSeat ? SEAT_BY_ID.get(this.state.previewSeat) ?? null : null;
  }

  private setMinutes(m: number) {
    this.state.minutes = m;
    this.stage.setTime(m);
    this.updateWindowCopy(false);
  }

  private setShade(s: number, commit: boolean) {
    const st = this.state;
    st.shade = s;
    if (!st.shadeUsed && s > 0.015) {
      st.shadeUsed = true;
      this.hideHint();
    }
    this.stage.setShade(s);
    this.shadeCtl.set(s);
    this.updateWindowCopy(false);
    if (commit) {
      const seat = this.currentSeat();
      if (seat && seat.view !== 'no-window') {
        const beats = BEATS[seat.side];
        const fb = windowFeedback(beats[textBeatIndex(beats, st.minutes)], s);
        if (fb.title !== this.lastFeedbackTitle) this.announcer.say(`${fb.title}. ${fb.detail}`);
        this.lastFeedbackTitle = fb.title;
      }
    }
  }

  private describeTime(m: number) {
    const seat = this.currentSeat();
    const side = seat?.side ?? 'port';
    const beats = BEATS[side];
    const b = beats[textBeatIndex(beats, m)];
    return `${formatClock(m)}, ${phaseAt(TIMELINE.phases, m)}. ${b.title}`;
  }

  private updateWindowCopy(instant: boolean) {
    const seat = this.currentSeat();
    if (!seat || seat.view === 'no-window') {
      this.applyInk();
      return;
    }
    const m = this.state.minutes;
    const beats = BEATS[seat.side];
    const beat = beats[textBeatIndex(beats, m)];
    this.sheet.setClock(formatClock(m), phaseAt(TIMELINE.phases, m));
    const fb = windowFeedback(beat, this.state.shade);
    this.sheet.setFeedback(fb, beat.dot, instant);
    this.applyInk();
    this.updateHint(beat.id, !!beat.sun);
  }

  /** Header text turns light over night scenes once the preview is on screen. */
  private applyInk() {
    const seat = this.currentSeat();
    let ink: 'dark' | 'light' = 'dark';
    if (seat && seat.view !== 'no-window' && this.state.view === 'preview' && previewOpacity(this.progress) > 0.5) {
      const beats = BEATS[seat.side];
      ink = beats[textBeatIndex(beats, this.state.minutes)].ink;
    }
    if (this.root.dataset.ink !== ink) this.root.dataset.ink = ink;
  }

  /* ------------------------------ hint ------------------------------ */

  private updateHint(beatId: string, hasSun: boolean) {
    if (this.state.shadeUsed || !hasSun) {
      if (!hasSun) this.hintBeat = null;
      this.hideHint();
      return;
    }
    if (!this.stage.settledPreview || this.hintBeat === beatId) return;
    this.hintBeat = beatId;
    window.clearTimeout(this.hintTimer);
    this.hint.classList.add('is-on');
    this.positionOverlays();
    this.hintTimer = window.setTimeout(() => this.hideHint(), HINT_MS);
  }

  private hideHint() {
    window.clearTimeout(this.hintTimer);
    this.hint.classList.remove('is-on');
  }

  /* ------------------------------ stage events ------------------------------ */

  onProgress(p: number) {
    this.progress = p;
    this.state.transitioning = p > 0 && p < 1;
    this.sheet.setTransition(p);
    this.header.setTransition(p);
    this.applyInk();
    if (p > 0 && p < 1) {
      this.hideHint();
      this.shadeCtl.position(null);
    }
  }

  onSettled(view: 'map' | 'preview') {
    const s = this.state;
    s.transitioning = false;
    const seat = this.currentSeat();
    if (view === 'preview' && seat) {
      if (seat.view === 'no-window') {
        this.announcer.say(`Seat ${seat.id}. ${COPY.noWindow.soldAs}. ${COPY.noWindow.title}: ${COPY.noWindow.detail.toLowerCase()}. ${COPY.noWindow.keep(seat.id, CURRENCY.format(seat.price))}.`);
      } else {
        const beats = BEATS[seat.side];
        const fb = windowFeedback(beats[textBeatIndex(beats, s.minutes)], s.shade);
        this.lastFeedbackTitle = fb.title;
        this.announcer.say(`Window view, seat ${seat.id}. ${formatClock(s.minutes)}, ${phaseAt(TIMELINE.phases, s.minutes)}. ${fb.title}. ${fb.detail}.`);
        this.hintBeat = null;
        this.updateWindowCopy(false);
      }
      if (this.keyboardEntry) this.sheet.focusPrimary();
    } else if (view === 'map') {
      this.header.setBackLabel(this.embedded ? 'Back' : 'Reset seat map view');
      this.grid.setEnabled(true);
      this.refreshMapCopy();
      const sel = s.selectedSeat ? SEAT_BY_ID.get(s.selectedSeat) : null;
      this.announcer.say(`Seat map.${sel ? ` ${seatDescription(sel, { selected: true, confirmed: sel.id === s.confirmedSeat })}.` : ''}`);
      if (this.keyboardEntry && s.previewSeat) this.grid.focusSeat(s.previewSeat);
    }
    this.applyInk();
    this.positionOverlays();
  }

  /** Re-anchor DOM overlays to the 3D scene after each rendered frame. */
  positionOverlays() {
    if (!this.stage) return;
    const info = this.state.view === 'preview' ? this.stage.shadeHandle() : null;
    this.shadeCtl.position(info);
    const anchor = this.stage.hintAnchor();
    if (anchor && this.hint.classList.contains('is-on')) {
      this.hint.style.left = `${anchor.x}px`;
      this.hint.style.top = `${anchor.y - 20}px`;
    }
    this.updateFocusLabel();
  }

  private updateFocusLabel() {
    const id = this.grid.focusedSeat;
    if (!id || this.state.view !== 'map') {
      this.focusLabel.classList.remove('is-on');
      return;
    }
    const seat = SEAT_BY_ID.get(id)!;
    const pos = this.stage.seatScreen(id);
    if (!pos) return;
    const kind = seat.position === 'window' ? (seat.view === 'no-window' ? 'Window · no window' : 'Window') : seat.position === 'aisle' ? 'Aisle' : 'Middle';
    const text = `${seat.id} · ${kind} · ${seat.available ? CURRENCY.format(seat.price) : 'Taken'}`;
    if (this.focusLabel.textContent !== text) this.focusLabel.textContent = text;
    this.focusLabel.style.left = `${pos.x}px`;
    this.focusLabel.style.top = `${pos.y}px`;
    this.focusLabel.classList.add('is-on');
  }

  /** Debug summary used by automated checks. */
  snapshot() {
    return { ...this.state, shadePct: shadePercent(this.state.shade), progress: this.progress };
  }
}
