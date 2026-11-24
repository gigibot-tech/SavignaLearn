/**
 * Tipped vocabulary rail for chats home. Opens the same CreateVocabCardModal as word tap.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LearningItem } from '@/domain/learning';
import type { LearningItemRepository } from '@/ports/ports';
import type { ThemeColors } from '@/constants/Colors';
import { listTippedVocabularyCards } from '@/adapters/vocabulary';
import { chatPersistenceUserId } from '@/adapters/identity';
import { useAuthState, useServices } from '@/features/chat/AppProviders';
import { useVocabCardFromTap } from '@/features/vocabulary/CreateVocabCardModal';

function subscribeItems(items: LearningItemRepository, listener: () => void) {
  return items.subscribe?.(listener) ?? (() => {});
}

export function useTippedVocabularyCards(userId: string | undefined): LearningItem[] {
  const { learningItems } = useServices();
  const [cards, setCards] = useState<LearningItem[]>([]);

  const reload = useCallback(async () => {
    if (!userId) {
      setCards([]);
      return;
    }
    setCards(await listTippedVocabularyCards(learningItems, userId));
  }, [learningItems, userId]);

  useEffect(() => {
    void reload();
    return subscribeItems(learningItems, () => {
      void reload();
    });
  }, [learningItems, reload]);

  return cards;
}

/** Gigolingo VocabularyBox-style horizontal chips of tipped cards. */
export function TippedVocabRail({
  colors,
  cards,
  onOpenCard,
}: {
  colors: ThemeColors;
  cards: LearningItem[];
  onOpenCard: (item: LearningItem) => void;
}) {
  if (cards.length === 0) {
    return (
      <Text style={[railStyles.hint, { color: colors.textMuted }]} accessibilityRole="text">
        Tip a word in chat
      </Text>
    );
  }

  return (
    <View style={railStyles.wrap}>
      <Text style={[railStyles.kicker, { color: colors.textMuted }]}>Tipped words</Text>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={railStyles.row}
        accessibilityRole="list"
        accessibilityLabel="Tipped vocabulary cards"
      >
        {cards.map((item) => (
          <Pressable
            key={item.id ?? `${item.word}-${item.language ?? ''}-${item.source.kind}`}
            onPress={() => onOpenCard(item)}
            style={[railStyles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel={`Vocabulary card ${item.word}`}
          >
            <Text style={[railStyles.word, { color: colors.text }]} numberOfLines={1}>
              {item.word}
            </Text>
            {item.reading ? (
              <Text style={[railStyles.reading, { color: colors.textMuted }]} numberOfLines={1}>
                {item.reading}
              </Text>
            ) : null}
            <Text style={[railStyles.translation, { color: colors.textMuted }]} numberOfLines={2}>
              {item.translation}
            </Text>
            {item.languageLevel ? (
              <View style={[railStyles.level, { backgroundColor: colors.accentSoft }]}>
                <Text style={[railStyles.levelText, { color: colors.accent }]}>{item.languageLevel}</Text>
              </View>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/** Home/pick-a-chat surface: rail + same voc-card modal as chat word tap. */
export function TippedVocabHome({ colors }: { colors: ThemeColors }) {
  const { user } = useAuthState();
  const { learningItems, vocabularyCards } = useServices();
  const { modal, openSavedCard } = useVocabCardFromTap({
    userId: user ? chatPersistenceUserId(user) : undefined,
    cards: vocabularyCards,
    items: learningItems,
    colors,
  });
  const cards = useTippedVocabularyCards(user ? chatPersistenceUserId(user) : undefined);

  return (
    <View style={railStyles.home}>
      <TippedVocabRail colors={colors} cards={cards} onOpenCard={(item) => void openSavedCard(item)} />
      {modal}
    </View>
  );
}

const railStyles = StyleSheet.create({
  home: { width: '100%' },
  wrap: { width: '100%' },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 10,
  },
  hint: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
  },
  row: {
    gap: 10,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  card: {
    width: 168,
    minHeight: 96,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 4,
  },
  word: { fontSize: 16, fontWeight: '800' },
  reading: { fontSize: 12 },
  translation: { fontSize: 13, lineHeight: 18 },
  level: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  levelText: { fontSize: 10, fontWeight: '800' },
});
