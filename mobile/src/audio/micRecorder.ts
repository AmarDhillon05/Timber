import { AudioRecorder, FileDirectory, FileFormat } from 'react-native-audio-api';
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

// Native mic capture → a WAV file in the document directory, via
// react-native-audio-api's AudioRecorder. (The web build uses micRecorder.web.)
// The input device is chosen via the audio session (useAudioInput in the UI),
// so the deviceId option is web-only and ignored here.
export function createMicRecorder(_opts: MicRecorderOptions = {}): MicRecorder {
  let rec: AudioRecorder | null = null;

  return {
    async start() {
      const r = new AudioRecorder();
      r.enableFileOutput({
        format: FileFormat.Wav,
        directory: FileDirectory.Document,
        fileNamePrefix: 'drums',
      });
      const started = r.start();
      if (started.status !== 'success') {
        throw new Error('Mic recorder failed to start');
      }
      rec = r;
    },

    async stop(): Promise<MicRecording> {
      const info = rec?.stop();
      rec = null;
      if (!info || info.status !== 'success') {
        throw new Error('Mic recorder failed to stop');
      }
      return { uri: info.paths[0], ext: '.wav', durationSec: info.duration };
    },

    cancel() {
      try {
        rec?.stop();
      } catch {
        // already stopped
      }
      rec = null;
    },
  };
}
