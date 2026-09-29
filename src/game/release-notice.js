export function createReleaseNotice({ current, url, canReload = () => true, reload = () => location.reload() }) {
  const box = document.createElement('aside');
  box.id = 'release-notice'; box.hidden = true; box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  box.innerHTML = '<strong>Вышло обновление</strong><p></p><small hidden>Нажми Esc, чтобы освободить курсор</small><button type="button">Обновить игру</button><button type="button">Позже</button>';
  document.body.append(box);
  const badge = document.createElement('button');
  badge.id = 'release-badge'; badge.type = 'button'; badge.hidden = true;
  badge.textContent = '● Есть обновление';
  badge.setAttribute('aria-controls', box.id);
  document.body.append(badge);
  const description = box.querySelector('p');
  const hint = box.querySelector('small');
  const fallback = 'Новая версия уже на сайте. Обнови игру, чтобы получить улучшения.';
  let dismissed, busy = false, disposed = false, message = fallback;
  function announce(value) {
    const release = typeof value === 'string' ? value : value?.release;
    if (disposed || typeof release !== 'string' || !release || release === current) return;
    if (release !== box.dataset.release) message = fallback;
    if (typeof value?.message === 'string' && value.message.trim()) message = value.message.trim().slice(0, 500);
    description.textContent = message;
    box.dataset.release = release;
    if (release !== dismissed) { box.hidden = false; badge.hidden = true; }
    hint.hidden = !document.pointerLockElement;
  }
  box.querySelectorAll('button')[0].onclick = () => {
    if (!canReload()) {
      description.textContent = 'Сначала останови и сохрани запись видео, затем обнови страницу.';
      return;
    }
    reload();
  };
  box.querySelectorAll('button')[1].onclick = () => { dismissed = box.dataset.release; box.hidden = true; badge.hidden = false; };
  badge.onclick = () => { dismissed = null; description.textContent = message; box.hidden = false; badge.hidden = true; };
  async function check(expected) {
    if (disposed || busy || document.hidden) return;
    busy = true;
    const seen = box.dataset.release;
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const value = await response.json();
        // A slower HTTP response must not replace a newer WebSocket announcement.
        if (expected && value.release !== expected) return;
        if (box.dataset.release !== seen && value.release !== box.dataset.release) return;
        announce(value);
      }
    } catch { /* Offline is not a reason to interrupt a flight. */ }
    finally { busy = false; }
  }
  const timer = setInterval(check, 20000);
  const visible = () => { if (!document.hidden) check(); };
  const pushed = e => { announce(e.detail); check(e.detail?.release); };
  const pointer = () => { hint.hidden = !document.pointerLockElement; };
  document.addEventListener('visibilitychange', visible);
  document.addEventListener('pointerlockchange', pointer);
  addEventListener('focus', visible);
  addEventListener('online', visible);
  addEventListener('skyfly-update', pushed);
  check();
  return { check, announce, dispose() {
    disposed = true; clearInterval(timer);
    document.removeEventListener('visibilitychange', visible);
    document.removeEventListener('pointerlockchange', pointer);
    removeEventListener('focus', visible); removeEventListener('online', visible);
    removeEventListener('skyfly-update', pushed); box.remove(); badge.remove();
  } };
}
