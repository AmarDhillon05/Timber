import type { Channels } from '../dsp';

// Encode de-interleaved PCM to a mono 16-bit WAV. The inference API only reads
// libsndfile formats (not mp4/mov) and extracts mono anyway, so we downmix and
// pack 16-bit here. Returns the full WAV file as an ArrayBuffer.
export function encodeWavMono16(channels: Channels, sampleRate: number): ArrayBuffer {
  const length = channels[0].length;
  const numChannels = channels.length;
  const dataSize = length * 2; // 16-bit mono
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    let sample = 0;
    for (let c = 0; c < numChannels; c++) sample += channels[c][i];
    sample = Math.max(-1, Math.min(1, sample / numChannels));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}
