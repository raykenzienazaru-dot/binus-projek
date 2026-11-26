import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api/bmkg/forecast': {
        target: 'https://api.bmkg.go.id',
        changeOrigin: true,
        rewrite: (reqPath) => reqPath.replace(/^\/api\/bmkg\/forecast/, '/publik/prakiraan-cuaca'),
      },
      '/api/bmkg/nowcast': {
        target: 'https://www.bmkg.go.id',
        changeOrigin: true,
        rewrite: (reqPath) => reqPath.replace(/^\/api\/bmkg\/nowcast/, '/alerts/nowcast'),
      },
      '/api/vision': {
        target: 'https://be-binus-production.up.railway.app',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
