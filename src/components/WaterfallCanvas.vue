<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { dtsStore } from '../lib/store.js'
import { valueToRgb, turboGradientCss } from '../lib/colormap.js'
import { AXIS_GUTTER_PX } from '../config.js'

const props = defineProps({
  channel: { type: Number, required: true },
})

const canvasRef = ref(null)
const overlayRef = ref(null)
const containerRef = ref(null)
const hoverReadout = ref(null) // { distance, timeMs, temp }

const matrix = computed(() => dtsStore.matrixView(props.channel))
const tempRange = computed(() => dtsStore.temperatureRange())

// Non-reactive: the exact matrix used for the last render, so mousemove can map pixels ->
// (distance, time) without recomputing/re-trimming on every cursor move.
let currentMatrix = null

let rafId = null
let resizeObserver = null

function sizeCanvas(canvas, container) {
  const displayWidth = Math.max(1, Math.floor(container.clientWidth))
  const displayHeight = Math.max(1, Math.floor(container.clientHeight))
  if (canvas.width !== displayWidth) canvas.width = displayWidth
  if (canvas.height !== displayHeight) canvas.height = displayHeight
}

function render() {
  const canvas = canvasRef.value
  const container = containerRef.value
  if (!canvas || !container) return
  sizeCanvas(canvas, container)
  if (overlayRef.value) sizeCanvas(overlayRef.value, container)

  const ctx = canvas.getContext('2d')
  const m = matrix.value
  currentMatrix = m
  if (!m || m.rows.length === 0 || m.distance.length === 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    return
  }

  const range = tempRange.value
  if (!range) return
  const { min, max } = range

  const nDist = m.distance.length
  const nTime = m.rows.length

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
}

function scheduleRender() {
  if (rafId != null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    render()
  })
}

watch(matrix, scheduleRender)
watch(tempRange, scheduleRender)

function drawCrosshair(x, y) {
  const overlay = overlayRef.value
  if (!overlay) return
  const ctx = overlay.getContext('2d')
  ctx.clearRect(0, 0, overlay.width, overlay.height)
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, 0)
  ctx.lineTo(x, overlay.height)
  ctx.moveTo(0, y)
  ctx.lineTo(overlay.width, y)
  ctx.stroke()
}

function clearCrosshair() {
  const overlay = overlayRef.value
  if (!overlay) return
  overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height)
}

function onMouseMove(e) {
  const canvas = canvasRef.value
  const m = currentMatrix
  if (!canvas || !m || m.rows.length === 0 || m.distance.length === 0) return

  const rect = canvas.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return

  const nDist = m.distance.length
  const nTime = m.rows.length
  const distIdx = Math.min(nDist - 1, Math.max(0, Math.floor((x / rect.width) * nDist)))
  const timeIdx = Math.min(nTime - 1, Math.max(0, Math.floor((y / rect.height) * nTime)))

  const distance = m.distance[distIdx]
  const timeMs = new Date(m.times[timeIdx]).getTime()
  const temp = m.rows[timeIdx][distIdx]

  hoverReadout.value = { distance, timeMs, temp }
  dtsStore.setHover(props.channel, { timeMs, distance })
  drawCrosshair(x, y)
}

function onMouseLeave() {
  hoverReadout.value = null
  dtsStore.clearHover(props.channel)
  clearCrosshair()
}

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
      <span class="muted" v-if="hoverReadout">
        {{ hoverReadout.distance.toFixed(1) }} m @ {{ new Date(hoverReadout.timeMs).toLocaleTimeString() }} —
        {{ hoverReadout.temp.toFixed(2) }}°C
      </span>
      <span class="muted" v-else-if="timeLabels">{{ timeLabels.count }} profiles</span>
      <span class="muted" v-else>no data yet</span>
    </div>

    <div class="body">
      <div class="time-axis" v-if="timeLabels">
        <span>{{ new Date(timeLabels.oldest).toLocaleTimeString() }}</span>
        <span>{{ new Date(timeLabels.newest).toLocaleTimeString() }}</span>
      </div>
      <div
        ref="containerRef"
        class="canvas-wrap"
        @mousemove="onMouseMove"
        @mouseleave="onMouseLeave"
      >
        <canvas ref="canvasRef"></canvas>
        <canvas ref="overlayRef" class="overlay"></canvas>
      </div>
    </div>

    <div class="distance-axis" v-if="distanceLabels">
      <span>{{ distanceLabels.min.toFixed(0) }} m</span>
      <span class="muted">distance along fiber</span>
      <span>{{ distanceLabels.max.toFixed(0) }} m</span>
    </div>

    <div class="legend" v-if="tempRange">
      <span>{{ tempRange.min.toFixed(1) }}°C</span>
      <div class="swatch" :style="{ background: gradientCss }"></div>
      <span>{{ tempRange.max.toFixed(1) }}°C</span>
    </div>
  </div>
</template>

<style scoped>
.waterfall {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  height: 420px;
  border-top: none;
  border-top-left-radius: 0;
  border-top-right-radius: 0;
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
  width: v-bind('`${AXIS_GUTTER_PX}px`');
  flex: none;
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
canvas.overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: 0;
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
