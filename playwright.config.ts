import { defineConfig } from '@playwright/test';

// The 3D stage needs WebGL 2. On macOS Chrome uses the GPU through ANGLE/Metal;
// elsewhere fall back to SwiftShader so CI machines without a GPU still run.
const gpuArgs =
  process.platform === 'darwin'
    ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5199',
    // Set PW_CHANNEL=chrome to use an installed Google Chrome instead of Playwright's Chromium.
    channel: process.env.PW_CHANNEL || undefined,
    launchOptions: { args: gpuArgs },
    viewport: { width: 390, height: 846 },
    deviceScaleFactor: 2,
  },
  webServer: {
    command: 'npm run dev -- --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
