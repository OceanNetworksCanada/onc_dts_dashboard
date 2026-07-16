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
  nearest fiber position to `targetDistance`.

## Build status

All 5 phases complete and verified in-browser against the live ONC API (with historical
backfill used for testing while the instrument was offline):

- Phase 0 (CORS/API verify), Phase 1 (profile chart + status bar + trim controls), Phase 2
  (waterfall heatmap), Phase 3 (point time series), Phase 4 (map — `src/components/MapView.vue`,
  cable geometry from `scripts/generate-cable-route.mjs`, real Endeavour-field origin coords
  provided by the user), Phase 5 (`.github/workflows/deploy.yml`, no secrets needed since the
  ONC token is never baked into the build).

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
