// Связь студии с JSON в рабочем дереве. Чужие правки не перезаписываются молча.
import { normalizeSetup, saveSetup } from '../render/flypose.js';
const REVISION = 'skyfly-anim-revision';
const PENDING = 'skyfly-anim-pending';
const BACKUP = 'skyfly-anim-before-sync';
// A project plus its backup can exceed localStorage's quota. Keep the backup in
// IndexedDB before freeing that duplicate; never discard an unsaved browser pose.
async function archiveBrowserCopies(copies) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('skyfly-animation-backups', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('copies', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('copies', 'readwrite');
      for (const [source, json] of copies) if (json) tx.objectStore('copies').put({ id: `${Date.now()}-${crypto.randomUUID()}`, source, json });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export function createAnimationStorage({ onProject, onStatus, dev = import.meta.env.DEV, base = import.meta.env.BASE_URL }) {
  let revision = null, ready = false, dirty = false, writing = false, conflict = false, stopped = false;
  let generation = 0, pollTimer, retryTimer, getProject, initializing = false, polling = false;
  const status = (text, error = false) => { if (!stopped) onStatus(text, error, conflict); };
  const fetchProject = async () => {
    const response = await fetch(dev ? '/__skyfly/animations' : `${base}data/animations.json`, { cache: 'no-store' });
    if (!dev && response.status === 404) return { project: null, revision: null };
    if (!response.ok) throw new Error('Хранилище проекта недоступно. Нужен запущенный npm run dev.');
    const data = await response.json();
    return dev ? { ...data, project: data.project && normalizeSetup(data.project) } : { project: normalizeSetup(data), revision: null };
  };
  async function accept(remote) {
    if (stopped) return;
    const old = localStorage.getItem('skyfly-anim'), previousBackup = localStorage.getItem(BACKUP);
    const beforeGeneration = generation, beforeRevision = revision;
    try {
      if (old && old !== JSON.stringify(remote.project)) localStorage.setItem(BACKUP, old);
      saveSetup(remote.project);
    } catch (error) {
      if (error.name !== 'QuotaExceededError') throw error;
      await archiveBrowserCopies([['before-sync', previousBackup], ['current', old]]);
      // An edit or save while IndexedDB was opening takes precedence over this GET.
      if (stopped || generation !== beforeGeneration || revision !== beforeRevision) return;
      localStorage.removeItem(BACKUP);
      saveSetup(remote.project);
    }
    revision = remote.revision; dirty = false; conflict = false;
    localStorage.setItem(REVISION, revision || ''); localStorage.removeItem(PENDING);
    onProject(remote.project); status(dev ? 'Синхронизировано с public/data/animations.json' : 'Анимации загружены из проекта');
  }
  async function flush(force = false) {
    if (!dev || stopped || writing) return;
    if (!ready) { await initialize(); return; }
    if (conflict && !force) { status('Файл и студия изменены. Выбери нужную версию ниже.', true); return; }
    if (!dirty && !force) { status('Сохранено в public/data/animations.json'); return; }
    writing = true;
    try {
      if (force) { revision = (await fetchProject()).revision; conflict = false; saveSetup(getProject()); }
      const sentGeneration = generation;
      const response = await fetch('/__skyfly/animations', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseRevision: revision, project: getProject() }),
      });
      const result = await response.json();
      if (response.status === 409) { conflict = true; status('Конфликт: файл и студия изменены. Выбери, какую версию оставить.', true); return; }
      if (!response.ok) throw new Error(result.error || 'Ошибка сохранения проекта');
      revision = result.revision; localStorage.setItem(REVISION, revision || '');
      if (sentGeneration === generation) { dirty = false; localStorage.removeItem(PENDING); status('Сохранено в public/data/animations.json'); }
    } catch (error) { status(`${error.message} Копия остаётся в браузере.`, true); }
    finally {
      writing = false;
      if (dirty && !conflict && !stopped) { clearTimeout(retryTimer); retryTimer = setTimeout(() => flush(), 2500); }
    }
  }
  async function poll() {
    if (stopped || writing || polling || !dev) return;
    if (!ready) { await initialize(); return; }
    polling = true;
    const requestedRevision = revision, requestedGeneration = generation;
    try {
      const remote = await fetchProject();
      // Ответ GET мог прийти после клика и успешного PUT. Старый снимок не должен откатывать новый кадр.
      if (stopped || writing || revision !== requestedRevision || generation !== requestedGeneration) return;
      if (remote.project && remote.revision !== revision) {
        if (dirty) { conflict = true; status('Файл изменён снаружи; твои правки сохранены в браузере.', true); }
        else await accept(remote);
      }
    } catch (error) { status(error.message, true); }
    finally { polling = false; }
  }
  async function initialize() {
    if (initializing || stopped) return;
    initializing = true;
    try {
      const remote = await fetchProject();
      if (stopped) return;
      const existing = localStorage.getItem('skyfly-anim');
      const pending = dirty || localStorage.getItem(PENDING) === '1';
      const previousRevision = localStorage.getItem(REVISION);
      revision = remote.revision; ready = true;
      if (!dev) { if (!existing && !dirty && remote.project) await accept(remote); return; }
      if (!remote.project) {
        dirty = true; localStorage.setItem(PENDING, '1'); await flush();
      } else if ((existing || dirty) && (pending || !previousRevision) && JSON.stringify(normalizeSetup(getProject())) !== JSON.stringify(remote.project)) {
        dirty = true; conflict = true; status('Есть две версии: поза в браузере и файл проекта. Выбери нужную.', true);
      } else await accept(remote);
    } catch (error) { status(error.message, true); }
    finally { initializing = false; }
  }
  return {
    async start(projectGetter) {
      getProject = projectGetter;
      await initialize();
      if (dev && !stopped) pollTimer = setInterval(poll, 2500);
    },
    markDirty() {
      generation++; dirty = true;
      try { localStorage.setItem(PENDING, '1'); } catch {}
    },
    save: () => flush(),
    keepBrowser: () => flush(true),
    async loadProject() {
      if (writing) { status('Дождись завершения записи', true); return; }
      try { const remote = await fetchProject(); if (remote.project) await accept(remote); else status('В проекте пока нет файла анимаций', true); }
      catch (error) { status(error.message, true); }
    },
    get conflict() { return conflict; },
    get enabled() { return dev; },
    dispose() { stopped = true; clearInterval(pollTimer); clearTimeout(retryTimer); },
  };
}
