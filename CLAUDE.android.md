# CLAUDE.android.md

Rules for the Android TV port. `CLAUDE.md` stays canonical for upstream
IPTVnator; this file only covers what the port adds or overrides.

Written from scratch against this tree (`androidtv/tvm-ui`, based on `master` at
v0.23.0). Every claim below was verified here, not carried over.

## Fork And Branch Model

| Branch | Role |
| --- | --- |
| `master` | Exact mirror of `upstream/master` (`4gray/iptvnator`). Never commit here. |
| `androidtv/tvm-ui` | Port work. Branched from `master` (v0.23.0). |
| `androidtv/main` | **Abandoned first attempt** — see below. Do not build on it. |

Remotes: `origin` = the fork (`JimDoubleW/iptvandor`), `upstream` =
`4gray/iptvnator` with pushes disabled.

Refresh `master` with a fast-forward only — if it ever fails, something was
committed there by mistake:

```bash
git fetch upstream
git checkout master
git merge --ff-only upstream/master
git push origin master
```

Bring upstream into the port with **merge, never rebase**. The port branch is
long-lived; rebasing replays the same conflicts on every sync.

### Do not trigger upstream's release pipeline

Tag port builds `androidtv-v*`, **never** `v*`. Three workflows react to
upstream's release shape:

| Workflow | Fires on |
| --- | --- |
| `docker.yml` | tags `v*`, pushes to `master`, and **PRs touching `apps/web/**`, `libs/**`, `package.json`** |
| `build-and-make.yaml` | tags `v*.*.*` (creates a draft release), pushes to `master`, **PRs targeting `master`** |
| `publish-snap.yaml` | a release being *published* |

Note the second column: opening a PR from the port branch **into `master`**
fires the Docker image build and the desktop make/release job. Keep port PRs
off `master`, or expect those runs.

### The abandoned attempt

`androidtv/main` carries an earlier port (10 commits, based on tag `v0.22.0`):
Capacitor shell, native HTTP transport, D-pad spatial navigation, focus
treatment, per-panel position memory, progressive panel collapse. It was
deliberately **not** carried over — the restart is intentional.

Its documentation stayed there too and is worth reading before re-deriving
anything, since it records device measurements that cost real time — notably
`docs/android-port/epg-storage-load-test.md` (SQLite-in-WebView carrying a
million-row week of guide data with the JS heap flat at 20 MB):

```bash
git show androidtv/main:docs/android-port/epg-storage-load-test.md
```

The TiviMate interaction benchmark was **re-observed on the device for this
branch** and lives here: [`docs/android-port/tv-navigation-reference.md`](./docs/android-port/tv-navigation-reference.md).
Prefer it over the `androidtv/main` copy, which is less accurate.

## TV Interaction Reference

D-pad behaviour, the four surfaces, the measured focus palette and the adoption
order are in
[`docs/android-port/tv-navigation-reference.md`](./docs/android-port/tv-navigation-reference.md).

The one rule to carry into every component: **each panel marks its own selection
with a low-contrast fill relative to that panel's background, and only the
focused panel promotes its selection to the near-white pill.** Three visual
states and per-panel position memory are the same mechanism, not two features.

## Minimize Conflict Surface

This is the rule that decides how expensive every future upstream sync will be.

- **Added files never conflict.** A new Nx app/lib can grow without limit and
  cost nothing at merge time.
- **Modified shared files conflict** every time upstream touches them.

So: prefer a new file plus a one-line hook at an existing injection point over
editing existing code in place. The main injection point is already there —
`DataFactory()` in `apps/web/src/app/app.config.ts:98` selects the environment
implementation at runtime, so an Android data service slots in beside
`ElectronService` and `PwaService` without touching either:

```typescript
export function DataFactory() {
    if (window.electron) {
        return inject(ElectronService);
    }
    return inject(PwaService);
}
```

Concretely: never scatter `if (isAndroid)` through components.

## Base Facts (v0.23.0)

Verified against this tree. **These correct the v0.22.0-era notes on
`androidtv/main`, which are stale here** — check before trusting anything that
branch says about repo structure.

- **A release-note gate exists.** `.changes/` is present and `ci.yml` runs a
  `release-note-gate` job: a PR needs a release note or a `no-release-note`
  label. `ci.yml` has 4 jobs — `actionlint`, `release-note-gate`, `lint`,
  `unit-and-typecheck`. 8 workflows total.
- **A `PlayerController` contract exists** (13 files under
  `libs/ui/playback/src/lib/player-controls/`). This is the single biggest
  difference from the old base, where it had zero occurrences repo-wide.
- `docs/architecture/vod-multi-source.md`,
  `docs/architecture/player-controls-contract.md` and
  `docs/architecture/embedded-inline-playback.md` are all present.
- **Capacitor 8.4.2** (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli`)
  and the `android/` project are in place — see below.

## Building and running the APK

```bash
pnpm nx build web --configuration=pwa   # must run first: Capacitor copies dist/apps/web
npx cap sync android

cd android
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME=$HOME/Android/Sdk
./gradlew assembleDebug
adb -s <box>:5555 install -r app/build/outputs/apk/debug/app-debug.apk
```

Two toolchain traps on this machine:

- **JDK 21 is required.** The default JDK is 25, which AGP 8.13 rejects. Nothing
  in the error message points at the JDK version.
- **`ANDROID_HOME` must be exported.** `android/local.properties` is generated
  per-machine and git-ignored, so a fresh clone has no `sdk.dir`.

`android/.gitignore` (generated) already covers `build/`, `.gradle/`,
`local.properties` and the copied web assets, so only the ~50 source files are
tracked.

### Baseline before any navigation work

Measured on the reference device with the first APK from this branch: pressing
`DPAD_DOWN`, `DPAD_DOWN`, `DPAD_RIGHT` produces **no visible focus change
anywhere** — the app has no focus ring and is entirely unnavigable by remote.
That is the zero point the D-pad work has to move.

## Target Hardware

Reference device: **Xiaomi TV Box S (3rd Gen)**, model `MiTV-AFMU0` — Amlogic
S905X5M, 4× Cortex-A55 @ 2.5 GHz, Mali-G310 V2, **2 GB RAM**, 32 GB storage,
Android TV **14 (API 34)**.

Two consequences that should drive design decisions:

- **All cores are in-order efficiency cores.** JavaScript is single-threaded, so
  extra cores do not help the main thread. Heavy SPA work is the worst-case
  profile for this SoC.
- **2 GB RAM shared with the OS** leaves roughly 700 MB–1 GB. Large playlists
  held in NgRx state *and* in storage risk the low-memory killer, not just
  slowness. The JS heap ceiling measured on the device is 497 MB.

Hardware decode (AV1/VP9/HEVC 4K60) is not a concern as long as playback goes
through MSE. Raw MPEG-TS is: it is demuxed in JavaScript by `mpegts.js`, and
that is the workload most likely to fail on an A55.

## Decisions

**Architecture: Capacitor.** The Angular app is wrapped in a Capacitor Android
app; there is no native rewrite. Environment specifics arrive as a third
`DataService` implementation selected by the existing `DataFactory()`.

Settled by measurement on the reference device, running the production PWA build
served from the dev machine:

| Measurement | Result |
| --- | --- |
| Raw MPEG-TS live playback | OK |
| Memory stability, 20 min continuous | OK on 2 GB shared |
| Scrolling 6 000 live + 6 000 VOD entries | OK |
| Cold start | OK |

No hardware ceiling was found. These figures are pessimistic for Capacitor,
which loads assets from local storage, issues native HTTP, and drops the CORS
proxy entirely.

*Test hygiene:* make sure no other client is using the IPTV subscription during
a measurement, or the provider's concurrent-connection limit is what gets
measured. This produced one false "device too slow" result.

**Playback engine: native ExoPlayer/Media3**, behind a Capacitor plugin, from
the start — not as a fallback. On the reference device the WebView plays 4K
streams with audio only, no video, while the SoC decodes HEVC/AV1 4K60 in
hardware. The limit is the WebView plus JavaScript demuxing, not the silicon.
ExoPlayer talks to the platform decoder directly and handles raw TS natively.

**Cost note — cheaper than on the old base.** `PlayerController` now exists, so
ExoPlayer *plugs into* an abstraction instead of having to create one. The shape
to implement is in
`libs/ui/playback/src/lib/player-controls/player-controls.model.ts`: a
`PlayerStatus` union plus a `PlayerControlsCapabilities` flag set (`seek`,
`volume`, `audioTracks`, `subtitles`, `playbackSpeed`, `aspectRatio`,
`recording`, `pictureInPicture`, `fullscreen`, `seriesNavigation`) — a control
renders only when its flag is true, so an engine may legitimately support a
subset. Two adapters already exist as precedent:

- `web-video-controls.adapter.ts` — the in-WebView engines
- `embedded-mpv-controls.adapter.ts` — an out-of-process native engine, the
  closer analogue, including bounds-sync plumbing that an ExoPlayer
  `SurfaceView` under a transparent WebView needs too

Engine *selection* is still an `@if` chain in
`libs/ui/playback/src/lib/web-player-view/web-player-view.component.html`.
Contract: `docs/architecture/player-controls-contract.md`.

## WebView Origin Contract

Serve the app from **`http://localhost`** (`server.androidScheme: 'http'`), not
https. Verified on device — do not "fix" it.

- `http://localhost` is a *potentially trustworthy* origin, so the page still
  gets a **secure context**: `isSecureContext`, `MediaSource`, EME and
  `crypto.subtle` are all present. Nothing the players need is lost.
- Under `https://localhost`, Chromium's mixed-content **autoupgrade** blocks
  `<img src="http://…">` outright, even with `allowMixedContent: true` — which
  hides every provider logo in an ecosystem that is overwhelmingly plain http.
  `fetch`/XHR were unaffected; only images were.
- `allowMixedContent: true` is still required: without it `fetch`/XHR to
  `http://` origins are refused. It pairs with `usesCleartextTraffic="true"` in
  `AndroidManifest.xml`, which is what unblocks the native HTTP stack under a
  modern `targetSdk`.

Two traps found the hard way:

- Capacitor reads the scheme from **`server.androidScheme`**. Putting it under
  `android` is silently ignored (`CapConfig.java:254`) and you get the `https`
  default with no warning.
- Changing the scheme changes the origin, so `localStorage`/IndexedDB written
  under the old origin become unreachable. Run `adb shell pm clear <appId>` when
  switching, and treat any future scheme change as a data migration.

## Out Of Scope

Not ported, and not worth reading when working on Android: Embedded MPV (native
addon, frame-copy helper, Snap/Flatpak/DEB packaging), external MPV/VLC process
control, `electron-updater`, window controls, and native file dialogs.

## Local Test Setup

**The `web-backend` is no longer needed.** It exists only to work around CORS in
a browser; native HTTP is not subject to CORS, so the shell talks to providers
directly and the box is self-contained. `BACKEND_URL` in
`apps/web/src/assets/app-config.js` is now irrelevant on Android — leave it
alone, and never commit a local edit to that tracked file.

Still useful:

- ADB over network does not survive a box reboot: toggle ADB debugging off/on in
  Developer options.
- Inspect the WebView with
  `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`, then drive
  it over the DevTools websocket. This is the only way to tell a stale bundle,
  a CORS refusal and a dead network apart — all three look identical from the
  UI, and two of them cost a debugging cycle here before the WebView was
  inspected.

## Workspace Landmarks

Verified in the running app, because guessing here cost a debugging cycle:

| Element | x | width (of 960 dp) |
| --- | --- | --- |
| `aside.app-rail` (wraps `nav.rail-links`) | 0 | 60 |
| `header.workspace-header` | 60 | 900 — spans the full content width |
| `aside.context-panel` | 60 | 322 |
| `main.workspace-content` | 382 | 578 |

Two traps in that table. **The rail is an `<aside>` too**, so a bare `aside`
selector collapses the rail along with the category column, and testing
`closest('aside')` before `closest('nav')` puts rail items in the wrong region.
And the header spans everything, so an element's x coordinate says nothing about
which panel it belongs to.

Progressive collapse is driven by `panel-region.ts`, which publishes
`data-tv-region` on the document element; the stylesheet narrows
`aside.context-panel` when the region is `content`. It narrows to a strip rather
than to zero on purpose: a zero-width panel has zero-sized children, candidate
collection drops them, and left would have nothing to move to.

## Portal Transport

Portal traffic bypasses the proxy through `PortalDirectInterceptor`
(`apps/web/src/app/services/android/`), with `CapacitorHttp` enabled in
`capacitor.config.ts` so `fetch`/XHR go through the native stack.

The interceptor keeps the proxy's *contract* while removing the proxy: it
answers `POST /provider-targets` locally from an in-memory registry, and rewrites
`GET /xtream?targetId=…` into a direct `player_api.php` call, re-wrapping the
response in the `{action, payload}` envelope. `PwaService` therefore keeps all
its error normalisation, debug logging and result shaping unchanged.

An interceptor rather than a `DataService` subclass, because `PwaService` marks
`http` private and owns a lot of behaviour worth reusing. Consequence: only
Xtream is routed so far — **Stalker and M3U parsing still point at the proxy**
and need the same treatment.

## Open Questions

- **EPG is Electron-only and unported.** Every `supportsEpg*` capability probes a
  `window.electron` method. The storage route was already settled by measurement
  on `androidtv/main` (SQLite in the WebView) — read that load test before
  re-deciding.
- **Catalogue payload headroom is unmeasured.** The bridge can hold several
  copies of a large `get_vod_streams` body on a ~1 GB budget.
- **Stalker transport** was never implemented in the first attempt (it rejected
  explicitly).
- **4K diagnosis deferred.** Not established whether the WebView failure is
  HEVC-specific or resolution-specific, nor whether `mpegts.js` or the WebView's
  exposed decoders are the blocker. Does not affect the decisions above.
- **Text inputs and the IME.** Focusing a text field opens the Android IME, which
  swallows remote key events. The platform-idiomatic answer is a search
  *destination* rather than an inline field.
