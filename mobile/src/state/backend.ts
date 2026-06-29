import { create } from 'zustand';
import { getHealth, InferenceError, type HealthInfo } from '../ai/inferenceApi';

// Tracks whether the /inference backend is reachable. App pings on start (and
// callers may re-ping); the editor reads `status` to gate AI features and show
// a reason when the service is down, instead of letting a request blow up.

export type BackendStatus =
  | 'unknown' // not pinged yet
  | 'checking' // ping in flight
  | 'online' // last ping succeeded
  | 'offline'; // last ping failed

interface BackendState {
  status: BackendStatus;
  /** /health payload when online (models, device, …); null otherwise. */
  health: HealthInfo | null;
  /** Human-readable reason we're offline; null when online/unknown. */
  error: string | null;
  /** Probe /health and update status. Never throws. */
  ping: () => Promise<void>;
}

export const useBackend = create<BackendState>((set, get) => ({
  status: 'unknown',
  health: null,
  error: null,

  ping: async () => {
    if (get().status === 'checking') return; // collapse concurrent pings
    set({ status: 'checking', error: null });
    try {
      const health = await getHealth();
      set({ status: 'online', health, error: null });
    } catch (e) {
      const error =
        e instanceof InferenceError ? e.message : `Backend ping failed: ${String(e)}`;
      set({ status: 'offline', health: null, error });
    }
  },
}));
