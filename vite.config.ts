import { defineConfig } from 'vite';
import path from 'path';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  base: '/ai-town',
  plugins: [react()],
  resolve: {
    alias: {
      zod: path.resolve(__dirname, 'vendor/zod/index.ts'),
      'zod-to-json-schema': path.resolve(__dirname, 'vendor/zod-to-json-schema/index.ts'),
    },
  },
  server: {
    allowedHosts: ['ai-town-your-app-name.fly.dev', 'localhost', '127.0.0.1'],
  },
});
