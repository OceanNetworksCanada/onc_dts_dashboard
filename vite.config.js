import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
          chartjs: ['chart.js', 'chartjs-adapter-date-fns', 'date-fns'],
        },
      },
    },
  },
})
