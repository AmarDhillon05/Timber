// Contract for recording the drum mic to its own file, implemented per platform
// (micRecorder.ts = native via react-native-audio-api; micRecorder.web.ts = web
// via getUserMedia + MediaRecorder). Metro resolves the right one by extension.

export interface MicRecording {
  /** Object URL (web) or file URI (native) of the captured audio. */
  uri: string;
  /** File extension including the dot, e.g. ".wav" or ".webm". */
  ext: string;
  /** Recorded duration in seconds. */
  durationSec: number;
}

export interface MicRecorder {
  /** Acquire the mic and begin recording. */
  start(): Promise<void>;
  /** Stop recording and resolve with the captured audio. */
  stop(): Promise<MicRecording>;
  /** Abort without producing a result. */
  cancel(): void;
}
