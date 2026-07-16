<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { dtsStore } from '../lib/store.js'
import { valueToRgb, turboGradientCss } from '../lib/colormap.js'

const props = defineProps({
  channel: { type: Number, required: true },
})

const canvasRef = ref(null)
const containerRef = ref(null)
const colorRange = ref(null) // { min, max }

const matrix = computed(() => dtsStore.matrixView(props.channel))

let rafId = null
let resizeObserver = null

function render() {
  const canvas = canvasRef.value
  const container = containerRef.value
  if (!canvas || !container) return

  const displayWidth = Math.max(1, Math.floor(container.clientWidth))
  const displayHeight = Math.max(1, Math.floor(container.clientHeight))
  if (canvas.width !== displayWidth) canvas.width = displayWidth
  if (canvas.height !== displayHeight) canvas.height = displayHeight

  const ctx = canvas.getContext('2d')
  const m = matrix.value
  if (!m || m.rows.length === 0 || m.distance.length === 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    colorRange.value = null
    return
  }

  const nDist = m.distance.length
  const nTime = m.rows.length

  let min = Infinity
  let max = -Infinity
  for (const row of m.rows) {
    for (let j = 0; j < row.length; j++) {
      const v = row[j]
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    colorRange.value = null
    return
  }
  if (min === max) {
    min -= 0.5
    max += 0.5
  }

  // Render at native (distance x time) resolution offscreen, then scale up to the
  // display canvas — far cheaper than per-pixel drawing at display resolution.
  const off = document.createElement('canvas')
  off.width = nDist
  off.height = nTime
  const offCtx = off.getContext('2d')
  const imageData = offCtx.createImageData(nDist, nTime)
  const data = imageData.data

  // rows are oldest -> newest; draw oldest at the top, newest at the bottom.
  for (let t = 0; t < nTime; t++) {
    const row = m.rows[t]
    let offset = t * nDist * 4
    for (let d = 0; d < nDist; d++) {
      const [r, g, b] = valueToRgb(row[d], min, max)
      data[offset] = r
      data[offset + 1] = g
      data[offset + 2] = b
      data[offset + 3] = 255
      offset += 4
    }
  }
  offCtx.putImageData(imageData, 0, 0)

  ctx.imageSmoothingEnabled = true
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(off, 0, 0, nDist, nTime, 0, 0, canvas.width, canvas.height)

  colorRange.value = { min, max }
}

function scheduleRender() {
  if (rafId != null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    render()
  })
}

watch(matrix, scheduleRender)

onMounted(() => {
  scheduleRender()
  resizeObserver = new ResizeObserver(scheduleRender)
  if (containerRef.value) resizeObserver.observe(containerRef.value)
})

onBeforeUnmount(() => {
  if (rafId != null) cancelAnimationFrame(rafId)
  resizeObserver?.disconnect()
})

const distanceLabels = computed(() => {
  const m = matrix.value
  if (!m || m.distance.length === 0) return null
  return { min: m.distance[0], max: m.distance.at(-1) }
})

const timeLabels = computed(() => {
  const m = matrix.value
  if (!m || m.times.length === 0) return null
  return { oldest: m.times[0], newest: m.times.at(-1), count: m.times.length }
})

const gradientCss = turboGradientCss()
</script>

<template>
  <div class="waterfall panel">
    <div class="header">
      <span>Channel {{ channel }} — waterfall (time × distance)</span>
      <span class="muted" v-if="timeLabels">{{ timeLabels.count }} profiles</span>
      <span class="muted" v-else>no data yet</span>
    </div>

    <div class="body">
      <div class="time-axis" v-if="timeLabels">
        <span>{{ new Date(timeLabels.oldest).toLocaleTimeString() }}</span>
        <span>{{ new Date(timeLabels.newest).toLocaleTimeString() }}</span>
      </div>
      <div ref="containerRef" class="canvas-wrap">
        <canvas ref="canvasRef"></canvas>
      </div>
    </div>

    <div class="distance-axis" v-if="distanceLabels">
      <span>{{ distanceLabels.min.toFixed(0) }} m</span>
      <span class="muted">distance along fiber</span>
      <span>{{ distanceLabels.max.toFixed(0) }} m</span>
    </div>

    <div class="legend" v-if="colorRange">
      <span>{{ colorRange.min.toFixed(1) }}°C</span>
      <div class="swatch" :style="{ background: gradientCss }"></div>
      <span>{{ colorRange.max.toFixed(1) }}°C</span>
    </div>
  </div>
</template>

<style scoped>
.waterfall {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  height: 420px;
}
.header {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
}
.body {
  flex: 1;
  display: flex;
  gap: 0.35rem;
  min-height: 0;
}
.time-axis {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  font-size: 0.7rem;
  color: var(--muted);
  writing-mode: vertical-rl;
  text-orientation: mixed;
}
.canvas-wrap {
  flex: 1;
  position: relative;
  min-height: 0;
}
canvas {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 4px;
}
.distance-axis {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  color: var(--muted);
}
.legend {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.7rem;
  color: var(--muted);
}
.swatch {
  flex: 1;
  height: 10px;
  border-radius: 3px;
}
.muted {
  color: var(--muted);
}
</style>
