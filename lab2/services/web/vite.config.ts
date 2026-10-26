import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// En desarrollo (npm run dev) el front habla con el stack de compose levantado en el host.
// En el contenedor, el mismo trabajo lo hace nginx (ver nginx.conf.template).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': { target: 'http://localhost:8000', rewrite: (p) => p.replace(/^\/api/, '') },
      '/jaeger': { target: 'http://localhost:16686', rewrite: (p) => p.replace(/^\/jaeger/, '') },
    },
  },
})
