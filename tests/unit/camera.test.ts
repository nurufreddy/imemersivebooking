import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SEATS } from '../../src/config/demoFlight';
import { CAB, wallSurfaceX, wallViewGeometry, zWin } from '../../src/scene/cabin/Cabin';
import { OPENING_BOTTOM, OPENING_TOP, WINDOW } from '../../src/scene/cabin/WindowUnit';
import { applyPose, clonePose, frameMap, mapPose, posePosition, transitionPose, wallPose, windowPose, type Layout, type Pose } from '../../src/scene/camera';
import { MAP, rowZ } from '../../src/scene/map/AircraftMap';

/** The reference recording: 390 × 846 CSS px, header to ~71px, sheets at 726 / 586. */
const L = { width: 390, height: 846 };
const mapLayout: Layout = { ...L, regionTop: 71, regionBottom: 726 };
const previewLayout: Layout = { ...L, regionTop: 71, regionBottom: 586 };

function seatPose(row: number, side: 'port' | 'starboard', view: string | undefined, layout = previewLayout): Pose {
  const m = side === 'port' ? 1 : -1;
  const heading = side === 'port' ? Math.PI / 2 : -Math.PI / 2;
  const z = rowZ(row) + zWin(0);
  if (view === 'no-window') return wallPose(new THREE.Vector3(m * wallSurfaceX, CAB.windowY, z), heading, wallViewGeometry(), layout);
  return windowPose(new THREE.Vector3(m * CAB.wallX, CAB.windowY, z), heading, { top: OPENING_TOP, bottom: OPENING_BOTTOM, width: WINDOW.w }, layout);
}

describe('map framing', () => {
  it('fits the reference composition on a 390px phone', () => {
    const f = frameMap(mapLayout);
    expect(f.orientation).toBe('vertical');
    // reference: 36.1 CSS px per metre, all 26 rows visible without panning
    expect(f.scale).toBeCloseTo(36.1, 0);
    expect(f.panMax).toBe(0);
  });

  it('turns the aircraft sideways on short landscape screens instead of shrinking seats', () => {
    const f = frameMap({ width: 844, height: 390, regionTop: 50, regionBottom: 300 });
    expect(f.orientation).toBe('horizontal');
    expect(f.scale).toBeGreaterThan(31);
  });
});

describe('transition camera path', () => {
  const map = mapPose(frameMap(mapLayout), L.height, 0, MAP.seatTopY);
  const out: Pose = clonePose(map);

  it('starts exactly at the map pose and lands exactly on the seat pose', () => {
    const seat = seatPose(23, 'port', 'window');
    const a = transitionPose(map, seat, 0, out);
    expect(posePosition(a).distanceTo(posePosition(map))).toBeLessThan(1e-6);
    const b = transitionPose(map, seat, 1, clonePose(map));
    expect(posePosition(b).distanceTo(posePosition(seat))).toBeLessThan(1e-6);
    expect(b.fov).toBeCloseTo(seat.fov, 6);
  });

  it('never flies through the overhead bins, the wall or the floor — for every window seat', () => {
    const p = new THREE.Vector3();
    for (const s of SEATS.filter((x) => x.position === 'window' && x.available)) {
      const m = s.side === 'port' ? 1 : -1;
      const seat = seatPose(s.row, s.side, s.view);
      for (let t = 0; t <= 1.0001; t += 0.005) {
        posePosition(transitionPose(map, seat, t, out), p);
        const x = p.x * m; // fold starboard onto port
        const insideBins = x > wallSurfaceX - 0.02 && x < CAB.binFront + 0.08 && p.y > CAB.binBottom - 0.05 && p.y < CAB.binTop + 0.05;
        expect(insideBins, `${s.id} t=${t.toFixed(3)} at ${p.toArray().map((v) => v.toFixed(2))}`).toBe(false);
        expect(x, `${s.id} wall t=${t.toFixed(3)}`).toBeGreaterThan(wallSurfaceX + 0.05);
        expect(p.y, `${s.id} floor t=${t.toFixed(3)}`).toBeGreaterThan(0.5);
      }
    }
  });
});

describe('window close-up framing (23A on the reference phone)', () => {
  it('centres the visible opening in the stage and fills ~80% of its height', () => {
    const pose = seatPose(23, 'port', 'window');
    const cam = new THREE.PerspectiveCamera(50, L.width / L.height, 0.01, 100);
    applyPose(cam, pose);
    const c = new THREE.Vector3(CAB.wallX, CAB.windowY, rowZ(23) + zWin(0));
    const toY = (y: number) => ((1 - new THREE.Vector3(c.x, c.y + y, c.z).project(cam).y) / 2) * L.height;
    const top = toY(OPENING_TOP);
    const bottom = toY(OPENING_BOTTOM);
    const regionMid = (previewLayout.regionTop + previewLayout.regionBottom) / 2;
    expect((top + bottom) / 2).toBeCloseTo(regionMid, -1);
    expect((bottom - top) / (previewLayout.regionBottom - previewLayout.regionTop)).toBeCloseTo(0.8, 1);
  });
});
