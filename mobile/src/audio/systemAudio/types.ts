// A platform-agnostic contract for capturing "whatever is currently playing"
// (system / tab audio) as the take's music track. Concrete handlers live
// alongside this file; the factory in ./index picks one based on the host OS.
//
// The lifecycle is deliberately two-phase so capture lines up with the drums:
//   arm()   — interactive, BEFORE recording: prompt the user for permission and
//             acquire the audio stream (this is the slow, user-facing step).
//   start() — non-interactive, fired at the exact moment the drum recorder
//             starts, so music and drums share a timeline.
//   stop()  — end capture and hand back the recorded file.
//   cancel()— release everything without producing a result (e.g. on unmount).

export interface SystemAudioResult {
  /** Object URL (web) or file URI pointing at the captured audio. */
  uri: string;
  /** Container/codec of the capture, e.g. "audio/webm;codecs=opus". */
  mimeType: string;
  /** File extension matching `mimeType`, including the dot (e.g. ".webm"). */
  ext: string;
  /** Wall-clock capture duration in seconds. */
  durationSec: number;
}

export interface SystemAudioRecorder {
  /** Short label for logs/UI, e.g. "Windows · getDisplayMedia". */
  readonly name: string;
  /** True once `arm()` has acquired a stream and we're ready to record. */
  readonly armed: boolean;
  /**
   * Prompt for permission and acquire the system-audio stream. Interactive and
   * slow (the OS/browser share dialog), so call it as a setup step, not while
   * recording.
   */
  arm(): Promise<void>;
  /** Begin recording from the armed stream. Cheap; call it next to the drums. */
  start(): void;
  /** Stop recording and resolve with the captured audio. */
  stop(): Promise<SystemAudioResult>;
  /** Tear everything down without producing a result. */
  cancel(): void;
}
