import { Platform } from 'react-native';
import { createWebMediaSettings } from './web';
import { createNativeMediaSettings } from './native';
import type { MediaSettings } from './types';

export type { MediaDevice, MediaKind, MediaSettings } from './types';

// Factory: hand back the media settings handler for whatever host we're on.
//
// The meaningful split is web vs native, because device enumeration/selection
// goes through entirely different APIs (browser MediaDevices vs the native audio
// session). `Platform.OS === 'web'` covers both the browser and the Electron
// renderer, which share the MediaDevices path. If a future desktop OS needs
// special handling (the way ../../audio/systemAudio special-cases Windows), add
// a branch here and a sibling handler file — callers won't change.
export function createMediaSettings(): MediaSettings {
  return Platform.OS === 'web'
    ? createWebMediaSettings()
    : createNativeMediaSettings();
}
