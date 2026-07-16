// Default DTS device + parsing constants, ported from onc_dts_data/src/onc_dts/monitor_dts.py
// and onc_dts_data/src/onc_dts/utils.py.

export const DEFAULT_DEVICE_CODE = 'SILIXADTSXT19083'

// Number of external-fiber points to keep per channel after trimming the lead-in fiber.
// Matches channel_points default in parse_xt_json (utils.py:21).
export const CHANNEL_POINTS = { 1: 2206, 2: 1561 }

export const ONC_RAWDATA_URL = 'https://data.oceannetworks.ca/api/rawdata/device'

// Poll cadence once caught up to the live edge (matches RawDataFetcher's sleep(5)).
export const POLL_INTERVAL_MS = 5000

// Row page size per ONC API request.
export const ROW_LIMIT = 100

// Max profiles retained per channel in the in-memory ring buffer (for the waterfall/point views).
export const HISTORY_CAP = 500

export const TOKEN_STORAGE_KEY = 'onc-dts-dashboard:onc-token'
export const DEVICE_STORAGE_KEY = 'onc-dts-dashboard:device-code'
export const START_TIME_STORAGE_KEY = 'onc-dts-dashboard:start-time'
export const TRIM_STORAGE_KEY = 'onc-dts-dashboard:trim'
export const POINTS_STORAGE_KEY = 'onc-dts-dashboard:points'
