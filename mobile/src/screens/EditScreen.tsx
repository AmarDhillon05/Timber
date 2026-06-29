import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import {
  useSession,
  activeValues,
  activeTrack,
  activeDecoding,
} from '../state/session';
import { useBackend } from '../state/backend';
import { usePreview } from '../audio/usePreview';
import { exportVideo } from '../media/exportVideo';
import { suggestBlanket } from '../ai/suggestBlanket';
import { InferenceError } from '../ai/inferenceApi';
import { BlanketKnob } from '../components/BlanketKnob';
import {
  BLANKET_TERM_KEYS,
  BLANKET_TERMS,
  CATEGORY_ORDER,
} from '../dsp/blanketTerms';

// Below this width we stack (video over sliders); at or above it we go
// side-by-side (video left, sliders right).
const WIDE_BREAKPOINT = 600;

// Shown whenever the session holds a TrackFile. The video is playable
// immediately; the Blanket sliders stay locked until the active track's
// background decode finishes (`activeDecoding` flips to false once its PCM
// lands). The track selector switches which track the knobs act on — each
// track keeps its own Blanket state.
export default function EditScreen() {
  const video = useSession((s) => s.file?.video ?? null);
  const videoName = video?.name ?? 'Untitled';
  const videoUri = video?.uri ?? null;
  const decoding = useSession(activeDecoding);
  const clear = useSession((s) => s.clear);
  const reset = useSession((s) => s.reset);
  const mode = useSession((s) => activeTrack(s)?.mode ?? 'user');
  const toggleMode = useSession((s) => s.toggleMode);
  const copyGeneratedToUser = useSession((s) => s.copyGeneratedToUser);
  const setGenerated = useSession((s) => s.setGenerated);

  // Backend availability (pinged on app start). When offline we disable the
  // suggest action and show why, rather than firing a request that will fail.
  const backendStatus = useBackend((s) => s.status);
  const backendError = useBackend((s) => s.error);
  const pingBackend = () => void useBackend.getState().ping();

  // Track selector. A signature string (ids/names/editability, delimited by
  // tab/newline) keeps this stable across knob drags — those replace the active
  // track object but never change the tab list — so the editor doesn't
  // re-render on every move.
  const trackSig = useSession((s) =>
    (s.file?.tracks ?? [])
      .map((t) => [t.id, t.name, t.editable ? '1' : '0'].join('\t'))
      .join('\n'),
  );
  const activeTrackId = useSession((s) => s.activeTrackId);
  const setActiveTrack = useSession((s) => s.setActiveTrack);
  const editableTabs = useMemo(
    () =>
      (trackSig ? trackSig.split('\n') : [])
        .map((part) => {
          const [id, name, editable] = part.split('\t');
          return { id, name, editable: editable === '1' };
        })
        .filter((t) => t.editable),
    [trackSig],
  );

  // Debug: dump the whole TrackFile whenever the list, selection, or decode
  // state changes — i.e. on every editor open and every tab switch. Read from
  // getState() (not a reactive selector) and SUMMARIZE the heavy fields: pcm
  // (never log the raw Float32Array buffers, ~70 MB each) and the video (name +
  // truncated uri, never the blob itself).
  useEffect(() => {
    const { file, activeTrackId } = useSession.getState();
    if (!file) return;
    const video = file.video
      ? `${file.video.name} · ${file.video.uri.slice(0, 48)}`
      : 'none';
    console.log(
      `[editor] file "${file.name}" · ${file.tracks.length} tracks · video=${video}`,
    );
    console.table(
      file.tracks.map((t) => ({
        name: t.name,
        editable: t.editable,
        active: t.id === activeTrackId,
        sampleRate: t.sampleRate,
        pcm: t.pcm ? `${t.pcm.length}ch × ${t.pcm[0]?.length ?? 0} samples` : 'decoding…',
        uri: t.uri.slice(0, 48),
      })),
    );
  }, [trackSig, activeTrackId, decoding]);

  const generated = mode === 'generated';
  const accent = generated ? '#22c55e' : '#ef4444';

  // null = not exporting; otherwise the 0..1 progress fraction.
  const [exportProgress, setExportProgress] = useState<number | null>(null);

  // AI suggestion in-flight state, plus the free-text hint sent with it.
  const [suggesting, setSuggesting] = useState(false);
  const [prompt, setPrompt] = useState('');

  // Notification micro-interaction: a toast that springs in (on success OR
  // failure), then settles back out on its own. Its contents are data-driven so
  // the same animation reports both outcomes.
  const toast = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toastInfo, setToastInfo] = useState<{
    tone: 'ok' | 'err';
    title: string;
    sub: string;
  }>({ tone: 'ok', title: 'Suggestions ready', sub: 'Generated from your audio' });
  const flashToast = (info: { tone: 'ok' | 'err'; title: string; sub: string }) => {
    setToastInfo(info);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    Animated.spring(toast, {
      toValue: 1,
      useNativeDriver: false,
      friction: 6,
      tension: 130,
    }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toast, { toValue: 0, duration: 240, useNativeDriver: false }).start();
    }, info.tone === 'err' ? 3200 : 1900);
  };

  // Press feedback for the suggest button.
  const press = useRef(new Animated.Value(0)).current;
  const pressTo = (to: number) =>
    Animated.spring(press, { toValue: to, useNativeDriver: false, friction: 7, tension: 200 }).start();

  // Send the active track's decoded audio to the inference service and land its
  // suggestions on that track. The track's current "Yours" values ride along as
  // an inclination the model blends toward, and the prompt text biases scoring.
  // A backend failure is reported in the toast (and re-pings availability) rather
  // than thrown — the service being down shouldn't break the editor.
  const onSuggest = async () => {
    const track = activeTrack(useSession.getState());
    if (!track?.pcm) return;
    setSuggesting(true);
    try {
      setGenerated(
        await suggestBlanket(track.pcm, track.sampleRate, {
          context: prompt,
          inclination: track.user,
        }),
      );
      flashToast({ tone: 'ok', title: 'Suggestions ready', sub: 'Generated from your audio' });
    } catch (e) {
      flashToast({ tone: 'err', title: 'Suggestion failed', sub: describeBackendError(e) });
      pingBackend(); // refresh the online/offline indicator after a failure
    } finally {
      setSuggesting(false);
    }
  };

  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;

  const onExport = async () => {
    const track = activeTrack(useSession.getState());
    if (!videoUri || !track?.pcm) return;
    setExportProgress(0);
    try {
      await exportVideo({
        videoUri,
        videoName,
        pcm: track.pcm,
        values: activeValues(useSession.getState()),
        onProgress: setExportProgress,
      });
    } finally {
      setExportProgress(null);
    }
  };
  // Video column scales with the screen but stays within sensible bounds.
  const videoWidth = wide ? Math.min(Math.max(width * 0.42, 300), 600) : undefined;

  const player = useVideoPlayer(videoUri, (p) => {
    p.loop = true;
  });

  // Mutes the video and plays the processed audio in its place, re-rendering as
  // sliders change. No-op visually; drives all the audio.
  usePreview(player);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>
          {videoName}
        </Text>
        <Pressable onPress={clear} hitSlop={8}>
          <Text style={styles.close}>Close</Text>
        </Pressable>
      </View>

      <View style={[styles.body, wide && styles.bodyWide]}>
        <View style={wide ? { width: videoWidth } : styles.videoColStacked}>
          <VideoView
            style={[styles.video, wide ? { width: videoWidth } : undefined]}
            player={player}
            contentFit="contain"
            nativeControls
          />
        </View>

        <View style={styles.controls}>
          {editableTabs.length > 1 && (
            <View style={styles.trackBar}>
              {editableTabs.map((t) => {
                const active = t.id === activeTrackId;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => setActiveTrack(t.id)}
                    style={[styles.trackChip, active && styles.trackChipActive]}
                  >
                    <Text
                      style={[styles.trackChipText, active && styles.trackChipTextActive]}
                    >
                      {t.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <View style={[styles.controlsHeader, wide && styles.controlsHeaderWide]}>
            <View style={styles.controlsTitleRow}>
              <Text style={styles.controlsTitle}>Blanket</Text>
              <Pressable
                onPress={toggleMode}
                hitSlop={8}
                style={[styles.modePill, { borderColor: accent }]}
              >
                <View style={[styles.modeDot, { backgroundColor: accent }]} />
                <Text style={[styles.modePillText, { color: accent }]}>
                  {generated ? 'Generated' : 'Yours'}
                </Text>
              </Pressable>
            </View>
            {decoding ? (
              <View style={styles.status}>
                <ActivityIndicator color="#94a3b8" size="small" />
                <Text style={styles.statusText}>Preparing audio…</Text>
              </View>
            ) : exportProgress !== null ? (
              <View style={styles.status}>
                <ActivityIndicator color="#38bdf8" size="small" />
                <Text style={styles.statusText}>
                  Exporting {Math.round(exportProgress * 100)}%
                </Text>
              </View>
            ) : (
              <View style={styles.actions}>
                <Pressable onPress={copyGeneratedToUser} hitSlop={8}>
                  <Text style={styles.applyText}>Generated → Yours</Text>
                </Pressable>
                <Pressable onPress={reset} hitSlop={8}>
                  <Text style={styles.resetText}>Reset</Text>
                </Pressable>
                <Pressable onPress={onExport} hitSlop={8} style={styles.exportButton}>
                  <Text style={styles.exportText}>Export ↓</Text>
                </Pressable>
              </View>
            )}
          </View>

          <UsageSummary />

          {!decoding && (
            <View style={styles.suggestBlock}>
              <TextInput
                style={styles.promptInput}
                value={prompt}
                onChangeText={setPrompt}
                placeholder="Optional hint, e.g. live drum kit, noisy room"
                placeholderTextColor="#64748b"
                multiline
                editable={!suggesting}
              />
              {backendStatus === 'offline' && (
                <Pressable style={styles.offlineBanner} onPress={pingBackend} hitSlop={6}>
                  <Text style={styles.offlineText} numberOfLines={2}>
                    AI offline — {backendError ?? 'service unreachable'}. Tap to retry.
                  </Text>
                </Pressable>
              )}
              <Animated.View
                style={{
                  transform: [
                    { scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] }) },
                  ],
                }}
              >
                <Pressable
                  onPress={onSuggest}
                  onPressIn={() => pressTo(1)}
                  onPressOut={() => pressTo(0)}
                  disabled={suggesting || backendStatus === 'offline'}
                  style={[
                    styles.suggestButton,
                    (suggesting || backendStatus === 'offline') && styles.suggestButtonDisabled,
                  ]}
                >
                  {suggesting ? (
                    <ActivityIndicator color="#0f172a" size="small" />
                  ) : (
                    <Text style={styles.suggestButtonText}>
                      {backendStatus === 'checking' ? 'Checking AI…' : 'Suggest from audio'}
                    </Text>
                  )}
                </Pressable>
              </Animated.View>
            </View>
          )}

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={decoding && styles.locked}>
              {CATEGORY_ORDER.map((category) => (
                <View key={category} style={styles.group}>
                  <Text style={styles.category}>{category}</Text>
                  <View style={styles.knobGrid}>
                    {BLANKET_TERM_KEYS.filter(
                      (key) => BLANKET_TERMS[key].category === category,
                    ).map((key) => (
                      <BlanketKnob key={key} term={key} disabled={decoding} />
                    ))}
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>

      <View style={styles.toastHost} pointerEvents="none">
        <Animated.View
          style={[
            styles.toast,
            toastInfo.tone === 'err' && styles.toastErr,
            {
              opacity: toast,
              transform: [
                { translateY: toast.interpolate({ inputRange: [0, 1], outputRange: [-28, 0] }) },
                { scale: toast.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
              ],
            },
          ]}
        >
          <View style={[styles.toastIcon, toastInfo.tone === 'err' && styles.toastIconErr]}>
            <Text style={styles.toastCheck}>{toastInfo.tone === 'err' ? '!' : '✓'}</Text>
          </View>
          <View style={styles.toastTextCol}>
            <Text style={styles.toastTitle}>{toastInfo.title}</Text>
            <Text style={styles.toastSub} numberOfLines={2}>{toastInfo.sub}</Text>
          </View>
        </Animated.View>
      </View>

      <StatusBar style="light" />
    </View>
  );
}

// Turn a failed /suggest call into a short, user-facing reason. Each backend
// failure mode (service down, slow, HTTP error, bad body) gets its own line.
function describeBackendError(e: unknown): string {
  if (e instanceof InferenceError) {
    switch (e.kind) {
      case 'unreachable':
        return 'Inference service is offline.';
      case 'timeout':
        return 'The service took too long to respond.';
      case 'http':
        return `Service error (${e.status}).`;
      case 'malformed':
        return 'The service returned an unexpected response.';
    }
  }
  return 'Something went wrong.';
}

// Live readout of the active track's usage tally. Subscribes on its own (like a
// knob) so it can update on every drag without re-rendering the whole editor.
function UsageSummary() {
  const usage = useSession((s) => activeTrack(s)?.usage ?? null);
  if (!usage) return null;
  const knobs = Object.keys(usage.blanket).length;
  const effects = Object.values(usage.effect).reduce((a, b) => a + b, 0);
  if (knobs === 0) return null;
  return (
    <Text style={styles.usageText}>
      {knobs} {knobs === 1 ? 'knob' : 'knobs'} · {effects}{' '}
      {effects === 1 ? 'effect' : 'effects'} applied
    </Text>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    paddingTop: 56,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  name: {
    flex: 1,
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700',
    marginRight: 12,
  },
  close: {
    color: '#94a3b8',
    fontSize: 16,
    fontWeight: '600',
  },
  body: {
    flex: 1,
    flexDirection: 'column',
  },
  bodyWide: {
    flexDirection: 'row',
    gap: 24,
  },
  videoColStacked: {
    width: '100%',
  },
  video: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 12,
    backgroundColor: '#000',
  },
  controls: {
    flex: 1,
  },
  trackBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 20,
  },
  trackChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#1e293b',
  },
  trackChipActive: {
    backgroundColor: '#2563eb',
  },
  trackChipText: {
    color: '#cbd5e1',
    fontSize: 14,
  },
  trackChipTextActive: {
    color: '#f8fafc',
    fontWeight: '600',
  },
  controlsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 4,
  },
  controlsHeaderWide: {
    marginTop: 0,
  },
  controlsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  controlsTitle: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  modeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  modePillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    color: '#94a3b8',
    fontSize: 14,
  },
  resetText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600',
  },
  applyText: {
    color: '#22c55e',
    fontSize: 14,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  exportButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#38bdf8',
  },
  exportText: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '700',
  },
  usageText: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 8,
    fontVariant: ['tabular-nums'],
  },
  suggestBlock: {
    marginTop: 12,
    marginBottom: 4,
    gap: 8,
  },
  promptInput: {
    minHeight: 40,
    maxHeight: 96,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  suggestButton: {
    height: 40,
    borderRadius: 10,
    backgroundColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#22c55e',
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  suggestButtonDisabled: {
    opacity: 0.4,
  },
  suggestButtonText: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  locked: {
    opacity: 0.4,
  },
  group: {
    marginTop: 16,
  },
  knobGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  category: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  toastHost: {
    position: 'absolute',
    top: 64,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#1e293b',
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 20,
  },
  toastErr: { borderColor: '#7f1d1d' },
  toastIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#22c55e',
    shadowOpacity: 0.6,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  toastIconErr: { backgroundColor: '#ef4444', shadowColor: '#ef4444' },
  toastCheck: {
    color: '#04130a',
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 18,
  },
  toastTextCol: { flexShrink: 1 },
  toastTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
  },
  toastSub: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 1,
  },
  offlineBanner: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(127,29,29,0.35)',
    borderWidth: 1,
    borderColor: '#7f1d1d',
  },
  offlineText: { color: '#fca5a5', fontSize: 12 },
});
