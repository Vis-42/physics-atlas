import { P } from './paint';
import { T, flight, glide, stepCamera } from './camera';
import { hashPending } from './nav';
import { update } from './focus';
import { draw } from './draw';

// ---------- frame loop: one requestAnimationFrame at a time, only while something is changing
export let raf = 0, last = 0, moving = false;
export function kick() { if (!raf && typeof requestAnimationFrame !== 'undefined') raf = requestAnimationFrame(tick); }
// Anything still easing toward its target keeps the loop running for another frame.
export function markMoving() { moving = true; }
export function tick(now) {
  raf = 0;
  const dt = last ? Math.min(64, now - last) : 16;
  last = now;
  moving = stepCamera(now, dt);
  P.T = T;
  update(dt);
  draw();
  if (moving || flight || glide || hashPending) kick(); else last = 0;
}
