import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { deployflowMockPlugin } from './src/mock/mockApi.ts'

// En desarrollo el navegador pega en /api y Vite lo reenvía a la API real quitando
// el prefijo (nginx hace lo mismo en el contenedor). Con `npm run dev:mock` no hay
// backend: un plugin de Vite responde /api con los ejemplos del contrato.
const API_TARGET = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8000'

export default defineConfig(({ mode }) => {
  const mock = mode === 'mock'
  return {
    plugins: [react(), ...(mock ? [deployflowMockPlugin()] : [])],
    server: {
      port: 5173,
      proxy: mock
        ? undefined
        : {
            '/api': {
              target: API_TARGET,
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/api/, ''),
            },
          },
    },
  }
})
