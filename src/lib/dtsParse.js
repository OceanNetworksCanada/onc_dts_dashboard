// Port of onc_dts_data/src/onc_dts/utils.py:parse_xt_json and the K->C conversion
// used in onc_dts_data/src/onc_dts/monitor_dts.py:155.
import { CHANNEL_POINTS } from '../config.js'

const KELVIN_OFFSET = 273.15

// ONC's raw JSON payloads use Python's json.loads-only extension tokens
// (-Infinity / Infinity / NaN) for fields like "fibre break location". These are not
// valid JSON per spec, so JSON.parse() throws on them. Replace bare occurrences
// (only where they appear as a JSON value, not inside a quoted string) with null
// before parsing.
export function sanitizeOncJson(text) {
  return text.replace(/([:,[]\s*)(-?Infinity|NaN)(?=\s*[,\]}])/g, (_, prefix) => `${prefix}null`)
}

export function parseOncJson(text) {
  return JSON.parse(sanitizeOncJson(text))
}

function decodeBase64Float32(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  // DTS payloads are little-endian float32 ('<f4'); browsers are little-endian natively.
  return new Float32Array(bytes.buffer)
}

/**
 * Parse one DTS "getData" measurement record (the `Resp` object) into a profile.
 * Mirrors parse_xt_json (utils.py:19-121): extracts metadata, trims to the external
 * fiber span, and converts temperature Kelvin -> Celsius.
 *
 * @param {object} resp - the `Resp` object from a decoded getData record
 * @param {object} [channelPoints] - points-per-channel map, defaults to CHANNEL_POINTS
 * @param {boolean} [trim] - trim to external fiber span (default true)
 */
export function parseDtsProfile(resp, channelPoints = CHANNEL_POINTS, trim = true) {
  const processed = resp['processed data']
  const tempBlock = processed['resampled temperature data']

  const channel = (processed['forward channel'] ?? 0) + 1
  const dz = tempBlock.dz
  const firstExternalPoint = tempBlock['first external point']
  const nExternalPoints = channelPoints[channel]

  const rawTempKelvin = decodeBase64Float32(tempBlock.signal.Data)

  let distance
  let tempKelvin
  if (trim && nExternalPoints != null) {
    const from = firstExternalPoint
    const to = from + nExternalPoints
    tempKelvin = rawTempKelvin.slice(from, to)
    distance = new Float32Array(tempKelvin.length)
    for (let i = 0; i < distance.length; i++) distance[i] = i * dz
  } else {
    tempKelvin = rawTempKelvin
    distance = new Float32Array(rawTempKelvin.length)
    for (let i = 0; i < distance.length; i++) distance[i] = i * dz
  }

  const temperature = new Float32Array(tempKelvin.length)
  for (let i = 0; i < temperature.length; i++) temperature[i] = tempKelvin[i] - KELVIN_OFFSET

  const fibreCheck = processed['fibre check status'] ?? {}
  const probeTemps = processed['probe temperatures'] ?? {}

  return {
    channel,
    time: processed['measurement start time'],
    distance,
    temperature,
    meta: {
      dz,
      firstExternalPoint,
      externalLength: nExternalPoints != null ? nExternalPoints * dz : null,
      acquisitionTime: processed['acquisition time'],
      measurementComplete: processed['measurement complete'],
      fibreOk: fibreCheck['fibre ok'] ?? null,
      fibreBreakLocation: fibreCheck['fibre break location'] ?? null,
      internalProbeTempK: probeTemps['internal probe temperature'] ?? null,
      probe1TempK: probeTemps['probe1 temperature'] ?? null,
      probe2TempK: probeTemps['probe2 temperature'] ?? null,
    },
  }
}
