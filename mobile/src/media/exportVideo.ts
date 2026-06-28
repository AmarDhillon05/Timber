import type { BlanketTerm } from '../dsp/blanketTerms';
import type { Channels } from '../dsp';

export interface ExportParams {
  videoUri: string;
  videoName: string;
  pcm: Channels;
  values: Record<BlanketTerm, number>;
  onProgress?: (fraction: number) => void;
}

// Native fallback. Muxing the original video track with the freshly rendered
// audio into an mp4 needs a native media muxer (e.g. Android MediaMuxer / iOS
// AVAssetExportSession or ffmpeg) that isn't installed. The working
// implementation lives in exportVideo.web.ts and is used on web.
export async function exportVideo(_params: ExportParams): Promise<void> {
  throw new Error(
    'Video export is currently web-only — native needs a muxer module (MediaMuxer/ffmpeg).',
  );
}
