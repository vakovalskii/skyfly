export function createReleaseNotice({ current, url, canReload = () => true, reload = () => location.reload() }) {
  const box = document.createElement('aside');
  box.id = 'release-notice'; box.hidden = true; box.setAttribute('role', 'status');
  box.innerHTML = '<strong>Доступно обновление игры</strong><p>Новый контент уже на сайте. Обнови страницу, когда будешь готов.</p><button type="button">Обновить</button><button type="button">Позже</button>';
  document.body.append(box);
  let dismissed, busy = false;
  function announce(release) {
    if (typeof release !== 'string' || !release || release === current || release === dismissed) return;
    box.dataset.release = release; box.hidden = false;
  }
  box.querySelectorAll('button')[0].onclick = () => {
    if (!canReload()) {
      box.querySelector('p').textContent = 'Сначала останови и сохрани запись видео, затем обнови страницу.';
      return;
    }
    reload();
  };
  box.querySelectorAll('button')[1].onclick = () => { dismissed = box.dataset.release; box.hidden = true; };
  async function check() {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (response.ok) announce((await response.json()).release);
    } catch { /* Offline is not a reason to interrupt a flight. */ }
    finally { busy = false; }
  }
  const timer = setInterval(check, 60000);
  const visible = () => { if (!document.hidden) check(); };
  const pushed = e => announce(e.detail?.release);
  document.addEventListener('visibilitychange', visible);
  addEventListener('skyfly-update', pushed);
  check();
  return { check, announce, dispose() { clearInterval(timer); document.removeEventListener('visibilitychange', visible); removeEventListener('skyfly-update', pushed); box.remove(); } };
}
