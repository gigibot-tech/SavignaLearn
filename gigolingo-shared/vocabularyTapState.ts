/**
 * Copied from GigolingoConcept/features/media/media-detail/state/vocabularyTapState.ts
 * (no package import path in the monorepo; this file has no @/ or media I/O).
 */

export type VocabularyTapVisualState =
  | 'idle'
  | 'pending_orange'
  | 'confirmed_green'
  | 'error';

export interface VocabularyTapMeta {
  state: VocabularyTapVisualState;
  origin: 'preexisting' | 'first_clicked_this_session';
  learnCycleCompleted: boolean;
  lastPersistenceError?: string;
}

export type VocabularyTapStateMap = Map<string, VocabularyTapMeta>;

export const normalizeVocabularyTapKey = (value?: string | null): string => {
  if (!value || typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s.,!?;:()[\]{}"'`~…、。！？・]+|[\s.,!?;:()[\]{}"'`~…、。！？・]+$/g, '');
};

export const buildInitialTapStateMap = (
  words: Iterable<string>,
  origin: VocabularyTapMeta['origin'] = 'preexisting'
): VocabularyTapStateMap => {
  const map: VocabularyTapStateMap = new Map();
  for (const rawWord of words) {
    const word = normalizeVocabularyTapKey(rawWord);
    if (!word || map.has(word)) continue;
    map.set(word, {
      state: 'confirmed_green',
      origin,
      learnCycleCompleted: origin === 'preexisting',
    });
  }
  return map;
};

export const mergeTapStateMaps = (
  base: VocabularyTapStateMap,
  overlay: VocabularyTapStateMap
): VocabularyTapStateMap => {
  const merged = new Map(base);
  overlay.forEach((nextMeta, key) => {
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, nextMeta);
      return;
    }

    // confirmed wins over pending; keep latest persistence error when present.
    const statePriority: Record<VocabularyTapVisualState, number> = {
      idle: 0,
      pending_orange: 1,
      error: 2,
      confirmed_green: 3,
    };
    const state =
      statePriority[nextMeta.state] >= statePriority[prev.state]
        ? nextMeta.state
        : prev.state;

    merged.set(key, {
      state,
      origin: prev.origin === 'first_clicked_this_session' ? prev.origin : nextMeta.origin,
      learnCycleCompleted: prev.learnCycleCompleted || nextMeta.learnCycleCompleted,
      lastPersistenceError: nextMeta.lastPersistenceError || prev.lastPersistenceError,
    });
  });
  return merged;
};
