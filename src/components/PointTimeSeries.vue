<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { Chart } from 'chart.js'
import { dtsStore } from '../lib/store.js'

const props = defineProps({
  channel: { type: Number, required: true },
})

const PALETTE = ['#58a6ff', '#3fb950', '#f0883e', '#db61a2', '#a371f7', '#f85149', '#56d4dd', '#e3b341']

const canvasRef = ref(null)
let chart = null

const points = computed(() => dtsStore.getPoints(props.channel))
const tempRange = computed(() => dtsStore.temperatureRange())
const newPointInput = ref('')

function addPoint() {
  const d = Number(newPointInput.value)
  if (!Number.isFinite(d)) return
  dtsStore.addPoint(props.channel, d)
  newPointInput.value = ''
}

function removePoint(d) {
  dtsStore.removePoint(props.channel, d)
}

function seriesFor(distance) {
  // With `parsing: false`, Chart.js expects the time scale's internal numeric form
  // (epoch ms) directly, not a Date object — a Date here silently breaks scale min/max
  // detection and the chart renders as an empty default day span.
  // Default line is the ~5-min-binned average (dtsStore.binnedPointSeries), smoothing
  // per-measurement noise; raw per-measurement data is what the waterfall hover overlay
  // draws a guideline against.
  return dtsStore.binnedPointSeries(props.channel, distance).map((s) => ({
    x: new Date(s.time).getTime(),
    y: s.value,
  }))
}

const datasets = computed(() =>
  points.value.map((d, i) => ({
    label: `${d.toFixed(1)} m`,
    data: seriesFor(d),
    borderColor: PALETTE[i % PALETTE.length],
    backgroundColor: PALETTE[i % PALETTE.length],
    borderWidth: 1.5,
    pointRadius: 0,
    tension: 0.15,
  })),
)

/** Draws a vertical guideline at the waterfall's hovered time (this channel only). */
const hoverGuidelinePlugin = {
  id: 'hoverGuideline',
  afterDatasetsDraw(chartInstance) {
    const hover = dtsStore.state.hover[props.channel]
    if (!hover) return
    const xScale = chartInstance.scales.x
    const px = xScale.getPixelForValue(hover.timeMs)
    if (px < xScale.left || px > xScale.right) return
    const { ctx, chartArea } = chartInstance
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.setLineDash([4, 3])
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(px, chartArea.top)
    ctx.lineTo(px, chartArea.bottom)
    ctx.stroke()
    ctx.restore()
  },
}

onMounted(() => {
  chart = new Chart(canvasRef.value, {
    type: 'line',
    data: { datasets: datasets.value },
    options: {
      animation: false,
      maintainAspectRatio: false,
      parsing: false,
      scales: {
        x: { type: 'time', title: { display: true, text: 'Time' } },
        y: {
          title: { display: true, text: 'Temperature (°C)' },
          min: tempRange.value?.min,
          max: tempRange.value?.max,
        },
      },
      plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 12 } } },
    },
    plugins: [hoverGuidelinePlugin],
  })
})

onUnmounted(() => {
  chart?.destroy()
  chart = null
})

watch(datasets, (ds) => {
  if (!chart) return
  // Mutate the existing datasets array in place (matching Chart.js's recommended reactive
  // update pattern) rather than replacing the array reference, which leaves Chart.js's
  // internal per-dataset metadata stale and the chart renders blank.
  chart.data.datasets.splice(0, chart.data.datasets.length, ...ds)
  chart.update()
})

watch(tempRange, (range) => {
  if (!chart) return
  chart.options.scales.y.min = range?.min
  chart.options.scales.y.max = range?.max
  chart.update('none')
})

watch(
  () => dtsStore.state.hover[props.channel],
  () => chart?.update('none'),
)
</script>

<template>
  <div class="point-series panel">
    <div class="header">
      <span>Channel {{ channel }} — temperature at selected points (5-min avg)</span>
    </div>

    <div class="controls">
      <input
        v-model="newPointInput"
        type="number"
        step="0.1"
        placeholder="Distance (m)"
        @keyup.enter="addPoint"
      />
      <button @click="addPoint">Add point</button>
      <span v-for="(d, i) in points" :key="d" class="chip" :style="{ borderColor: PALETTE[i % PALETTE.length] }">
        {{ d.toFixed(1) }} m
        <button class="chip-remove" @click="removePoint(d)">×</button>
      </span>
    </div>

    <div class="chart-canvas">
      <canvas ref="canvasRef"></canvas>
    </div>
  </div>
</template>

<style scoped>
.point-series {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  height: 380px;
}
.header {
  font-size: 0.85rem;
}
.controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  font-size: 0.8rem;
}
.controls input {
  width: 8rem;
  padding: 0.25rem 0.4rem;
}
.controls button {
  padding: 0.25rem 0.6rem;
  font-weight: 500;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid;
  border-radius: 999px;
  padding: 0.1rem 0.3rem 0.1rem 0.6rem;
  color: var(--text);
}
.chip-remove {
  background: transparent;
  border: none;
  color: var(--muted);
  padding: 0 0.3rem;
  font-weight: 700;
  line-height: 1;
}
.chart-canvas {
  flex: 1;
  position: relative;
}
</style>
