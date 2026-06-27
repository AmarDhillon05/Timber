# Timber — Recording, Multi-Track Model & Platform Handlers

This document explains how the mobile app's **recording pipeline**, the
**multi-track document model**, and the **OS-specific system-audio handlers**
fit together, and how the same codebase runs as web, an Electron desktop app, or
a native iOS app.

> Scope: the `mobile/` app. Other top-level dirs (`inference/`, `hub/`,
> `functions/`) are the audio/ML backend and are out of scope here.

---

## 1. The document model (the "multi-track class system")

Everything the editor works on is a single document type, defined in
`src/data/TrackFile.ts`:

```
TrackFile                     // one editing session
├── id, name
├── video: { uri, name } | null   // optional aligned video, played muted
└── tracks: Track[]               // one or more aligned audio tracks
        └── Track
            ├── id, name, uri          // uri = source of truth for decode/export
            ├── pcm: Channels | null   // decoded audio, filled in lazily
            ├── sampleRate
            ├── editable               // editable → exposes Blanket controls
            ├── mode: 'user'|'generated'
            ├── user / generated: BlanketValues   // per-track edit state
            └── usage: TrackUsage      // tally of engaged knobs/effects
```

Key properties:

- **Per-track edit state.** Each `Track` carries its own Blanket values (`user`
  and `generated` copies) and a `usage` tally. There is **no global blanket
  store** — the editor acts on the *active* track.
- **`editable` flag.** Editable tracks expose Blanket controls; non-editable
  ones mix in raw (used for backing material you don't want to process).
- **Big-buffer discipline.** `track.pcm` is a large (~tens of MB) buffer held by
  reference. It must **never** be selected reactively in a component — read it
  via `getState()` in the DSP/preview layer only.

### Session state

`src/state/session.ts` (zustand) holds the current `TrackFile` plus the
`activeTrackId`. `load(file)` opens a document (and focuses the first editable
track); `setTrackPcm(id, pcm)` lands a track's decoded audio. `App.js` routes on
`file !== null`: a loaded file means "show the editor."

---

## 2. Two ingestion flows, one document

Both entry points converge on the **same** `TrackFile`, so the editor never has
to care where a document came from:

| Flow | File | Produces |
|------|------|----------|
| **Upload** | `src/media/importVideo.ts` | Picks one or more video/audio sources; first source provides the video; every source becomes a track. |
| **Record** | `src/screens/RecordScreen.tsx` | Captures a live take (video + drums + system audio) and assembles a `TrackFile`. |

The recording flow now mirrors upload exactly:

1. `makeTrack(...)` per captured source,
2. `makeTrackFile({ tracks, video })`,
3. `useSession.getState().load(file)`,
4. `decodeTrackInBackground(id, uri)` per track (PCM fills in off the critical
   path, identical to `importVideo`'s background decode).

This is the integration that makes the OS-specific handlers "run correctly with
the multi-track class system": their captured output becomes an ordinary
`Track`, indistinguishable downstream from an uploaded one.

---

## 3. The recording pipeline

`RecordScreen` captures a take with up to **three aligned tracks**:

| Track | Source | API |
|-------|--------|-----|
| **video** | camera (recorded **muted** — never owns the mic) | `expo-camera` `recordAsync()` |
| **drums** | a selectable hardware input → its own WAV | `react-native-audio-api` `AudioRecorder` |
| **music** | the host's **system / tab audio**, captured live | the system-audio factory (§4) |

Lifecycle:

- **`shareSystemAudio()`** → `handler.arm()` — the slow, interactive permission
  step, done *before* recording so the take start stays tight.
- **`startTake()`** — sets the audio session, starts the mic recorder + camera,
  then `handler.start()` right next to the drums so music and drums share a
  timeline (`musicOffsetSec ≈ 0`).
- **`stopTake()`** — stops camera/mic/system-audio, gathers the files into a
  timestamped take folder, writes `take.json`.
- **`openInEditor()`** — assembles the `TrackFile` (drums = editable, music =
  raw backing, plus the video) and loads it, swapping to the editor.

Errors are intentionally **not** caught — they propagate to Expo's redbox in dev
(project policy).

---

## 4. System-audio handlers (the domain-specific handlers)

Capturing "whatever is currently playing" is a **privileged, user-consented**
capability that differs sharply per OS. It is abstracted behind a small factory
so the recording screen is platform-agnostic.

```
src/audio/systemAudio/
├── types.ts          # SystemAudioRecorder interface + SystemAudioResult
├── index.ts          # createSystemAudioRecorder() + detectHostOS()
├── windows.ts        # Windows (browser/Electron) via getDisplayMedia  ✅ implemented
└── unsupported.ts    # fallback that names why it can't capture & throws if used
```

### The interface (`SystemAudioRecorder`)

Deliberately **two-phase**, so capture aligns with the drums:

```ts
arm():   Promise<void>           // interactive: OS share prompt → acquire stream
start(): void                    // cheap: begin recording, fired next to drums
stop():  Promise<SystemAudioResult>   // → { uri, mimeType, ext, durationSec }
cancel(): void                   // release everything, no result
armed:   boolean
```

### The factory & OS detection

`createSystemAudioRecorder()` calls `detectHostOS()` and forwards a handler.
On web, `Platform.OS` is only ever `'web'`, so detection sniffs `navigator` for
the real desktop OS (Windows/macOS/Linux). Today: **Windows → real handler**,
everything else → `unsupported`.

### The Windows handler

Uses `getDisplayMedia({ video, audio })` — the browser's screen-share path,
which on Windows can capture the **whole system's** output (WASAPI loopback
underneath). It requests video only because the audio checkbox isn't offered
otherwise, then drops the video track and keeps the audio. `MediaRecorder`
records the stream to an opus/webm blob, returned as an object URL.

Under **Electron** (§5) the main process auto-answers the capture request with
`audio: 'loopback'`, so this same handler gets system audio with **no picker
dialog**.

### Why a factory and not just `getDisplayMedia` everywhere

Because the capability isn't uniform:

- **Windows browser/Electron** — full system audio. ✅
- **macOS browser** — `getDisplayMedia` typically yields **tab** audio only;
  full-system needs native ScreenCaptureKit. (Future `macos.ts`.)
- **iOS / Android native** — the OS forbids third-party system-audio capture
  outright → `unsupported`. (iOS would instead use a different music source,
  e.g. an in-app backing track.)

---

## 5. Run modes & the Electron shell

One codebase, three run modes. Electron is a thin shell over the **same web
build**; iOS is the native Expo target.

| Mode | Command | Entry |
|------|---------|-------|
| Windows (web) | `npm run win:web` | browser at `localhost:8081` |
| Windows (electron) | `npm run win:electron` | `expo export` → `electron/main.js` |
| Apple (iOS) | `npm run apple` | native Expo build |

Convenience launchers live in `mobile/`: `run-win-web.ps1`,
`run-win-electron.ps1`, `run-apple.command`.

The Electron shell (`mobile/electron/`):

- **`main.js`** — creates the window, loads the Expo web dev server
  (`ELECTRON_START_URL`) or the static `dist/` export, and installs a
  `setDisplayMediaRequestHandler` that returns the primary screen + `'loopback'`
  audio — system audio with no prompt.
- **`preload.js`** — exposes a minimal `window.desktop` flag so app code *can*
  tell it's inside the desktop shell.

> **WSL note:** Electron must run on the **Windows host** (PowerShell), not
> inside WSL, to capture Windows audio and show a real window. The web export
> can be built in WSL; only the Electron shell runs on Windows.

---

## 6. Platform capability matrix

| Capability | Web (Win) | Electron (Win) | iOS (native) |
|---|---|---|---|
| Camera video | restore `CameraView` | restore `CameraView` | ✅ `expo-camera` |
| Mic / drums | ✅ `getUserMedia` | ✅ `getUserMedia` | ✅ `react-native-audio-api` |
| System audio | ✅ `getDisplayMedia` (picker) | ✅ loopback, no picker | ❌ blocked by OS |
| Take persistence | needs web file path | needs web file path | ✅ `expo-file-system` |
| Multi-track editor | ✅ | ✅ | ✅ |

---

## 7. Known gaps / TODO

These are deliberately staged; the architecture above is in place, the
platform-specific plumbing is not yet complete:

1. **Camera is a placeholder.** `RecordScreen`'s preview is a solid panel; the
   real `CameraView` (with the `position: relative` web-containment fix) needs
   restoring before video actually records.
2. ~~**Web mic capture.**~~ **Done** — `src/audio/micRecorder.ts` (native
   `AudioRecorder`) + `micRecorder.web.ts` (`getUserMedia` + `MediaRecorder`)
   behind a Metro platform split; `RecordScreen` is now platform-aware (skips
   the native audio-session + file-move steps on web).
3. **Web persistence.** The system-audio capture is an in-memory blob/object
   URL; writing it (and the drums/video) into the take folder needs a web-aware
   file path — `expo-file-system`'s `Directory`/`File.move` is native-only.
4. **macOS / native system-audio handlers.** Only Windows is implemented; add
   `macos.ts` (ScreenCaptureKit or tab-audio) and decide the iOS music source.
5. **Electron packaging.** `electron-builder` config (icons, installer, signing)
   for a distributable `.exe` is not set up yet.
