<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { Chart } from 'chart.js'
import { dtsStore, trimProfile } from '../lib/store.js'
import { AXIS_GUTTER_PX } from '../config.js'

const props = defineProps({
  channel: { type: Number, required: true },
  color: { type: String, default: '#58a6ff' },
  hoverColor: { type: String, default: '#f0883e' },
  // When stacked directly above a WaterfallCanvas for the same channel, hide this chart's own
  // x-axis so the waterfall's distance-axis labels underneath serve both, and the two plot
  // areas line up without a duplicated axis between them.
  showXAxis: { type: Boolean, default: true },
})

const canvasRef = ref(null)
let chart = null

const rawProfile = computed(() => dtsStore.latest(props.channel)) // for the header timestamp only
const trim = computed(() => dtsStore.getTrim(props.channel))
const avgProfile = computed(() => dtsStore.averagedProfile(props.channel)) // default line (trim-applied internally)
const tempRange = computed(() => dtsStore.temperatureRange())

const hover = computed(() => dtsStore.state.hover[props.channel])
const hoverProfile = computed(() => {
  const h = hover.value
  if (!h) return null
  return trimProfile(dtsStore.profileAt(props.channel, h.timeMs), trim.value)
})

// Local editable copies so the fields don't reset on every incoming profile.
const trimMinInput = ref(trim.value.min ?? '')
const trimMaxInput = ref(trim.value.max ?? '')

function applyTrim() {
  const min = trimMinInput.value === '' ? null : Number(trimMinInput.value)
  const max = trimMaxInput.value === '' ? null : Number(trimMaxInput.value)
  dtsStore.setTrim(props.channel, Number.isFinite(min) ? min : null, Number.isFinite(max) ? max : null)
}

function resetTrim() {
  trimMinInput.value = ''
  trimMaxInput.value = ''
  dtsStore.setTrim(props.channel, null, null)
}

function toPoints(p) {
  if (!p) return []
  const { distance, temperature } = p
  const pts = new Array(distance.length)
  for (let i = 0; i < distance.length; i++) pts[i] = { x: distance[i], y: temperature[i] }
  return pts
}

onMounted(() => {
  chart = new Chart(canvasRef.value, {
    type: 'line',
    data: {
      datasets: [
        {
          label: '5-min avg',
          data: toPoints(avgProfile.value),
          borderColor: props.color,
          backgroundColor: props.color,
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'hovered',
          data: toPoints(hoverProfile.value),
          borderColor: props.hoverColor,
          backgroundColor: props.hoverColor,
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 0,
          tension: 0,
        },
      ],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      parsing: false,
      scales: {
        x: {
          type: 'linear',
          display: props.showXAxis,
          title: { display: props.showXAxis, text: 'Distance along fiber (m)' },
        },
        y: {
          title: { display: true, text: 'Temperature (°C)' },
          min: tempRange.value?.min,
          max: tempRange.value?.max,
          afterFit: (scale) => { scale.width = AXIS_GUTTER_PX },
        },
      },
      plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 9 } } } },
    },
  })
})

onUnmounted(() => {
  chart?.destroy()
  chart = null
})

watch(avgProfile, (p) => {
  if (!chart) return
  chart.data.datasets[0].data = toPoints(p)
  chart.update('none')
})

watch(hoverProfile, (p) => {
  if (!chart) return
  chart.data.datasets[1].data = toPoints(p)
  chart.data.datasets[1].label = hover.value
    ? `hovered ${new Date(hover.value.timeMs).toLocaleTimeString()}`
    : 'hovered'
  chart.update('none')
})

watch(tempRange, (range) => {
  if (!chart) return
  chart.options.scales.y.min = range?.min
  chart.options.scales.y.max = range?.max
  chart.update('none')
})
</script>

<template>
  <div class="profile-chart panel" :class="{ compact: !showXAxis }">
    <div class="chart-header">
      <span>Channel {{ channel }} — profile</span>
      <span class="muted" v-if="rawProfile">
        latest {{ rawProfile.time }}
        <template v-if="avgProfile?.meta?.averagedOverN">(avg of {{ avgProfile.meta.averagedOverN }})</template>
      </span>
      <span class="muted" v-else>no data yet</span>
    </div>

    <div class="trim-controls">
      <label class="muted">
        Trim from
        <input v-model="trimMinInput" type="number" step="0.1" placeholder="0" @change="applyTrim" />
        m
      </label>
      <label class="muted">
        to
        <input v-model="trimMaxInput" type="number" step="0.1" :placeholder="rawProfile ? rawProfile.distance.at(-1).toFixed(0) : ''" @change="applyTrim" />
        m
      </label>
      <button class="secondary" @click="resetTrim">Reset</button>
    </div>

    <div class="chart-canvas">
      <canvas ref="canvasRef"></canvas>
    </div>
  </div>
</template>

<style scoped>
.profile-chart {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  height: 380px;
}
.profile-chart.compact {
  height: 260px;
  border-bottom: none;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}
.chart-header {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
}
.trim-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.8rem;
}
.trim-controls label {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.trim-controls input {
  width: 5.5rem;
  padding: 0.25rem 0.4rem;
}
.trim-controls button {
  padding: 0.25rem 0.6rem;
  font-weight: 500;
}
.chart-canvas {
  flex: 1;
  position: relative;
}
.muted {
  color: var(--muted);
}
</style>
