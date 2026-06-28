import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Directory, File, Paths } from 'expo-file-system';
import { AudioManager, useAudioInput } from 'react-native-audio-api';
import type { AudioDeviceInfo } from 'react-native-audio-api';
import { createSystemAudioRecorder } from '../audio/systemAudio';
import type { SystemAudioRecorder } from '../audio/systemAudio';
import { createMicRecorder } from '../audio/micRecorder';
import type { MicRecorder } from '../audio/micRecorder';
import { AudioFile } from '../dsp';
import { makeTrack, makeTrackFile } from '../data/TrackFile';
import { useSession } from '../state/session';

// The Record page captures a take with THREE aligned tracks:
//   1. video  — the camera (recorded muted; the camera never owns the mic)
//   2. drums  — a user-selectable hardware input, recorded to its own file
//   3. music  — the system / tab audio playing on the host, captured LIVE
//               alongside the drums (see ../audio/systemAudio)
//
// The music source is no longer a file the app plays back — instead we capture
// whatever is already playing (Spotify, a browser tab, …) through the OS's
// privileged screen-share path. Because music and drums are recorded at the
// same time, they share a timeline: we still note how far into the take the
// music capture began (`musicOffsetSec`), which is ~0.
//
// Which capture backend we get is decided by `createSystemAudioRecorder()`,
// which forwards an OS-specific handler. Windows (browser) is wired up first.
//
// Per the project's error policy, failures are NOT caught into friendly
// messages: they propagate to Expo's redbox during development.

interface Take {
  dir: string;
  /** null while the camera is a placeholder (no video captured yet). */
  video: string | null;
  drums: string;
  music: string;
  /** Seconds into the recording at which system-audio capture began (~0). */
  musicOffsetSec: number;
  drumsDurationSec: number;
  micName: string;
}

const extOf = (uri: string) => {
  const m = uri.split('?')[0].match(/\.[a-zA-Z0-9]+$/);
  return m ? m[0] : '';
};

export default function RecordScreen({ onBack }: { onBack: () => void }) {
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const { availableInputs, currentInput, onSelectInput } = useAudioInput();

  // True once the user has shared system audio for this take.
  const [armed, setArmed] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState<Take | null>(null);

  const cameraRef = useRef<CameraView>(null);
  // Platform-specific drum-mic recorder (native WAV / web getUserMedia).
  const micRef = useRef<MicRecorder | null>(null);
  // The OS-specific system-audio capture handler, created on first share.
  const sysAudioRef = useRef<SystemAudioRecorder | null>(null);
  // The camera's recordAsync promise resolves only once recording stops.
  const videoPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(
    null,
  );
  const recorderStartRef = useRef(0);
  const musicOffsetRef = useRef(0);

  // Tick the on-screen timer while a take is in progress.
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  // Release any shared system-audio stream if we leave mid-session.
  useEffect(() => {
    return () => sysAudioRef.current?.cancel();
  }, []);

  // Debug: log every media peripheral the OS exposes (and the camera permission
  // state). Labels stay hidden until permission is granted, so this re-runs when
  // camPerm changes. Native exposes audio inputs via useAudioInput below.
  useEffect(() => {
    console.log('[peripheral] camera permission:', camPerm?.status ?? 'loading');
    if (Platform.OS === 'web' && navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        for (const d of devices) {
          console.log(
            `[peripheral] ${d.kind}:`,
            d.label || '(label hidden until permission)',
            d.deviceId,
          );
        }
      });
    }
  }, [camPerm]);

  // Native: log the audio inputs the OS offers and which one is selected.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    console.log(
      '[peripheral] native audio inputs:',
      availableInputs.map((d) => d.name),
      '· selected:',
      currentInput?.name ?? 'system default',
    );
  }, [availableInputs, currentInput]);

  // Prompt the user to share system/tab audio (the slow, interactive step) so
  // that starting the take itself stays tight. The handler is OS-specific.
  const shareSystemAudio = async () => {
    const sys =
      sysAudioRef.current ?? (sysAudioRef.current = createSystemAudioRecorder());
    await sys.arm();
    setArmed(true);
  };

  const startTake = async () => {
    const sys = sysAudioRef.current;
    if (!sys?.armed) return; // must share system audio first
    console.log(
      '[peripheral] take starting — peripherals:',
      `system-audio=${sys.name}`,
      `mic=${Platform.OS === 'web' ? 'getUserMedia' : currentInput?.name ?? 'system default'}`,
      `video=${Platform.OS === 'web' ? 'preview-only' : 'camera recording'}`,
    );
    setTake(null);
    setElapsed(0);

    // Native only: route the audio session for recording. The web mic uses
    // getUserMedia, which handles its own permission prompt.
    if (Platform.OS !== 'web') {
      AudioManager.setAudioSessionOptions({
        iosCategory: 'playAndRecord',
        iosMode: 'default',
        iosOptions: ['allowBluetoothA2DP', 'allowBluetoothHFP'],
      });
      const granted = await AudioManager.requestRecordingPermissions();
      if (granted !== 'Granted') return;
      await AudioManager.setAudioSessionActivity(true);
    }

    // Mic (drums) — platform-specific recorder.
    const mic = createMicRecorder();
    micRef.current = mic;
    await mic.start();

    setRecording(true);

    // The camera shows a live preview on every platform, but video RECORDING is
    // native-only for now (expo-camera web recording is unverified here). On web
    // we skip recordAsync, so the take is drums + music and the preview is just
    // a viewfinder. System audio is already armed, so start() lands right next
    // to the drums.
    videoPromiseRef.current =
      Platform.OS === 'web' ? null : cameraRef.current?.recordAsync() ?? null;

    recorderStartRef.current = Date.now();
    sys.start();
    musicOffsetRef.current = (Date.now() - recorderStartRef.current) / 1000;
  };

  const stopTake = async () => {
    setRecording(false);

    cameraRef.current?.stopRecording();
    const video = (await videoPromiseRef.current) ?? null;
    const drums = await micRef.current?.stop();
    const music = await sysAudioRef.current?.stop();
    micRef.current = null;

    if (Platform.OS !== 'web') await AudioManager.setAudioSessionActivity(false);
    setArmed(false);

    if (!drums || !music) return;

    // Native has a durable filesystem: move the captured files into a take
    // folder and write a manifest. Web keeps the in-memory object URLs as-is
    // (there's no durable FS in the browser/Electron renderer).
    let dir = '(in-memory)';
    let drumsUri = drums.uri;
    let videoUri = video?.uri ?? null;
    let folder: Directory | null = null;

    if (Platform.OS !== 'web') {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      folder = new Directory(Paths.document, 'recordings', stamp);
      folder.create({ intermediates: true, idempotent: true });

      const drumsDest = new File(folder, `drums${drums.ext}`);
      await new File(drums.uri).move(drumsDest);
      drumsUri = drumsDest.uri;

      if (video) {
        const videoDest = new File(folder, `video${extOf(video.uri)}`);
        await new File(video.uri).move(videoDest);
        videoUri = videoDest.uri;
      }
      dir = folder.uri;
    }

    const result: Take = {
      dir,
      video: videoUri,
      drums: drumsUri,
      music: music.uri, // object URL on web; persisting it is still TODO
      musicOffsetSec: musicOffsetRef.current,
      drumsDurationSec: drums.durationSec,
      micName: currentInput?.name ?? 'Default',
    };

    if (folder) {
      const manifest = new File(folder, 'take.json');
      manifest.create();
      manifest.write(JSON.stringify(result, null, 2));
    }

    setTake(result);
  };

  // Hand the finished take to the rest of the app as a multi-track TrackFile
  // (the same document the upload flow produces), then leave the record route so
  // App swaps to the editor. Drums are an editable track (Blanket controls);
  // the captured music mixes in raw. Each track's PCM decodes in the background,
  // exactly as importVideo does.
  const openInEditor = () => {
    if (!take) return;
    const drums = makeTrack({ name: 'Drums', uri: take.drums, editable: true });
    const music = makeTrack({ name: 'Backing', uri: take.music, editable: false });
    const file = makeTrackFile({
      name: take.dir.split('/').pop() || 'Take',
      tracks: [drums, music],
      video: take.video
        ? { uri: take.video, name: take.video.split('/').pop() ?? 'video' }
        : null,
    });

    useSession.getState().load(file);
    void decodeTrackInBackground(drums.id, drums.uri);
    void decodeTrackInBackground(music.id, music.uri);
    onBack();
  };

  // --- Render -------------------------------------------------------------

  if (!camPerm) {
    return <Screen onBack={onBack} />; // permission state still loading
  }

  if (!camPerm.granted) {
    return (
      <Screen onBack={onBack}>
        <Text style={styles.body}>Camera access is needed to record.</Text>
        <Pressable style={styles.button} onPress={requestCamPerm}>
          <Text style={styles.buttonText}>Grant camera access</Text>
        </Pressable>
      </Screen>
    );
  }

  return (
    <Screen onBack={onBack}>
      <View style={styles.row}>
        {/* LEFT: camera preview. Temporarily a solid placeholder so we can
            settle the layout/sizing before wiring the real CameraView back in. */}
        <View style={styles.preview}>
          <CameraView ref={cameraRef} style={styles.camera} mode="video" mute />
          {recording && (
            <View style={styles.recBadge}>
              <View style={styles.recDot} />
              <Text style={styles.recText}>
                {String(Math.floor(elapsed / 60)).padStart(2, '0')}:
                {String(elapsed % 60).padStart(2, '0')}
              </Text>
            </View>
          )}
        </View>

        {/* RIGHT: all the inputs and controls. */}
        <View style={styles.controls}>
          {!recording && (
            <>
              <Text style={styles.label}>Drum mic</Text>
              {availableInputs.length === 0 ? (
                <Text style={styles.hint}>Using the system default input.</Text>
              ) : (
                <View style={styles.micRow}>
                  {availableInputs.map((d: AudioDeviceInfo) => {
                    const active = currentInput?.id === d.id;
                    return (
                      <Pressable
                        key={d.id}
                        onPress={() => onSelectInput(d)}
                        style={[styles.chip, active && styles.chipActive]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            active && styles.chipTextActive,
                          ]}
                        >
                          {d.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              <Text style={styles.label}>System audio</Text>
              <Pressable style={styles.secondary} onPress={shareSystemAudio}>
                <Text style={styles.secondaryText}>
                  {armed
                    ? 'System audio shared ✓ — ready to record'
                    : 'Share system audio to capture along'}
                </Text>
              </Pressable>
            </>
          )}

          <Pressable
            style={[
              styles.button,
              recording && styles.stop,
              !armed && !recording && styles.disabled,
            ]}
            disabled={!armed && !recording}
            onPress={recording ? stopTake : startTake}
          >
            <Text style={styles.buttonText}>
              {recording ? 'Stop' : 'Record take'}
            </Text>
          </Pressable>

          {take && (
            <View style={styles.result}>
              <Text style={styles.resultTitle}>
                Take saved · {take.video ? 3 : 2} tracks
              </Text>
              {take.video && (
                <Text style={styles.resultLine}>
                  🎥 video → {take.video.split('/').pop()}
                </Text>
              )}
              <Text style={styles.resultLine}>
                🥁 drums ({take.micName}, {take.drumsDurationSec.toFixed(1)}s)
              </Text>
              <Text style={styles.resultLine}>
                🎵 music · starts +{take.musicOffsetSec.toFixed(2)}s
              </Text>
              <Text style={styles.hint}>{take.dir}</Text>
              <Pressable style={styles.secondary} onPress={openInEditor}>
                <Text style={styles.secondaryText}>Open in editor →</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>

      <StatusBar style="light" />
    </Screen>
  );
}

// Decode one track's audio to PCM off the critical path and land it on its
// track, mirroring importVideo's background decode so recorded and uploaded
// TrackFiles fill in identically.
async function decodeTrackInBackground(id: string, uri: string): Promise<void> {
  const audio = await AudioFile.decode(uri);
  useSession.getState().setTrackPcm(id, audio.data);
}

function Screen({
  children,
  onBack,
}: {
  children?: React.ReactNode;
  onBack: () => void;
}) {
  return (
    <View style={[styles.container, styles.content]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Record</Text>
        <View style={{ width: 48 }} />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 20, gap: 16 },
  // The two-column body: camera preview on the left, controls on the right.
  row: { flex: 1, flexDirection: 'row', gap: 20 },
  controls: { flex: 1, gap: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  back: { color: '#94a3b8', fontSize: 16, width: 48 },
  title: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 1,
  },
  preview: {
    // position: relative makes this the containing block for the camera's
    // absolutely-positioned <video> on web, so overflow: hidden clips it to the
    // panel instead of letting it escape to fill the viewport.
    position: 'relative',
    flex: 1,
    alignSelf: 'flex-start',
    aspectRatio: 3 / 4,
    maxHeight: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#020617',
  },
  camera: { width: '100%', height: '100%' },
  recBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444' },
  recText: { color: '#f8fafc', fontVariant: ['tabular-nums'], fontSize: 14 },
  label: {
    color: '#94a3b8',
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  hint: { color: '#64748b', fontSize: 13 },
  body: { color: '#cbd5e1', fontSize: 16 },
  micRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#1e293b',
  },
  chipActive: { backgroundColor: '#2563eb' },
  chipText: { color: '#cbd5e1', fontSize: 14 },
  chipTextActive: { color: '#f8fafc', fontWeight: '600' },
  secondary: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#1e293b',
  },
  secondaryText: { color: '#e2e8f0', fontSize: 15 },
  button: {
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    marginTop: 4,
  },
  stop: { backgroundColor: '#ef4444' },
  disabled: { opacity: 0.4 },
  buttonText: { color: '#f8fafc', fontSize: 16, fontWeight: '600' },
  result: {
    gap: 6,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#1e293b',
  },
  resultTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '600' },
  resultLine: { color: '#cbd5e1', fontSize: 14 },
});
