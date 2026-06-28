# Timber — Video Import & Edit Pipeline

## In words

The app has exactly two states, and which one you see is derived entirely from
the session store: **if a video is loaded, you're editing; if not, you're
uploading.** There's no router — the presence of a video *is* the route.

When you open the app with no video, you land on the **Upload screen**. Tapping
"Choose video" runs a three-stage import:

1. **Pick** — the OS file picker opens (`video/*`). If you cancel, nothing
   happens and you return to idle.
2. **Persist (copy/move)** — the picked file is moved out of evictable storage
   into a stable location so the edit session has a URI that won't disappear. On
   native this is an instant rename; on web it's a no-op (the picker's blob URL
   is used directly).

As soon as the video is persisted, the import writes the URI into the session
store and returns. That write flips the app's derived route, and the **Edit
screen** mounts immediately — the video is **playable right away** (via
`expo-video`). The "redirect" no longer waits on audio.

3. **Decode (background)** — the audio track is decoded to raw PCM (resampled to
   48 kHz stereo) on a background task that the import does *not* await. While it
   runs, the session's `decoding` flag is `true` and the edit screen keeps audio
   **editing locked** ("Preparing audio…"). When `setPcm` lands, `decoding` flips
   to `false` and editing unlocks.

The Upload screen only ever shows the brief "Opening picker…" → "Saving video…"
labels — it unmounts before decode starts. Errors are intentionally **not**
caught: a copy failure rejects the import; a background-decode failure surfaces
as an unhandled rejection. Either way you get Expo's debug overlay with a full
stack.

---

## Software-wise

### Module map

| File | Role |
|------|------|
| `App.js` | Derives the route from `session.videoUri` |
| `src/state/session.ts` | Zustand store — single source of truth |
| `src/screens/UploadScreen.tsx` | Picker UI + per-stage progress state |
| `src/media/importVideo.ts` | Orchestrates pick → persist → commit; fires background decode |
| `src/dsp/AudioFile.ts` | `decode()` — file → PCM (native file path / web fetch) |
| `src/screens/EditScreen.tsx` | `expo-video` player + decode-gated editing; `clear()` to exit |

### State shape (`session.ts`)

```ts
interface SessionState {
  videoUri: string | null;   // reactive — drives routing
  videoName: string | null;  // reactive — display
  decoding: boolean;         // reactive — true between setVideo and setPcm
  pcm: Channels | null;      // NON-reactive — large (~MBs/GBs), read via getState()
  setVideo(uri, name): void; // sets video, pcm=null, decoding=true
  setPcm(pcm): void;         // sets pcm, decoding=false
  clear(): void;
}
// Channels = Float32Array[]  (de-interleaved, one array per channel)
```

The split is deliberate: components subscribe to `videoUri`/`videoName`/
`decoding`; nobody `select`s `pcm` (selecting a multi-hundred-MB buffer would
re-render on it). `decoding` is the cheap reactive signal that gates editing
while `pcm` fills in.

### Control flow

```
App.js
  const videoUri = useSession(s => s.videoUri)
  return videoUri ? <EditScreen/> : <UploadScreen/>
        │
        ▼  (no video)
UploadScreen.onPick()
  setProgress('opening')
  importVideo(setProgress)         ──────────────┐
  if canceled → setProgress(null)                │
                                                 ▼
importVideo(onStage)
  ┌─ DocumentPicker.getDocumentAsync({ type:'video/*', copyToCacheDirectory:true, base64:false })
  │     └─ canceled? → return {status:'canceled'}
  │
  ├─ onStage('copying')
  │     persist(asset.uri, asset.name)
  │        web  → return asset.uri                      (no FS)
  │        native → new File(src).move(File(Paths.document, name)) → dest.uri
  │
  ├─ setVideo(videoUri, name)   ← re-renders App → EditScreen mounts (video playable, decoding=true)
  ├─ void decodeInBackground(videoUri, size)   ← NOT awaited
  └─ return {status:'imported'}                ← import resolves now; UploadScreen unmounts

decodeInBackground(uri, size)                  ← runs independently
  ├─ AudioFile.decode(uri)
  │     native → decodeAudioData(uri, 48000)            (native file-path decoder)
  │     web    → fetch(uri)→arrayBuffer→ctx.decodeAudioData(bytes)
  │     channels = [getChannelData(c).slice() per channel]
  ├─ console.log(`decode ${ms}ms (${size} bytes)`)
  └─ setPcm(audio.data)         ← decoding=false → EditScreen unlocks editing
```

### Sequence (who calls whom)

```
User      UploadScreen     importVideo      DocumentPicker   persist/FS      AudioFile        session store      App
 │  tap        │                │                 │              │              │                 │              │
 ├────────────▶│ onPick         │                 │              │              │                 │              │
 │             ├ setProgress('opening')           │              │              │                 │              │
 │             ├───────────────▶│ getDocumentAsync│              │              │                 │              │
 │             │                ├────────────────▶│ (picker UI)  │              │                 │              │
 │             │                │◀────────────────┤ asset        │              │                 │              │
 │             │  onStage('copying')              │              │              │                 │              │
 │             │                ├─────────────────┼─────────────▶│ move→dest.uri│                 │              │
 │             │                ├─────────────────┼──────────────┼──────────────┼ setVideo ───────▶│              │
 │             │                │                 │              │              │                 ├─ re-render ─▶│ EditScreen (video plays, decoding=true)
 │             │◀ imported ─────┤ (UploadScreen unmounts)        │              │                 │              │
 │             │                ╎ void decodeInBackground(uri)   │              │                 │              │
 │             │                ╎────────────────┼──────────────┼─────────────▶│ decode          │              │  ← runs after import resolved
 │             │                ╎                 │              │              │◀── PCM ──────────│              │
 │             │                ╎────────────────┼──────────────┼──────────────┼ setPcm ─────────▶│              │
 │             │                ╎                 │              │              │                 ├─ update ───▶│ EditScreen (decoding=false → editable)
```

### Platform branches

| Concern | Native (iOS/Android) | Web |
|---|---|---|
| Picker output | `copyToCacheDirectory:true` → `file://` in cache | `base64:false` → blob URL |
| Persist | `File.move` cache → `Paths.document` (instant rename) | pass-through (`Paths`/`File` unimplemented on web) |
| Decode input | file URI → native file-path decoder | blob URL → `fetch` → ArrayBuffer |

### Cost model

- **opening** — user-bound (picker UI) + the picker's internal copy (native, not
  measured by our log).
- **copying** — `move` = instant rename within sandbox (~ms). This is all the
  user *waits* on before the editor opens.
- **decode (background)** — dominant in wall-clock, but **off the critical
  path**: it runs after the editor is up, so it costs *unlock latency*, not
  *time-to-editor*. Scales with **audio duration**, one un-chunkable decode call,
  no progress callback. Produces `1 hr stereo @ 48 kHz f32 ≈ 1.4 GB` PCM —
  **memory is the real ceiling**, and background decode doesn't change that
  (same buffer either way).
- The `[importVideo] decode Yms (size)` log measures the background decode +
  channel copy; the picker copy sits *outside* it.

### Error model

No try/catch anywhere in the path. A copy failure rejects the awaited
`importVideo`; a **background-decode** failure becomes an unhandled rejection
(the editor would stay "Preparing audio…"). Both surface on Expo's redbox with a
full stack (dev-time choice).

---

## Not yet wired (discussed, not built)

- **Chunk-wise decode** — not feasible with `decodeAudioData` (single opaque
  call needing a complete stream). Would require a packet-level decoder
  (`MediaCodec`/`AVAssetReader`, or `WebCodecs AudioDecoder` + mp4 demux on web).
- **Skip resampling** — decode at the file's native rate (`sampleRate = 0`) to
  drop the resample step; requires storing `sampleRate` in the session instead
  of assuming 48 kHz.
- **Waveform/thumbnail generation** for the editor timeline — downstream work
  that can overlap or follow decode.
