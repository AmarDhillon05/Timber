import type { SystemAudioRecorder, SystemAudioResult } from './types';

// Windows system-audio capture, in the browser, via getDisplayMedia — the same
// privileged, user-consented path Windows screen recorders use (WASAPI loopback
// under the hood). Windows Chromium can share the WHOLE system's audio, not just
// a single tab, which is why it's the easiest desktop target to start with.
//
// In the share picker the user must pick a screen/tab AND tick "Share system
// audio" / "Share tab audio" — otherwise no audio track comes back and we throw
// (per the project's no-swallow-errors policy).
//
// getDisplayMedia only offers the audio checkbox when video is also requested,
// so we ask for video and immediately drop its track — we just want the audio.
export function createWindowsSystemAudio(
  label = 'Windows · getDisplayMedia',
): SystemAudioRecorder {
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
    name: label,

    get armed() {
      return stream !== null;
    },

    async arm() {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      if (display.getAudioTracks().length === 0) {
        display.getTracks().forEach((t) => t.stop());
        throw new Error(
          'No system audio was shared. In the picker choose a screen or tab and tick "Share system/tab audio".',
        );
      }

      // The video track is only the price of surfacing the audio checkbox.
      display.getVideoTracks().forEach((t) => {
        t.stop();
        display.removeTrack(t);
      });
      stream = display;
    },

    start() {
      if (!stream) throw new Error('System audio not armed — call arm() first.');
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

    async stop(): Promise<SystemAudioResult> {
      const rec = recorder;
      if (!rec) throw new Error('System audio capture was never started.');
      const durationSec = (performance.now() - startedAt) / 1000;

      const blob = await new Promise<Blob>((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
        rec.stop();
      });
      release();

      return {
        uri: URL.createObjectURL(blob),
        mimeType,
        ext: '.webm',
        durationSec,
      };
    },

    cancel() {
      try {
        recorder?.stop();
      } catch {
        // already stopped / never started
      }
      release();
    },
  };
}
