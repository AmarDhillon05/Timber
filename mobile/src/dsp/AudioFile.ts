// Port of functions/audiofile.py. Holds decoded PCM + the deferred effect
// chain, and exposes the raw DSP primitives. Methods append a spec and return
// `this` for chaining, mirroring the Python's mutate-and-return style.

import { Platform } from 'react-native';
import { OfflineAudioContext, decodeAudioData } from 'react-native-audio-api';
import { Blanket } from './Blanket';
import { Channels, EffectSpec, BiquadKind } from './types';
import { renderChain, RenderResult } from './render';

// All decode/render runs at this rate, so PCM held in the session can be
// rebuilt into an AudioFile without separately tracking its sample rate.
export const TARGET_SAMPLE_RATE = 48000;

// Butterworth section Q values per even order (cascaded biquads).
const BUTTER_Q: Record<number, number[]> = {
  2: [0.7071],
  4: [0.5412, 1.3066],
  6: [0.5176, 0.7071, 1.9319],
  8: [0.5098, 0.6013, 0.9000, 2.5629],
};

export class AudioFile {
  data: Channels;
  sampleRate: number;
  chain: EffectSpec[] = [];
  blanket: Blanket;

  constructor(data: Channels, sampleRate: number) {
    this.data = data;
    this.sampleRate = sampleRate;
    this.blanket = new Blanket(this);
  }

  /** Decode an audio/video file (mp4/m4a/mp3/wav) to PCM. */
  static async decode(uri: string, targetSampleRate = TARGET_SAMPLE_RATE): Promise<AudioFile> {
    let buffer;
    if (Platform.OS === 'web') {
      // The browser decoder only takes an ArrayBuffer, so fetch the blob URL's
      // bytes first. (Passing the URL string straight in throws on web.)
      const ctx = new OfflineAudioContext({
        numberOfChannels: 2,
        length: 1,
        sampleRate: targetSampleRate,
      });
      const bytes = await fetch(uri).then((r) => r.arrayBuffer());
      buffer = await ctx.decodeAudioData(bytes);
    } else {
      // Native: decode straight from the file path. This goes to the native
      // file-path decoder, skipping the throwaway OfflineAudioContext.
      buffer = await decodeAudioData(uri, targetSampleRate);
    }

    const channels: Channels = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      // slice() is a memcpy; Float32Array.from() copies element-by-element.
      channels.push(buffer.getChannelData(c).slice());
    }
    return new AudioFile(channels, buffer.sampleRate);
  }

  /** Append a spec to the chain. */
  add(spec: EffectSpec): this {
    this.chain.push(spec);
    return this;
  }

  /** Execute the whole chain offline and return processed channels. */
  render(): Promise<RenderResult> {
    return renderChain(this.data, this.sampleRate, this.chain);
  }

  // --- Filters ---

  private butterworth(kind: BiquadKind, frequency: number, order: number): this {
    const qs = BUTTER_Q[order] ?? BUTTER_Q[4];
    for (const q of qs) this.add({ kind, frequency, q });
    return this;
  }

  high_pass(cutoffHz: number, order = 4): this {
    return this.butterworth('highpass', cutoffHz, order);
  }

  low_pass(cutoffHz: number, order = 4): this {
    return this.butterworth('lowpass', cutoffHz, order);
  }

  band_pass(lowHz: number, highHz: number): this {
    const frequency = Math.sqrt(lowHz * highHz);
    const q = frequency / (highHz - lowHz);
    return this.add({ kind: 'bandpass', frequency, q });
  }

  notch(centerHz: number, q = 30.0): this {
    return this.add({ kind: 'notch', frequency: centerHz, q });
  }

  // --- Parametric / Shelving EQ ---

  peak_eq(centerHz: number, gainDb: number, q: number): this {
    return this.add({ kind: 'peaking', frequency: centerHz, q, gainDb });
  }

  low_shelf(cutoffHz: number, gainDb: number): this {
    return this.add({ kind: 'lowshelf', frequency: cutoffHz, gainDb });
  }

  high_shelf(cutoffHz: number, gainDb: number): this {
    return this.add({ kind: 'highshelf', frequency: cutoffHz, gainDb });
  }

  // --- Gain ---

  gain(db: number): this {
    return this.add({ kind: 'gain', db });
  }
}
