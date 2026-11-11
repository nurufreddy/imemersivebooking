import { COPY, CURRENCY } from '../config/demoFlight';
import type { SeatDef } from '../config/types';
import type { Feedback } from '../logic/shade';
import { feedbackFamily } from '../logic/shade';
import { smoothstep } from '../logic/timeline';
import { $ } from './dom';

export type PreviewKind = 'wall' | 'window';

/** Map content fades out early, preview content fades in late; both are functions of the same flight progress. */
export const mapOpacity = (p: number) => 1 - smoothstep(0.02, 0.26, p);
export const previewOpacity = (p: number) => smoothstep(0.76, 0.99, p);
const heightMix = (p: number) => smoothstep(0.18, 0.8, p);

export class SheetUI {
  readonly el: HTMLElement;
  private readonly paneMap: HTMLElement;
  private readonly paneWall: HTMLElement;
  private readonly paneWindow: HTMLElement;
  private readonly feedbackLayers: HTMLElement[];
  private activeLayer = 0;
  private feedbackKey = '';
  private kind: PreviewKind = 'window';
  private mapH = 123;
  private previewH = 260;
  private sheetH = 260;
  private progress = 0;
  private confirmTimer = 0;

  constructor(root: HTMLElement) {
    this.el = $('#sheet', root);
    this.paneMap = $('#pane-map', root);
    this.paneWall = $('#pane-wall', root);
    this.paneWindow = $('#pane-window', root);
    this.feedbackLayers = [...this.paneWindow.querySelectorAll<HTMLElement>('.fb')];
  }

  get mapHeight() {
    return this.mapH;
  }
  get previewHeight() {
    return this.previewH;
  }

  /** Measure natural pane heights (call on resize / font load). */
  measure(viewportH: number, headerBottom: number) {
    const panes = [this.paneMap, this.paneWall, this.paneWindow];
    const prev = panes.map((p) => ({ hidden: p.hidden, vis: p.style.visibility }));
    for (const p of panes) {
      p.hidden = false;
      p.style.visibility = 'hidden';
      p.classList.remove('is-scroll');
      p.style.height = '';
    }
    this.mapH = Math.ceil(this.paneMap.offsetHeight);
    const natural = Math.ceil(Math.max(this.paneWall.offsetHeight, this.paneWindow.offsetHeight));
    panes.forEach((p, i) => {
      p.hidden = prev[i].hidden;
      p.style.visibility = prev[i].vis;
    });
    // never let the controls take over the stage: keep ≥ ~100px of scene visible
    const maxPreview = Math.max(200, viewportH - headerBottom - 96);
    this.previewH = Math.min(natural, maxPreview);
    for (const p of [this.paneWall, this.paneWindow]) {
      const scroll = natural > maxPreview;
      p.classList.toggle('is-scroll', scroll);
      p.style.height = scroll ? `${this.previewH}px` : '';
    }
    this.mapH = Math.min(this.mapH, Math.max(110, viewportH * 0.4));
    this.sheetH = Math.max(this.mapH, this.previewH);
    this.el.style.height = `${this.sheetH}px`;
    this.setTransition(this.progress);
  }

  /** Choose which preview pane the flight reveals. */
  setPreviewKind(kind: PreviewKind) {
    this.kind = kind;
    this.applyVisibility();
  }

  private applyVisibility() {
    const p = this.progress;
    this.paneMap.hidden = p >= 0.999;
    this.paneWall.hidden = !(this.kind === 'wall' && p > 0.001);
    this.paneWindow.hidden = !(this.kind === 'window' && p > 0.001);
  }

  /** Drive content fades and the sheet height from flight progress (0 map → 1 preview). */
  setTransition(p: number) {
    this.progress = p;
    this.applyVisibility();
    const mo = mapOpacity(p);
    const po = previewOpacity(p);
    this.paneMap.style.opacity = String(mo);
    this.paneMap.style.filter = mo > 0.001 && mo < 0.999 ? `blur(${(1 - mo) * 3}px)` : '';
    const pane = this.kind === 'wall' ? this.paneWall : this.paneWindow;
    pane.style.opacity = String(po);
    pane.style.filter = po > 0.001 && po < 0.999 ? `blur(${(1 - po) * 5}px)` : '';
    const visible = this.mapH + (this.previewH - this.mapH) * heightMix(p);
    this.el.style.translate = `0 ${this.sheetH - visible}px`;
    const settled = p === 0 || p === 1;
    this.el.style.pointerEvents = settled ? '' : 'none';
    this.paneMap.toggleAttribute('inert', p > 0);
    this.paneWall.toggleAttribute('inert', p < 1 || this.kind !== 'wall');
    this.paneWindow.toggleAttribute('inert', p < 1 || this.kind !== 'window');
  }

  /* ------------------------------ map pane ------------------------------ */

  setMapCopy(title: string, detail: string, confirmed: boolean) {
    $('#map-title', this.paneMap).textContent = title;
    $('#map-detail', this.paneMap).textContent = detail;
    this.paneMap.classList.toggle('is-confirmed', confirmed);
  }

  /* ------------------------------ wall pane (11A) ------------------------------ */

  setWallSeat(seat: SeatDef, confirmed: boolean) {
    $('#wall-seat', this.paneWall).textContent = seat.id;
    $('#wall-soldas', this.paneWall).textContent = COPY.noWindow.soldAs;
    $('#wall-title', this.paneWall).textContent = COPY.noWindow.title;
    $('#wall-detail', this.paneWall).textContent = COPY.noWindow.detail;
    $('#change-seat', this.paneWall).textContent = COPY.noWindow.change;
    $('#keep-wall-label', this.paneWall).textContent = COPY.noWindow.keep(seat.id, CURRENCY.format(seat.price));
    this.setConfirmed($('#keep-wall', this.paneWall), seat, confirmed, false);
  }

  /* ------------------------------ window pane (23A) ------------------------------ */

  setWindowSeat(seat: SeatDef, confirmed: boolean) {
    $('#keep-window-label', this.paneWindow).textContent = COPY.keepSeat(seat.id);
    $('#keep-window-price', this.paneWindow).textContent = CURRENCY.format(seat.price);
    this.setConfirmed($('#keep-window', this.paneWindow), seat, confirmed, false);
    this.feedbackKey = '';
  }

  setClock(clock: string, phase: string) {
    const c = $('#clock', this.paneWindow);
    if (c.textContent !== clock) c.textContent = clock;
    const ph = $('#phase', this.paneWindow);
    if (ph.textContent !== phase) ph.textContent = phase;
  }

  /** Cross-fade the description when its meaning changes; update in place when only the % changes. */
  setFeedback(fb: Feedback, dot: string, instant = false) {
    if (fb.key === this.feedbackKey) return;
    const sameFamily = this.feedbackKey && feedbackFamily(fb.key) === feedbackFamily(this.feedbackKey);
    this.feedbackKey = fb.key;
    const fill = (layer: HTMLElement) => {
      layer.querySelector('.headline')!.textContent = fb.title;
      layer.querySelector('.txt')!.textContent = fb.detail;
      (layer.querySelector('.dot') as HTMLElement).style.backgroundColor = dot;
    };
    if (sameFamily || instant) {
      fill(this.feedbackLayers[this.activeLayer]);
      if (instant) this.feedbackLayers.forEach((l, i) => l.classList.toggle('is-on', i === this.activeLayer));
      return;
    }
    const next = 1 - this.activeLayer;
    fill(this.feedbackLayers[next]);
    this.feedbackLayers[next].classList.add('is-on');
    this.feedbackLayers[this.activeLayer].classList.remove('is-on');
    this.feedbackLayers[next].removeAttribute('aria-hidden');
    this.feedbackLayers[this.activeLayer].setAttribute('aria-hidden', 'true');
    this.activeLayer = next;
  }

  /* ------------------------------ confirmation ------------------------------ */

  private setConfirmed(btn: HTMLElement, seat: SeatDef, confirmed: boolean, animate: boolean) {
    window.clearTimeout(this.confirmTimer);
    btn.querySelector('.done-text')!.textContent = COPY.confirmed(seat.id);
    btn.classList.remove('is-pressing');
    if (!animate) {
      btn.classList.add('no-anim');
      btn.classList.toggle('is-done', confirmed);
      void btn.offsetWidth;
      btn.classList.remove('no-anim');
    } else {
      btn.classList.add('is-pressing');
      this.confirmTimer = window.setTimeout(() => {
        btn.classList.remove('is-pressing');
        btn.classList.add('is-done');
      }, 110);
    }
    btn.setAttribute('aria-disabled', String(confirmed));
    btn.setAttribute('aria-label', confirmed ? `${COPY.confirmed(seat.id)} — kept for this demo` : btn.querySelector('.label-default')!.textContent!.replace(/\s+/g, ' ').trim());
  }

  confirm(seat: SeatDef) {
    const btn = this.kind === 'wall' ? $('#keep-wall', this.paneWall) : $('#keep-window', this.paneWindow);
    this.setConfirmed(btn, seat, true, true);
  }

  focusPrimary() {
    const target = this.kind === 'wall' ? $('#change-seat', this.paneWall) : $('#timeline', this.paneWindow);
    target.focus({ preventScroll: true });
  }
}

export class HeaderUI {
  private readonly a: HTMLElement;
  private readonly b: HTMLElement;
  private readonly title: HTMLElement;
  private readonly back: HTMLButtonElement;

  constructor(root: HTMLElement, itinerary: { long: string; short: string; route: string; routeShort: string; date: string }) {
    this.title = $('#title', root);
    this.a = this.title.querySelector('.title-a')!;
    this.b = this.title.querySelector('.title-b')!;
    this.back = $<HTMLButtonElement>('#back', root);
    const it = $('#itinerary', root);
    it.innerHTML = '';
    const l = document.createElement('span');
    l.className = 'demo-long';
    l.textContent = itinerary.long;
    const s = document.createElement('span');
    s.className = 'demo-short';
    s.textContent = itinerary.short;
    const r = document.createElement('span');
    r.className = 'route-long';
    r.textContent = itinerary.route;
    const rs = document.createElement('span');
    rs.className = 'route-short';
    rs.textContent = itinerary.routeShort;
    it.append(l, s, document.createTextNode(' · '), r, rs, document.createTextNode(` · ${itinerary.date}`));
  }

  setTitles(mapTitle: string, previewTitle: string) {
    this.a.textContent = mapTitle;
    this.b.textContent = previewTitle;
  }

  setTransition(p: number) {
    const mo = mapOpacity(p);
    const po = previewOpacity(p);
    this.a.style.opacity = String(mo);
    this.b.style.opacity = String(po);
    this.a.setAttribute('aria-hidden', String(p >= 0.5));
    this.b.setAttribute('aria-hidden', String(p < 0.5));
  }

  setBackLabel(label: string) {
    this.back.setAttribute('aria-label', label);
  }
}
