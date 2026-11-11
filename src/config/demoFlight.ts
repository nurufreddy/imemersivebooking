/**
 * ALL demonstration data lives here: itinerary, currency, seat map, prices,
 * flight timeline and the illustrative scenery story for each side of the cabin.
 *
 * This is concept data only. It does not describe a real RwandAir aircraft,
 * schedule, fare or seat, and confirming a seat creates no reservation.
 * To build another scenario (for example a Kigali departure), replace the
 * values in this file and the photographs referenced by SCENERY.
 */
import type { Beat, Phase, SceneryImage, SeatDef, SeatLetter, SeatPosition, Side, TimelineMarker, ViewCategory } from './types';

const hm = (h: number, m: number) => h * 60 + m;

export const ITINERARY = {
  /** Replaces the reference's flight number — this is not a real RwandAir service. */
  flightLabel: 'Demo flight',
  flightLabelShort: 'Demo',
  origin: 'Barcelona',
  destination: 'Paris CDG',
  /** Used on very narrow screens. */
  originCode: 'BCN',
  destinationCode: 'CDG',
  date: '14 Nov',
};

export const CURRENCY = {
  code: 'EUR',
  symbol: '€',
  format: (amount: number) => `€${amount}`,
};

/* ------------------------------------------------------------------ */
/* Seat map                                                            */
/* ------------------------------------------------------------------ */

export const CABIN = {
  rows: 26,
  letters: ['A', 'B', 'C', 'D', 'E', 'F'] as SeatLetter[],
  /** Port side (A) rows where the window line skips a frame: the seat is sold as a window seat but faces a wall panel. */
  missingWindowRows: { port: [11], starboard: [] as number[] },
  /** Rows whose window looks over the wing. */
  wingRows: [9, 10, 11, 12, 13, 14, 15, 16],
  /**
   * Availability per row, A→F. "." = available, "#" = taken.
   * Matches the seat pattern shown in the reference recording.
   */
  availability: [
    '#.##..', '#.....', '.##..#', '....#.', '......', '##.###', '##....', '##..##', '.###..', '######',
    '.#.#..', '......', '.#.#.#', '##..#.', '####.#', '.#..#.', '.....#', '####.#', '...#.#', '#.#.#.',
    '..#.#.', '#.###.', '.#...#', '#.#..#', '.....#', '#..###',
  ],
  prices: { window: 14, wing: 12, 'no-window': 9, middle: 5, aisle: 8 } as Record<ViewCategory | 'middle' | 'aisle', number>,
};

function positionOf(letter: SeatLetter): SeatPosition {
  if (letter === 'A' || letter === 'F') return 'window';
  if (letter === 'C' || letter === 'D') return 'aisle';
  return 'middle';
}

function buildSeats(): SeatDef[] {
  const seats: SeatDef[] = [];
  for (let row = 1; row <= CABIN.rows; row++) {
    const pattern = CABIN.availability[row - 1];
    CABIN.letters.forEach((letter, i) => {
      const side: Side = i < 3 ? 'port' : 'starboard';
      const position = positionOf(letter);
      let view: ViewCategory | undefined;
      if (position === 'window') {
        if (CABIN.missingWindowRows[side].includes(row)) view = 'no-window';
        else if (CABIN.wingRows.includes(row)) view = 'wing';
        else view = 'window';
      }
      const price = view ? CABIN.prices[view] : CABIN.prices[position === 'aisle' ? 'aisle' : 'middle'];
      seats.push({ id: `${row}${letter}`, row, letter, side, position, available: pattern[i] === '.', view, price });
    });
  }
  return seats;
}

export const SEATS: SeatDef[] = buildSeats();
export const SEAT_BY_ID = new Map(SEATS.map((s) => [s.id, s]));

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

export const COPY = {
  mapTitle: 'Choose your seat',
  previewTitle: (seatId: string) => `Window view · ${seatId}`,
  mapPrompt: { title: 'Tap a window seat', detail: 'See the view before you pay for it' },
  aisleNotice: (id: string) => ({ title: `${id} is an aisle seat`, detail: 'No window from here — tap an A or F seat' }),
  middleNotice: (id: string) => ({ title: `${id} is a middle seat`, detail: 'No window from here — tap an A or F seat' }),
  takenNotice: (id: string) => ({ title: `${id} is taken`, detail: 'Grey seats are already booked' }),
  confirmedNotice: (id: string) => ({ title: `${id} is yours`, detail: 'Tap another window seat to compare' }),
  noWindow: {
    soldAs: 'Sold as a window seat',
    title: 'No window in this row',
    detail: 'Just the wall panel between two windows',
    change: 'Change seat',
    keep: (id: string, price: string) => `Keep ${id} · ${price}`,
  },
  keepSeat: (id: string) => `Keep seat ${id}`,
  confirmed: (id: string) => `${id} is yours`,
  shadeHint: 'Pull the shade down',
};

/* ------------------------------------------------------------------ */
/* Flight timeline                                                     */
/* ------------------------------------------------------------------ */

export const TIMELINE = {
  start: hm(16, 5),
  end: hm(17, 55),
  markers: [
    { label: 'BCN', minutes: hm(16, 5) },
    { label: 'Pyrenees', minutes: hm(16, 40) },
    { label: 'Sunset', minutes: hm(17, 15) },
    { label: 'Paris', minutes: hm(17, 45) },
  ] as TimelineMarker[],
  phases: [
    { name: 'Takeoff', until: hm(16, 13) },
    { name: 'Climb', until: hm(16, 26) },
    { name: 'Cruise', until: hm(17, 35) },
    { name: 'Descent', until: hm(17, 45) + 0.5 },
    { name: 'Approach', until: hm(17, 53) + 0.5 },
    { name: 'Landing', until: Infinity },
  ] as Phase[],
  /** Track colours between markers (sampled from the reference). */
  track: [
    ['#AFC7EC', '#B6CEE9'],
    ['#CBCCD0', '#D9CBB1', '#F7C67A', '#FAA451'],
    ['#C07752', '#7A6A76', '#4A5279', '#1C2448'],
    ['#1F2138', '#181A36'],
  ],
};

/* ------------------------------------------------------------------ */
/* Scenery photographs (see README "Asset credits")                    */
/* ------------------------------------------------------------------ */

export const SCENERY: Record<string, SceneryImage> = {
  barcelona: {
    src: 'scenery/barcelona.webp', focus: [0.5, 0.5], zoom: 1, drift: 0.05,
    credit: {
      title: 'Coastal aerial of Barcelona with Port-Nou in foreground', author: 'Joe Mabel', license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      source: 'https://commons.wikimedia.org/wiki/File:Coastal_aerial_of_Barcelona_with_Port-Nou_in_foreground.jpg',
    },
  },
  pyrenees: {
    src: 'scenery/pyrenees.webp', focus: [0.5, 0.5], zoom: 1, drift: 0.05,
    credit: {
      title: 'The Pyrenees mountains in December', author: 'Mike McBey', license: 'CC BY 2.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
      source: 'https://commons.wikimedia.org/wiki/File:The_Pyrenees_mountains_in_December_(49186679837).jpg',
    },
  },
  sunset: {
    src: 'scenery/sunset.webp', focus: [0.5, 0.5], zoom: 1, drift: 0.02,
    credit: {
      title: 'Sun near sunset shining through low-level dust over Collin County, Texas, viewed from an airplane', author: 'Famartin', license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      source: 'https://commons.wikimedia.org/wiki/File:2015-07-10_20_15_09_Sun_near_sunset_shining_through_low-level_dust_over_Collin_County,_Texas_viewed_from_an_airplane_flying_from_Washington_Dulles_International_Airport_to_Dallas-Fort_Worth_International_Airport.jpg',
      note: 'Illustrative stand-in for a sunset above cloud on the Barcelona–Paris story.',
    },
  },
  clouds: {
    src: 'scenery/clouds.webp', focus: [0.5, 0.5], zoom: 1, drift: 0.03,
    credit: {
      title: 'Sunset, airplane view — 9 December 2025', author: 'Asteralee', license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      source: 'https://commons.wikimedia.org/wiki/File:Sunset,_airplane_view_%E2%80%94_9_December_2025.jpg',
    },
  },
  bluehour: {
    src: 'scenery/bluehour.webp', focus: [0.5, 0.5], zoom: 1, drift: 0.03,
    credit: {
      title: 'View from the Tour Montparnasse, 1 May 2012 N0', author: 'Getfunky', license: 'CC BY 2.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
      source: 'https://commons.wikimedia.org/wiki/File:View_from_the_Tour_Montparnasse,_1_May_2012_N0.jpg',
    },
  },
  bluehourEast: {
    src: 'scenery/bluehour-east.webp', focus: [0.5, 0.5], zoom: 1, drift: 0.03,
    credit: {
      title: 'Utah Lake 2025a', author: 'Antony-22', license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      source: 'https://commons.wikimedia.org/wiki/File:Utah_Lake_2025a.jpg',
      note: 'Illustrative stand-in for town lights at dusk.',
    },
  },
  paris: {
    src: 'scenery/paris.webp', focus: [0.5, 0.5], zoom: 1, drift: 0.02,
    credit: {
      title: 'Eiffel Tower from the Tour Montparnasse, 1 May 2012 N1', author: 'Getfunky', license: 'CC BY 2.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
      source: 'https://commons.wikimedia.org/wiki/File:Eiffel_Tower_from_the_Tour_Montparnasse,_1_May_2012_N1.jpg',
    },
  },
  cityEast: {
    src: 'scenery/city-east.webp', focus: [0.5, 0.5], zoom: 1, drift: 0.02,
    credit: {
      title: 'View of Paris from the Tour Montparnasse 5096', author: 'Freepenguin', license: 'CC BY-SA 3.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
      source: 'https://commons.wikimedia.org/wiki/File:View_of_Paris_from_the_Tour_Montparnasse_5096.jpg',
    },
  },
  landing: {
    src: 'scenery/landing.webp', focus: [0.5, 0.5], zoom: 1, drift: 0.01,
    credit: {
      title: 'Roissy-en-France Hub FedEx – vue aérienne nocturne 20191028', author: 'Pymouss', license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      source: 'https://commons.wikimedia.org/wiki/File:Roissy-en-France_Hub_FedEx_-_vue_a%C3%A9rienne_nocturne_20191028.jpg',
    },
  },
};

/* ------------------------------------------------------------------ */
/* Story beats per side (illustrative, not a route simulation)          */
/* ------------------------------------------------------------------ */

const LIGHT = {
  afternoon: { window: '#F7F4EF', windowIntensity: 0.85, ambient: '#FFF6EC', ambientIntensity: 1.0, stripIntensity: 1.0, sceneryExposure: 1.0, haze: 0.2, hazeColor: '#E8D2B4', saturation: 0.92, contrast: 1, tint: '#FFFFFF', skyTint: '#FFFFFF', skyTintAmount: 0 },
  daylight: { window: '#EEF4FF', windowIntensity: 0.85, ambient: '#F6F6F4', ambientIntensity: 0.95, stripIntensity: 0.95, sceneryExposure: 1.0, haze: 0.14, hazeColor: '#C9D4E2', saturation: 0.82, contrast: 0.96, tint: '#FFFFFF', skyTint: '#FFFFFF', skyTintAmount: 0 },
  sunset: { window: '#FFD3A0', windowIntensity: 1.5, ambient: '#FFD9B5', ambientIntensity: 0.95, stripIntensity: 0.8, sceneryExposure: 1.3, haze: 0.0, hazeColor: '#FFB070', saturation: 1.3, contrast: 1.1, tint: '#FFBE9C', skyTint: '#6E8AC8', skyTintAmount: 0.55 },
  softSunset: { window: '#FFDDBA', windowIntensity: 1.0, ambient: '#FFE3CC', ambientIntensity: 0.88, stripIntensity: 0.85, sceneryExposure: 1.05, haze: 0.0, hazeColor: '#FFD2B0', saturation: 1.1, contrast: 1.02, tint: '#FFFFFF', skyTint: '#FFFFFF', skyTintAmount: 0 },
  dusk: { window: '#A6A8CE', windowIntensity: 0.6, ambient: '#BDBDD6', ambientIntensity: 0.62, stripIntensity: 0.6, sceneryExposure: 1.0, haze: 0.0, hazeColor: '#8C8FD0', saturation: 1, contrast: 1, tint: '#FFFFFF', skyTint: '#FFFFFF', skyTintAmount: 0 },
  night: { window: '#8A90B0', windowIntensity: 0.34, ambient: '#9EA6C8', ambientIntensity: 0.4, stripIntensity: 0.35, sceneryExposure: 1.0, haze: 0.0, hazeColor: '#4B5590', saturation: 1, contrast: 1, tint: '#FFFFFF', skyTint: '#FFFFFF', skyTintAmount: 0 },
  landing: { window: '#7E84A6', windowIntensity: 0.28, ambient: '#959DC0', ambientIntensity: 0.36, stripIntensity: 0.3, sceneryExposure: 1.0, haze: 0.0, hazeColor: '#3F4677', saturation: 1, contrast: 1, tint: '#FFFFFF', skyTint: '#FFFFFF', skyTintAmount: 0 },
};

export const BEATS: Record<Side, Beat[]> = {
  port: [
    { id: 'bcn', imageId: 'barcelona', hold: [hm(16, 5), hm(16, 24)], title: 'Barcelona and the sea', detail: 'Soft afternoon sun from behind', dot: '#9AB6EA', label: 'Barcelona', light: LIGHT.afternoon, ink: 'dark' },
    { id: 'pyrenees', imageId: 'pyrenees', hold: [hm(16, 34), hm(16, 58)], title: 'The Pyrenees on your left', detail: 'Low sun on your side', dot: '#FCD27A', label: 'the Pyrenees', light: LIGHT.daylight, ink: 'dark' },
    { id: 'sunset', imageId: 'sunset', hold: [hm(17, 8), hm(17, 28)], title: 'Sunset right in your window', detail: 'Bright glare 16:55–17:20', dot: '#F58B3D', label: 'the sunset', sun: { x: 0.5, y: 0.38, radius: 0.045 }, light: LIGHT.sunset, ink: 'dark' },
    { id: 'bluehour', imageId: 'bluehour', hold: [hm(17, 35), hm(17, 39)], title: 'Blue hour over France', detail: 'Sun is down at 17:13 in Paris', dot: '#6C7194', label: 'the blue hour', light: LIGHT.dusk, ink: 'dark' },
    { id: 'paris', imageId: 'paris', hold: [hm(17, 43), hm(17, 50)], title: 'Paris lights on your left', detail: 'Night · Eiffel Tower in view', dot: '#262A45', label: 'Paris', light: LIGHT.night, ink: 'light' },
    { id: 'cdg', imageId: 'landing', hold: [hm(17, 54), hm(17, 55)], title: 'Touchdown at CDG', detail: 'Dark outside · 17:55', dot: '#16171F', label: 'the airport', light: LIGHT.landing, ink: 'light' },
  ],
  starboard: [
    { id: 'bcn', imageId: 'barcelona', hold: [hm(16, 5), hm(16, 24)], title: 'Barcelona as you climb', detail: 'Sun on the far side', dot: '#9AB6EA', label: 'Barcelona', light: LIGHT.afternoon, ink: 'dark' },
    { id: 'pyrenees', imageId: 'pyrenees', hold: [hm(16, 34), hm(16, 58)], title: 'Snowy peaks below', detail: 'Cool light, no glare', dot: '#FCD27A', label: 'the mountains', light: LIGHT.daylight, ink: 'dark' },
    { id: 'clouds', imageId: 'clouds', hold: [hm(17, 8), hm(17, 28)], title: 'Pink clouds on your right', detail: 'Sun on the other side · no glare', dot: '#F58B3D', label: 'the clouds', light: LIGHT.softSunset, ink: 'dark' },
    { id: 'bluehour', imageId: 'bluehourEast', hold: [hm(17, 35), hm(17, 39)], title: 'Blue hour over France', detail: 'First town lights below', dot: '#6C7194', label: 'the blue hour', light: LIGHT.dusk, ink: 'dark' },
    { id: 'paris', imageId: 'cityEast', hold: [hm(17, 43), hm(17, 50)], title: 'City lights on your right', detail: 'Night · approaching from the south', dot: '#262A45', label: 'the city', light: LIGHT.night, ink: 'light' },
    { id: 'cdg', imageId: 'landing', hold: [hm(17, 54), hm(17, 55)], title: 'Touchdown at CDG', detail: 'Dark outside · 17:55', dot: '#16171F', label: 'the airport', light: LIGHT.landing, ink: 'light' },
  ],
};

/** Cabin light for seats sold as window seats that face a wall panel (bright, neutral daylight). */
export const NO_WINDOW_LIGHT = { window: '#EEF4FF', windowIntensity: 1.1, ambient: '#FFF8F0', ambientIntensity: 1.5, stripIntensity: 1.5, sceneryExposure: 1, haze: 0, hazeColor: '#DCE6F2', saturation: 1, contrast: 1, tint: '#FFFFFF', skyTint: '#FFFFFF', skyTintAmount: 0 };
