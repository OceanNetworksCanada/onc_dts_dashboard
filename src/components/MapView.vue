<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import cableRouteRaw from '../assets/cable-route.geojson?raw'
import { dtsStore, trimProfile } from '../lib/store.js'
import { valueToCss } from '../lib/colormap.js'

const cableRoute = JSON.parse(cableRouteRaw)

// Free, no-token raster basemap (OpenStreetMap tiles) — matches the "no API token" constraint.
const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

const CHANNEL_COLOR = { 1: '#58a6ff', 2: '#3fb950' }

const mapContainer = ref(null)
let map = null

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

/** Build a Point FeatureCollection: one point per geometry sample, colored by the
 * temperature nearest that distance in the latest (trim-aware) profile for its channel. */
function buildPointFeatures() {
  const profilesByChannel = {}
  for (const f of cableRoute.features) {
    const ch = f.properties.channel
    if (!(ch in profilesByChannel)) {
      profilesByChannel[ch] = trimProfile(dtsStore.latest(ch), dtsStore.getTrim(ch))
    }
  }

  let min = Infinity
  let max = -Infinity
  const rawFeatures = []
  for (const f of cableRoute.features) {
    const ch = f.properties.channel
    const profile = profilesByChannel[ch]
    const { distances } = f.properties
    const coords = f.geometry.coordinates
    for (let i = 0; i < coords.length; i++) {
      let temp = null
      if (profile && profile.distance.length > 0) {
        const idx = nearestIndex(profile.distance, distances[i])
        temp = idx >= 0 ? profile.temperature[idx] : null
      }
      if (temp != null) {
        if (temp < min) min = temp
        if (temp > max) max = temp
      }
      rawFeatures.push({ channel: ch, distance: distances[i], coord: coords[i], temp })
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0
    max = 1
  }

  return {
    type: 'FeatureCollection',
    features: rawFeatures.map((r) => ({
      type: 'Feature',
      properties: {
        channel: r.channel,
        distance: r.distance,
        temperature: r.temp,
        color: r.temp != null ? valueToCss(r.temp, min, max) : '#484f58',
      },
      geometry: { type: 'Point', coordinates: r.coord },
    })),
  }
}

function refreshPoints() {
  const src = map?.getSource('cable-points')
  if (src) src.setData(buildPointFeatures())
}

onMounted(() => {
  const [lon0, lat0] = cableRoute.features[0].geometry.coordinates[0]

  map = new maplibregl.Map({
    container: mapContainer.value,
    style: OSM_STYLE,
    center: [lon0, lat0],
    zoom: 15,
  })
  map.addControl(new maplibregl.NavigationControl(), 'top-right')

  map.on('load', () => {
    map.addSource('cable-lines', { type: 'geojson', data: cableRoute })
    map.addLayer({
      id: 'cable-lines',
      type: 'line',
      source: 'cable-lines',
      paint: {
        'line-color': ['match', ['get', 'channel'], 1, CHANNEL_COLOR[1], 2, CHANNEL_COLOR[2], '#888'],
        'line-width': 1.5,
        'line-opacity': 0.5,
      },
    })

    map.addSource('cable-points', { type: 'geojson', data: buildPointFeatures() })
    map.addLayer({
      id: 'cable-points',
      type: 'circle',
      source: 'cable-points',
      paint: {
        'circle-radius': 5,
        'circle-color': ['get', 'color'],
        'circle-stroke-width': 0.5,
        'circle-stroke-color': '#0d1117',
      },
    })

    map.on('click', 'cable-points', (e) => {
      const p = e.features[0].properties
      const tempLabel = p.temperature != null ? `${Number(p.temperature).toFixed(2)}°C` : 'no data'
      new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`<strong>Channel ${p.channel}</strong><br/>${Number(p.distance).toFixed(1)} m — ${tempLabel}`)
        .addTo(map)
    })
    map.on('mouseenter', 'cable-points', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'cable-points', () => { map.getCanvas().style.cursor = '' })
  })
})

onBeforeUnmount(() => {
  map?.remove()
  map = null
})

watch(
  () => [dtsStore.latest(1), dtsStore.latest(2), dtsStore.state.trim[1], dtsStore.state.trim[2]],
  refreshPoints,
)
</script>

<template>
  <div class="map-view panel">
    <div class="header">
      <span>Cable route — colored by latest temperature</span>
      <span class="muted">
        <span class="dot" :style="{ background: CHANNEL_COLOR[1] }"></span> Channel 1
        <span class="dot" :style="{ background: CHANNEL_COLOR[2] }"></span> Channel 2
      </span>
    </div>
    <p class="muted note">
      Cable geometry is a placeholder projection from a single origin point, not a survey — see
      <code>scripts/generate-cable-route.mjs</code>.
    </p>
    <div ref="mapContainer" class="map-container"></div>
  </div>
</template>

<style scoped>
.map-view {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  height: 480px;
}
.header {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
}
.note {
  font-size: 0.7rem;
  margin: 0;
}
.note code {
  color: var(--text);
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin: 0 0.2rem 0 0.6rem;
}
.map-container {
  flex: 1;
  border-radius: 6px;
  overflow: hidden;
}
.muted {
  color: var(--muted);
}
</style>
