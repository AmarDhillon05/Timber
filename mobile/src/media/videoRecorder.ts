import type {
  VideoRecorder,
  VideoRecording,
  VideoRecorderOptions,
} from './videoRecorder.types';

export type {
  VideoRecorder,
  VideoRecording,
  VideoRecorderOptions,
} from './videoRecorder.types';

// Native camera capture, via expo-camera's CameraView.recordAsync(). (The web
// build uses videoRecorder.web, which opens its own getUserMedia stream.) The
// CameraView is mounted muted by the UI, so the captured video carries no audio.
const extOf = (uri: string) => {
  const m = uri.split('?')[0].match(/\.[a-zA-Z0-9]+$/);
  return m ? m[0] : '.mov';
};

export function createVideoRecorder(opts: VideoRecorderOptions = {}): VideoRecorder {
  const cameraRef = opts.cameraRef;
  // recordAsync resolves only once stopRecording() is later called, so we hold
  // its promise from start() and await it in stop().
  let pending: Promise<{ uri: string } | undefined> | null = null;
  let startedAt = 0;

  return {
    async start() {
      const cam = cameraRef?.current;
      if (!cam) throw new Error('Camera not ready to record');
      pending = cam.recordAsync() ?? null;
      startedAt = Date.now();
    },

    async stop(): Promise<VideoRecording | null> {
      cameraRef?.current?.stopRecording();
      const result = (await pending) ?? null;
      pending = null;
      if (!result) return null;
      return {
        uri: result.uri,
        ext: extOf(result.uri),
        durationSec: (Date.now() - startedAt) / 1000,
      };
    },

    cancel() {
      try {
        cameraRef?.current?.stopRecording();
      } catch {
        // not recording
      }
      pending = null;
    },
  };
}
