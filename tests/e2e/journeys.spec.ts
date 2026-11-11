import { expect, test, type Page } from '@playwright/test';

type Snapshot = { view: string; previewSeat: string | null; selectedSeat: string | null; confirmedSeat: string | null; notice: { kind: string; seat: string } | null; minutes: number; shade: number; progress: number };

const errors: string[] = [];

async function ready(page: Page, query = '') {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('GL_'))) errors.push(m.text());
  });
  await page.goto(`/?e2e${query}`);
  await page.waitForFunction(() => {
    const w = window as unknown as { __seatPreview?: unknown };
    return !!w.__seatPreview && !document.querySelector('#loader')!.classList.contains('is-visible');
  });
}

const state = (page: Page) => page.evaluate(() => (window as unknown as { __seatPreview: { state(): Snapshot } }).__seatPreview.state());
const seatPos = (page: Page, id: string) =>
  page.evaluate((s) => (window as unknown as { __seatPreview: { seatScreen(id: string): { x: number; y: number } } }).__seatPreview.seatScreen(s), id);
const settled = (page: Page, p: 0 | 1, timeout = 10_000) =>
  page.waitForFunction((target) => (window as unknown as { __seatPreview: { state(): Snapshot } }).__seatPreview.state().progress === target, p, { timeout });

async function tapSeat(page: Page, id: string) {
  const pos = await seatPos(page, id);
  await page.mouse.click(pos.x, pos.y);
}

/** Drag the timeline thumb with a real pointer from one track fraction to another. */
async function scrub(page: Page, from: number, to: number) {
  const box = (await page.locator('#timeline').boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + from * box.width, y);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) await page.mouse.move(box.x + (from + ((to - from) * i) / 16) * box.width, y);
  await page.mouse.up();
}

const shadeInfo = (page: Page) =>
  page.evaluate(() => (window as unknown as { __seatPreview: { shadeHandle(): { x: number; y: number; yOpen: number; yClosed: number } | null } }).__seatPreview.shadeHandle());

async function dragShade(page: Page, to: number) {
  const h = (await shadeInfo(page))!;
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  const target = h.yOpen + to * (h.yClosed - h.yOpen);
  for (let i = 1; i <= 16; i++) await page.mouse.move(h.x + 1, h.y + ((target - h.y) * i) / 16);
  await page.mouse.up();
}

const feedbackText = (page: Page) => page.locator('#feedback .fb.is-on');

test.afterEach(() => {
  expect(errors, errors.join('\n')).toEqual([]);
});

test('11A: missing-window reveal, then Change seat returns to the same map position', async ({ page }) => {
  await ready(page);
  const before = await seatPos(page, '11A');
  await tapSeat(page, '11A');
  await settled(page, 1);
  await expect(page.locator('#title .title-b')).toHaveText('Window view · 11A');
  await expect(page.locator('#pane-wall')).toContainText('Sold as a window seat');
  await expect(page.locator('#pane-wall')).toContainText('No window in this row');
  await expect(page.locator('#pane-wall')).toContainText('Just the wall panel between two windows');
  await expect(page.locator('#keep-wall')).toContainText('Keep 11A · €9');
  expect(await page.evaluate(() => (window as unknown as { __seatPreview: { shadeHandle(): unknown } }).__seatPreview.shadeHandle())).toBeNull();

  await page.getByRole('button', { name: 'Change seat' }).click();
  await settled(page, 0);
  await expect(page.locator('#title .title-a')).toHaveText('Choose your seat');
  const after = await seatPos(page, '11A');
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeLessThan(1);
  expect((await state(page)).selectedSeat).toBe('11A');
});

test('23A: scrub, shade, night, landing, backwards scrub and blue confirmation', async ({ page }) => {
  await ready(page);
  await tapSeat(page, '23A');
  await settled(page, 1);
  await expect(page.locator('#title .title-b')).toHaveText('Window view · 23A');
  await expect(page.locator('#clock')).toHaveText('16:05');
  await expect(page.locator('#phase')).toHaveText('Takeoff');
  await expect(feedbackText(page)).toContainText('Barcelona and the sea');

  await scrub(page, 0, 0.32);
  await expect(feedbackText(page)).toContainText('The Pyrenees on your left');
  await expect(page.locator('#phase')).toHaveText('Cruise');

  await scrub(page, 0.32, 0.637);
  await expect(page.locator('#clock')).toHaveText('17:15');
  await expect(feedbackText(page)).toContainText('Sunset right in your window');
  await expect(page.locator('#hint')).toHaveClass(/is-on/);

  await dragShade(page, 0.7);
  expect(Math.round((await state(page)).shade * 100)).toBeGreaterThanOrEqual(66);
  await expect(feedbackText(page)).toContainText('Sunset, without the glare');
  await expect(feedbackText(page)).toContainText('Shade at 70% · sun hidden');
  await expect(page.locator('#hint')).not.toHaveClass(/is-on/);
  await expect(page.locator('#shade-handle')).toHaveAttribute('aria-valuenow', '70');

  await dragShade(page, 0);
  await expect(feedbackText(page)).toContainText('Sunset right in your window');

  const shadeBefore = (await state(page)).shade;
  await scrub(page, 0.637, 0.91);
  await expect(feedbackText(page)).toContainText('Paris lights on your left');
  await expect(page.locator('#app')).toHaveAttribute('data-ink', 'light');
  expect((await state(page)).shade).toBeCloseTo(shadeBefore, 5); // time never discards the shade

  await scrub(page, 0.91, 1);
  await expect(page.locator('#clock')).toHaveText('17:55');
  await expect(page.locator('#phase')).toHaveText('Landing');
  await expect(feedbackText(page)).toContainText('Touchdown at CDG');

  // backwards: time, copy and lighting stay in sync
  await scrub(page, 1, 0.3182);
  await expect(page.locator('#clock')).toHaveText('16:40');
  await expect(feedbackText(page)).toContainText('The Pyrenees on your left');
  await expect(page.locator('#app')).toHaveAttribute('data-ink', 'dark');
  expect((await state(page)).previewSeat).toBe('23A');

  await page.locator('#keep-window').click();
  await expect(page.locator('#keep-window')).toHaveAttribute('aria-disabled', 'true');
  // a repeated tap still reaches the button (aria-disabled, not disabled) and must change nothing
  await page.locator('#keep-window').click({ force: true });
  await expect(page.locator('#keep-window')).toHaveClass(/is-done/);
  await expect(page.locator('#keep-window .label-done')).toContainText('23A is yours');
  await expect.poll(() => page.locator('#keep-window').evaluate((b) => getComputedStyle(b).backgroundColor)).toBe('rgb(0, 93, 175)');
  expect((await state(page)).confirmedSeat).toBe('23A');
});

test('confirmation never leaks into another seat', async ({ page }) => {
  await ready(page);
  await tapSeat(page, '23A');
  await settled(page, 1);
  await page.locator('#keep-window').click();
  await page.locator('#back').click();
  await settled(page, 0);
  await expect(page.locator('#map-title')).toHaveText('23A is yours');

  await tapSeat(page, '5A');
  await settled(page, 1);
  await expect(page.locator('#title .title-b')).toHaveText('Window view · 5A');
  await expect(page.locator('#keep-window')).not.toHaveClass(/is-done/);
  await expect(page.locator('#keep-window-label')).toHaveText('Keep seat 5A');
  expect((await state(page)).confirmedSeat).toBe('23A');
});

test('rapid taps and repeated back never strand the camera', async ({ page }) => {
  await ready(page);
  for (let i = 0; i < 3; i++) {
    await tapSeat(page, '23A');
    await page.waitForTimeout(150 + i * 120);
    await page.locator('#back').click();
    await page.locator('#back').click();
    await page.waitForTimeout(90);
    await tapSeat(page, '11A');
  }
  await page.waitForTimeout(2600);
  const s = await state(page);
  expect([0, 1]).toContain(s.progress);
  expect(s.view).toBe(s.progress === 1 ? 'preview' : 'map');
});

test('keyboard: seat grid, timeline, shade and Escape', async ({ page }) => {
  await ready(page);
  await page.keyboard.press('Tab'); // back
  await page.keyboard.press('Tab'); // seat grid (1A)
  await expect(page.locator('#seat-grid [data-seat="1A"]')).toBeFocused();
  for (let i = 0; i < 22; i++) await page.keyboard.press('ArrowDown');
  await expect(page.locator('#seat-grid [data-seat="23A"]')).toBeFocused();
  await expect(page.locator('#focus-label')).toHaveClass(/is-on/);
  await page.keyboard.press('Enter');
  await settled(page, 1);
  await expect(page.locator('#timeline')).toBeFocused();
  for (let i = 0; i < 35; i++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('#clock')).toHaveText('16:40');
  await expect(page.locator('#timeline')).toHaveAttribute('aria-valuetext', /16:40, Cruise\. The Pyrenees on your left/);

  await page.locator('#shade-handle').focus();
  await page.keyboard.press('End');
  await expect(page.locator('#shade-handle')).toHaveAttribute('aria-valuetext', 'Shade closed');
  await page.keyboard.press('Home');
  await expect(page.locator('#shade-handle')).toHaveAttribute('aria-valuetext', 'Shade open');

  await page.keyboard.press('Escape');
  await settled(page, 0);
  await expect(page.locator('#seat-grid [data-seat="23A"]')).toBeFocused();
});

test('taken and non-window seats explain themselves instead of doing nothing', async ({ page }) => {
  await ready(page);
  await tapSeat(page, '10A');
  await expect(page.locator('#map-title')).toHaveText('10A is taken');
  await tapSeat(page, '12C');
  await expect(page.locator('#map-title')).toHaveText('12C is an aisle seat');
  const s = await state(page);
  expect(s.view).toBe('map');
  expect(s.selectedSeat).toBeNull();
});

test('reduced motion replaces the flight with a short cross-fade', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  const t0 = Date.now();
  await tapSeat(page, '23A');
  await settled(page, 1, 3000);
  expect(Date.now() - t0).toBeLessThan(1000);
  await page.locator('#back').click();
  await settled(page, 0, 3000);
});

test('lightweight fallback works without WebGL', async ({ page }) => {
  await ready(page, '&fallback');
  await expect(page.locator('#stage')).toBeHidden();
  await page.locator('.fb-seat[data-seat="23A"]').click();
  await settled(page, 1);
  await expect(page.locator('#title .title-b')).toHaveText('Window view · 23A');
  await expect(page.locator('#shade-handle')).toBeVisible();
  await dragShade(page, 0.7);
  expect(Math.round((await state(page)).shade * 100)).toBeGreaterThanOrEqual(65);
  await page.locator('#keep-window').click();
  await expect(page.locator('#keep-window')).toHaveClass(/is-done/);
});

for (const [w, h] of [[360, 800], [430, 932], [768, 1024], [1440, 900], [844, 390]] as const) {
  test(`layout ${w}×${h}: no horizontal overflow, controls stay on screen`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await ready(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => (window as unknown as { __seatPreview: { stage: { revealSeat(id: string): void } } }).__seatPreview.stage.revealSeat('23A'));
    await page.waitForTimeout(400);
    await tapSeat(page, '23A');
    await settled(page, 1);
    const btn = (await page.locator('#keep-window').boundingBox())!;
    const tl = (await page.locator('#timeline').boundingBox())!;
    expect(btn.y + btn.height).toBeLessThanOrEqual(h);
    expect(tl.y).toBeGreaterThan(0);
    expect(btn.x).toBeGreaterThanOrEqual(0);
    expect(btn.x + btn.width).toBeLessThanOrEqual(w);
  });
}
