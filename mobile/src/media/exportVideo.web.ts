import { renderBlanket } from '../dsp/renderBlanket';
import { TARGET_SAMPLE_RATE } from '../dsp/AudioFile';
import type { ExportParams } from './exportVideo';

export type { ExportParams } from './exportVideo';

// Web export: re-render the processed audio for the whole clip, then realtime-
// record the video frames (drawn to a canvas) muxed with that audio (through a
// MediaStream) into a .webm, and trigger a browser download. Because it records
// in realtime, the export takes about as long as the clip.
export async function exportVideo({
  videoUri,
  videoName,
  pcm,
  values,
  onProgress,
}: ExportParams): Promise<void> {
  // Create + kick the audio context synchronously so the Export tap's user
  // gesture isn't lost across the awaits below (browser autoplay policy).
  const AC: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AC();
  void audioCtx.resume();

  // 1. Render the processed audio.
  const channels = await renderBlanket(pcm, TARGET_SAMPLE_RATE, values);
  const audioBuffer = audioCtx.createBuffer(
    channels.length,
    channels[0].length,
    TARGET_SAMPLE_RATE,
  );
  for (let c = 0; c < channels.length; c++) audioBuffer.getChannelData(c).set(channels[c]);

  // 2. Hidden, muted video element (muted lets it play without a gesture).
  const video = document.createElement('video');
  video.src = videoUri;
  video.muted = true;
  video.playsInline = true;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Export: could not load video'));
  });
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const duration =
    Number.isFinite(video.duration) && video.duration > 0 ? video.duration : audioBuffer.duration;

  // 3. Canvas → video track.
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const cctx = canvas.getContext('2d');
  if (!cctx) throw new Error('Export: no 2d canvas context');
  const videoStream = canvas.captureStream(30);

  // 4. Processed audio → audio track.
  const dest = audioCtx.createMediaStreamDestination();
  const srcNode = audioCtx.createBufferSource();
  srcNode.buffer = audioBuffer;
  srcNode.connect(dest);

  // 5. Mux the two tracks and record.
  const tracks = [...videoStream.getVideoTracks(), ...dest.stream.getAudioTracks()];
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : 'video/webm';
  const recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: mime });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  await new Promise<void>((resolve, reject) => {
    let raf = 0;
    const draw = () => {
      cctx.drawImage(video, 0, 0, width, height);
      onProgress?.(Math.min(1, video.currentTime / duration));
      raf = requestAnimationFrame(draw);
    };
    const finish = () => {
      cancelAnimationFrame(raf);
      try {
        srcNode.stop();
      } catch {
        // already stopped
      }
      if (recorder.state !== 'inactive') recorder.stop();
    };
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error('Export: recorder error'));
    video.onended = finish;

    recorder.start();
    srcNode.start();
    video.play().then(draw).catch(reject);
  });

  await audioCtx.close();

  // 6. Download.
  const blob = new Blob(chunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${videoName.replace(/\.[^.]+$/, '')}-timber.webm`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  onProgress?.(1);
}
