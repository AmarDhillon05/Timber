// Offline render of an effect chain → processed channels (for export, and as
// the preview source until the live worklet graph lands). Consecutive native
// specs are rendered together on one OfflineAudioContext; custom DSP runs on
// the buffer in between.

import { OfflineAudioContext } from 'react-native-audio-api';
import { Channels, EffectSpec, BiquadSpec, isNativeSpec } from './types';
import { makeImpulseResponse } from './reverbIR';
import * as fx from './effects';

export interface RenderResult {
  channels: Channels;
  sampleRate: number;
}

export async function renderChain(
  source: Channels,
  sampleRate: number,
  chain: EffectSpec[],
): Promise<RenderResult> {
  let channels: Channels = source.map((c) => Float32Array.from(c));

  let i = 0;
  while (i < chain.length) {
    if (isNativeSpec(chain[i])) {
      const run: EffectSpec[] = [];
      while (i < chain.length && isNativeSpec(chain[i])) run.push(chain[i++]);
      channels = await renderNative(channels, sampleRate, run);
    } else if (chain[i].kind === 'resonance') {
      const amount = (chain[i] as { amount: number }).amount;
      i++;
      const q = amount * 30;
      if (q > 0) {
        const notches: BiquadSpec[] = fx
          .detectResonances(channels, sampleRate)
          .map((frequency) => ({ kind: 'notch', frequency, q }));
        if (notches.length) channels = await renderNative(channels, sampleRate, notches);
      }
    } else {
      channels = applyCustom(channels, sampleRate, chain[i]);
      i++;
    }
  }
  return { channels, sampleRate };
}

function applyCustom(channels: Channels, sr: number, spec: EffectSpec): Channels {
  switch (spec.kind) {
    case 'compressor':
      return fx.compress(channels, sr, spec);
    case 'gate':
      return fx.gate(channels, sr, spec);
    case 'upwardCompressor':
      return fx.upwardCompress(channels, sr, spec);
    case 'saturation':
      return fx.saturate(channels, spec.drive);
    case 'presence':
      return fx.presence(channels, sr, spec);
    case 'width':
      return fx.width(channels, spec.amount);
    case 'spectralGate':
      return fx.spectralGate(channels, spec);
    default:
      return channels;
  }
}

async function renderNative(channels: Channels, sr: number, specs: EffectSpec[]): Promise<Channels> {
  const length = channels[0].length;
  const ctx = new OfflineAudioContext({
    numberOfChannels: channels.length,
    length,
    sampleRate: sr,
  });

  const buffer = ctx.createBuffer(channels.length, length, sr);
  for (let c = 0; c < channels.length; c++) buffer.copyToChannel(channels[c], c);

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  let node: any = source;
  for (const spec of specs) {
    node = connectSpec(ctx, node, sr, spec);
  }
  node.connect(ctx.destination);
  source.start(0);

  const rendered = await ctx.startRendering();
  const out: Channels = [];
  for (let c = 0; c < channels.length; c++) {
    out.push(Float32Array.from(rendered.getChannelData(c)));
  }
  return out;
}

function connectSpec(ctx: any, node: any, sr: number, spec: EffectSpec): any {
  if (spec.kind === 'gain') {
    const g = ctx.createGain();
    g.gain.value = Math.pow(10, spec.db / 20);
    node.connect(g);
    return g;
  }
  if (spec.kind === 'reverb') {
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulseResponse(ctx, sr, spec.roomSize, spec.damping);
    const wet = ctx.createGain();
    wet.gain.value = spec.wetLevel;
    const dry = ctx.createGain();
    dry.gain.value = spec.dryLevel;
    const merge = ctx.createGain();
    node.connect(conv);
    conv.connect(wet);
    wet.connect(merge);
    node.connect(dry);
    dry.connect(merge);
    return merge;
  }
  // biquad family
  const bq = ctx.createBiquadFilter();
  bq.type = spec.kind;
  bq.frequency.value = (spec as BiquadSpec).frequency;
  if ((spec as BiquadSpec).q != null) bq.Q.value = (spec as BiquadSpec).q;
  if ((spec as BiquadSpec).gainDb != null) bq.gain.value = (spec as BiquadSpec).gainDb;
  node.connect(bq);
  return bq;
}
