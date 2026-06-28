import { useState } from 'react';
import { useSession } from './src/state/session';
import UploadScreen from './src/screens/UploadScreen';
import EditScreen from './src/screens/EditScreen';
import RecordScreen from './src/screens/RecordScreen';

// Routing is derived from the session: a loaded TrackFile means we're editing,
// otherwise we're uploading. Subscribe only to whether a file is present (never
// a track's `pcm`, which is a large buffer) so this re-renders just on the
// load/clear transition.
//
// The Record page is a separate, self-contained route reached from Upload; it
// lives outside the upload/edit flow for now and returns via `onBack`.
export default function App() {
  const hasFile = useSession((s) => s.file !== null);
  const [recording, setRecording] = useState(false);

  if (recording) return <RecordScreen onBack={() => setRecording(false)} />;
  if (hasFile) return <EditScreen />;
  return <UploadScreen onRecord={() => setRecording(true)} />;
}
