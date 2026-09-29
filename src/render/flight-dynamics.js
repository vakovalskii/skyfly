// Reactive motion signals. Derivatives use real dt; yaw crosses ±π without a spike.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function createFlightDynamics() {
  let previous = null;
  const values = { bank: 0, brake: 0, drive: 0, pitch: 0, turn: 0 };
  return {
    values,
    reset() { previous = null; for (const key in values) values[key] = 0; },
    update({ speed = 0, yaw = 0, pitch = 0, braking = false, active = true }, dt) {
      if (!(dt > 0)) return values;
      const acceleration = previous && active && previous.active ? (speed - previous.speed) / dt : 0;
      const angle = previous ? Math.atan2(Math.sin(yaw - previous.yaw), Math.cos(yaw - previous.yaw)) : 0;
      const turn = active ? clamp(angle / dt, -2.5, 2.5) : 0;
      const targets = {
        bank: -turn * .28 * clamp(speed / 25, 0, 1), turn,
        brake: active ? Math.max(braking && speed > 2 ? 1 : 0, clamp((-acceleration - 18) / 95, 0, 1)) : 0,
        drive: active ? clamp((acceleration - 8) / 100, 0, 1) : 0,
        pitch: active ? pitch : 0,
      };
      for (const key in values) {
        const rate = key === 'brake' ? 9 : key === 'pitch' ? 12 : 7;
        values[key] += (targets[key] - values[key]) * (1 - Math.exp(-rate * dt));
      }
      previous = { speed, yaw, active };
      return values;
    },
  };
}
