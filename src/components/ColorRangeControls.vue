<script setup>
import { ref, computed } from 'vue'
import { dtsStore } from '../lib/store.js'

const stored = dtsStore.getColorRange()
const rangeMinInput = ref(stored.min ?? '')
const rangeMaxInput = ref(stored.max ?? '')

const autoRange = computed(() => dtsStore.autoTemperatureRange())

function applyRange() {
  const min = rangeMinInput.value === '' ? null : Number(rangeMinInput.value)
  const max = rangeMaxInput.value === '' ? null : Number(rangeMaxInput.value)
  dtsStore.setColorRange(Number.isFinite(min) ? min : null, Number.isFinite(max) ? max : null)
}

function resetRange() {
  rangeMinInput.value = ''
  rangeMaxInput.value = ''
  dtsStore.clearColorRange()
}
</script>

<template>
  <div class="color-range panel">
    <span class="muted">Color scale (both channels)</span>
    <label class="muted">
      Min
      <input
        v-model="rangeMinInput"
        type="number"
        step="0.1"
        :placeholder="autoRange?.min?.toFixed(1) ?? 'auto'"
        @change="applyRange"
      />
      °C
    </label>
    <label class="muted">
      Max
      <input
        v-model="rangeMaxInput"
        type="number"
        step="0.1"
        :placeholder="autoRange?.max?.toFixed(1) ?? 'auto'"
        @change="applyRange"
      />
      °C
    </label>
    <button class="secondary" @click="resetRange">Auto</button>
    <span class="muted hint">Pin the range to clamp out damaged/out-of-range readings.</span>
  </div>
</template>

<style scoped>
.color-range {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.8rem;
  flex-wrap: wrap;
}
.color-range label {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.color-range input {
  width: 5.5rem;
  padding: 0.25rem 0.4rem;
}
.color-range button {
  padding: 0.25rem 0.6rem;
  font-weight: 500;
}
.hint {
  margin-left: auto;
}
.muted {
  color: var(--muted);
}
</style>
