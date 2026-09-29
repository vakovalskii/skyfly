// Только локальный Vite dev server: фиксированный файл проекта + optimistic concurrency.
import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { normalizeSetup } from '../src/render/flypose.js';

export const PROJECT_FILE = 'public/data/animations.json';
const LIMIT = 8 * 1024 * 1024;
const hash = (s) => createHash('sha256').update(s).digest('hex');
export function createAnimationRepository(root) {
  const file = path.join(root, PROJECT_FILE);
  let queue = Promise.resolve();
  async function read() {
    try {
      const raw = await readFile(file, 'utf8');
      return { revision: hash(raw), project: normalizeSetup(JSON.parse(raw)) };
    } catch (error) {
      if (error.code === 'ENOENT') return { revision: null, project: null };
      throw error;
    }
  }
  function save(project, expected) {
    const work = queue.then(async () => {
      const normalized = normalizeSetup(project);
      const current = await read();
      if (current.revision !== expected) {
        const error = new Error('Файл изменён другим редактором'); error.status = 409; throw error;
      }
      const content = JSON.stringify(normalized, null, 2) + '\n';
      if (current.project && JSON.stringify(current.project) === JSON.stringify(normalized)) return current;
      await mkdir(path.dirname(file), { recursive: true });
      const history = path.join(root, '.cache/animation-history');
      if (current.project) {
        await mkdir(history, { recursive: true });
        await writeFile(path.join(history, `${Date.now()}-${current.revision.slice(0, 12)}-${randomUUID()}.json`), await readFile(file), { flag: 'wx' });
      }
      // Последняя сверка ловит внешнюю правку между чтением и созданием резервной копии.
      if ((await read()).revision !== expected) { const e = new Error('Файл изменился во время записи'); e.status = 409; throw e; }
      const temporary = file + '.' + randomUUID() + '.tmp';
      try { await writeFile(temporary, content, { flag: 'wx' }); await rename(temporary, file); }
      finally { await unlink(temporary).catch((e) => { if (e.code !== 'ENOENT') throw e; }); }
      return { revision: hash(content), project: normalized };
    });
    queue = work.catch(() => {}); return work;
  }
  return { read, save };
}
export function animationStorePlugin() {
  return {
    name: 'skyfly-animation-store',
    config() { return { server: { watch: { ignored: ['**/public/data/animations.json*', '**/.cache/animation-history/**'] } } }; },
    configureServer(server) {
      const repository = createAnimationRepository(server.config.root);
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/__skyfly/animations') return next();
        const send = (status, data) => {
          res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(data));
        };
        try {
          const host = new URL(`http://${req.headers.host}`).hostname;
          if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return send(403, { error: 'Хранилище доступно только локально' });
          if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(403, { error: 'Другой origin' });
          if (req.method === 'GET') return send(200, await repository.read());
          if (req.method !== 'PUT') return send(405, { error: 'Ожидается GET или PUT' });
          if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'Ожидается JSON' });
          if (Number(req.headers['content-length']) > LIMIT) return send(413, { error: 'Файл больше 8 МБ' });
          let size = 0; const chunks = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > LIMIT) { send(413, { error: 'Файл больше 8 МБ' }); return; }
            chunks.push(chunk);
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!body || !Object.hasOwn(body, 'baseRevision')) return send(400, { error: 'Нужна версия исходного файла' });
          return send(200, await repository.save(body.project, body.baseRevision));
        } catch (error) { return send(error.status || 400, { error: error.message }); }
      });
    },
  };
}
