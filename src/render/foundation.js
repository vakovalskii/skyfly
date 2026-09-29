// One height shared by the building mesh and its colliders. Missing DEM samples
// never mean sea level; refinements converge without moving a block in one frame.
export function refineFoundation(tile, height, zoom, dt) {
  if (zoom >= 0 && Number.isFinite(height) && zoom >= (tile.baseZ ?? -1)) {
    tile.baseTarget = height; tile.baseZ = zoom;
    if (tile.base === undefined) tile.base = height;
  }
  if (tile.base === undefined || tile.baseTarget === undefined) return false;
  const delta = tile.baseTarget - tile.base;
  const limit = 3 * Math.max(0, Math.min(.05, dt));
  tile.base += Math.max(-limit, Math.min(limit, delta * (1 - Math.exp(-2 * dt))));
  return true;
}
