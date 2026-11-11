import type { SeatDef } from '../config/types';
import type { ShadeHandleInfo, StageLayout } from '../scene/Stage3D';

export type { ShadeHandleInfo, StageLayout };

/** What the controller needs from a stage (WebGL or the DOM fallback). */
export interface StageLike {
  setLayout(l: StageLayout): void;
  setReducedMotion(reduced: boolean): void;
  setSeatStates(selected: string | null, confirmed: string | null): void;
  setHover(id: string | null): void;
  setFocusSeat(id: string | null): void;
  pick(clientX: number, clientY: number): SeatDef | null;
  beginDrag(): void;
  dragBy(dx: number, dy: number, dt: number): void;
  endDrag(): void;
  scrollBy(px: number): void;
  resetMapView(): void;
  revealSeat(id: string): void;
  seatScreen(id: string): { x: number; y: number } | null;
  enterSeat(seat: SeatDef): boolean;
  exitToMap(): void;
  setTime(minutes: number): void;
  setShade(s: number): void;
  shadeHandle(): ShadeHandleInfo | null;
  hintAnchor(): { x: number; y: number } | null;
  preloadFor(seat: SeatDef): void;
  readonly mapInteractive: boolean;
  readonly settledPreview: boolean;
  readonly canPan: boolean;
  readonly progress: number;
}

export interface AppState {
  /** Destination view (a transition may still be running). */
  view: 'map' | 'preview';
  /** Seat whose preview is shown / being flown to. */
  previewSeat: string | null;
  /** Seat highlighted on the map. */
  selectedSeat: string | null;
  /** Seat the user kept (local demo confirmation only). */
  confirmedSeat: string | null;
  /** Transient explanation shown in the map sheet. */
  notice: { kind: 'aisle' | 'middle' | 'taken'; seat: string } | null;
  /** Flight clock, minutes after midnight (continuous). */
  minutes: number;
  /** Shade closure for the previewed window, 0 open → 1 closed. */
  shade: number;
  /** The shade has been used at least once (dismisses the hint). */
  shadeUsed: boolean;
  transitioning: boolean;
}
