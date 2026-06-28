import type { MicRecorder, MicRecording } from './micRecorder.types';

export type { MicRecorder, MicRecording } from './micRecorder.types';

// Web mic capture → an opus/webm blob, via getUserMedia + MediaRecorder. This is
// the browser/Electron counterpart to the native AudioRecorder path.
export function createMicRecorder(): MicRecorder {
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
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = stream.getAudioTracks()[0];
      console.log(
        '[peripheral] mic (web):',
        track?.label || '(unnamed)',
        track?.getSettings?.(),
      );
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
