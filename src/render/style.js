// Оформление: «сетка» — голая геометрия без текстур (быстро, видно структуру),
// «полное» — снимки Земли, фасады, ветер и смаз (по умолчанию). Сетка — в адресе: ?style=grid
const q = new URLSearchParams(location.search).get('style');
// по умолчанию — снимки Земли и фасады, как в стартовой версии; сетка — только по ?style=grid
// (без запоминания в localStorage: раньше отладочный режим залипал между запусками)
export const STYLE = q || 'full';
export const GRID = STYLE === 'grid';
// Переключение прямо из игры: стиль собирается при загрузке (материалы, тайлы), поэтому
// перезагружаем страницу с другим ?style=, а место и позу героя кладём в sessionStorage —
// после «В НЕБО» игрок продолжит там же (resume() в main.js).
export function toggleStyle(state) {
  try { sessionStorage.setItem('skyfly-resume', JSON.stringify(state)); } catch { /* без памяти — начнём с крыши */ }
  const u = new URL(location.href);
  u.searchParams.set('style', GRID ? 'full' : 'grid');
  location.href = u.toString();
}
export function takeResume() {
  try { const s = sessionStorage.getItem('skyfly-resume'); sessionStorage.removeItem('skyfly-resume'); return s ? JSON.parse(s) : null; } catch { return null; }
}
// Каркасные линии сетки: вблизи показывают структуру, с высоты сливаются в муар —
// поэтому все каркасы регистрируются здесь и гаснут с высотой (fadeWires в главном цикле).
const WIRES = [];
let gain = 1;
export const wire = (mat) => {
  mat.transparent = true; mat.userData.base = mat.opacity; mat.userData.color = mat.color.clone();
  mat.color.copy(mat.userData.color).multiplyScalar(gain);
  WIRES.push(mat); return mat;
};
// Неосвещаемые линии не знают про экспозицию атмосферы takram (×10) — приглушаем их цвет сами
// GLOW — та же поправка для светящихся полос на зданиях (у них emissive, свет сцены их не касается)
export const GLOW = { value: 1 };
export function setWireGain(g) { gain = g; GLOW.value = g; for (const m of WIRES) m.color.copy(m.userData.color).multiplyScalar(g); }
export function fadeWires(alt) {
  const k = 1 - Math.min(1, Math.max(0, (alt - 1500) / 4500));
  for (const m of WIRES) { m.opacity = m.userData.base * k; m.visible = k > 0.01; }
}
