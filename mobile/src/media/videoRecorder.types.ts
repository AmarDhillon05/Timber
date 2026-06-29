// Contract for recording the take's camera video to its own file, implemented
// per platform (videoRecorder.ts = native via expo-camera's recordAsync;
// videoRecorder.web.ts = web/electron via getUserMedia + MediaRecorder). Metro
// resolves the right one by extension, exactly like micRecorder.
//
// The video is captured WITHOUT audio — the camera never owns the mic (drums)
// or the system audio (music); those are separate tracks. So both backends
// record a muted, video-only stream.

import type { CameraView } from 'expo-camera';

export interface VideoRecording {
  /** Object URL (web) or file URI (native) of the captured video. */
  uri: string;
  /** File extension including the dot, e.g. ".webm" or ".mov". */
  ext: string;
  /** Recorded duration in seconds. */
  durationSec: number;
}

export interface VideoRecorder {
  /** Acquire the camera and begin recording. */
  start(): Promise<void>;
  /** Stop recording and resolve with the captured video, or null if none. */
  stop(): Promise<VideoRecording | null>;
  /** Abort without producing a result, releasing the camera. */
  cancel(): void;
}

export interface VideoRecorderOptions {
  /**
   * Native only: the CameraView whose recordAsync() captures the take. The web
   * backend ignores this and opens its own getUserMedia stream instead.
   */
  cameraRef?: { current: CameraView | null };
  /**
   * Web only: the getUserMedia deviceId of the camera to capture. When omitted,
   * the browser's default camera is used. Native picks the camera through the
   * CameraView, so it ignores this.
   */
  deviceId?: string | null;
}
