/**
 * Shared cm → world-unit IPD mapping for every stereo surface
 * (anaglyph on-canvas, side-by-side recording compositor).
 *
 * Convention (established by StereoCompositor, v12): the mesh's
 * bounding-box X extent is the reference — a 1-unit-wide mesh maps
 * centimetres directly to `cm / 100` world units; a 10-unit-wide mesh
 * scales the eye offset up proportionally so perceived depth looks the
 * same on screen regardless of mesh scale.
 *
 * One concept, one source: both stereo consumers MUST route through
 * this function so a change to the convention can never drift between
 * surfaces.
 */
export function worldIpdFromCm(ipdCm: number, meshWidth: number): number {
  const cm = Math.max(0.1, ipdCm);
  if (!isFinite(meshWidth) || meshWidth <= 0) {
    // Degenerate bbox (mesh not built yet) — plain cm-to-units.
    return cm / 100;
  }
  return (cm / 100) * meshWidth;
}
