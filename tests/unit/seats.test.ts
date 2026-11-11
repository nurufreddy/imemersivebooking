import { describe, expect, it } from 'vitest';
import { CABIN, CURRENCY, SCENERY, SEATS, SEAT_BY_ID, BEATS } from '../../src/config/demoFlight';

describe('seat map data', () => {
  it('has 26 rows of A–F', () => {
    expect(SEATS).toHaveLength(26 * 6);
    expect(CABIN.availability.every((r) => r.length === 6)).toBe(true);
  });

  it('models the reference seats exactly', () => {
    const s11 = SEAT_BY_ID.get('11A')!;
    expect(s11.available).toBe(true);
    expect(s11.position).toBe('window');
    expect(s11.view).toBe('no-window');
    expect(CURRENCY.format(s11.price)).toBe('€9');

    const s23 = SEAT_BY_ID.get('23A')!;
    expect(s23.available).toBe(true);
    expect(s23.view).toBe('window');
    expect(CURRENCY.format(s23.price)).toBe('€14');
  });

  it('gives a view category to window seats only', () => {
    for (const s of SEATS) {
      if (s.letter === 'A' || s.letter === 'F') expect(s.view).toBeDefined();
      else expect(s.view).toBeUndefined();
    }
  });

  it('keeps unavailable seats unavailable (reference pattern)', () => {
    expect(SEATS.filter((s) => !s.available)).toHaveLength(CABIN.availability.join('').split('').filter((c) => c === '#').length);
    expect(SEAT_BY_ID.get('10A')!.available).toBe(false);
    expect(SEAT_BY_ID.get('12F')!.available).toBe(true);
  });

  it('references scenery that exists for every beat', () => {
    for (const side of ['port', 'starboard'] as const) {
      for (const beat of BEATS[side]) {
        expect(SCENERY[beat.imageId], `${side}:${beat.id}`).toBeDefined();
        expect(SCENERY[beat.imageId].credit.license).not.toBe('—');
      }
    }
  });
});
