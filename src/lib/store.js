// Reactive in-memory state: per-channel ring buffers of decoded DTS profiles, plus
// derived views for the profile chart, waterfall heatmap, and point time-series.
import { reactive } from 'vue'
import { HISTORY_CAP, TRIM_STORAGE_KEY, POINTS_STORAGE_KEY } from '../config.js'

function createChannelState() {
  return { profiles: [] }
}

function nearestIndex(distanceArr, target) {
  let lo = 0
  let hi = distanceArr.length - 1
  if (hi < 0) return -1
  if (target <= distanceArr[lo]) return lo
  if (target >= distanceArr[hi]) return hi
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (distanceArr[mid] < target) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(distanceArr[lo - 1] - target) < Math.abs(distanceArr[lo] - target)) return lo - 1
  return lo
}

function loadStoredTrim() {
  try {
    const raw = localStorage.getItem(TRIM_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function persistTrim(trim) {
  try {
    localStorage.setItem(TRIM_STORAGE_KEY, JSON.stringify(trim))
  } catch {
    // localStorage unavailable (private browsing, quota) — trim just won't persist.
  }
}

function loadStoredPoints() {
  try {
    const raw = localStorage.getItem(POINTS_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function persistPoints(points) {
  try {
    localStorage.setItem(POINTS_STORAGE_KEY, JSON.stringify(points))
  } catch {
    // localStorage unavailable — selected points just won't persist.
  }
}

/**
 * Slice a profile's distance/temperature arrays to [min, max] meters (either bound
 * optional). Used to crop the in-instrument lead-in and past-end-of-fibre sections
 * from a view without discarding them from the underlying profile data.
 */
export function trimProfile(profile, trim) {
  if (!profile) return profile
  const min = trim?.min
  const max = trim?.max
  if (min == null && max == null) return profile

  const { distance, temperature } = profile
  let lo = 0
  let hi = distance.length - 1
  if (min != null) while (lo < distance.length && distance[lo] < min) lo++
  if (max != null) while (hi >= 0 && distance[hi] > max) hi--
  if (lo > hi) return { ...profile, distance: distance.subarray(0, 0), temperature: temperature.subarray(0, 0) }

  return {
    ...profile,
    distance: distance.subarray(lo, hi + 1),
    temperature: temperature.subarray(lo, hi + 1),
  }
}

export function createDtsStore() {
  const state = reactive({
    channels: { 1: createChannelState(), 2: createChannelState() },
    status: 'idle', // idle | connecting | fetching | waiting-for-live-edge | error
    lastError: null,
    // Per-channel view crop in meters, e.g. { min: 5, max: 550 }. Persists across
    // reconnects/reloads; independent of the profile ring buffers so `reset()` keeps it.
    trim: loadStoredTrim(),
    // Per-channel list of fiber positions (meters) picked for the point time-series view.
    points: loadStoredPoints(),
  })

  function addProfile(profile) {
    const ch = state.channels[profile.channel] ?? (state.channels[profile.channel] = createChannelState())
    ch.profiles.push(profile)
    if (ch.profiles.length > HISTORY_CAP) ch.profiles.shift()
  }

  function reset() {
    state.channels = { 1: createChannelState(), 2: createChannelState() }
    state.lastError = null
  }

  function latest(channel) {
    const profiles = state.channels[channel]?.profiles
    return profiles?.length ? profiles[profiles.length - 1] : null
  }

  function history(channel) {
    return state.channels[channel]?.profiles ?? []
  }

  function getTrim(channel) {
    return state.trim[channel] ?? { min: null, max: null }
  }

  function setTrim(channel, min, max) {
    state.trim[channel] = { min, max }
    persistTrim(state.trim)
  }

  /** (time x distance) view for the waterfall heatmap. Assumes a stable distance grid per channel. */
  function matrixView(channel) {
    const trim = getTrim(channel)
    const profiles = history(channel).map((p) => trimProfile(p, trim))
    if (profiles.length === 0) return null
    return {
      distance: profiles[profiles.length - 1].distance,
      times: profiles.map((p) => p.time),
      rows: profiles.map((p) => p.temperature),
    }
  }

  /** Temperature over time at the fiber position nearest `targetDistance` (trim-aware). */
  function pointSeries(channel, targetDistance) {
    const trim = getTrim(channel)
    return history(channel).map((p) => {
      const tp = trimProfile(p, trim)
      const idx = nearestIndex(tp.distance, targetDistance)
      return { time: p.time, value: idx >= 0 ? tp.temperature[idx] : null }
    })
  }

  function getPoints(channel) {
    return state.points[channel] ?? []
  }

  function addPoint(channel, distance) {
    const list = state.points[channel] ?? (state.points[channel] = [])
    if (!list.includes(distance)) {
      list.push(distance)
      list.sort((a, b) => a - b)
      persistPoints(state.points)
    }
  }

  function removePoint(channel, distance) {
    const list = state.points[channel]
    if (!list) return
    const idx = list.indexOf(distance)
    if (idx !== -1) {
      list.splice(idx, 1)
      persistPoints(state.points)
    }
  }

  return {
    state,
    addProfile,
    reset,
    latest,
    history,
    matrixView,
    pointSeries,
    getTrim,
    setTrim,
    getPoints,
    addPoint,
    removePoint,
  }
}

export const dtsStore = createDtsStore()
