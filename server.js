// WS-сервер «Полёта»: рассылает позиции 12 Гц и чат. Физику считает каждый клиент сам.
// Запуск: node server.js (порт 8791 по умолчанию), маршрут /fly-ws.
import { WebSocketServer } from 'ws';
import { createPlayerStore, savedPosition } from './player-store.js';
import { createNicknameModerator, normalizeNickname } from './nickname-moderation.js';
import { readFileSync } from 'node:fs';

const PORT = process.env.PORT || 8791;
const wss = new WebSocketServer({ port: PORT, maxPayload: 4096 });
const players = new Map();
const store = createPlayerStore(process.env.SKYFLY_STATE_FILE || './state/players.json');
const owners = new Map();
const checkNickname = createNicknameModerator();
let currentRelease;
function announceUpdate(p) {
  if (!currentRelease || !p.joined || p.clientRelease === currentRelease || p.noticedRelease === currentRelease || p.ws.readyState !== 1) return;
  p.noticedRelease = currentRelease;
  p.ws.send(JSON.stringify({ t: 'update', release: currentRelease }));
  p.ws.send(JSON.stringify({ t: 'chat', from: '•', text: 'Доступна новая версия: управление мышью, игроки на карте и другие улучшения. Обнови страницу, когда будешь готов (запись видео сначала сохрани).' }));
}
function readRelease() {
  if (!process.env.SKYFLY_RELEASE_FILE) return;
  try { currentRelease = JSON.parse(readFileSync(process.env.SKYFLY_RELEASE_FILE, 'utf8')).release; } catch { return; }
  for (const p of players.values()) announceUpdate(p);
}
readRelease(); setInterval(readRelease, 30000).unref();
const joinLimits = new Map();
function joinWait(ip) {
  const now = Date.now(), old = joinLimits.get(ip);
  const entry = old && old.until > now ? old : { count: 0, until: now + 60000 };
  joinLimits.set(ip, entry);
  for (const [key, value] of joinLimits) if (value.until <= now) joinLimits.delete(key);
  return ++entry.count <= 12 ? 0 : Math.max(1, Math.ceil((entry.until - now) / 1000));
}
const savePlayer = p => { if (p.key && owners.get(p.key) === p.id) store.save(p.key, p.saved); };
setInterval(() => { try { store.flush(); } catch (e) { console.error('Position save failed:', e.message); } }, 5000).unref();
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  for (const p of players.values()) savePlayer(p);
  try { store.flush(); } catch (e) { console.error('Position save failed:', e.message); process.exit(1); }
  process.exit(0);
});
let nextId = 1;

const clean = (s) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120);
const num = (v, lim) => (Number.isFinite(+v) ? Math.max(-lim, Math.min(lim, +v)) : 0);

wss.on('connection', (ws, req) => {
  const id = nextId++;
  const p = { id, ws, name: `Герой${id}`, s: null, chatAt: 0, joined: false, joining: false };
  // Local nginx appends the real peer last; ignore spoofable client X-Real-IP.
  const peer = req.socket.remoteAddress;
  const ip = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)
    ? String(req.headers['x-forwarded-for'] || '').split(',').at(-1).trim() || peer : peer;
  players.set(id, p);
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  // ws emits an error before close for invalid/oversized frames. It is not fatal to the service.
  ws.on('error', () => {});
  ws.send(JSON.stringify({ t: 'hi', id, build: BUILD }));

  ws.on('message', async (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join') {
      if (p.joining) return;
      const retryAfter = joinWait(ip);
      if (retryAfter) {
        ws.send(JSON.stringify({ t: 'join_error', code: 'rate', retryAfter, message: 'Слишком много попыток. Подожди минуту.' })); return;
      }
      p.joining = true;
      const candidate = normalizeNickname(m.name) || `Герой${id}`;
      const verdict = await checkNickname(candidate);
      p.joining = false;
      if (ws.readyState !== 1) return;
      if (!verdict.allowed && m.protocol >= 2) {
        ws.send(JSON.stringify({ t: 'join_error', code: verdict.code, message: verdict.code === 'unavailable'
          ? 'Проверка ника временно недоступна. Попробуй снова или оставь поле пустым.'
          : 'Этот ник не подходит. Выбери другой — без мата, оскорблений и рекламы.' })); return;
      }
      // Older open tabs can reconnect safely without understanding join_error.
      p.name = verdict.allowed ? candidate : `Герой${id}`;
      p.joined = true;
      p.clientRelease = typeof m.release === 'string' ? m.release : null;
      const nextKey = store.key(m.token);
      if (nextKey !== p.key) {
        savePlayer(p);
        if (owners.get(p.key) === id) owners.delete(p.key);
        p.key = nextKey;
        p.saved = null; p.s = null;
      }
      if (p.key) owners.set(p.key, id);
      ws.send(JSON.stringify({ t: 'joined', name: p.name, resume: p.key ? store.get(p.key) : null }));
      announceUpdate(p);
      broadcast({ t: 'chat', from: '•', text: `${p.name} в небе` });
      return;
    }
    if (!p.joined) return;
    if (m.t === 's') {
      const saved = savedPosition(m);
      if (!saved) return;
      p.saved = saved;
      savePlayer(p);
      p.s = {
        lat: num(m.lat, 90), lon: num(m.lon, 180), alt: num(m.alt, 2e6),
        yaw: num(m.yaw, 7), pitch: num(m.pitch, 2),
        speed: num(m.speed, 9000) | 0, thrust: !!m.thrust, grounded: !!m.grounded,
      };
      return;
    }
    if (m.t === 'chat') {
      const text = clean(m.text);
      const now = Date.now();
      if (!text || now - p.chatAt < 900) return;
      p.chatAt = now;
      broadcast({ t: 'chat', from: p.name, text });
    }
  });

  ws.on('close', () => {
    savePlayer(p);
    if (owners.get(p.key) === id) owners.delete(p.key);
    try { store.flush(); } catch (e) { console.error('Position save failed:', e.message); }
    players.delete(id);
    if (p.s) broadcast({ t: 'chat', from: '•', text: `${p.name} приземлился` });
  });
});

function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(s);
}

const BUILD = Date.now();
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    if (ws.readyState === 1) ws.ping();
  }
}, 25000);
heartbeat.unref();
wss.on('close', () => clearInterval(heartbeat));
setInterval(() => {
  const list = [];
  for (const p of players.values()) if (p.s) list.push({ id: p.id, name: p.name, ...p.s });
  broadcast({ t: 'snap', players: list });
}, 84);

console.log('ПОЛЁТ · ws://localhost:' + PORT);
