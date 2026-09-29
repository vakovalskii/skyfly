// Сеть: позиции 12 раз в секунду, чат. Сервер только раздаёт снимки — физика у каждого своя,
// чтобы на телефоне с плохой связью полёт не дёргался.
const URL_ = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? `ws://${location.hostname}:8791`
  : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/fly-ws`;

export function connect({ onChat } = {}) {
  let token;
  try { token = localStorage.getItem('skyfly-player-token'); } catch {}
  if (!/^[a-f0-9]{64}$/.test(token || '')) {
    token = [...crypto.getRandomValues(new Uint8Array(32))].map(v => v.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem('skyfly-player-token', token); } catch {}
  }
  const api = { ws: null, id: null, online: false, ready: false, players: new Map(), name: null };
  let joined = null, joinFailed = null, retryTimer, entered = false;
  const sendJoin = () => {
    if (api.ws?.readyState !== WebSocket.OPEN) return;
    api.ws.send(JSON.stringify({ t: 'join', protocol: 2, release: __SKYFLY_RELEASE__, name: api.name, token }));
  };
  let sendAt = 0;

  const open = () => {
    try {
      const ws = new WebSocket(URL_);
      api.ws = ws;
      ws.onopen = () => { api.online = true; if (api.name) sendJoin(); };
      ws.onclose = () => { clearTimeout(retryTimer); api.online = false; api.ready = false; api.players.clear(); setTimeout(open, 2500); };
      ws.onerror = () => {};
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (!m || typeof m !== 'object') return;
        if (m.t === 'hi') api.id = m.id;
        if (m.t === 'update') dispatchEvent(new CustomEvent('skyfly-update', { detail: m }));
        if (m.t === 'joined') {
          api.ready = true;
          entered = true; clearTimeout(retryTimer);
          if (m.name) { api.name = m.name; try { localStorage.setItem('skyfly-nick', m.name); } catch {} }
          joined?.(m.resume); joined = joinFailed = null;
        }
        if (m.t === 'join_error') {
          if (joinFailed) { joinFailed(new Error(m.message)); joined = joinFailed = null; }
          else if (entered && m.code === 'rate') {
            clearTimeout(retryTimer);
            retryTimer = setTimeout(sendJoin, Math.max(1, Math.min(60, Number(m.retryAfter) || 60)) * 1000);
            onChat?.({ from: '•', text: 'Переподключаемся к серверу. Полёт продолжается.' });
          } else if (entered && m.code !== 'rate') {
            // Existing players must not lose flight/position after moderation rolls out.
            api.name = `Герой${api.id}`;
            onChat?.({ from: '•', text: 'Ник заменён на нейтральный после проверки. Новый можно выбрать при следующем входе.' });
            sendJoin();
          }
        }
        if (m.t === 'snap' && Array.isArray(m.players)) {
          const alive = new Set();
          for (const s of m.players) { if (!s || !Number.isFinite(s.id)) continue; api.players.set(s.id, s); alive.add(s.id); }
          for (const id of [...api.players.keys()]) if (!alive.has(id)) api.players.delete(id);
        }
        if (m.t === 'chat') onChat?.(m);
      };
    } catch { setTimeout(open, 3000); }
  };
  open();

  api.join = (name) => new Promise((resolve, reject) => {
    clearTimeout(retryTimer);
    joinFailed?.(new Error('Начата новая попытка входа.'));
    api.name = name;
    const timer = setTimeout(() => { joined = joinFailed = null; reject(new Error('Нет связи с сервером. Нажми «Повторить».')); }, 12000);
    joined = resume => { clearTimeout(timer); resolve(resume); };
    joinFailed = error => { clearTimeout(timer); reject(error); };
    if (api.online) sendJoin();
  });
  api.send = (s) => {
    const now = performance.now();
    if (!api.ready || api.ws?.readyState !== WebSocket.OPEN || now - sendAt < 80) return;   // 12 раз в секунду
    sendAt = now;
    api.ws.send(JSON.stringify({
      t: 's',
      lat: +s.lat.toFixed(6), lon: +s.lon.toFixed(6), alt: Math.round(s.alt),
      yaw: +s.yaw.toFixed(2), pitch: +s.pitch.toFixed(2),
      speed: Math.round(s.speed), thrust: !!s.thrust, grounded: !!s.grounded,
      mode: s.mode, face: s.face, vel: s.vel, power: s.power,
    }));
  };
  api.chat = (text) => { if (api.ready && api.ws?.readyState === WebSocket.OPEN) api.ws.send(JSON.stringify({ t: 'chat', text })); };
  return api;
}
