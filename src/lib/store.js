// Reactive in-memory state: per-channel ring buffers of decoded DTS profiles, plus
// derived views for the profile chart, waterfall heatmap, and point time-series.
import { reactive } from 'vue'
import { HISTORY_CAP, TRIM_STORAGE_KEY, POINTS_STORAGE_KEY, AVERAGE_WINDOW_MS } from '../config.js'

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
    // Per-channel waterfall hover position: { timeMs, distance } | null. Session-only, not
    // persisted — drives the cross-chart hover overlay/guideline on the profile and
    // point-series charts.
    hover: { 1: null, 2: null },
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

  /**
   * Temperature min/max across BOTH channels' currently-buffered, trim-applied profiles —
   * the single shared color/axis range used by every view (profile, waterfall, points, map)
   * so they're directly comparable.
   */
  function temperatureRange() {
    let min = Infinity
    let max = -Infinity
    for (const ch of [1, 2]) {
      const trim = getTrim(ch)
      for (const p of history(ch)) {
        const tp = trimProfile(p, trim)
        for (let i = 0; i < tp.temperature.length; i++) {
          const v = tp.temperature[i]
          if (v < min) min = v
          if (v > max) max = v
        }
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null
    if (min === max) {
      min -= 0.5
      max += 0.5
    }
    return { min, max }
  }

  /**
   * Default profile-chart line: mean temperature per distance bin over the trailing
   * AVERAGE_WINDOW_MS, relative to the latest profile's own timestamp (not wall-clock —
   * historical replay can run much faster than real time). Smooths per-measurement noise.
   */
  function averagedProfile(channel) {
    const trim = getTrim(channel)
    const profiles = history(channel).map((p) => trimProfile(p, trim))
    if (profiles.length === 0) return null

    const latest = profiles[profiles.length - 1]
    const cutoff = new Date(latest.time).getTime() - AVERAGE_WINDOW_MS
    const windowed = profiles.filter(
      (p) => new Date(p.time).getTime() >= cutoff && p.temperature.length === latest.temperature.length,
    )
    if (windowed.length === 0) return latest

    const n = latest.temperature.length
    const sum = new Float64Array(n)
    for (const p of windowed) {
      for (let i = 0; i < n; i++) sum[i] += p.temperature[i]
    }
    const avg = new Float32Array(n)
    for (let i = 0; i < n; i++) avg[i] = sum[i] / windowed.length

    return { ...latest, temperature: avg, meta: { ...latest.meta, averagedOverN: windowed.length } }
  }

  /**
   * Default point-series line: `pointSeries` bucketed into AVERAGE_WINDOW_MS-wide bins
   * (mean per bin), producing a smoothed ~5-minute-resolution series instead of raw
   * per-measurement noise.
   */
  function binnedPointSeries(channel, targetDistance) {
    const raw = pointSeries(channel, targetDistance)
    if (raw.length === 0) return []

    const bins = new Map() // binStartMs -> { sum, count }
    for (const { time, value } of raw) {
      if (value == null) continue
      const t = new Date(time).getTime()
      const binStart = Math.floor(t / AVERAGE_WINDOW_MS) * AVERAGE_WINDOW_MS
      const bin = bins.get(binStart) ?? { sum: 0, count: 0 }
      bin.sum += value
      bin.count += 1
      bins.set(binStart, bin)
    }

    return [...bins.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([binStart, { sum, count }]) => ({
        time: new Date(binStart + AVERAGE_WINDOW_MS / 2).toISOString(),
        value: sum / count,
      }))
  }

  /** Nearest-time historical profile (trim-applied), for the waterfall hover overlay. */
  function profileAt(channel, timeMs) {
    const profiles = history(channel)
    if (profiles.length === 0) return null
    let best = profiles[0]
    let bestDiff = Math.abs(new Date(best.time).getTime() - timeMs)
    for (const p of profiles) {
      const diff = Math.abs(new Date(p.time).getTime() - timeMs)
      if (diff < bestDiff) {
        best = p
        bestDiff = diff
      }
    }
    return trimProfile(best, getTrim(channel))
  }

  function setHover(channel, hover) {
    state.hover[channel] = hover
  }

  function clearHover(channel) {
    state.hover[channel] = null
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
    temperatureRange,
    averagedProfile,
    binnedPointSeries,
    profileAt,
    setHover,
    clearHover,
  }
}

export const dtsStore = createDtsStore()
