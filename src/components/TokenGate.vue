<script setup>
import { ref, onMounted } from 'vue'
import { TOKEN_STORAGE_KEY, DEVICE_STORAGE_KEY, START_TIME_STORAGE_KEY, DEFAULT_DEVICE_CODE } from '../config.js'

const emit = defineEmits(['connect', 'disconnect'])

function defaultStartTime() {
  return new Date(Date.now() - 2 * 60 * 1000).toISOString()
}

const token = ref('')
const deviceCode = ref(DEFAULT_DEVICE_CODE)
const startTime = ref(localStorage.getItem(START_TIME_STORAGE_KEY) || defaultStartTime())
const connected = ref(false)

onMounted(() => {
  const savedToken = localStorage.getItem(TOKEN_STORAGE_KEY)
  const savedDevice = localStorage.getItem(DEVICE_STORAGE_KEY)
  if (savedToken) {
    token.value = savedToken
    deviceCode.value = savedDevice || DEFAULT_DEVICE_CODE
    connected.value = true
    emit('connect', { token: savedToken, deviceCode: deviceCode.value, startTime: startTime.value })
  }
})

function persist() {
  localStorage.setItem(TOKEN_STORAGE_KEY, token.value.trim())
  localStorage.setItem(DEVICE_STORAGE_KEY, deviceCode.value.trim() || DEFAULT_DEVICE_CODE)
  localStorage.setItem(START_TIME_STORAGE_KEY, startTime.value.trim())
}

function submit() {
  const t = token.value.trim()
  if (!t) return
  deviceCode.value = deviceCode.value.trim() || DEFAULT_DEVICE_CODE
  persist()
  connected.value = true
  emit('connect', { token: t, deviceCode: deviceCode.value, startTime: startTime.value.trim() })
}

/** Restart the stream from a new start time without re-entering the token. */
function restart() {
  persist()
  emit('connect', { token: token.value, deviceCode: deviceCode.value, startTime: startTime.value.trim() })
}

function jumpToNow() {
  startTime.value = defaultStartTime()
  restart()
}

function forget() {
  localStorage.removeItem(TOKEN_STORAGE_KEY)
  localStorage.removeItem(DEVICE_STORAGE_KEY)
  token.value = ''
  connected.value = false
  emit('disconnect')
}
</script>

<template>
  <div class="panel token-gate" :class="{ connected }">
    <template v-if="!connected">
      <h2>Connect to ONC Oceans 3.0</h2>
      <p class="muted">
        Paste your ONC API token to start streaming live DTS data. Get one from
        <a href="https://data.oceannetworks.ca/Profile" target="_blank" rel="noopener">your ONC profile</a>
        under "Web Services API". The token is stored only in this browser (localStorage) and sent only to
        ONC's API.
      </p>
      <div class="row">
        <input v-model="token" type="password" placeholder="ONC API token" @keyup.enter="submit" />
      </div>
      <div class="row">
        <input v-model="deviceCode" type="text" placeholder="Device code" />
      </div>
      <div class="row">
        <input
          v-model="startTime"
          type="text"
          placeholder="Start from (ISO 8601)"
          title="Defaults to ~2 minutes ago. Set to an earlier timestamp to backfill archived data."
        />
      </div>
      <button :disabled="!token.trim()" @click="submit">Connect</button>
    </template>
    <template v-else>
      <span class="muted">Device <strong>{{ deviceCode }}</strong></span>
      <div class="row restart-row">
        <input v-model="startTime" type="text" title="ISO 8601 timestamp to restream from" @keyup.enter="restart" />
        <button class="secondary" @click="restart">Restart from here</button>
        <button class="secondary" @click="jumpToNow">Jump to now</button>
      </div>
      <button class="secondary" @click="forget">Forget token</button>
    </template>
  </div>
</template>

<style scoped>
.token-gate {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-width: 480px;
}
.token-gate.connected {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  max-width: none;
  flex-wrap: wrap;
}
.row {
  display: flex;
}
.restart-row {
  gap: 0.5rem;
  flex: 1;
  min-width: 320px;
}
.restart-row input {
  flex: 1;
}
input {
  width: 100%;
}
.muted {
  color: var(--muted);
  font-size: 0.85rem;
}
</style>
