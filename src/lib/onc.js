// Browser client + realtime poller for ONC Oceans 3.0 rawdata/device, porting
// onc_dts_data/src/onc_dts/monitor_dts.py (fetch_onc_realtime_data, RawDataFetcher).
import { ONC_RAWDATA_URL, ROW_LIMIT, POLL_INTERVAL_MS, DEFAULT_DEVICE_CODE } from '../config.js'
import { parseOncJson, parseDtsProfile } from './dtsParse.js'

const GET_DATA_PREFIX = '{"Cmd":"getData",'

export class OncApiError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message)
    this.name = 'OncApiError'
    this.status = status
    if (cause) this.cause = cause
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** GET https://data.oceannetworks.ca/api/rawdata/device — mirrors fetch_onc_realtime_data. */
export async function fetchRawData({ deviceCode, dateFrom, token, getLatest = false, rowLimit = ROW_LIMIT }) {
  if (!token) throw new OncApiError('Missing ONC API token')

  const url = new URL(ONC_RAWDATA_URL)
  url.searchParams.set('deviceCode', deviceCode)
  url.searchParams.set('dateFrom', dateFrom)
  url.searchParams.set('rowLimit', String(rowLimit))
  url.searchParams.set('outputFormat', 'Object')
  url.searchParams.set('getLatest', String(getLatest))
  url.searchParams.set('token', token)

  let response
  try {
    response = await fetch(url)
  } catch (err) {
    throw new OncApiError('Network error contacting the ONC API (possibly blocked by CORS)', { cause: err })
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new OncApiError(`ONC API error ${response.status}: ${text.slice(0, 300)}`, { status: response.status })
  }

  const text = await response.text()
  return parseOncJson(text)
}

function isGetDataRecord(item) {
  return typeof item?.rawData === 'string' && item.rawData.startsWith(GET_DATA_PREFIX)
}

/**
 * One-shot helper: page forward from `dateFrom` (an archived/historical timestamp) until a
 * decodable DTS profile is found. Useful for testing against archived data when the instrument
 * is offline and there's nothing at the live edge.
 */
export async function fetchHistoricalProfile({ deviceCode = DEFAULT_DEVICE_CODE, token, dateFrom, maxPages = 10 }) {
  let cursor = dateFrom
  for (let page = 0; page < maxPages && cursor; page++) {
    const result = await fetchRawData({ deviceCode, dateFrom: cursor, token })
    const items = result?.data ?? []
    for (const item of items) {
      if (isGetDataRecord(item)) {
        const decoded = parseOncJson(item.rawData)
        return parseDtsProfile(decoded.Resp)
      }
    }
    cursor = result?.next?.parameters?.dateFrom ?? null
  }
  return null
}

/**
 * One-shot helper: fetch the most recent decodable DTS profile within `lookbackMs` of now.
 * Useful for an initial snapshot and for verifying API/CORS access (Phase 0).
 */
export async function fetchLatestProfile({ deviceCode = DEFAULT_DEVICE_CODE, token, lookbackMs = 5 * 60 * 1000, rowLimit = 50 }) {
  const dateFrom = new Date(Date.now() - lookbackMs).toISOString()
  const result = await fetchRawData({ deviceCode, dateFrom, token, getLatest: true, rowLimit })
  const items = result?.data ?? []
  for (let i = items.length - 1; i >= 0; i--) {
    if (isGetDataRecord(items[i])) {
      const decoded = parseOncJson(items[i].rawData)
      return parseDtsProfile(decoded.Resp)
    }
  }
  return null
}

/**
 * Cursor-paginated realtime poller, mirroring RawDataFetcher (monitor_dts.py:81-133).
 * Walks forward through the raw serial stream via the `next.parameters.dateFrom` cursor;
 * once caught up to the live edge (no `next`), waits POLL_INTERVAL_MS and retries.
 */
export class DtsPoller {
  constructor({ deviceCode = DEFAULT_DEVICE_CODE, token, startTime, onProfile, onError, onStatus }) {
    this.deviceCode = deviceCode
    this.token = token
    this.nextDate = startTime
    this.lastDate = startTime
    this.onProfile = onProfile
    this.onError = onError
    this.onStatus = onStatus
    this._stopped = true
  }

  stop() {
    this._stopped = true
  }

  async start() {
    this._stopped = false
    while (!this._stopped) {
      if (this.nextDate == null) {
        this.onStatus?.('waiting-for-live-edge')
        await sleep(POLL_INTERVAL_MS)
        if (this._stopped) return
        try {
          const result = await fetchRawData({
            deviceCode: this.deviceCode,
            dateFrom: this.lastDate,
            token: this.token,
            rowLimit: 1,
          })
          this.nextDate = result?.next?.parameters?.dateFrom ?? null
        } catch (err) {
          this.onError?.(err)
          await sleep(POLL_INTERVAL_MS)
        }
        continue
      }

      let result
      try {
        this.onStatus?.('fetching')
        result = await fetchRawData({
          deviceCode: this.deviceCode,
          dateFrom: this.nextDate,
          token: this.token,
        })
      } catch (err) {
        this.onError?.(err)
        await sleep(POLL_INTERVAL_MS)
        continue
      }

      const items = result?.data ?? []
      for (const item of items) {
        if (this._stopped) return
        if (isGetDataRecord(item)) {
          try {
            const decoded = parseOncJson(item.rawData)
            this.onProfile?.(parseDtsProfile(decoded.Resp))
          } catch (err) {
            this.onError?.(err)
          }
        }
        this.lastDate = item.sampleTime
      }

      this.nextDate = result?.next?.parameters?.dateFrom ?? null
      if (items.length === 0 && this.nextDate == null) {
        await sleep(POLL_INTERVAL_MS)
      }
    }
  }
}
