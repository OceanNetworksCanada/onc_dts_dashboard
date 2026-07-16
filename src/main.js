import { createApp } from 'vue'
import { Chart, registerables } from 'chart.js'
import 'chartjs-adapter-date-fns'
import './style.css'
import App from './App.vue'

Chart.register(...registerables)
Chart.defaults.color = '#7d8590'
Chart.defaults.borderColor = '#21262d'
Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
Chart.defaults.font.size = 10

createApp(App).mount('#app')
