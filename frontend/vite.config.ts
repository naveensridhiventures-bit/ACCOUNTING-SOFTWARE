import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API is proxied, so there is no CORS to configure.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:4000', changeOrigin: true } } },
});
