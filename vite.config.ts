import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import universalProxy from './vite.universalProxy'

export default defineConfig({
  plugins: [
    react(),
    universalProxy(), // 👈 proxy genérico
  ],

  server: {
    host: true,
    port: 80,
    strictPort: true,
  },
})
