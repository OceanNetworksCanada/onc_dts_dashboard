#!/usr/bin/env node
// Generates src/assets/cable-route.geojson: per-channel fiber geometry as a spherical
// forward-azimuth projection from a single origin point. This is a placeholder/approximate
// route (accurate to sub-meter at this scale, but not a real survey) — tweak ORIGIN/CHANNELS
// below and re-run as real deployment coordinates or a surveyed route become available.
// Mirrors the geodesic approach in onc_dts_data/scripts/create_lat_lons.py (pyproj.Geod.fwd),
// reimplemented with the spherical law of cosines so this repo has no Python dependency.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ORIGIN = { lat: 47.9481685, lon: -129.09884676 }

const CHANNELS = [
  { channel: 1, azimuthDeg: 15, lengthM: 560, stepM: 5 },
  { channel: 2, azimuthDeg: 105, lengthM: 400, stepM: 5 },
]

const EARTH_RADIUS_M = 6371000

function toRad(deg) {
  return (deg * Math.PI) / 180
}
function toDeg(rad) {
  return (rad * 180) / Math.PI
}

/** Destination point given a start lat/lon, bearing (deg), and distance (m). */
function destination(lat, lon, bearingDeg, distanceM) {
  const lat1 = toRad(lat)
  const lon1 = toRad(lon)
  const brng = toRad(bearingDeg)
  const angularDist = distanceM / EARTH_RADIUS_M

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDist) + Math.cos(lat1) * Math.sin(angularDist) * Math.cos(brng),
  )
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(angularDist) * Math.cos(lat1),
      Math.cos(angularDist) - Math.sin(lat1) * Math.sin(lat2),
    )

  return [toDeg(lon2), toDeg(lat2)]
}

const features = CHANNELS.map((ch) => {
  const distances = []
  const coordinates = []
  for (let d = 0; d <= ch.lengthM; d += ch.stepM) {
    distances.push(d)
    coordinates.push(destination(ORIGIN.lat, ORIGIN.lon, ch.azimuthDeg, d))
  }
  return {
    type: 'Feature',
    properties: { channel: ch.channel, azimuthDeg: ch.azimuthDeg, distances },
    geometry: { type: 'LineString', coordinates },
  }
})

const featureCollection = {
  type: 'FeatureCollection',
  properties: {
    note: 'Placeholder cable geometry (spherical forward-azimuth from ORIGIN per channel) — not a survey. Regenerate via scripts/generate-cable-route.mjs once real coordinates/route are available.',
    origin: ORIGIN,
  },
  features,
}

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'cable-route.geojson')
writeFileSync(outPath, JSON.stringify(featureCollection, null, 2) + '\n')
console.log(`Wrote ${outPath}`)
for (const f of features) {
  console.log(`  channel ${f.properties.channel}: ${f.geometry.coordinates.length} points, azimuth ${f.properties.azimuthDeg}°`)
}
