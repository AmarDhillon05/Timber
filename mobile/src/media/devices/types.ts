// A platform-agnostic contract for the capture peripherals a take can use: the
// microphones and cameras the host exposes, which one is currently selected, and
// the media handlers built from that selection. Concrete handlers live alongside
// this file; the factory in ./index picks one per host OS (the same shape as the
// sibling ../../audio/systemAudio module).
//
// Three responsibilities, mirroring how the OS thinks about peripherals:
//   list()       — EXPOSE: enumerate the devices of a kind the host offers.
//   setCurrent() — SET: choose the active device for a kind (null = default).
//   create*()    — HANDLERS: hand back recorders/constraints bound to the pick.
//
// Why this exists: enumeration and selection are wildly OS-specific (the browser
// uses MediaDevices + getUserMedia; native iOS/Android uses the audio session
// via react-native-audio-api, and has no camera device list at all). Callers —
// the Record screen's dropdowns — shouldn't branch on any of that; they talk to
// this one interface.

import type { MicRecorder } from '../../audio/micRecorder';

/** The peripheral kinds we let the user choose between. */
export type MediaKind = 'audioinput' | 'videoinput';

/** One selectable peripheral, normalized across platforms. */
export interface MediaDevice {
  /** Stable handle: a getUserMedia `deviceId` (web) or audio-session id (native). */
  id: string;
  /** Human-readable name for the dropdown. May be a fallback until permission
   *  unlocks the real label (web hides labels until a stream is granted). */
  label: string;
  kind: MediaKind;
}

export interface MediaSettings {
  /** Short label for logs/UI, e.g. "web · MediaDevices" or "ios · AudioSession". */
  readonly name: string;

  /**
   * EXPOSE the devices of a kind the host currently offers. Best-effort: labels
   * may be hidden until the relevant permission is granted, and a host may have
   * no devices of a kind (e.g. native has no camera list — returns []).
   */
  list(kind: MediaKind): Promise<MediaDevice[]>;

  /**
   * The device currently selected for a kind, or null for "system default".
   * Sync and cheap: reads the last selection / cached enumeration so the UI can
   * render it directly. Call list() first to populate the cache.
   */
  current(kind: MediaKind): MediaDevice | null;

  /**
   * SET the active device for a kind. Pass an id from list(), or null to fall
   * back to the system default. Resolves once the selection is in effect (native
   * re-routes the audio session here; web defers to the next getUserMedia).
   */
  setCurrent(kind: MediaKind, id: string | null): Promise<void>;

  /**
   * Subscribe to device hot-plug / route changes so the UI can re-list. Returns
   * an unsubscribe function.
   */
  onChange(listener: () => void): () => void;

  /**
   * HANDLER: a mic recorder bound to the current audioinput selection. On web
   * the deviceId is pinned into getUserMedia; on native the recorder follows the
   * audio session that setCurrent() already routed.
   */
  createMicRecorder(): MicRecorder;

  /** Release any listeners/streams this settings object is holding. */
  dispose(): void;
}
