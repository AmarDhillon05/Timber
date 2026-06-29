import { AudioManager } from 'react-native-audio-api';
import { createMicRecorder } from '../../audio/micRecorder';
import type { MicRecorder } from '../../audio/micRecorder';
import type { MediaDevice, MediaKind, MediaSettings } from './types';

// Native (iOS/Android) media settings, backed by react-native-audio-api's
// imperative AudioManager — the non-hook counterpart to useAudioInput, so this
// can live in a plain factory instead of a component.
//
//   list('audioinput')   → AudioManager.getDevicesInfo().availableInputs
//   setCurrent(...)       → AudioManager.setInputDevice(id) (routes the session)
//   onChange              → AudioManager 'routeChange' system event
//
// Cameras have no device enumeration on native (expo-camera only exposes
// front/back via its `facing` prop), so list('videoinput') is always empty and
// the UI falls back to a hint. The mic recorder needs no deviceId: it records
// whatever input the audio session is currently routed to, which setCurrent set.
export function createNativeMediaSettings(): MediaSettings {
  // Cache of the last audio enumeration so current() can resolve synchronously.
  let audioCache: MediaDevice[] = [];
  let selectedAudioId: string | null = null;

  const toDevice = (d: { id: string; name: string }): MediaDevice => ({
    id: d.id,
    label: d.name,
    kind: 'audioinput',
  });

  return {
    name: 'native · AudioSession',

    async list(kind) {
      if (kind === 'videoinput') return []; // no native camera device list
      const info = await AudioManager.getDevicesInfo();
      audioCache = info.availableInputs.map(toDevice);
      // Seed the selection from whatever the system currently has routed, so the
      // dropdown shows the live input before the user picks anything.
      if (selectedAudioId === null && info.currentInputs[0]) {
        selectedAudioId = info.currentInputs[0].id;
      }
      return audioCache;
    },

    current(kind) {
      if (kind === 'videoinput') return null;
      if (selectedAudioId === null) return null;
      return audioCache.find((d) => d.id === selectedAudioId) ?? null;
    },

    async setCurrent(kind, id) {
      if (kind === 'videoinput') return; // can't pick a native camera by id
      selectedAudioId = id;
      if (id !== null) await AudioManager.setInputDevice(id);
    },

    onChange(listener) {
      // A route change means inputs were added/removed/re-routed — re-list.
      const sub = AudioManager.addSystemEventListener('routeChange', listener);
      return () => sub?.remove();
    },

    createMicRecorder(): MicRecorder {
      return createMicRecorder(); // follows the routed audio session
    },

    dispose() {
      audioCache = [];
    },
  };
}
