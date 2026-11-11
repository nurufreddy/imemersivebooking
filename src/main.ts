import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles.css';
import { App } from './app/App';
import type { StageLike } from './app/types';
import { BEATS, SEAT_BY_ID, TIMELINE } from './config/demoFlight';
import { FallbackStage } from './fallback/FallbackStage';
import { $ } from './ui/dom';

const MONO = '"Geist Mono Variable", ui-monospace, monospace';

async function fontsReady() {
  const wait = Promise.all([
    document.fonts.load('600 16px "Geist Variable"'),
    document.fonts.load('500 32px "Geist Mono Variable"'),
  ]);
  await Promise.race([wait, new Promise((r) => setTimeout(r, 2500))]);
}

function webglAvailable() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

const idle = (fn: () => void) => {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 1500 });
  else setTimeout(fn, 400);
};

async function boot() {
  const root = $('#app');
  const loader = $('#loader');
  // only show the loading state when start-up is noticeably slow
  const loaderTimer = window.setTimeout(() => loader.classList.add('is-visible'), 250);
  performance.mark('sp:boot');
  await fontsReady();
  performance.mark('sp:fonts');

  const canvas = $<HTMLCanvasElement>('#stage');
  const fallbackEl = $('#fallback');
  const params = new URLSearchParams(location.search);
  const wantWebGL = !params.has('fallback') && webglAvailable();

  let app!: App;
  let stage!: StageLike;
  const events = {
    onProgress: (p: number) => app.onProgress(p),
    onSettled: (v: 'map' | 'preview') => app.onSettled(v),
    onFrame: () => app.positionOverlays(),
  };

  const startFallback = () => {
    canvas.hidden = true;
    app = new App(root, fallbackEl);
    stage = new FallbackStage(fallbackEl, events);
    app.attach(stage);
  };

  if (wantWebGL) {
    try {
      const { Stage3D } = await import('./scene/Stage3D');
      performance.mark('sp:module');
      app = new App(root, canvas);
      let restoreTimer = 0;
      const s3 = new Stage3D(
        canvas,
        {
          ...events,
          onContextLost: () => {
            // give the browser a chance to restore the context, otherwise continue without WebGL
            restoreTimer = window.setTimeout(() => {
              const url = new URL(location.href);
              url.searchParams.set('fallback', '1');
              location.replace(url.toString());
            }, 3000);
          },
        },
        MONO,
        TIMELINE.start,
      );
      canvas.addEventListener('webglcontextrestored', () => {
        window.clearTimeout(restoreTimer);
        s3.requestRender();
      });
      stage = s3;
      app.attach(s3);
      performance.mark('sp:built');
      await s3.warmUp();
      performance.mark('sp:warm');
      app.relayout();
      idle(() => void s3.library.preload([...new Set([...BEATS.port, ...BEATS.starboard].map((b) => b.imageId))]));
    } catch (err) {
      console.warn('[seat-preview] WebGL stage unavailable — using the lightweight seat map', err);
      startFallback();
    }
  } else {
    startFallback();
  }

  const ro = new ResizeObserver(() => app.relayout());
  ro.observe(root);
  window.addEventListener('orientationchange', () => setTimeout(() => app.relayout(), 120));
  document.fonts.addEventListener?.('loadingdone', () => app.relayout());

  window.clearTimeout(loaderTimer);
  requestAnimationFrame(() => loader.classList.remove('is-visible'));

  if (params.has('e2e') || import.meta.env.DEV) {
    (window as unknown as { __seatPreview: unknown }).__seatPreview = {
      app,
      get stage() {
        return stage;
      },
      seatScreen: (id: string) => stage.seatScreen(id),
      shadeHandle: () => stage.shadeHandle(),
      state: () => app.snapshot(),
      seat: (id: string) => SEAT_BY_ID.get(id),
    };
  }
}

void boot();
