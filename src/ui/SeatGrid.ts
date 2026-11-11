import { CABIN, CURRENCY, SEATS } from '../config/demoFlight';
import type { SeatDef } from '../config/types';

export interface SeatGridOptions {
  onActivate(id: string): void;
  /** Keyboard focus moved to a seat (null when focus leaves the grid). */
  onFocusSeat(id: string | null): void;
}

export function seatDescription(seat: SeatDef, state: { selected: boolean; confirmed: boolean }) {
  const parts = [`Row ${seat.row}, seat ${seat.letter}`];
  if (seat.position === 'window') {
    parts.push(seat.view === 'no-window' ? 'sold as a window seat, wall panel, no window' : seat.view === 'wing' ? 'window seat over the wing' : 'window seat');
  } else parts.push(`${seat.position} seat`);
  if (!seat.available) parts.push('taken');
  else parts.push(CURRENCY.format(seat.price));
  if (state.confirmed) parts.push('yours');
  else if (state.selected) parts.push('selected');
  return parts.join(', ');
}

/**
 * Visually hidden but fully operable seat grid (roving tabindex). Sighted
 * keyboard users see the focus on the 3D seat map; screen readers get
 * the semantic grid. Shares the same seat state as the canvas.
 */
export class SeatGrid {
  private readonly cells = new Map<string, HTMLElement>();
  private current: string;
  private selected: string | null = null;
  private confirmed: string | null = null;

  constructor(private readonly el: HTMLElement, private readonly o: SeatGridOptions) {
    this.current = '1A';
    for (let row = 1; row <= CABIN.rows; row++) {
      const r = document.createElement('div');
      r.setAttribute('role', 'row');
      r.setAttribute('aria-label', `Row ${row}`);
      for (const seat of SEATS.filter((s) => s.row === row)) {
        const c = document.createElement('div');
        c.setAttribute('role', 'gridcell');
        c.tabIndex = -1;
        c.dataset.seat = seat.id;
        if (!seat.available) c.setAttribute('aria-disabled', 'true');
        this.cells.set(seat.id, c);
        r.appendChild(c);
      }
      el.appendChild(r);
    }
    this.cells.get(this.current)!.tabIndex = 0;
    this.refreshLabels();
    el.addEventListener('keydown', this.onKey);
    el.addEventListener('focusin', (e) => {
      const id = (e.target as HTMLElement).dataset.seat;
      if (id) {
        this.current = id;
        this.o.onFocusSeat(id);
      }
    });
    el.addEventListener('focusout', (e) => {
      if (!el.contains(e.relatedTarget as Node)) this.o.onFocusSeat(null);
    });
    el.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).dataset.seat;
      if (id) this.o.onActivate(id);
    });
  }

  setStates(selected: string | null, confirmed: string | null) {
    this.selected = selected;
    this.confirmed = confirmed;
    this.refreshLabels();
  }

  private refreshLabels() {
    for (const seat of SEATS) {
      const c = this.cells.get(seat.id)!;
      const sel = seat.id === this.selected;
      const conf = seat.id === this.confirmed;
      c.setAttribute('aria-label', seatDescription(seat, { selected: sel, confirmed: conf }));
      c.setAttribute('aria-selected', String(sel || conf));
    }
  }

  setEnabled(enabled: boolean) {
    this.el.toggleAttribute('inert', !enabled);
    this.el.setAttribute('aria-hidden', String(!enabled));
  }

  /** Move the roving focus (optionally focusing the element). */
  focusSeat(id: string, focus = true) {
    const cell = this.cells.get(id);
    if (!cell) return;
    this.cells.get(this.current)!.tabIndex = -1;
    this.current = id;
    cell.tabIndex = 0;
    if (focus) cell.focus({ preventScroll: true });
  }

  get focusedSeat() {
    return this.el.contains(document.activeElement) ? this.current : null;
  }

  private readonly onKey = (e: KeyboardEvent) => {
    const seat = SEATS.find((s) => s.id === this.current)!;
    const letters = CABIN.letters;
    let row = seat.row;
    let li = letters.indexOf(seat.letter);
    switch (e.key) {
      case 'ArrowLeft':
        li = Math.max(0, li - 1);
        break;
      case 'ArrowRight':
        li = Math.min(letters.length - 1, li + 1);
        break;
      case 'ArrowUp':
        row = Math.max(1, row - 1);
        break;
      case 'ArrowDown':
        row = Math.min(CABIN.rows, row + 1);
        break;
      case 'PageUp':
        row = Math.max(1, row - 5);
        break;
      case 'PageDown':
        row = Math.min(CABIN.rows, row + 5);
        break;
      case 'Home':
        li = 0;
        if (e.ctrlKey) row = 1;
        break;
      case 'End':
        li = letters.length - 1;
        if (e.ctrlKey) row = CABIN.rows;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this.o.onActivate(this.current);
        return;
      default:
        return;
    }
    e.preventDefault();
    this.focusSeat(`${row}${letters[li]}`);
  };
}
