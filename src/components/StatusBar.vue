<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { dtsStore } from '../lib/store.js'

const props = defineProps({
  pollerStatus: { type: String, default: 'idle' },
})

// Measurement cadence alternates ~10s/channel (~20s full cycle); flag stale past 3x that.
const STALE_THRESHOLD_MS = 60_000

const now = ref(Date.now())
let timer = null
onMounted(() => {
  timer = setInterval(() => { now.value = Date.now() }, 1000)
})
onUnmounted(() => clearInterval(timer))

const channelInfos = computed(() =>
  [1, 2].map((channel) => {
    const profile = dtsStore.latest(channel)
    if (!profile) return { channel, profile: null }
    const ageMs = now.value - new Date(profile.time).getTime()
    return { channel, profile, ageMs, stale: ageMs > STALE_THRESHOLD_MS }
  }),
)

const statusLabel = computed(() => {
  switch (props.pollerStatus) {
    case 'idle': return 'Not connected'
    case 'connecting': return 'Connecting…'
    case 'fetching': return 'Streaming'
    case 'waiting-for-live-edge': return 'Waiting for live data'
    default: return props.pollerStatus
  }
})
</script>

<template>
  <div class="panel status-bar">
    <div class="status-item">
      <span class="muted">Status</span>
      <strong>{{ statusLabel }}</strong>
    </div>
    <div v-for="{ channel, profile, ageMs, stale } in channelInfos" :key="channel" class="status-item">
      <span class="muted">Channel {{ channel }}</span>
      <template v-if="profile">
        <strong :class="{ stale }">{{ stale ? 'STALE' : 'live' }}</strong>
        <span class="muted">{{ Math.round(ageMs / 1000) }}s ago</span>
        <span class="muted" :class="{ fault: profile.meta.fibreOk === false }">
          Fibre: {{ profile.meta.fibreOk === null ? '—' : profile.meta.fibreOk ? 'OK' : 'FAULT' }}
        </span>
      </template>
      <span v-else class="muted">no data yet</span>
    </div>
  </div>
</template>

<style scoped>
.status-bar {
  display: flex;
  gap: 2rem;
  flex-wrap: wrap;
  align-items: center;
}
.status-item {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
  font-size: 0.85rem;
}
.muted {
  color: var(--muted);
}
.stale {
  color: var(--warn);
}
.fault {
  color: var(--error);
}
</style>
