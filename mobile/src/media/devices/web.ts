import { createMicRecorder } from '../../audio/micRecorder';
import type { MicRecorder } from '../../audio/micRecorder';
import type { MediaDevice, MediaKind, MediaSettings } from './types';

// Browser/Electron media settings, backed by the standard MediaDevices API.
// Enumeration is enumerateDevices(); selection is just remembered and applied
// the next time a stream is opened (getUserMedia for the mic, future getUserMedia
// for the camera) — the browser has no "set the active input" call, the deviceId
// rides along with the request.
//
// Labels are hidden until the page has been granted a stream of that kind, so the
// names here may be generic ("Microphone 2") until the first take; onChange +
// re-list pick up the real labels once permission lands.
export function createWebMediaSettings(): MediaSettings {
  // Last enumeration, so current() can resolve an id → device synchronously.
  let cache: MediaDevice[] = [];
  // Per-kind selection; null means "let the browser pick its default".
  const selected: Record<MediaKind, string | null> = {
    audioinput: null,
    videoinput: null,
  };

  const md = (): MediaDevices | undefined =>
    typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;

  const fallbackLabel = (kind: MediaKind, i: number) =>
    `${kind === 'audioinput' ? 'Microphone' : 'Camera'} ${i + 1}`;

  return {
    name: 'web · MediaDevices',

    async list(kind) {
      const all = (await md()?.enumerateDevices()) ?? [];
      cache = all
        .filter((d): d is MediaDeviceInfo => d.kind === kind)
        .map((d, i) => ({
          id: d.deviceId,
          label: d.label || fallbackLabel(kind, i),
          kind,
        }));
      return cache;
    },

    current(kind) {
      const id = selected[kind];
      if (id === null) return null;
      return cache.find((d) => d.kind === kind && d.id === id) ?? null;
    },

    async setCurrent(kind, id) {
      // Nothing to call: the browser applies the deviceId at stream-open time.
      // We just record the choice for createMicRecorder()/constraints to read.
      selected[kind] = id;
    },

    onChange(listener) {
      const target = md();
      target?.addEventListener('devicechange', listener);
      return () => target?.removeEventListener('devicechange', listener);
    },

    createMicRecorder(): MicRecorder {
      return createMicRecorder({ deviceId: selected.audioinput });
    },

    dispose() {
      cache = [];
    },
  };
}
