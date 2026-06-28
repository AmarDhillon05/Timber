import { create } from 'zustand';
import type { Channels } from '../dsp';
import type { BlanketTerm } from '../dsp/blanketTerms';
import {
  editableTracks,
  tallyUsage,
  trackActiveValues,
  zeroValues,
  type BlanketMode,
  type BlanketValues,
  type Track,
  type TrackFile,
} from '../data/TrackFile';

// Single source of truth for the current editing session: the loaded TrackFile
// plus which track the editor is focused on. Per-track Blanket state lives ON
// each track (in `file`), so the blanket actions below all act on the active
// track — there is no separate blanket store to keep in sync.
//
// Big-buffer discipline (unchanged): each `track.pcm` is held by reference and
// must NOT be selected reactively in a component. Read it via getState() in the
// DSP/preview layer instead; selecting it would re-render on a ~70 MB value.

interface SessionState {
  file: TrackFile | null;
  /** Which track the editor is acting on. */
  activeTrackId: string | null;

  load: (file: TrackFile) => void;
  clear: () => void;
  setActiveTrack: (id: string) => void;
  /** Land a track's decoded PCM (called by the background decode). */
  setTrackPcm: (id: string, pcm: Channels) => void;

  // Blanket edit actions — all operate on the active track's copy.
  setValue: (term: BlanketTerm, amount: number) => void;
  setMode: (mode: BlanketMode) => void;
  toggleMode: () => void;
  setGenerated: (values: BlanketValues) => void; // land an AI suggestion + show it
  copyGeneratedToUser: () => void; // commit the generated copy into your own
  reset: () => void; // clears the active copy only
}

// Recompute the usage tally from whichever copy is currently active, so it
// always mirrors what's applied right now.
const withUsage = (t: Track): Track => ({
  ...t,
  usage: tallyUsage(trackActiveValues(t)),
});

export const useSession = create<SessionState>((set) => {
  // Replace the active track via `fn`, leaving the rest of the file untouched.
  const mutateActive = (fn: (t: Track) => Track) =>
    set((s) => {
      if (!s.file || !s.activeTrackId) return {};
      return {
        file: {
          ...s.file,
          tracks: s.file.tracks.map((t) =>
            t.id === s.activeTrackId ? fn(t) : t,
          ),
        },
      };
    });

  return {
    file: null,
    activeTrackId: null,

    load: (file) =>
      set({
        file,
        activeTrackId: (editableTracks(file)[0] ?? file.tracks[0])?.id ?? null,
      }),

    clear: () => set({ file: null, activeTrackId: null }),

    setActiveTrack: (id) => set({ activeTrackId: id }),

    setTrackPcm: (id, pcm) =>
      set((s) =>
        s.file
          ? {
              file: {
                ...s.file,
                tracks: s.file.tracks.map((t) =>
                  t.id === id ? { ...t, pcm } : t,
                ),
              },
            }
          : {},
      ),

    setValue: (term, amount) =>
      mutateActive((t) => {
        const key = t.mode === 'generated' ? 'generated' : 'user';
        return withUsage({ ...t, [key]: { ...t[key], [term]: amount } });
      }),

    setMode: (mode) => mutateActive((t) => withUsage({ ...t, mode })),

    toggleMode: () =>
      mutateActive((t) =>
        withUsage({ ...t, mode: t.mode === 'user' ? 'generated' : 'user' }),
      ),

    // Land an AI-suggested set into the generated copy and switch to it so it's
    // immediately auditioned (knobs go green).
    setGenerated: (values) =>
      mutateActive((t) => withUsage({ ...t, generated: values, mode: 'generated' })),

    // Copy the generated set onto your own and switch to it.
    copyGeneratedToUser: () =>
      mutateActive((t) => withUsage({ ...t, user: { ...t.generated }, mode: 'user' })),

    reset: () =>
      mutateActive((t) => {
        const key = t.mode === 'generated' ? 'generated' : 'user';
        return withUsage({ ...t, [key]: zeroValues() });
      }),
  };
});

// --- Selectors (use outside or inside components) -------------------------

export const activeTrack = (s: SessionState): Track | null =>
  s.file && s.activeTrackId
    ? s.file.tracks.find((t) => t.id === s.activeTrackId) ?? null
    : null;

/** The value set the editor is currently acting on (zeros if no track). */
export const activeValues = (s: SessionState): BlanketValues => {
  const t = activeTrack(s);
  return t ? trackActiveValues(t) : zeroValues();
};

/** The active track is editable only once its PCM has decoded. */
export const activeDecoding = (s: SessionState): boolean => {
  const t = activeTrack(s);
  return !t || t.pcm === null;
};
