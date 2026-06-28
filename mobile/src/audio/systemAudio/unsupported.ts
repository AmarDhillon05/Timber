import type { SystemAudioRecorder } from './types';

// Fallback for hosts where system-audio capture isn't wired up yet (native
// iOS/Android, macOS, Linux). It carries the reason so the UI can explain
// itself, and — per the project's error policy — throws loudly if anyone tries
// to record, rather than silently producing an empty track.
export function createUnsupportedSystemAudio(reason: string): SystemAudioRecorder {
  const fail = () => {
    throw new Error(`System-audio capture isn't available here: ${reason}`);
  };
  return {
    name: `unsupported (${reason})`,
    armed: false,
    async arm() {
      fail();
    },
    start() {
      fail();
    },
    async stop() {
      return fail();
    },
    cancel() {
      // nothing to release
    },
  };
}
