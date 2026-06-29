import type {
  MicRecorder,
  MicRecording,
  MicRecorderOptions,
} from './micRecorder.types';

export type {
  MicRecorder,
  MicRecording,
  MicRecorderOptions,
} from './micRecorder.types';

// Web mic capture → an opus/webm blob, via getUserMedia + MediaRecorder. This is
// the browser/Electron counterpart to the native AudioRecorder path.
export function createMicRecorder(opts: MicRecorderOptions = {}): MicRecorder {
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

  return {
    async start() {
      // Pin the chosen input when one was selected; otherwise let the browser
      // pick its default. `exact` makes a missing/unauthorized device fail loudly
      // rather than silently falling back (per the project's error policy).
      const audio: MediaTrackConstraints | boolean = opts.deviceId
        ? { deviceId: { exact: opts.deviceId } }
        : true;
      stream = await navigator.mediaDevices.getUserMedia({ audio });
      mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const rec = new MediaRecorder(stream, { mimeType });
      chunks = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.start();
      recorder = rec;
      startedAt = performance.now();
    },

    async stop(): Promise<MicRecording> {
      const rec = recorder;
      if (!rec) throw new Error('Mic recorder was never started');
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
