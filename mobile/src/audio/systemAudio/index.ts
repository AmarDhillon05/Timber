import { Platform } from 'react-native';
import { createWindowsSystemAudio } from './windows';
import { createUnsupportedSystemAudio } from './unsupported';
import type { SystemAudioRecorder } from './types';

export type { SystemAudioRecorder, SystemAudioResult } from './types';

export type HostOS =
  | 'windows'
  | 'macos'
  | 'linux'
  | 'ios'
  | 'android'
  | 'unknown';

// Best-effort host detection. On web `Platform.OS` is only ever 'web', so we
// sniff the browser for the real desktop OS — system-audio support differs
// sharply between Windows, macOS and Linux, so we need to know which one.
export function detectHostOS(): HostOS {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    const hint =
      (navigator as Navigator & { userAgentData?: { platform?: string } })
        .userAgentData?.platform ||
      navigator.platform ||
      navigator.userAgent ||
      '';
    if (/win/i.test(hint)) return 'windows';
    if (/mac/i.test(hint)) return 'macos';
    if (/linux|x11|cros/i.test(hint)) return 'linux';
  }
  return 'unknown';
}

// True when running inside the Electron desktop shell (any OS). Electron's
// userAgent carries "Electron/<version>"; the preload also exposes a flag.
export function isElectron(): boolean {
  if (typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent)) {
    return true;
  }
  return (
    typeof window !== 'undefined' &&
    !!(window as Window & { desktop?: { isElectron?: boolean } }).desktop
      ?.isElectron
  );
}

// Factory: hand back the system-audio recorder for whatever host we're on.
//
// Inside Electron the main process auto-grants loopback system audio via
// getDisplayMedia on EVERY OS (including WSL/Linux), so we use that handler
// whenever we're in the desktop shell — host detection only matters for a plain
// browser, where today only Windows can capture system audio. Every other host
// gets a recorder that names why it can't and throws if used.
export function createSystemAudioRecorder(): SystemAudioRecorder {
  if (isElectron()) return createWindowsSystemAudio('Electron · loopback');

  const os = detectHostOS();
  switch (os) {
    case 'windows':
      return createWindowsSystemAudio();
    default:
      return createUnsupportedSystemAudio(`${os} not yet supported`);
  }
}
