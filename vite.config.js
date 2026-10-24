import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        orders: resolve(__dirname, 'orders.html'),
        main: resolve(__dirname, 'index.html'),   // public marketing site
        admin: resolve(__dirname, 'admin.html'),  // internal admin app
      },
    },
  },
})
