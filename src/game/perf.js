// СТАТИСТИКА ОТРИСОВКИ (клавиша I): куда уходит кадр.
// • По проходам (тени, сцена, облака и небо, пост, поверх): вызовы отрисовки, треугольники и время
//   видеокарты — через EXT_disjoint_timer_query_webgl2, если браузер его даёт (иначе «—»).
//   Проходы не вкладываются: вложенный (тени внутри сцены) ставит внешний на паузу.
// • По содержимому сцены: сколько объектов и треугольников в каждой группе (рельеф, дома…),
//   сколько из них попадает в кадр (сфера объекта против пирамиды камеры) и отбрасывает тень.
// • Дальности: near/far камеры, край рельефа, дома подробно/упрощённо, тени; размер буфера кадра.
// Пока панель закрыта, замеры не ведутся (кроме счётчиков renderer.info — они бесплатны).
import * as THREE from 'three';

export function createPerf(renderer, scene, overlay, camera) {
  const gl = renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const info = renderer.info;
  info.autoReset = false;                     // композер рисует много раз за кадр — считаем сами

  const el = document.createElement('pre');
  el.id = 'perf';
  el.style.cssText = 'position:fixed;left:12px;top:64px;z-index:30;margin:0;padding:10px 12px;max-height:80vh;overflow:auto;'
    + 'background:rgba(8,14,22,.82);color:#d8e6f2;font:11px/1.45 ui-monospace,Menlo,monospace;border-radius:8px;'
    + 'pointer-events:none;display:none;white-space:pre';
  document.body.appendChild(el);
  let on = false;
  addEventListener('keydown', (e) => {
    if (e.code !== 'KeyI' || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    on = !on; el.style.display = on ? 'block' : 'none';
  });

  // ---- проходы: вызовы/треугольники (всегда) и время ГП (когда панель открыта) ----
  const stat = new Map();                    // label → { calls, tris, gpu (EMA мс) }
  const cur = new Map();                     // label → { calls, tris } этого кадра
  const stack = [];
  let mark = { calls: 0, tris: 0 }, active = null, frameId = 0;
  const pending = [];                        // { q, label, f }
  const gpuFrame = new Map();                // f → { left, sums: Map }
  const take = () => {                       // приписать набежавшее с прошлой отметки текущему проходу
    const top = stack[stack.length - 1] || 'прочее';
    const c = cur.get(top) || { calls: 0, tris: 0 };
    c.calls += info.render.calls - mark.calls; c.tris += info.render.triangles - mark.tris;
    cur.set(top, c);
    mark = { calls: info.render.calls, tris: info.render.triangles };
  };
  const stopQ = () => { if (active) { gl.endQuery(ext.TIME_ELAPSED_EXT); active = null; } };
  const startQ = (label) => {
    if (!ext || !on) return;
    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    active = q;
    pending.push({ q, label, f: frameId });
    const g = gpuFrame.get(frameId) || { left: 0, sums: new Map() };
    g.left++; gpuFrame.set(frameId, g);
  };
  const begin = (label) => { take(); stopQ(); stack.push(label); startQ(label); };
  const end = () => { take(); stopQ(); stack.pop(); if (stack.length) startQ(stack[stack.length - 1]); };
  const wrap = (obj, fn, label) => {
    const orig = obj[fn];
    obj[fn] = function (...a) { begin(typeof label === 'function' ? label(...a) : label); try { return orig.apply(this, a); } finally { end(); } };
  };
  wrap(renderer.shadowMap, 'render', 'тени');

  function pollGpu() {
    if (!ext) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    for (let i = 0; i < pending.length;) {
      const p = pending[i];
      if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) { i++; continue; }
      const ns = gl.getQueryParameter(p.q, gl.QUERY_RESULT);
      gl.deleteQuery(p.q);
      pending.splice(i, 1);
      const g = gpuFrame.get(p.f);
      if (!g) continue;
      if (!disjoint) g.sums.set(p.label, (g.sums.get(p.label) || 0) + ns / 1e6);
      if (--g.left === 0) {
        gpuFrame.delete(p.f);
        let total = 0;
        for (const [label, ms] of g.sums) {
          total += ms;
          const s = stat.get(label) || { calls: 0, tris: 0, gpu: ms };
          s.gpu += (ms - s.gpu) * 0.1; stat.set(label, s);
        }
        gpuTotal += (total - gpuTotal) * 0.1;
      }
    }
    if (pending.length > 300) { for (const p of pending) gl.deleteQuery(p.q); pending.length = 0; gpuFrame.clear(); }
  }

  // ---- содержимое сцены ----
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sphere = new THREE.Sphere();
  let inventory = [];
  function survey() {
    pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    const rows = new Map();
    const walk = (root, fallback) => root.traverseVisible((o) => {
      if (!(o.isMesh || o.isPoints || o.isLine)) return;
      let cat = fallback;
      for (let p = o; p; p = p.parent) if (p.userData.perfCat) { cat = p.userData.perfCat; break; }
      const r = rows.get(cat) || { n: 0, tris: 0, draws: 0, inView: 0, trisView: 0, cast: 0, culled: 0 };
      const g = o.geometry;
      const count = g.index ? g.index.count : (g.attributes.position?.count || 0);
      const prims = o.isMesh ? count / 3 : count;
      const draws = o.isMesh && g.groups.length ? g.groups.length : 1;
      r.n++; r.tris += prims; r.draws += draws;
      if (o.frustumCulled) r.culled++;
      let vis = true;
      if (o.frustumCulled && g) {
        if (!g.boundingSphere) g.computeBoundingSphere();
        vis = frustum.intersectsSphere(sphere.copy(g.boundingSphere).applyMatrix4(o.matrixWorld));
      }
      if (vis) { r.inView++; r.trisView += prims; }
      if (o.castShadow) r.cast++;
      rows.set(cat, r);
    });
    walk(scene, 'прочее');
    walk(overlay, 'поверх кадра');
    inventory = [...rows].sort((a, b) => b[1].tris - a[1].tris);
  }

  let t0 = 0, tRender = 0, cpuUpd = 0, cpuRen = 0, gpuTotal = 0, fps = 60, lastEnd = performance.now();
  const K = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`);
  const pad = (s, n) => String(s).padStart(n);
  const padR = (s, n) => String(s).padEnd(n);
  const M = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} км` : `${Math.round(v)} м`);

  return {
    get on() { return on; },
    begin, end, wrap,
    // проходы композера: labels[i] — имя i-го прохода
    watchPasses(composer, labels) {
      composer.passes.forEach((p, i) => wrap(p, 'render', labels[i] || p.name || `проход ${i}`));
    },
    frameStart() {
      t0 = performance.now();
      info.reset();
      mark = { calls: 0, tris: 0 };
      cur.clear();
      frameId++;
      if (on) pollGpu();
    },
    renderStart() { tRender = performance.now(); },
    // dist — строки про дальности (подписи → значения в метрах или текст)
    frameEnd(dist) {
      take();
      const now = performance.now();
      cpuUpd += ((tRender || now) - t0 - cpuUpd) * 0.1;
      cpuRen += (now - (tRender || now) - cpuRen) * 0.1;
      fps += (1000 / Math.max(1, now - lastEnd) - fps) * 0.05; lastEnd = now;
      for (const [label, c] of cur) {
        const s = stat.get(label) || { calls: 0, tris: 0, gpu: 0 };
        s.calls = c.calls; s.tris = c.tris; stat.set(label, s);
      }
      if (!on || frameId % 15) return;
      if (frameId % 30 === 0) survey();
      const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
      const L = [];
      L.push(`${fps.toFixed(0)} к/с   ЦП: логика ${cpuUpd.toFixed(1)} мс, отправка ${cpuRen.toFixed(1)} мс   ГП: ${ext ? `${gpuTotal.toFixed(1)} мс` : 'таймер недоступен'}`);
      L.push(`буфер ${buf.x}×${buf.y} (×${renderer.getPixelRatio()})   программ ${info.programs?.length ?? '?'}   геометрий ${info.memory.geometries}   текстур ${info.memory.textures}`);
      L.push('');
      L.push(`${padR('проход', 16)}${pad('вызовов', 8)}${pad('треуг.', 9)}${pad('ГП мс', 8)}`);
      let calls = 0, tris = 0;
      for (const [label, s] of [...stat].sort((a, b) => b[1].tris - a[1].tris)) {
        calls += s.calls; tris += s.tris;
        L.push(`${padR(label, 16)}${pad(s.calls, 8)}${pad(K(s.tris), 9)}${pad(ext ? s.gpu.toFixed(2) : '—', 8)}`);
      }
      L.push(`${padR('итого', 16)}${pad(calls, 8)}${pad(K(tris), 9)}`);
      L.push('');
      L.push(`${padR('в сцене', 16)}${pad('объект.', 8)}${pad('в кадре', 8)}${pad('треуг.', 9)}${pad('в кадре', 9)}${pad('вызов.', 7)}${pad('тень', 6)}${pad('отсеч.', 7)}`);
      for (const [cat, r] of inventory) {
        L.push(`${padR(cat, 16)}${pad(r.n, 8)}${pad(r.inView, 8)}${pad(K(r.tris), 9)}${pad(K(r.trisView), 9)}${pad(r.draws, 7)}${pad(r.cast, 6)}${pad(r.culled, 7)}`);
      }
      if (dist) {
        L.push('');
        for (const [k, v] of Object.entries(dist)) L.push(`${padR(k, 22)}${typeof v === 'number' ? M(v) : v}`);
      }
      L.push('');
      L.push('«отсеч.» — сколько объектов проверяются на попадание в кадр; остальные рисуются всегда');
      el.textContent = L.join('\n');
    },
  };
}
