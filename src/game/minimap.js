import { CITIES_GEO } from '../core/cities.js';
import { haversine, bearing } from '../core/grid.js';

// North-up map. The destination is explicit and never flips at the midpoint.
export function createMinimap(p, net = { players: new Map(), id: null }) {
  let targetId = 'spb', overview = false;
  try { targetId = localStorage.getItem('skyfly-destination') || targetId; } catch {}
  if (!CITIES_GEO[targetId]) targetId = 'spb';
  const button = document.createElement('button');
  button.id = 'minimap'; button.type = 'button';
  button.title = 'Нажми: карта рядом / весь маршрут';
  button.innerHTML = '<canvas width="360" height="360"></canvas><span>Весь маршрут</span>';
  document.body.append(button);
  const canvas = button.firstChild, ctx = canvas.getContext('2d');
  const tiles = new Map();
  function tileAt(z, x, y) {
    const n = 2 ** z;
    if (y < 0 || y >= n) return null;
    const key = `${z}/${y}/${((x % n) + n) % n}`;
    let tile = tiles.get(key);
    if (!tile) tile = { image: null, loaded: false, loading: false, attempts: 0, retryAt: 0 };
    // Touch entries so flying back does not evict the tiles currently on screen.
    tiles.delete(key); tiles.set(key, tile);
    if (!tile.loaded && !tile.loading && performance.now() >= tile.retryAt) {
      const image = new Image();
      tile.image = image; tile.loading = true; tile.attempts++;
      image.crossOrigin = 'anonymous'; // Match terrain requests and their browser cache.
      let timeout;
      const fail = () => {
        clearTimeout(timeout); image.onload = image.onerror = null;
        tile.loading = false; tile.retryAt = performance.now() + Math.min(30000, 1500 * 2 ** Math.min(tile.attempts - 1, 5));
        image.src = '';
      };
      image.onload = () => {
        clearTimeout(timeout); image.onload = image.onerror = null;
        tile.loading = false; tile.loaded = image.naturalWidth > 0;
        requestAnimationFrame(update);
      };
      image.onerror = fail;
      timeout = setTimeout(fail, 12000);
      const host = tile.attempts % 2 ? 'server' : 'services';
      image.src = `https://${host}.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${key}`;
    }
    return tile.loaded ? tile.image : null;
  }
  const merc = ({lat, lon}) => [(lon + 180) / 360, (1 - Math.asinh(Math.tan(Math.max(-85, Math.min(85, lat)) * Math.PI / 180)) / Math.PI) / 2];
  const compass = document.getElementById('compass');
  compass.title = 'Сменить цель: Москва / Санкт-Петербург';
  compass.addEventListener('click', () => {
    targetId = targetId === 'spb' ? 'moscow' : 'spb';
    try { localStorage.setItem('skyfly-destination', targetId); } catch {}
    update();
  });
  button.onclick = () => { overview = !overview; update(); };
  function update() {
    const target = CITIES_GEO[targetId], distance = haversine(p, target);
    const caption = document.getElementById('h-city');
    const name = document.body.classList.contains('mobile') && targetId === 'spb' ? 'СПб' : target.name;
    caption.textContent = `${name}: ${distance < 1000 ? Math.round(distance) + ' м' : (distance / 1000).toFixed(distance < 10000 ? 1 : 0) + ' км'}${distance < 12000 && p.alt > 2000 ? ' ↓' : ''}`;
    caption.title = distance < 12000 && p.alt > 2000 ? 'Город под вами — снижайтесь' : 'Нажми, чтобы сменить город';
    document.getElementById('h-arrow').style.transform = `rotate(${bearing(p, target) - p.yaw}rad)`;
    button.lastChild.textContent = overview ? 'Карта рядом' : 'Весь маршрут';
    button.setAttribute('aria-label', `Мини-карта. Цель ${caption.textContent}. ${button.lastChild.textContent}`);
    const a = merc(p), b = merc(target), center = overview ? [(a[0]+b[0])/2,(a[1]+b[1])/2] : a;
    const size = 360;
    const zoom = overview ? Math.max(2, Math.min(12, Math.floor(Math.log2(size / (256 * Math.max(.0001, Math.abs(a[0]-b[0]), Math.abs(a[1]-b[1])) * 1.5))))) : 13;
    const n = 2 ** zoom, scale = 256 * n;
    const left = center[0]*scale-size/2, top = center[1]*scale-size/2;
    ctx.fillStyle = '#142538'; ctx.fillRect(0,0,size,size);
    for (let y=Math.floor(top/256); y<=Math.floor((top+size)/256); y++) for (let x=Math.floor(left/256); x<=Math.floor((left+size)/256); x++) {
      if (y<0||y>=n) continue;
      // A coarse parent covers missing/slow detail tiles, including across tile boundaries.
      const parentZoom = Math.max(0, zoom - 2), factor = 2 ** (zoom - parentZoom);
      const px = Math.floor(x / factor), py = Math.floor(y / factor);
      const parent = tileAt(parentZoom, px, py);
      const tile = tileAt(zoom, x, y), dx = x * 256 - left, dy = y * 256 - top;
      if (tile) ctx.drawImage(tile, dx, dy, 256, 256);
      else if (parent) {
        const part = 256 / factor;
        ctx.drawImage(parent, (x - px * factor) * part, (y - py * factor) * part, part, part, dx, dy, 256, 256);
      }
    }
    while(tiles.size>96) tiles.delete(tiles.keys().next().value);
    const xy = v => [v[0]*scale-left,v[1]*scale-top];
    const [ax,ay]=xy(a),[bx,by]=xy(b);
    ctx.strokeStyle='#9ce4ff';ctx.lineWidth=3;ctx.setLineDash([8,7]);ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);ctx.stroke();ctx.setLineDash([]);
    for(const city of Object.values(CITIES_GEO)) {
      const [x,y]=xy(merc(city));if(x<0||y<0||x>size||y>size)continue;
      ctx.fillStyle=city===target?'#ffd174':'#fff';ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.fill();
      ctx.font='bold 20px sans-serif';ctx.textAlign=x>size/2?'right':'left';ctx.lineWidth=4;ctx.strokeStyle='#142538';
      const label=city===CITIES_GEO.spb?'Петербург':'Москва';ctx.strokeText(label,x,y-14);ctx.fillText(label,x,y-14);
    }
    let peerCount = 0;
    for (const peer of net.players.values()) {
      if (peer.id === net.id || !Number.isFinite(peer.lat) || !Number.isFinite(peer.lon)) continue;
      peerCount++;
      const [rawX, rawY] = xy(merc(peer));
      const outside = rawX < 12 || rawX > size - 12 || rawY < 12 || rawY > size - 12;
      const x = Math.max(12, Math.min(size - 12, rawX)), y = Math.max(12, Math.min(size - 42, rawY));
      ctx.save(); ctx.translate(x, y);
      ctx.rotate(outside ? Math.atan2(rawX - size / 2, -(rawY - size / 2)) : (peer.yaw || 0));
      ctx.fillStyle = '#ffadf0'; ctx.strokeStyle = '#302039'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0,-10); ctx.lineTo(8,8); ctx.lineTo(0,4); ctx.lineTo(-8,8); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      if (!outside && peerCount <= 6) {
        ctx.font = 'bold 16px sans-serif'; ctx.textAlign = x > size / 2 ? 'right' : 'left';
        ctx.fillStyle = '#ffcdf6'; ctx.strokeStyle = '#142538'; ctx.lineWidth = 4;
        const label = String(peer.name || 'Игрок').slice(0,14);
        ctx.strokeText(label, x, y - 16); ctx.fillText(label, x, y - 16);
      }
    }
    ctx.save();ctx.translate(ax,ay);ctx.rotate(p.yaw);ctx.fillStyle='#8bffe0';ctx.strokeStyle='#123b44';ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(0,-15);ctx.lineTo(11,12);ctx.lineTo(0,7);ctx.lineTo(-11,12);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
    ctx.fillStyle='#fff';ctx.strokeStyle='#142538';ctx.font='bold 20px sans-serif';ctx.textAlign='left';ctx.lineWidth=4;ctx.strokeText('С ↑',12,26);ctx.fillText('С ↑',12,26);
    ctx.font='14px sans-serif';ctx.strokeText('Esri',12,size-10);ctx.fillText('Esri',12,size-10);
    if (peerCount) {
      ctx.fillStyle = '#ffcdf6'; ctx.textAlign = 'right';
      const label = `Игроки: ${peerCount}`; ctx.strokeText(label,size-10,size-10);ctx.fillText(label,size-10,size-10);
    }
    canvas.setAttribute('aria-label', `Карта: вы и ${peerCount} других игроков. Розовые стрелки — игроки, зелёная — вы.`);
  }
  update();
  return { update };
}
