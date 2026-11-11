export type SeatLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type Side = 'port' | 'starboard';
export type SeatPosition = 'window' | 'middle' | 'aisle';
/** How a window seat's preview behaves. */
export type ViewCategory = 'window' | 'wing' | 'no-window';

export interface SeatDef {
  id: string;
  row: number;
  letter: SeatLetter;
  side: Side;
  position: SeatPosition;
  available: boolean;
  /** Present for window seats only. */
  view?: ViewCategory;
  /** Seat price in whole currency units. */
  price: number;
}

/** Lighting for the cabin while a beat is on screen (linear-ish authoring values). */
export interface BeatLight {
  /** Colour of the daylight / sky light entering through the window. */
  window: string;
  windowIntensity: number;
  /** Cabin ambient / mood light colour. */
  ambient: string;
  ambientIntensity: number;
  /** Warm LED strip under the overhead bins. */
  stripIntensity: number;
  /** Extra exposure multiplier for the exterior photograph. */
  sceneryExposure: number;
  /** Atmospheric grade applied to the photograph: blend amount (0..1) towards `hazeColor`. */
  haze: number;
  hazeColor: string;
  /** Photograph saturation and contrast multipliers (1 = untouched). */
  saturation: number;
  contrast: number;
  /** Multiply tint for the photograph, and a colour blended into the top of the frame (sky). */
  tint: string;
  skyTint: string;
  skyTintAmount: number;
}

export interface Beat {
  id: string;
  /** Key into SCENERY. */
  imageId: string;
  /** Minutes after midnight during which this beat is fully on screen. */
  hold: [number, number];
  title: string;
  detail: string;
  /** Colour of the small status dot. */
  dot: string;
  /** Short noun used by shade feedback, e.g. "Raise it to see the Pyrenees". */
  label: string;
  /** Present when the sun is visible in the window (normalised opening coordinates, 0 = top). */
  sun?: { x: number; y: number; radius: number };
  light: BeatLight;
  /** Header ink over the scene. */
  ink: 'dark' | 'light';
}

export interface SceneryImage {
  src: string;
  /** Focal point in the source image (0..1) kept centred in the window. */
  focus: [number, number];
  /** >1 zooms in beyond "cover" fit. */
  zoom: number;
  /** Horizontal drift (in image widths) applied across the beat, simulating motion. */
  drift: number;
  credit: { title: string; author: string; license: string; licenseUrl: string; source: string; note?: string };
}

export interface TimelineMarker {
  label: string;
  minutes: number;
}

export interface Phase {
  name: string;
  /** Phase applies while time < until (minutes after midnight). */
  until: number;
}
