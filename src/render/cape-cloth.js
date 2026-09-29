// A damped spring sheet. Fixed substeps keep its response independent of frame rate.
// Targets supply airflow/gravity; edge constraints keep neighbouring particles together.
export function createCapeCloth(columns, rows) {
  const length = (columns + 1) * (rows + 1) * 3;
  const position = new Float32Array(length), velocity = new Float32Array(length);
  const pinnedRows = Math.floor(rows * .1);
  let initialized = false;
  function constrain(target, a, b) {
    let d2 = 0, rest2 = 0;
    for (let k = 0; k < 3; k++) { d2 += (position[b + k] - position[a + k]) ** 2; rest2 += (target[b + k] - target[a + k]) ** 2; }
    const limit = Math.sqrt(rest2) * 1.06, distance = Math.sqrt(d2);
    if (distance <= limit || distance < 1e-8) return;
    const pinA = a / 3 < (pinnedRows + 1) * (columns + 1), pinB = b / 3 < (pinnedRows + 1) * (columns + 1);
    if (pinA && pinB) return;
    const correction = (distance - limit) / distance / (pinA || pinB ? 1 : 2);
    for (let k = 0; k < 3; k++) { const d = (position[b + k] - position[a + k]) * correction; if (!pinA) position[a + k] += d; if (!pinB) position[b + k] -= d; }
  }
  return {
    update(target, dt, reset = false) {
      if (!initialized || reset) { position.set(target); velocity.fill(0); initialized = true; return position; }
      const steps = Math.max(1, Math.ceil(Math.min(.05, dt) * 120)), h = Math.min(.05, Math.max(0, dt)) / steps;
      for (let step = 0; step < steps; step++) {
        for (let row = 0; row <= rows; row++) {
          const free = row / rows, spring = 42 + 110 * (1 - free) ** 3, damping = 6 + (1 - free) * 9;
          for (let col = 0; col <= columns; col++) for (let k = 0; k < 3; k++) {
            const i = (row * (columns + 1) + col) * 3 + k;
            if (row <= pinnedRows) { position[i] = target[i]; velocity[i] = 0; continue; }
            velocity[i] += ((target[i] - position[i]) * spring - velocity[i] * damping) * h;
            position[i] += velocity[i] * h;
          }
        }
        for (let iteration = 0; iteration < 3; iteration++) for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
          const a = (row * (columns + 1) + col) * 3;
          if (col < columns) constrain(target, a, a + 3);
          if (row < rows) constrain(target, a, a + (columns + 1) * 3);
        }
      }
      return position;
    },
    correct(index, x, y, z) {
      if (Math.abs(position[index] - x) > 1e-6) { position[index] = x; velocity[index] = 0; }
      if (Math.abs(position[index + 1] - y) > 1e-6) { position[index + 1] = y; velocity[index + 1] = 0; }
      if (Math.abs(position[index + 2] - z) > 1e-6) { position[index + 2] = z; velocity[index + 2] = 0; }
    },
  };
}
