import { defineConfig } from 'vite';
import { animationStorePlugin } from './tools/animation-store.mjs';
// Игра лежит на проде по адресу /fly/ — отсюда base.
export default defineConfig({
  plugins: [animationStorePlugin()],
  base: process.env.BASE || '/',
  server: { host: '127.0.0.1', port: 5174 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16)), __SKYFLY_RELEASE__: JSON.stringify(process.env.SKYFLY_RELEASE || 'development') },
});
