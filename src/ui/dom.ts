export function $<T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
}

/** Polite screen-reader announcements (re-announces identical text). */
export class Announcer {
  private timer = 0;
  constructor(private readonly el: HTMLElement) {}
  say(text: string) {
    window.clearTimeout(this.timer);
    this.el.textContent = '';
    this.timer = window.setTimeout(() => {
      this.el.textContent = text;
    }, 60);
  }
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
