/**
 * Vocabulary create modal — overlays the thread; chat UI only calls WordTapPort.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { LearningItem, LearningSource } from '@/domain/learning';
import { learningSourceKey } from '@/domain/learning';
import { getLanguageName } from '@/gigolingo-shared/languages';
import { toGigolingoLangKey } from '@/domain/chat';
import { createVocabularyWordTap } from '@/adapters/vocabulary';
import type {
  LearningItemRepository,
  VocabularyCardPort,
  WordTapPort,
  WordTapRequest,
} from '@/ports/ports';
import type { ThemeColors } from '@/constants/Colors';

function sourceSummary(source: LearningSource): string {
  if (source.kind === 'chat') {
    return `chat line ${source.lineIndex + 1} · ${source.messageId}`;
  }
  return learningSourceKey(source);
}

export function CreateVocabCardModal({
  visible,
  onClose,
  colors,
  busy,
  created,
  error,
  draft,
  item,
}: {
  visible: boolean;
  onClose: () => void;
  colors: ThemeColors;
  busy: boolean;
  created: boolean;
  error: string | null;
  draft: WordTapRequest | null;
  item: LearningItem | null;
}) {
  const word = item?.word ?? draft?.token ?? '';
  const sentence = item?.sentenceOrig ?? draft?.sentence ?? '';
  const language = item?.language ?? draft?.language ?? '';
  const source = item?.source ?? draft?.source;
  const langName = language ? getLanguageName(toGigolingoLangKey(language)) : '';
  const title = item && !created ? 'Vocabulary card' : 'Create voc card';
  const status = busy
    ? 'Creating card…'
    : error
      ? error
      : item && !created
        ? 'Already saved — refetched same card'
        : item
          ? 'Card created'
          : '';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss vocabulary card" />
        <View
          style={[styles.sheet, { backgroundColor: colors.surfaceSolid, borderColor: colors.border }]}
          accessibilityLabel="Create voc card"
        >
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Ionicons name="book" size={20} color={colors.accent} />
              <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close vocabulary card"
              style={[styles.close, { backgroundColor: colors.accentSoft }]}
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color={colors.accent} />
              <Text style={{ color: colors.textMuted }}>{status}</Text>
            </View>
          ) : (
            <Text
              style={[styles.status, { color: created ? colors.online : colors.textMuted }]}
              accessibilityLiveRegion="polite"
            >
              {status}
            </Text>
          )}

          <Field label="Word" value={word} colors={colors} />
          <Field label="Sentence" value={sentence} colors={colors} />
          <Field
            label="Language"
            value={language ? `${language.toUpperCase()}${langName ? ` · ${langName}` : ''}` : ''}
            colors={colors}
          />
          <Field label="Source" value={source ? sourceSummary(source) : ''} colors={colors} />
          {item ? (
            <>
              <Field label="Translation" value={item.translation} colors={colors} />
              <Field label="Sentence (EN)" value={item.sentenceEng} colors={colors} />
              {item.reading ? <Field label="Reading" value={item.reading} colors={colors} /> : null}
              {item.languageLevel ? (
                <Field label="Level" value={item.languageLevel} colors={colors} />
              ) : null}
              {item.frequency ? <Field label="Frequency" value={item.frequency} colors={colors} /> : null}
              <Field label="Card id" value={item.id ?? ''} colors={colors} testId="vocab-card-id" />
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function Field({
  label,
  value,
  colors,
  testId,
}: {
  label: string;
  value: string;
  colors: ThemeColors;
  testId?: string;
}) {
  if (!value) return null;
  return (
    <View style={styles.field} accessibilityLabel={`${label}: ${value}`} nativeID={testId}>
      <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.fieldValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

export function useVocabCardFromTap(options: {
  userId: string | undefined;
  cards: VocabularyCardPort;
  items: LearningItemRepository;
  colors: ThemeColors;
}): { wordTap: WordTapPort; modal: React.ReactElement; openSavedCard: (item: LearningItem) => Promise<void> } {
  const { userId, cards, items, colors } = options;
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<WordTapRequest | null>(null);
  const [item, setItem] = useState<LearningItem | null>(null);

  const onClose = useCallback(() => {
    setVisible(false);
    setBusy(false);
  }, []);

  const wordTap = useMemo<WordTapPort>(() => {
    const openExisting = createVocabularyWordTap({
      userId: () => userId ?? null,
      cards,
      items,
      onOpen: (result) => {
        setItem(result.item);
        setCreated(result.created);
        setBusy(false);
      },
    });
    return {
      async onPress(request) {
        setDraft(request);
        setItem(null);
        setError(null);
        setCreated(false);
        setVisible(true);
        if (!userId) {
          setError('Sign in to save vocabulary');
          return;
        }
        setBusy(true);
        try {
          await openExisting.onPress(request);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'Could not open vocabulary card');
          setBusy(false);
        }
      },
    };
  }, [cards, items, userId]);

  const openSavedCard = useCallback(
    async (saved: LearningItem) => {
      setDraft(null);
      setError(null);
      setCreated(false);
      setBusy(true);
      setVisible(true);
      try {
        const fresh = saved.id
          ? ((await items.findById(saved.id)) ?? saved)
          : saved.userId
            ? ((await items.findByIdentity(saved.userId, saved.word, saved.language, saved.source)) ?? saved)
            : saved;
        setItem(fresh);
      } catch (caught) {
        setItem(saved);
        setError(caught instanceof Error ? caught.message : 'Could not open vocabulary card');
      } finally {
        setBusy(false);
      }
    },
    [items]
  );

  const modal = (
    <CreateVocabCardModal
      visible={visible}
      onClose={onClose}
      colors={colors}
      busy={busy}
      created={created}
      error={error}
      draft={draft}
      item={item}
    />
  );

  return { wordTap, modal, openSavedCard };
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(26, 10, 8, 0.55)',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  status: {
    fontSize: 13,
    fontWeight: '600',
  },
  field: {
    gap: 2,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  fieldValue: {
    fontSize: 16,
    fontWeight: '500',
  },
});
