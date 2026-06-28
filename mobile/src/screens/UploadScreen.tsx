import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { importVideo, type ImportStage } from '../media/importVideo';

// null = idle. 'opening' covers the gap between tapping and the picker
// returning; 'copying' mirrors importVideo's one awaited stage. Decode happens
// in the background on the edit screen, so it isn't a stage here.
type Progress = 'opening' | ImportStage | null;

const PROGRESS_LABEL: Record<Exclude<Progress, null>, string> = {
  opening: 'Opening picker…',
  copying: 'Saving sources…',
};

// Shown only when no video is loaded (see App). Picks a video and persists it;
// on success the session gains a video and App swaps to the edit screen, so
// this component never has to navigate itself.
//
// Errors are intentionally NOT caught — they propagate so Expo's debug
// overlay (redbox) shows the full stack during development.
export default function UploadScreen({
  onRecord,
}: {
  onRecord?: () => void;
}) {
  const [progress, setProgress] = useState<Progress>(null);

  const onPick = async () => {
    setProgress('opening');
    const result = await importVideo(setProgress);
    // On `imported`, the session update unmounts this screen. On `canceled`,
    // fall back to idle so the user can try again.
    if (result.status === 'canceled') setProgress(null);
  };

  const processing = progress !== null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Timber</Text>

      {processing ? (
        <View style={styles.processing}>
          <ActivityIndicator color="#f8fafc" />
          <Text style={styles.processingText}>
            {progress ? PROGRESS_LABEL[progress] : ''}
          </Text>
        </View>
      ) : (
        <>
          <Text style={styles.subtitle}>
            Upload a video to start editing. Pick several to layer extra audio
            tracks — the first one provides the video.
          </Text>
          <Pressable style={styles.button} onPress={onPick}>
            <Text style={styles.buttonText}>Choose video(s)</Text>
          </Pressable>
          {onRecord && (
            <Pressable style={styles.recordLink} onPress={onRecord}>
              <Text style={styles.recordLinkText}>Record a take</Text>
            </Pressable>
          )}
        </>
      )}

      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 24,
  },
  title: {
    color: '#94a3b8',
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  subtitle: {
    color: '#cbd5e1',
    fontSize: 16,
    textAlign: 'center',
  },
  button: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#334155',
  },
  buttonText: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '600',
  },
  recordLink: {
    paddingVertical: 8,
  },
  recordLinkText: {
    color: '#94a3b8',
    fontSize: 15,
    fontWeight: '500',
  },
  processing: {
    alignItems: 'center',
    gap: 12,
  },
  processingText: {
    color: '#cbd5e1',
    fontSize: 16,
  },
});
