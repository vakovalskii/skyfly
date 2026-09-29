// КООРДИНАТНАЯ СЕТКА ЗЕМЛИ. Единственное место, где широта/долгота превращаются в метры.
//
// Три системы координат, и путаница между ними — источник почти всех багов:
//   1. Геодезическая: lat (широта, °), lon (долгота, °), alt (метры над уровнем моря).
//      В ней хранится положение игрока и всё, что приходит по сети.
//   2. Локальная метровая (ENU): восток +X, вверх +Y, север −Z. Начало — под игроком.
//      В ней живёт вся сцена three.js. Север стал −Z, потому что в three камера смотрит в −Z.
//   3. Тайловая (Web Mercator z/x/y): в ней нумеруются тайлы снимков и высот.
//
// Плоское приближение (метры на градус) годится в пределах пары сотен километров — этого
// хватает: дальше игрок всё равно видит только грубые тайлы.

export const R = 6_371_000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// Сфера радиуса R — ровно как в tools/fetch-osm.mjs, по которому разложены дома в data/*.json.
// Раньше здесь было 110 540 м/° (экваториальное значение по широте): дома и снимок расходились
// на ~36 м у края Москвы, а физика и рельеф — между собой.
const M_PER_DEG = (R * Math.PI) / 180;           // ≈ 111 195 м
export const metersPerLat = () => M_PER_DEG;
export const metersPerLon = (lat) => M_PER_DEG * Math.cos(rad(lat));

// геодезическая → локальная (метры от точки отсчёта): [восток, север]
export function toLocal(lat, lon, originLat, originLon) {
  return [(lon - originLon) * metersPerLon(originLat), (lat - originLat) * metersPerLat()];
}
// локальная → геодезическая
export function fromLocal(east, north, originLat, originLon) {
  return [originLat + north / metersPerLat(), originLon + east / metersPerLon(originLat)];
}
// сдвиг по поверхности на восток/север (метры)
export const offsetGeo = (lat, lon, east, north) => fromLocal(east, north, lat, lon);

// расстояние по дуге (формула гаверсинуса — на тысячах километров плоская не годится)
export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
// азимут на цель, радианы от севера по часовой
export function bearing(a, b) {
  const dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
  return Math.atan2(y, x);
}
// Цель в локальных метрах вокруг игрока: [восток, север, расстояние].
// ВАЖНО: считаем той же плоской проекцией, что и offsetGeo. Раньше здесь была дуга (haversine),
// и две проекции расходились на 15 м уже в километре — герой промахивался мимо крыши и падал внутрь дома.
export function offsetTo(from, to) {
  const [east, north] = toLocal(to.lat, to.lon, from.lat, from.lon);
  return [east, north, Math.hypot(east, north)];
}

// --- тайлы Web Mercator ---
export const lon2tile = (lon, z) => ((lon + 180) / 360) * 2 ** z;
export const lat2tile = (lat, z) => ((1 - Math.log(Math.tan(rad(lat)) + 1 / Math.cos(rad(lat))) / Math.PI) / 2) * 2 ** z;
export const tile2lon = (x, z) => (x / 2 ** z) * 360 - 180;
export const tile2lat = (y, z) => { const n = Math.PI - (2 * Math.PI * y) / 2 ** z; return deg(Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))); };
export const tileMeters = (z, lat) => (40_075_016.686 * Math.cos(rad(lat))) / 2 ** z;

// просадка горизонта от кривизны на расстоянии d
export const curvatureDrop = (d) => (d * d) / (2 * R);
// плотность воздуха (для ветра, звука и сопротивления)
export const density = (alt) => Math.exp(-alt / 8500);
