# CLAUDE.md — ONC DTS Dashboard

Client-side-only realtime dashboard for Silixa XT DTS (Distributed Temperature Sensing)
data served through ONC's Oceans 3.0 REST API. See the plan at
`C:\Users\mheesema\.claude\plans\lexical-bouncing-emerson.md` for the full design rationale
and phase breakdown; this file is working notes for continuing implementation.

## Architecture (decided, don't re-litigate)

- **No backend, no database, no build secrets.** Vue 3 + Vite SPA, deployed to GitHub Pages.
  Each user pastes their own ONC API token; it's stored in `localStorage` and sent only to
  `data.oceannetworks.ca`. The browser fetches and parses DTS data directly.
- Reference for the *frontend skeleton pattern only* (not the Supabase/pipeline parts):
  `C:\Users\mheesema\Documents\Projects\ncszo_tools\waveglider_dashboard\web\`.
- Source Python project being ported: `C:\Users\mheesema\Documents\Projects\onc_dts\onc_dts_data`
  — `src/onc_dts/utils.py` (`parse_xt_json`) and `src/onc_dts/monitor_dts.py`
  (`RawDataFetcher`, `fetch_onc_realtime_data`) are the ported logic.

## Gotchas discovered during build (important — don't rediscover these)

1. **ONC's raw JSON payloads contain non-standard JSON tokens** (`-Infinity` appears in
   `processed data → fibre check status → fibre break location` when there's no break).
   Python's `json.loads` silently accepts these; JS `JSON.parse` throws. Always parse ONC
   response bodies through `parseOncJson()` / `sanitizeOncJson()` in `src/lib/dtsParse.js`,
   never raw `JSON.parse`.
2. **Each profile has real artifacts at both ends of the distance axis**: the start is inside
   the instrument (lead-in fiber) and the tail is past the physical end of the fiber — both
   read as huge temperature spikes/drops that blow out the y-axis. This is expected, not a
   parsing bug. Solved with **per-channel, user-adjustable trim** (`dtsStore.getTrim/setTrim`,
   persisted to `localStorage` under `TRIM_STORAGE_KEY`), applied via `trimProfile()` in
   `src/lib/store.js`. Every view that reads profiles (profile chart, and `matrixView()` for
   the waterfall) should go through the trim, not raw `history()`/`latest()` directly, unless
   there's a specific reason to see the full raw span.
3. **Channel point counts are fixed per channel**: `CHANNEL_POINTS = {1: 2206, 2: 1561}` in
   `src/config.js`, matching the Python default. This determines how many points from
   `first external point` onward are kept when trimming to the external fiber span.
4. **The live instrument may be offline** for extended periods (it was during this build).
   The dev flow for testing without live data: connect with a **historical `startTime`**
   (e.g. `2025-07-30T20:33:00.000Z` — known to have data, used throughout dev/testing) via
   the "Start from" field / "Restart from here" control in `TokenGate.vue`. The poller then
   replays archived raw data forward via cursor pagination — it can page through months of
   archive quickly once it finds data, so it will reach the live edge and start showing
   "STALE" / "waiting-for-live-edge" again after a while. This is expected, not a bug.
5. **`TokenGate.vue`'s connected view has "Restart from here" / "Jump to now"** — changing
   start time does NOT require re-entering the token (it used to; this was a specific user
   complaint during build — don't regress it back to forcing a full disconnect/reconnect for
   a start-time change).
6. **Typed arrays (`Float32Array`) are used throughout** (`profile.distance`,
   `profile.temperature`) for perf — `.subarray()` (used in `trimProfile`) is a *view*, not a
   copy, so trimming is cheap even at HISTORY_CAP (500 profiles/channel).
7. **Chart.js `parsing: false` + a `time` x-scale needs epoch-ms numbers, not `Date` objects.**
   With `parsing: false`, Chart.js skips the adapter-based parsing step and expects data
   already in the scale's *internal* numeric form — for a linear scale that's a plain number
   (fine), but for a `time` scale it's epoch milliseconds, not a `Date`. Passing `x: new
   Date(...)` silently breaks min/max detection: the chart shows a generic single-day axis
   with no visible line, no console error. Fix: `x: new Date(s.time).getTime()`. See
   `PointTimeSeries.vue`'s `seriesFor()`.
8. **Replacing `chart.data.datasets` with a new array breaks Chart.js's internal per-dataset
   metadata.** When reactively updating a chart with a dynamic number of series (e.g. user
   adds/removes point-series), mutate the existing array in place —
   `chart.data.datasets.splice(0, chart.data.datasets.length, ...newDatasets)` — rather than
   `chart.data.datasets = newDatasets`. `ProfileChart.vue`/`WaterfallCanvas.vue` sidestep this
   by mutating a fixed dataset's `.data` field instead of touching the array at all.
9. **Vite HMR can corrupt the module graph** after certain edits (seen: adding a new named
   export to `config.js` while multiple files import it triggered repeated "does not provide
   an export named X" errors that HMR couldn't self-heal). Symptom: components silently using
   stale module instances (e.g. store state not shared). Fix: kill and restart the dev server
   (`npx vite --port <N>`), don't just hot-reload through it.
10. **GMRT's tile "service" is actually WMS, not XYZ/TMS** — there's no documented tile
    endpoint. MapLibre/Mapbox GL's raster source supports a `{bbox-epsg-3857}` template token
    specifically for wiring a WMS `GetMap` request up as if it were an XYZ source; see
    `GMRT_STYLE` in `MapView.vue` (`LAYERS=topo`, `CRS=EPSG:3857`). Confirmed working live —
    real bathymetry tiles render.
11. **Historical/backfill replay timestamps are not evenly spaced** — during fast cursor-paged
    replay, consecutive decoded profiles can jump by hours/days between them (archive gaps),
    unlike live cadence (~10-20s). This makes `binnedPointSeries`' bins mostly sparse/empty
    with a long overall x-domain, so a waterfall-hover time often lands very close to the
    chart's right edge even when hovering the middle of the waterfall — this is a testing-data
    artifact of accelerated replay, not a bug in the hover→guideline pixel mapping. Don't
    "fix" the guideline math based on how it looks during fast replay; verify against roughly
    real-time-paced data if the positioning is ever in question.
12. **Chart.js scale `afterFit` hook can force a fixed pixel width** —
    `scales.y.afterFit = (scale) => { scale.width = AXIS_GUTTER_PX }` — used to pixel-align
    `ProfileChart`'s y-axis gutter with `WaterfallCanvas`'s CSS-fixed `.time-axis` width
    (`AXIS_GUTTER_PX` in `config.js`), so the two stack with a shared, aligned distance axis
    regardless of tick label content width.

## State shape (`src/lib/store.js`)

- `dtsStore.state.channels[1|2].profiles`: ring buffer (cap `HISTORY_CAP=500`) of decoded
  profiles, oldest first, newest last (`.push()`/`.shift()`).
- `dtsStore.state.trim[channel]`: `{min, max}` in meters or `null` — survives `reset()`
  (channel reset happens on every reconnect; trim is a view preference, not session data).
- `dtsStore.state.points[channel]`: array of user-picked fiber distances (meters) for the
  point time-series view, persisted under `POINTS_STORAGE_KEY`.
- `dtsStore.matrixView(channel)`: trimmed `(time × distance)` view for the waterfall —
  `{ distance, times, rows }`, rows oldest→newest.
- `dtsStore.pointSeries(channel, targetDistance)`: trim-aware temperature-over-time at the
  nearest fiber position to `targetDistance` (raw, per-measurement).
- `dtsStore.binnedPointSeries(channel, targetDistance)`: `pointSeries` bucketed into
  `AVERAGE_WINDOW_MS`-wide bins (mean per bin) — the default line drawn in `PointTimeSeries.vue`.
- `dtsStore.averagedProfile(channel)`: mean temperature per distance bin over the trailing
  `AVERAGE_WINDOW_MS`, relative to the latest profile's own timestamp — the default line drawn
  in `ProfileChart.vue`.
- `dtsStore.profileAt(channel, timeMs)`: nearest-time historical profile (linear scan,
  `HISTORY_CAP`-bounded) — used for the waterfall-hover overlay on `ProfileChart.vue`.
- `dtsStore.temperatureRange()`: shared `{min, max}` across **both channels'** trimmed
  buffered profiles — the single color/axis range used by every view.
- `dtsStore.state.hover[channel]`: `{ timeMs, distance } | null`, set by `WaterfallCanvas.vue`
  on mousemove — drives the profile-chart overlay and point-series guideline for that channel.

## Build status

All 5 v1 phases plus a v2 polish pass are complete and verified in-browser against the live
ONC API (with historical backfill used for testing while the instrument was offline):

- v1: Phase 0 (CORS/API verify), Phase 1 (profile chart + status bar + trim controls), Phase 2
  (waterfall heatmap), Phase 3 (point time series), Phase 4 (map — `src/components/MapView.vue`,
  cable geometry from `scripts/generate-cable-route.mjs`, real Endeavour-field origin coords
  provided by the user), Phase 5 (`.github/workflows/deploy.yml`, no secrets needed since the
  ONC token is never baked into the build). Deployed at
  https://oceannetworkscanada.github.io/onc_dts_dashboard/.
- v2 polish: profile chart + waterfall stacked and pixel-aligned per channel (`App.vue`
  `.channel-panel`); one shared temperature range across all views/both channels
  (`dtsStore.temperatureRange()`); default profile/point-series lines are 5-minute averages,
  with waterfall-hover overlaying the raw historical data on top; GMRT bathymetry basemap
  replacing OSM; ONC's NEPTUNE/VENUS backbone cable as a static reference layer on the map.

Remaining open items (not blocking, see plan file):
- Cable geometry is a placeholder projection from a single origin + azimuth per channel, not a
  real survey — regenerate via `scripts/generate-cable-route.mjs` as better data arrives.
- Profile history is in-memory only (not persisted across reloads) — noted as a v1 tradeoff in
  the plan, not yet revisited.

## Dev loop

`npm run dev` (Vite). Browser testing done via Claude-in-Chrome against `localhost:<port>`
(port varies per session — check the running background task). Token is never read from
`.env`/localStorage by the assistant directly (credential-materialization policy) — ask the
user to paste it into the UI themselves when live-testing is needed.
