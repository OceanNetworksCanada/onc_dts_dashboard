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

// Fixed left-gutter width (px) shared by ProfileChart's y-axis and WaterfallCanvas's time-axis,
// so the two stack with pixel-aligned distance axes regardless of tick label content.
export const AXIS_GUTTER_PX = 48

// Window used for the "default" (non-hover) smoothed profile/point-series lines, relative to
// the latest profile's own timestamp (not wall-clock time — historical replay can run much
// faster than real time).
export const AVERAGE_WINDOW_MS = 5 * 60 * 1000

export const TOKEN_STORAGE_KEY = 'onc-dts-dashboard:onc-token'
export const DEVICE_STORAGE_KEY = 'onc-dts-dashboard:device-code'
export const START_TIME_STORAGE_KEY = 'onc-dts-dashboard:start-time'
export const TRIM_STORAGE_KEY = 'onc-dts-dashboard:trim'
export const POINTS_STORAGE_KEY = 'onc-dts-dashboard:points'
