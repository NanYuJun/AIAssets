import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4891',
      '/s': 'http://127.0.0.1:4891'
    }
  },
  ...(mode === 'electron'
    ? {
        base: './',
        build: {
          outDir: '../desktop-app/app-ui',
          emptyOutDir: true
        }
      }
    : {
        build: {
          outDir: '../src/server/public-react',
          emptyOutDir: true
        }
      })
}))
