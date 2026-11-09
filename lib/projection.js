// Oblique Equal Earth: relative geographic areas are preserved everywhere.
// Rotation changes framing, not regional weights; density is handled by the display layout.
import { geoEqualEarth, geoStream } from 'd3-geo';

export function makeProjection() {
  // Preserve the original world-unit scale so research symbols keep their established sizes.
  const reference = geoEqualEarth().scale(1).translate([0, 0]);
  const a = reference([-2, 49.9]), b = reference([-2, 58.7]);
  const projection = geoEqualEarth().rotate([-10, -35, 0])
    .scale(1000 / Math.abs(a[1] - b[1])).translate([0, 0]).precision(2);
  return { projection, period: 0, band: null };
}

// Use the projection's spherical clipping and adaptive sampling, including its rotated seam.
export function projectedSegments(projection, geometry) {
  const segments = [];
  let current;
  geoStream(geometry, projection.stream({
    lineStart() { current = []; },
    point(x, y) { current?.push([x, y]); },
    lineEnd() { if (current?.length > 1) segments.push(current); current = null; },
    polygonStart() {}, polygonEnd() {}, sphere() {},
  }));
  return segments;
}

// ---- wrapping
// The copy of world x nearest to `near` (both in world units).
export const nearest = (x, near, period) => (period ? x + period * Math.round((near - x) / period) : x);
// A difference in x taken the short way round the world.
export const shortDx = (d, period) => (period ? d - period * Math.round(d / period) : d);
