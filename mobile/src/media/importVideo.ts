import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { AudioFile } from '../dsp';
import { makeTrack, makeTrackFile } from '../data/TrackFile';
import { useSession } from '../state/session';

// The persistent copy uses the File System object API (Paths/File/Directory),
// which isn't implemented on web. On web there's no durable filesystem anyway,
// so we keep the picker's in-memory URI and skip the copy stage entirely.
//
// `name` is made unique per source so picking several files that happen to share
// a filename don't clobber each other in the document directory.
async function persist(srcUri: string, name: string): Promise<string> {
  if (Platform.OS === 'web') return srcUri;

  // The picker already copied the file into the (disposable) cache dir, so MOVE
  // it into the document directory rather than copying again. Within the app
  // sandbox this is an instant rename, avoiding a second full-size copy.
  const dest = new File(Paths.document, name);
  if (dest.exists) dest.delete();
  await new File(srcUri).move(dest);
  return dest.uri;
}

// Drop the extension for a friendlier track label.
const trackName = (fileName: string) => fileName.replace(/\.[^.]+$/, '');

export type ImportResult = { status: 'imported' } | { status: 'canceled' };

// The only stage the upload screen waits on. Persisting the picked files is
// quick; once they're in the session the editor takes over and decode runs there.
export type ImportStage = 'copying';

// Pick one or more sources and build a TrackFile from them. Every source
// contributes an audio track; the VIDEO is taken from the FIRST source only and
// the rest are turned into audio-only tracks. `setVideo`/load flips the app to
// the edit screen immediately — the video is playable right away while each
// track's audio decode runs as a BACKGROUND task (not awaited).
//
// `onStage` is called as each stage begins so the caller can reflect progress.
// Resolves to `canceled` if the user dismisses the picker. A copy failure is
// thrown for the caller to surface; a decode failure surfaces from the
// background task (unhandled rejection → Expo redbox).
export async function importVideo(
  onStage?: (stage: ImportStage) => void,
): Promise<ImportResult> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'video/*',
    multiple: true,
    // Native: copy into the cache dir so we get a file:// URI to move into
    // place. Web: this is ignored, but disable base64 so the picker hands back
    // a blob URL instead of base64-encoding the whole video (slow + memory).
    copyToCacheDirectory: true,
    base64: false,
  });
  if (result.canceled) return { status: 'canceled' };

  onStage?.('copying');

  // Persist every source under a unique filename (index-prefixed so identically
  // named picks don't clobber each other), and make a track from each. The
  // VIDEO comes from the first source only; the rest are audio-only tracks.
  const stamp = Date.now().toString(36);
  const tracks = [];
  for (let i = 0; i < result.assets.length; i++) {
    const asset = result.assets[i];
    const uri = await persist(asset.uri, `${stamp}-${i}-${asset.name}`);
    tracks.push(makeTrack({ name: trackName(asset.name), uri }));
  }

  const first = result.assets[0];
  const file = makeTrackFile({
    name: trackName(first.name),
    tracks,
    video: { uri: tracks[0].uri, name: first.name },
  });

  // Editor opens now; each track's PCM fills in later.
  useSession.getState().load(file);
  for (const track of tracks) {
    void decodeInBackground(track.id, track.uri);
  }

  return { status: 'imported' };
}

// Decode one track's audio to PCM (resampled to 48 kHz) off the critical path
// and commit it to its track. Deliberately not awaited so the editor isn't
// blocked; the decode itself already runs on a native thread.
async function decodeInBackground(id: string, uri: string): Promise<void> {
  const audio = await AudioFile.decode(uri);
  useSession.getState().setTrackPcm(id, audio.data);
}
