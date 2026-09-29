// The release follows extension, not the start of the extension movement.
export const BOOST_RELEASE_PHASE = 1.02 / 1.5;
export const LAUNCH_RELEASE_PHASE = .76 / .96;
export function flightReleasePhase(state) {
  return state === 'booststart' ? BOOST_RELEASE_PHASE : ['flystart', 'jumpfly'].includes(state) ? LAUNCH_RELEASE_PHASE : 0;
}
export function createFlightPresentation() {
  let previousSpeed = 0, previous = null, approachSpeed = 0;
  return {
    update(visual, speed) {
      const start = flightReleasePhase(visual?.state);
      if (start && (visual.state !== previous?.state || visual.time < previous.time)) approachSpeed = previousSpeed;
      const phase = (visual?.time || 0) / Math.max(.01, visual?.duration || 1);
      const t = start ? Math.min(1, Math.max(0, (phase - start) / .08)) : 1;
      const blend = t * t * (3 - 2 * t);
      const shown = Math.min(speed, approachSpeed) * (1 - blend) + speed * blend;
      previousSpeed = speed; previous = visual ? { ...visual } : null;
      return { speed: shown, releaseReady: !start || phase >= start };
    },
  };
}
