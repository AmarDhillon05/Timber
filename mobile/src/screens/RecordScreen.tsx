import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Directory, File, Paths } from 'expo-file-system';
import { AudioManager, useAudioInput } from 'react-native-audio-api';
import { createSystemAudioRecorder } from '../audio/systemAudio';
import type { SystemAudioRecorder } from '../audio/systemAudio';
import { createMicRecorder } from '../audio/micRecorder';
import type { MicRecorder } from '../audio/micRecorder';
import { createVideoRecorder } from '../media/videoRecorder';
import type { VideoRecorder } from '../media/videoRecorder';
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

export default function RecordScreen({ onBack }: { onBack: () => void }) {
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const { availableInputs, currentInput, onSelectInput } = useAudioInput();

  // True once the user has shared system audio for this take.
  const [armed, setArmed] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState<Take | null>(null);

  // Web only: the peripherals the browser exposes via enumerateDevices, plus the
  // user's picks. Native enumerates mics through useAudioInput (above) instead,
  // and has no camera device list (expo-camera only offers front/back). `null`
  // selections mean "use the browser/system default".
  const [webDevices, setWebDevices] = useState<MediaDeviceInfo[]>([]);
  const [webMicId, setWebMicId] = useState<string | null>(null);
  const [webCamId, setWebCamId] = useState<string | null>(null);

  const cameraRef = useRef<CameraView>(null);
  // Platform-specific drum-mic recorder (native WAV / web getUserMedia).
  const micRef = useRef<MicRecorder | null>(null);
  // The OS-specific system-audio capture handler, created on first share.
  const sysAudioRef = useRef<SystemAudioRecorder | null>(null);
  // Platform-specific camera recorder (native recordAsync / web MediaRecorder).
  const videoRef = useRef<VideoRecorder | null>(null);
  const recorderStartRef = useRef(0);
  const musicOffsetRef = useRef(0);

  // Tick the on-screen timer while a take is in progress.
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  // Release any shared system-audio stream / camera if we leave mid-session.
  useEffect(() => {
    return () => {
      sysAudioRef.current?.cancel();
      videoRef.current?.cancel();
    };
  }, []);

  // Web: parse the peripherals the browser exposes into state for the dropdowns.
  // Labels/ids stay hidden until permission is granted, so we re-run when camera
  // permission changes, on hot-plug (devicechange), and after a take starts (mic
  // permission populates labels).
  const refreshWebDevices = useCallback(async () => {
    if (Platform.OS !== 'web' || !navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    setWebDevices(devices);
  }, []);

  useEffect(() => {
    void refreshWebDevices();
    if (Platform.OS !== 'web' || !navigator.mediaDevices) return;
    navigator.mediaDevices.addEventListener('devicechange', refreshWebDevices);
    return () =>
      navigator.mediaDevices.removeEventListener('devicechange', refreshWebDevices);
  }, [camPerm, refreshWebDevices]);

  // Unify the mic source across platforms for the dropdown: web parses
  // enumerateDevices; native uses the audio-session inputs from useAudioInput.
  // Cameras only have a device list on web (expo-camera native is front/back).
  const isWeb = Platform.OS === 'web';
  const webMics = webDevices.filter((d) => d.kind === 'audioinput');
  const webCams = webDevices.filter((d) => d.kind === 'videoinput');

  const micOptions: DeviceOption[] = isWeb
    ? webMics.map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
    : availableInputs.map((d) => ({ id: d.id, label: d.name }));
  const micSelectedId = isWeb ? webMicId : currentInput?.id ?? null;
  const selectMic = (id: string) => {
    if (isWeb) {
      setWebMicId(id);
    } else {
      const dev = availableInputs.find((d) => d.id === id);
      if (dev) onSelectInput(dev);
    }
  };

  const camOptions: DeviceOption[] = isWeb
    ? webCams.map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }))
    : [];

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

    // Mic (drums) — platform-specific recorder. Web pins the selected input by
    // deviceId; native ignores it (the input is set via the audio session).
    const mic = createMicRecorder({ deviceId: isWeb ? webMicId : undefined });
    micRef.current = mic;
    await mic.start();
    // Getting the mic stream unlocks device labels on web — refresh the lists.
    void refreshWebDevices();

    setRecording(true);

    // Start system audio first so the drums↔music timing stays tight, then begin
    // the camera capture — its alignment is the least critical of the three, so
    // any camera-setup latency is kept off the audio path.
    recorderStartRef.current = Date.now();
    sys.start();
    musicOffsetRef.current = (Date.now() - recorderStartRef.current) / 1000;

    // Camera capture. Native records through the CameraView (recordAsync); web
    // opens its own getUserMedia stream pinned to the selected camera. Both
    // produce a muted, video-only file.
    const vid = createVideoRecorder({
      cameraRef,
      deviceId: isWeb ? webCamId : undefined,
    });
    videoRef.current = vid;
    await vid.start();
  };

  const stopTake = async () => {
    setRecording(false);

    const video = (await videoRef.current?.stop()) ?? null;
    const drums = await micRef.current?.stop();
    const music = await sysAudioRef.current?.stop();
    micRef.current = null;
    videoRef.current = null;

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
        const videoDest = new File(folder, `video${video.ext}`);
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
      micName:
        micOptions.find((o) => o.id === micSelectedId)?.label ??
        currentInput?.name ??
        'Default',
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
  // App swaps to the editor. Both drums and backing are editable tracks, so each
  // gets its own Blanket controls and tab. Each track's PCM decodes in the
  // background, exactly as importVideo does.
  const openInEditor = () => {
    if (!take) return;
    const drums = makeTrack({ name: 'Drums', uri: take.drums, editable: true });
    const music = makeTrack({ name: 'Backing', uri: take.music, editable: true });
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
              <Dropdown
                options={micOptions}
                selectedId={micSelectedId}
                onSelect={selectMic}
                placeholder="System default input"
              />

              <Text style={styles.label}>Camera</Text>
              {camOptions.length === 0 ? (
                <Text style={styles.hint}>
                  {isWeb ? 'No cameras found.' : 'Using the device camera.'}
                </Text>
              ) : (
                <>
                  <Dropdown
                    options={camOptions}
                    selectedId={webCamId ?? camOptions[0]?.id ?? null}
                    onSelect={setWebCamId}
                  />
                  <Text style={styles.hint}>
                    Preview always uses the default camera for now — switching
                    isn't wired up yet.
                  </Text>
                </>
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
                  video → {take.video.split('/').pop()}
                </Text>
              )}
              <Text style={styles.resultLine}>
                drums ({take.micName}, {take.drumsDurationSec.toFixed(1)}s)
              </Text>
              <Text style={styles.resultLine}>
                music · starts +{take.musicOffsetSec.toFixed(2)}s
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

// One selectable peripheral. `id` is the deviceId (web) or audio-session id
// (native); `label` is the human-readable name shown in the dropdown.
interface DeviceOption {
  id: string;
  label: string;
}

// A minimal pop-over dropdown: the trigger shows the current pick and toggles a
// list of options rendered just below it. (RN has no native <select>, so we roll
// our own.) The menu is absolutely positioned so it overlays the controls
// underneath rather than pushing them down.
function Dropdown({
  options,
  selectedId,
  onSelect,
  placeholder = 'Select…',
}: {
  options: DeviceOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === selectedId);
  return (
    <View style={[styles.dropdownWrap, open && styles.dropdownWrapOpen]}>
      <Pressable style={styles.dropdown} onPress={() => setOpen((o) => !o)}>
        <Text style={styles.dropdownText} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </Text>
        <Text style={styles.dropdownCaret}>{open ? '▴' : '▾'}</Text>
      </Pressable>
      {open && (
        <View style={styles.dropdownMenu}>
          {options.length === 0 ? (
            <Text style={styles.dropdownEmpty}>No devices found</Text>
          ) : (
            options.map((o) => {
              const active = o.id === selectedId;
              return (
                <Pressable
                  key={o.id}
                  style={[styles.dropdownItem, active && styles.dropdownItemActive]}
                  onPress={() => {
                    onSelect(o.id);
                    setOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.dropdownItemText,
                      active && styles.chipTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {o.label}
                  </Text>
                </Pressable>
              );
            })
          )}
        </View>
      )}
    </View>
  );
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
  chipTextActive: { color: '#f8fafc', fontWeight: '600' },
  // Raise an open dropdown (and its overlaying menu) above sibling controls.
  dropdownWrap: { position: 'relative', zIndex: 1 },
  dropdownWrapOpen: { zIndex: 10 },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#1e293b',
  },
  dropdownText: { color: '#e2e8f0', fontSize: 15, flexShrink: 1 },
  dropdownCaret: { color: '#94a3b8', fontSize: 12 },
  dropdownMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    borderRadius: 12,
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#1e293b',
    overflow: 'hidden',
  },
  dropdownItem: { paddingHorizontal: 14, paddingVertical: 11 },
  dropdownItemActive: { backgroundColor: '#2563eb' },
  dropdownItemText: { color: '#cbd5e1', fontSize: 14 },
  dropdownEmpty: { color: '#64748b', fontSize: 14, padding: 14 },
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
