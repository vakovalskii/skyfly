import { defineConfig } from 'vite';
import { animationStorePlugin } from './tools/animation-store.mjs';
export default defineConfig(({ command }) => {
  const release = process.env.SKYFLY_RELEASE || (command === 'build' ? new Date().toISOString() : 'development');
  return {
    plugins: [animationStorePlugin(), {
      name: 'release-announcement',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'release.json', source: JSON.stringify({
          release,
          message: process.env.RELEASE_MESSAGE || 'Свежие улучшения и исправления уже в игре. Обнови страницу, чтобы их получить.',
        }) });
      },
    }],
    base: process.env.BASE || '/',
    server: { host: '127.0.0.1', port: 5174 },
    build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
    define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16)), __SKYFLY_RELEASE__: JSON.stringify(release) },
  };
});
