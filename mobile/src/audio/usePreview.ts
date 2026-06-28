import { useEffect, useRef } from 'react';
import { AudioContext } from 'react-native-audio-api';
import type { VideoPlayer } from 'expo-video';
import { useSession, activeValues, activeTrack, activeDecoding } from '../state/session';
import { renderBlanket } from '../dsp/renderBlanket';
import { TARGET_SAMPLE_RATE } from '../dsp/AudioFile';
import type { Channels } from '../dsp';

type Buffer = ReturnType<AudioContext['createBuffer']>;
type Source = ReturnType<AudioContext['createBufferSource']>;

const RESYNC_THRESHOLD = 0.25; // seconds of drift before a hard resync
const RENDER_DEBOUNCE = 200; // ms of quiet after the last slider move

// Drives the processed-audio preview: the video is muted and this graph plays
// the rendered PCM instead, kept in sync with the video's clock. Moving sliders
// re-renders the Blanket chain (debounced) and swaps the playing buffer.
export function usePreview(player: VideoPlayer) {
  const ctxRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<Buffer | null>(null);
  const sourceRef = useRef<Source | null>(null);
  // Bookkeeping to derive the audio's current playback position.
  const startCtxTimeRef = useRef(0);
  const startOffsetRef = useRef(0);

  const decoding = useSession(activeDecoding);
  const values = useSession(activeValues);

  const stopSource = () => {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        // already stopped/ended
      }
      sourceRef.current = null;
    }
  };

  // A buffer source is one-shot, so each (re)start builds a fresh node and
  // begins playback at the given offset into the looping buffer.
  const startSource = (offsetSec: number) => {
    const ctx = ctxRef.current;
    const buffer = bufferRef.current;
    if (!ctx || !buffer) return;
    stopSource();
    const offset = ((offsetSec % buffer.duration) + buffer.duration) % buffer.duration;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(ctx.destination);
    src.start(0, offset);
    sourceRef.current = src;
    startCtxTimeRef.current = ctx.currentTime;
    startOffsetRef.current = offset;
    console.log('[preview] startSource', { offset, ctxState: ctx.state });
  };

  const audioPosition = (): number => {
    const ctx = ctxRef.current;
    const buffer = bufferRef.current;
    if (!ctx || !buffer || !sourceRef.current) return 0;
    const elapsed = ctx.currentTime - startCtxTimeRef.current;
    return (startOffsetRef.current + elapsed) % buffer.duration;
  };

  // Context + video-sync wiring, once per player.
  useEffect(() => {
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    player.muted = true; // our graph is the audio now
    player.timeUpdateEventInterval = 0.25; // enable drift checks
    console.log('[preview] ctx created', { ctxState: ctx.state });

    const onPlaying = player.addListener('playingChange', ({ isPlaying }) => {
      console.log('[preview] playingChange', { isPlaying, ctxState: ctx.state });
      if (isPlaying) {
        ctx.resume();
        startSource(player.currentTime);
      } else {
        stopSource();
      }
    });

    const onTime = player.addListener('timeUpdate', ({ currentTime }) => {
      const buffer = bufferRef.current;
      if (!sourceRef.current || !buffer) return;
      let drift = Math.abs(currentTime - audioPosition());
      drift = Math.min(drift, buffer.duration - drift); // tolerate loop wrap
      if (drift > RESYNC_THRESHOLD) startSource(currentTime);
    });

    return () => {
      onPlaying.remove();
      onTime.remove();
      stopSource();
      ctx.close();
      ctxRef.current = null;
      bufferRef.current = null;
    };
  }, [player]);

  // (Re)render processed audio when the sliders settle, then swap the buffer.
  useEffect(() => {
    if (decoding) return;
    const track = activeTrack(useSession.getState());
    const pcm = track?.pcm;
    console.log('[preview] render effect', { decoding, hasPcm: !!pcm });
    if (!pcm || !track) return;

    const active = Object.fromEntries(
      Object.entries(values).filter(([, amount]) => amount > 0),
    );

    let cancelled = false;
    const timer = setTimeout(async () => {
      const channels = await renderBlanket(pcm, track.sampleRate, values);
      const ctx = ctxRef.current;
      if (cancelled || !ctx) return;
      bufferRef.current = channelsToBuffer(ctx, channels);

      // The audio buffer just changed to reflect the current slider values.
      const live = !!sourceRef.current || player.playing;
      console.log('[preview] audio modified', {
        active,
        terms: Object.keys(active).length,
        duration: bufferRef.current.duration,
        appliedLive: live, // false = buffered, will be heard on next play
      });

      // Reflect the new audio right away if we are (or should be) playing.
      if (sourceRef.current) startSource(audioPosition());
      else if (player.playing) startSource(player.currentTime);
    }, RENDER_DEBOUNCE);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [values, decoding, player]);
}

function channelsToBuffer(ctx: AudioContext, channels: Channels): Buffer {
  const buffer = ctx.createBuffer(channels.length, channels[0].length, TARGET_SAMPLE_RATE);
  for (let c = 0; c < channels.length; c++) buffer.copyToChannel(channels[c], c);
  return buffer;
}
