<script setup>
import { ref, onUnmounted } from 'vue'
import TokenGate from './components/TokenGate.vue'
import StatusBar from './components/StatusBar.vue'
import ProfileChart from './components/ProfileChart.vue'
import WaterfallCanvas from './components/WaterfallCanvas.vue'
import PointTimeSeries from './components/PointTimeSeries.vue'
import MapView from './components/MapView.vue'
import { DtsPoller } from './lib/onc.js'
import { dtsStore } from './lib/store.js'

const pollerStatus = ref('idle')
const pollerError = ref('')
let poller = null

function stopPoller() {
  poller?.stop()
  poller = null
  pollerStatus.value = 'idle'
}

function connect({ token, deviceCode, startTime }) {
  stopPoller()
  dtsStore.reset()
  pollerError.value = ''

  poller = new DtsPoller({
    token,
    deviceCode,
    startTime,
    onProfile: (profile) => dtsStore.addProfile(profile),
    onStatus: (s) => { pollerStatus.value = s },
    onError: (err) => {
      pollerError.value = err?.message ?? String(err)
      console.error(err)
    },
  })
  pollerStatus.value = 'connecting'
  poller.start()
}

function disconnect() {
  stopPoller()
  dtsStore.reset()
}

onUnmounted(stopPoller)
</script>

<template>
  <header class="panel header">
    <h1>ONC DTS Dashboard</h1>
    <span class="muted">Realtime Distributed Temperature Sensing</span>
  </header>

  <main>
    <TokenGate @connect="connect" @disconnect="disconnect" />

    <StatusBar :poller-status="pollerStatus" />

    <section v-if="pollerError" class="panel error">
      <strong>Poller error:</strong> {{ pollerError }}
    </section>

    <div class="charts-grid">
      <ProfileChart :channel="1" color="#58a6ff" />
      <ProfileChart :channel="2" color="#3fb950" />
    </div>

    <div class="charts-grid">
      <WaterfallCanvas :channel="1" />
      <WaterfallCanvas :channel="2" />
    </div>

    <div class="charts-grid">
      <PointTimeSeries :channel="1" />
      <PointTimeSeries :channel="2" />
    </div>

    <MapView />
  </main>
</template>

<style scoped>
.header {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  border-radius: 0;
  border-left: none;
  border-right: none;
  border-top: none;
}
h1 {
  margin: 0;
  font-size: 1.2rem;
}
main {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
}
.error {
  border-color: var(--error);
  color: var(--error);
}
.charts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 1rem;
}
</style>
