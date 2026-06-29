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

// Web/Electron camera capture → a webm blob, via getUserMedia + MediaRecorder.
// This is the browser counterpart to the native expo-camera recordAsync path,
// and the video sibling of micRecorder.web. We open our OWN camera stream here:
// the on-screen <CameraView> preview owns a separate stream, and Chromium allows
// concurrent captures of the same camera. The stream is video-only (audio:false)
// — the drums and music are recorded by the other two backends.
export function createVideoRecorder(opts: VideoRecorderOptions = {}): VideoRecorder {
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let mimeType = '';
  let startedAt = 0;

  const release = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    recorder = null;
    chunks = [];
  };

  // Prefer VP9, then VP8, then whatever webm the browser will give us. `exact`
  // on the deviceId makes a missing/unauthorized camera fail loudly rather than
  // silently falling back (per the project's error policy).
  const pickMime = () => {
    for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
      if (MediaRecorder.isTypeSupported(m)) return m;
    }
    return 'video/webm';
  };

  return {
    async start() {
      const video: MediaTrackConstraints | boolean = opts.deviceId
        ? { deviceId: { exact: opts.deviceId } }
        : true;
      stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      mimeType = pickMime();
      const rec = new MediaRecorder(stream, { mimeType });
      chunks = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.start();
      recorder = rec;
      startedAt = performance.now();
    },

    async stop(): Promise<VideoRecording | null> {
      const rec = recorder;
      if (!rec) return null;
      const durationSec = (performance.now() - startedAt) / 1000;
      const blob = await new Promise<Blob>((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
        rec.stop();
      });
      release();
      return { uri: URL.createObjectURL(blob), ext: '.webm', durationSec };
    },

    cancel() {
      try {
        recorder?.stop();
      } catch {
        // already stopped
      }
      release();
    },
  };
}
