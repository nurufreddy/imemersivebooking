# RwandAir seat preview (concept demo)

An interactive seat-selection experience that lets a passenger **see the view from a window seat before paying for it**. Tap a seat on a sculptural aircraft cutaway, fly into the cabin, scrub the flight from Barcelona to Paris, pull the window shade, and keep the seat.

> **Demo only.** The route, times, seat map, prices, the missing window at 11A and the scenery are illustrative concept data. They do not describe a real RwandAir aircraft, schedule or fare, and "keeping" a seat creates no reservation. No login, payment, booking system or API is used.

## Quick start

Requires Node.js 20+ (developed on Node 24).

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
npm test           # unit tests (Vitest)
npm run test:e2e   # end-to-end journeys (Playwright)
npm run check      # typecheck + unit tests + build
```

End-to-end tests drive a real browser with WebGL. Either install Playwright's Chromium once (`npx playwright install chromium`) or use an installed Google Chrome: `PW_CHANNEL=chrome npm run test:e2e`.

The build uses a relative base, so `dist/` can be served from any static host or sub-path (for example GitHub Pages).

**Live demo:** https://immersive-booking.vercel.app. It's hosted on Vercel using the settings in `vercel.json` (Vite, `npm ci`, `npm run build`, `dist/`). The Vercel project is connected to this GitHub repository, so every push to `main` redeploys. To deploy manually from a local checkout, run `vercel deploy --prod`.

Useful URL flags: `?fallback` forces the lightweight non-WebGL seat map; `?e2e` exposes a small test hook on `window.__seatPreview`.

## Controls

| Where | Pointer / touch | Keyboard |
| --- | --- | --- |
| Seat map | Tap a seat. Hover highlights available seats. Drag (or scroll) to pan when the cabin does not fit the screen; a drag never selects a seat. | Tab into the seat grid, arrow keys / PageUp / PageDown / Home / End to move, Enter or Space to choose. The focused seat is ringed on the map. |
| Window preview | Drag or click the thin timeline. Grab the shade's handle and pull it down or push it up. | Timeline: arrows (±1 min, Shift ±5), PageUp/PageDown (±10), Home/End. Shade handle: arrows (±10%), Home (open), End (closed), Enter/Space toggles. |
| Anywhere | **Back** returns to the map; on the map it resets the overview (inside an iframe it posts `rwandair-seat-preview:back` to the parent instead). **Change seat** returns to the map. **Keep** confirms the seat locally. | Escape returns to the map. |

Seat behaviour follows each seat's configured category:

- **window** (e.g. 23A): full window preview with the flight timeline.
- **wing** (rows 9–16): the same preview, with the wing visible in the lower part of the window.
- **no-window** (11A): the cabin view of the wall panel between two windows, with Change seat / Keep.
- Aisle and middle seats explain that there is no window from there.
- Taken seats explain that they are booked.

## What is implemented

- **Seat map**: a white 3D cutaway (fuselage, 26 rows of 3+3 instanced seats, armrests, window slits with the gap at 11A, galleys, wings, engines, soft baked contact shadows), framed like the reference on phones. Short landscape screens turn the aircraft sideways; small phones pan instead of shrinking seats below a usable size.
- **Camera flight**: one continuous, reversible camera path from the overview into the cabin, with radial motion blur and a cross-fade from the sculpture to the detailed cabin. Back mid-flight reverses smoothly; the return lands on the exact map position.
- **Detailed cabin**: modelled window units (glass, reveal, lip, seam, band, groove, raised ring, dish), a recessed shade housing, wall panels and seams, overhead bins with latches, a warm LED strip, and seats in RwandAir-blue woven upholstery with grey shells, white headrest covers and tray tables. The cabin is mirrored for F seats.
- **Scenery**: photographs on a plane far outside the window, so they are only visible through the aperture and gain real parallax. Beats cross-fade and drift with the timeline, with per-beat exposure, haze, saturation and sky grading. The cabin light follows the scene: warm at sunset, cool and dim at blue hour and night. The header turns light over night scenes.
- **Shade**: a physical panel inside the reveal, clipped to the aperture, that covers the scene from the top. As it closes, the window's area light shrinks with it and the shade glows faintly. Copy is computed from the real shade position and sun (for example "Sunset, without the glare · Shade at 70% · sun hidden"). A hint appears near the sunset and disappears once the shade is used.
- **Confirmation**: a press, then a colour morph to RwandAir blue with a check and "23A is yours". It is idempotent, never carries over to another seat, and is reflected on the map.
- **Responsive**: phone portrait (reference composition), tablet, desktop (centred 480 px sheet over a full-bleed cabin), short landscape (right-aligned sheet with the scene beside it). It uses dynamic viewport units and safe areas, and type in `rem` so text zoom works.
- **Accessibility**: semantic buttons, a keyboard seat grid tied to the same state, range roles for the timeline and shade, polite announcements (not on every slider frame), visible focus, and labels and icons as well as colour.
- **Robustness**: renders on demand only and stops when idle or the tab is hidden. It caps and adapts the pixel ratio, compiles shaders up front, preloads scenery by proximity to the current time, and falls back to a sky gradient if an image fails. A DOM fallback runs when WebGL is unavailable, and the app switches to it if a WebGL context is lost and not restored. Reduced motion replaces the flight with a short cross-fade.

## Project structure

```
src/
  config/        brand tokens, demo data (one file: demoFlight.ts), types
  logic/         pure timeline and shade-feedback logic (unit tested)
  scene/         Three.js stage: map/, cabin/, camera choreography, compositor
  ui/            sheet, header, timeline, shade handle, accessible seat grid
  app/           state + controller wiring UI and stage
  fallback/      DOM-only stage used without WebGL
public/brand     official RwandAir logo files (unmodified)
public/scenery   processed scenery photographs (see credits)
tests/unit       Vitest: timeline, shade, seat data, camera path safety
tests/e2e        Playwright: the user journeys below
```

### Changing the scenario (e.g. a Kigali departure)

Everything lives in `src/config/demoFlight.ts`: itinerary labels, currency and format, the seat map (rows, availability, missing-window rows, wing rows, prices), the timeline (start, end, markers, phases, track colours), the story beats for each side (copy, time ranges, sun position, cabin light and photo grade), and the scenery registry with credits. Replace the photographs in `public/scenery/` and update their credits.

## Verification

Run on macOS (Apple M3), Chrome 156 via Playwright, Node 24:

- `npm run typecheck`, `npm test` (36 unit tests) and `npm run build` pass.
- `npm run test:e2e` passes 13 journeys, each with no console or WebGL errors:
  - 11A reveal, then Change seat back to the identical map position.
  - 23A: scrub through every beat, pull the shade to 70% and raise it, night and landing, scrub backwards, confirm (also confirming that repeated taps do nothing).
  - Confirmation does not leak to another seat.
  - Rapid taps and back presses never strand the camera.
  - Keyboard-only flow.
  - Taken and aisle seat explanations.
  - Reduced motion.
  - The non-WebGL fallback.
  - Layout checks at 360×800, 430×932, 768×1024, 1440×900 and 844×390.
- Screens were compared frame by frame with the reference recording at 390×846 (1.846× device pixel ratio). The map, sheet typography and spacing (measured to within ~2 px), the 11A composition and the 23A window states were matched.

**Not verified:** physical iOS and Android devices, Safari, Firefox, and manual testing with a screen reader. Frame rates were not measured on phones; the adaptive pixel ratio is meant to keep weaker GPUs responsive, but that is untested on real hardware.

## Asset credits

### RwandAir identity

`public/brand/rwandair-logo.png` and `public/brand/rwandair-icon.png` are the official files served by [rwandair.com](https://www.rwandair.com/us-en) (`/revamped/public/assets/site/images/rwandairlogo.png` and `rwandair-icon.png`), unmodified. RwandAir names and logos are trademarks of RwandAir; they are used here only to illustrate this non-commercial concept. Brand colours were taken from the official site CSS (`#005DAF`, `#00509E`, `#E8F1FA`) or sampled from the logo (`#00529C`).

### Scenery photographs (Wikimedia Commons)

Each photograph was cropped to 3:4, resized to 1200×1600, converted to WebP with its metadata removed, and is colour-graded at runtime. Adaptations of CC BY-SA works are shared under the same licence.

| Use | Title | Author | Licence | Source |
| --- | --- | --- | --- | --- |
| Barcelona and the sea | Coastal aerial of Barcelona with Port-Nou in foreground | Joe Mabel | CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:Coastal_aerial_of_Barcelona_with_Port-Nou_in_foreground.jpg) |
| The Pyrenees | The Pyrenees mountains in December | Mike McBey | CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:The_Pyrenees_mountains_in_December_(49186679837).jpg) |
| Sunset (A side) | Sun near sunset shining through low-level dust over Collin County, Texas, viewed from an airplane | Famartin | CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:2015-07-10_20_15_09_Sun_near_sunset_shining_through_low-level_dust_over_Collin_County,_Texas_viewed_from_an_airplane_flying_from_Washington_Dulles_International_Airport_to_Dallas-Fort_Worth_International_Airport.jpg) |
| Dusk clouds (F side) | Sunset, airplane view — 9 December 2025 | Asteralee | CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:Sunset,_airplane_view_%E2%80%94_9_December_2025.jpg) |
| Blue hour (A side) | View from the Tour Montparnasse, 1 May 2012 N0 | Getfunky | CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:View_from_the_Tour_Montparnasse,_1_May_2012_N0.jpg) |
| Blue hour (F side) | Utah Lake 2025a | Antony-22 | CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:Utah_Lake_2025a.jpg) |
| Paris lights (A side) | Eiffel Tower from the Tour Montparnasse, 1 May 2012 N1 | Getfunky | CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Eiffel_Tower_from_the_Tour_Montparnasse,_1_May_2012_N1.jpg) |
| City lights (F side) | View of Paris from the Tour Montparnasse 5096 | Freepenguin | CC BY-SA 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:View_of_Paris_from_the_Tour_Montparnasse_5096.jpg) |
| Touchdown at CDG | Roissy-en-France Hub FedEx – vue aérienne nocturne 20191028 | Pymouss | CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:Roissy-en-France_Hub_FedEx_-_vue_a%C3%A9rienne_nocturne_20191028.jpg) |

Some images stand in for the story rather than showing the exact place (the sunset was photographed over Texas, the F-side blue hour over Utah); they are illustrative, as is the whole itinerary.

### Software and fonts

- [Three.js](https://threejs.org) — MIT licence.
- [Geist and Geist Mono](https://vercel.com/font) via Fontsource — SIL Open Font License 1.1.
- All 3D geometry, materials and textures (seats, cabin, window trim, aircraft sculpture, fabric weave) are procedural and written for this project. The reference recording was used for analysis only; none of its frames are shipped.
