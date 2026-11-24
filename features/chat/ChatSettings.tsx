/**
 * Per-chat settings UI in three shapes sharing the same pieces:
 *  - `ThreadInlineChatSettings`  compact bar under the thread header on wide screens
 *  - `ChatSettingsSheet`         bottom sheet on phones
 *  - `AiConnectionPanel`         app-wide AI backend status (Settings screen)
 */

import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AI_BACKENDS, type AiBackendId } from '@/adapters/chat';
import { isBackendSelectable, type AiHealthReport } from '@/adapters/aiHealth';
import { type ThemeColors } from '@/constants/Colors';

export const CHAT_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'German' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'tr', label: 'Turkish' },
] as const;

export type ChatLanguageCode = (typeof CHAT_LANGUAGES)[number]['code'];

export type AiPartnerMode = 'off' | 'bot';

function languageLabel(code: string): string {
  return CHAT_LANGUAGES.find((l) => l.code === code)?.label ?? code.toUpperCase();
}

export { languageLabel };

function LangPickerModal({
  visible,
  title,
  selected,
  exclude,
  colors,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  selected: string;
  exclude?: string;
  colors: ThemeColors;
  onSelect: (code: string) => void;
  onClose: () => void;
}) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={pickerStyles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable
          style={[pickerStyles.sheet, { backgroundColor: colors.surfaceSolid, borderColor: colors.border }]}
          onPress={(e) => e.stopPropagation?.()}
        >
          <Text style={[pickerStyles.sheetTitle, { color: colors.text }]}>{title}</Text>
          <ScrollView style={{ maxHeight: 320 }}>
            {CHAT_LANGUAGES.filter((l) => l.code !== exclude).map((lang) => {
              const active = lang.code === selected;
              return (
                <Pressable
                  key={lang.code}
                  onPress={() => {
                    onSelect(lang.code);
                    onClose();
                  }}
                  style={[
                    pickerStyles.option,
                    active && { backgroundColor: colors.accentSoft },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={{ color: colors.text, fontWeight: active ? '700' : '500' }}>
                    {lang.label}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>{lang.code.toUpperCase()}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable onPress={onClose} style={pickerStyles.cancel} accessibilityRole="button">
            <Text style={{ color: colors.accent, fontWeight: '700' }}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}


function healthCheck(health: AiHealthReport | null, id: string) {
  return health?.checks.find((item) => item.id === id) ?? null;
}

function StatusDot({ ok, colors }: { ok: boolean; colors: ThemeColors }) {
  return (
    <View
      style={[
        styles.statusDot,
        { backgroundColor: ok ? colors.online : 'transparent', borderColor: ok ? colors.online : colors.danger },
      ]}
    />
  );
}

/** Status + select in one tile. Infra probes (server / WebGPU) stay as a compact strip. */
export function AiConnectionPanel({
  health,
  checking,
  onRetry,
  colors,
  aiBackend,
  onAiBackendChange,
}: {
  health: AiHealthReport | null;
  checking: boolean;
  onRetry: () => void;
  colors: ThemeColors;
  aiBackend: AiBackendId;
  onAiBackendChange: (id: AiBackendId) => void;
}) {
  const server = healthCheck(health, 'server');
  const webgpu = healthCheck(health, 'webgpu');
  const [hoveredDisabledDetail, setHoveredDisabledDetail] = useState<string | null>(null);
  const isWeb = Platform.OS === 'web';
  return (
    <View style={{ marginBottom: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[styles.settingsLabel, { color: colors.textMuted, paddingHorizontal: 0 }]}>
          AI backend
        </Text>
        <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry connection tests">
          <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 13 }}>
            {checking ? 'Testing…' : 'Retry'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.infraRow}>
        {server ? (
          <View style={styles.infraItem}>
            <StatusDot ok={server.ok} colors={colors} />
            <Text style={{ color: colors.textMuted, fontSize: 12 }} numberOfLines={1}>
              Server · {server.detail}
            </Text>
          </View>
        ) : null}
        {webgpu ? (
          <View style={styles.infraItem}>
            <StatusDot ok={webgpu.ok} colors={colors} />
            <Text style={{ color: colors.textMuted, fontSize: 12 }} numberOfLines={1}>
              WebGPU · {webgpu.detail}
            </Text>
          </View>
        ) : null}
      </View>

      {checking && !health ? (
        <Text style={{ color: colors.textMuted, marginTop: 8, fontSize: 12 }}>
          Checking server and AI backends…
        </Text>
      ) : (
        <View style={styles.backendGrid}>
          {AI_BACKENDS.map((item) => {
            const probe = healthCheck(health, item.id);
            const online = isBackendSelectable(item.id, health);
            const selected = aiBackend === item.id;
            const detail = probe?.detail ?? (online ? item.hint : 'No connection');
            const shortDetail = detail.split(' · ')[0];
            const webHoverProps =
              isWeb
                ? ({
                    onMouseEnter: () => {
                      // Only show the "disabled" reason when the backend is actually off.
                      setHoveredDisabledDetail(online ? null : detail);
                    },
                    onMouseLeave: () => setHoveredDisabledDetail(null),
                  } as any)
                : {};
            return (
              <Pressable
                key={item.id}
                onPress={() => {
                  if (!online) return;
                  onAiBackendChange(item.id);
                }}
                {...webHoverProps}
                style={[
                  styles.backendTile,
                  {
                    borderColor: selected ? colors.accent : colors.border,
                    backgroundColor: selected ? colors.accentSoft : colors.background,
                    opacity: online ? 1 : 0.45,
                  },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: !online }}
                accessibilityLabel={`${item.label}, ${online ? 'online' : 'offline'}, ${detail}`}
              >
                <View style={styles.backendTileHead}>
                  <StatusDot ok={Boolean(probe?.ok) || item.id === 'demo'} colors={colors} />
                  <Text
                    style={{ color: colors.text, fontWeight: selected ? '800' : '600', fontSize: 14, flex: 1 }}
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                  {selected ? (
                    <Text style={{ color: colors.accent, fontWeight: '800', fontSize: 13 }}>On</Text>
                  ) : null}
                </View>
                <Text style={{ color: colors.textMuted, fontSize: 11, lineHeight: 15 }} numberOfLines={1}>
                  {shortDetail}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {isWeb && !checking && hoveredDisabledDetail ? (
        <Text style={{ color: colors.danger, marginTop: 8, fontSize: 12, lineHeight: 16 }}>
          {hoveredDisabledDetail}
        </Text>
      ) : null}

      <Text style={{ color: colors.textMuted, marginTop: 8, fontSize: 12, lineHeight: 16 }}>
        fourSome uses on-prem first, then OpenAI. Pick On-prem or OpenAI to force one.
      </Text>
    </View>
  );
}

type LangPickerKind = 'native' | 'learning' | 'partner' | null;

function ChatLangPickers({
  picker,
  nativeLang,
  learningLang,
  partnerLearningLang,
  colors,
  onNativeLangChange,
  onLearningLangChange,
  onPartnerLearningLangChange,
  onClose,
}: {
  picker: LangPickerKind;
  nativeLang: string;
  learningLang: string;
  partnerLearningLang: string;
  colors: ThemeColors;
  onNativeLangChange: (code: string) => void;
  onLearningLangChange: (code: string) => void;
  onPartnerLearningLangChange: (code: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <LangPickerModal
        visible={picker === 'native'}
        title="I speak"
        selected={nativeLang}
        exclude={learningLang}
        colors={colors}
        onSelect={onNativeLangChange}
        onClose={onClose}
      />
      <LangPickerModal
        visible={picker === 'learning'}
        title="I'm learning"
        selected={learningLang}
        exclude={nativeLang}
        colors={colors}
        onSelect={onLearningLangChange}
        onClose={onClose}
      />
      <LangPickerModal
        visible={picker === 'partner'}
        title="They read (partner learning language)"
        selected={partnerLearningLang}
        colors={colors}
        onSelect={onPartnerLearningLangChange}
        onClose={onClose}
      />
    </>
  );
}

export type ThreadChatSettingsProps = {
  colors: ThemeColors;
  mode: 'lines' | 'birkenbihl';
  onModeChange: (mode: 'lines' | 'birkenbihl') => void;
  botReplies: boolean;
  onBotRepliesChange: (on: boolean) => void;
  nativeLang: string;
  learningLang: string;
  partnerLearningLang: string;
  onNativeLangChange: (code: string) => void;
  onLearningLangChange: (code: string) => void;
  onPartnerLearningLangChange: (code: string) => void;
  isBotChat: boolean;
  storedInCloud?: boolean;
  aiBackend: AiBackendId;
  onAiBackendChange: (id: AiBackendId) => void;
  health: AiHealthReport | null;
  onRecalculateBirkenbihl?: () => void;
  birkenbihlBusy?: boolean;
};

/** Compact this-chat controls for L/XL thread headers — not the app Settings page. */
/**
 * Learner-facing controls only: who speaks what, and how lines are shown. Which AI backend
 * answers is plumbing — it lives in the settings sheet and the app Settings screen.
 */
export function ThreadInlineChatSettings({
  colors,
  mode,
  onModeChange,
  botReplies,
  onBotRepliesChange,
  nativeLang,
  learningLang,
  partnerLearningLang,
  onNativeLangChange,
  onLearningLangChange,
  onPartnerLearningLangChange,
  isBotChat,
  onRecalculateBirkenbihl,
  birkenbihlBusy,
}: ThreadChatSettingsProps) {
  const [picker, setPicker] = useState<LangPickerKind>(null);
  const chipBorder = (active: boolean) => ({
    borderColor: active ? colors.accent : colors.border,
    backgroundColor: active ? colors.accentSoft : colors.background,
  });
  return (
    <View
      style={[inlineStyles.bar, { backgroundColor: colors.headerGlass, borderBottomColor: colors.border }]}
      accessibilityLabel="This chat: languages and display"
    >
      <View style={inlineStyles.row}>
        <Pressable
          onPress={() => setPicker('native')}
          style={[inlineStyles.chip, chipBorder(false)]}
          accessibilityRole="button"
          accessibilityLabel={`I speak ${languageLabel(nativeLang)}`}
        >
          <Text style={[inlineStyles.chipHint, { color: colors.textMuted }]}>I speak</Text>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
            {nativeLang.toUpperCase()}
          </Text>
        </Pressable>
        <Ionicons name="arrow-forward" size={14} color={colors.textMuted} />
        <Pressable
          onPress={() => setPicker('learning')}
          style={[inlineStyles.chip, chipBorder(false)]}
          accessibilityRole="button"
          accessibilityLabel={`Learning ${languageLabel(learningLang)}`}
        >
          <Text style={[inlineStyles.chipHint, { color: colors.textMuted }]}>Learning</Text>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
            {learningLang.toUpperCase()}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setPicker('partner')}
          style={[inlineStyles.chip, chipBorder(false)]}
          accessibilityRole="button"
          accessibilityLabel={`They read ${languageLabel(partnerLearningLang)}`}
        >
          <Text style={[inlineStyles.chipHint, { color: colors.textMuted }]}>They read</Text>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
            {partnerLearningLang.toUpperCase()}
          </Text>
        </Pressable>
        {isBotChat ? (
          <>
            <View style={[inlineStyles.vrule, { backgroundColor: colors.border }]} />
            <Pressable
              onPress={() => onBotRepliesChange(true)}
              style={[inlineStyles.chip, chipBorder(botReplies)]}
              accessibilityRole="button"
              accessibilityState={{ selected: botReplies }}
              accessibilityLabel="Bot replies on"
            >
              <Text style={{ color: colors.text, fontWeight: botReplies ? '800' : '600', fontSize: 12 }}>
                Bot on
              </Text>
            </Pressable>
            <Pressable
              onPress={() => onBotRepliesChange(false)}
              style={[inlineStyles.chip, chipBorder(!botReplies)]}
              accessibilityRole="button"
              accessibilityState={{ selected: !botReplies }}
              accessibilityLabel="Bot replies off"
            >
              <Text style={{ color: colors.text, fontWeight: !botReplies ? '800' : '600', fontSize: 12 }}>
                Off
              </Text>
            </Pressable>
          </>
        ) : null}
        <View style={[inlineStyles.vrule, { backgroundColor: colors.border }]} />
        <Pressable
          onPress={() => onModeChange('lines')}
          style={[inlineStyles.chip, chipBorder(mode === 'lines')]}
          accessibilityRole="button"
          accessibilityLabel="Standard display mode"
          accessibilityState={{ selected: mode === 'lines' }}
        >
          <Text style={{ color: colors.text, fontWeight: mode === 'lines' ? '800' : '600', fontSize: 12 }}>
            Standard
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onModeChange('birkenbihl')}
          style={[inlineStyles.chip, chipBorder(mode === 'birkenbihl')]}
          accessibilityRole="button"
          accessibilityLabel="Birkenbihl display mode"
          accessibilityState={{ selected: mode === 'birkenbihl' }}
        >
          <Text style={{ color: colors.text, fontWeight: mode === 'birkenbihl' ? '800' : '600', fontSize: 12 }}>
            Birkenbihl
          </Text>
        </Pressable>
        {mode === 'birkenbihl' && onRecalculateBirkenbihl ? (
          <Pressable
            onPress={onRecalculateBirkenbihl}
            disabled={birkenbihlBusy}
            style={[inlineStyles.chip, chipBorder(false), { opacity: birkenbihlBusy ? 0.55 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Recalculate Birkenbihl"
            accessibilityState={{ disabled: Boolean(birkenbihlBusy), busy: Boolean(birkenbihlBusy) }}
          >
            {birkenbihlBusy ? <ActivityIndicator size="small" color={colors.text} /> : null}
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
              {birkenbihlBusy ? 'Recalculating…' : 'Recalculate Birkenbihl'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <ChatLangPickers
        picker={picker}
        nativeLang={nativeLang}
        learningLang={learningLang}
        partnerLearningLang={partnerLearningLang}
        colors={colors}
        onNativeLangChange={(code) => {
          onNativeLangChange(code);
          setPicker(null);
        }}
        onLearningLangChange={(code) => {
          onLearningLangChange(code);
          setPicker(null);
        }}
        onPartnerLearningLangChange={(code) => {
          onPartnerLearningLangChange(code);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}

export function ChatSettingsSheet({
  visible,
  onClose,
  colors,
  mode,
  onModeChange,
  botReplies,
  onBotRepliesChange,
  nativeLang,
  learningLang,
  partnerLearningLang,
  onNativeLangChange,
  onLearningLangChange,
  onPartnerLearningLangChange,
  pipelineLabel,
  isBotChat,
  storedInCloud = false,
  aiBackend,
  onAiBackendChange,
  health,
  healthChecking,
  onRetryHealth,
  onRecalculateBirkenbihl,
  birkenbihlBusy,
}: {
  visible: boolean;
  onClose: () => void;
  colors: ThemeColors;
  mode: 'lines' | 'birkenbihl';
  onModeChange: (mode: 'lines' | 'birkenbihl') => void;
  botReplies: boolean;
  onBotRepliesChange: (on: boolean) => void;
  nativeLang: string;
  learningLang: string;
  partnerLearningLang: string;
  onNativeLangChange: (code: string) => void;
  onLearningLangChange: (code: string) => void;
  onPartnerLearningLangChange: (code: string) => void;
  pipelineLabel: string;
  isBotChat: boolean;
  storedInCloud?: boolean;
  aiBackend: AiBackendId;
  onAiBackendChange: (id: AiBackendId) => void;
  health: AiHealthReport | null;
  healthChecking: boolean;
  onRetryHealth: () => void;
  onRecalculateBirkenbihl?: () => void;
  birkenbihlBusy?: boolean;
}) {
  const [picker, setPicker] = useState<'native' | 'learning' | 'partner' | null>(null);
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={pickerStyles.backdrop} onPress={onClose} accessibilityLabel="Close settings">
        <Pressable
          style={[pickerStyles.sheet, { backgroundColor: colors.surfaceSolid, borderColor: colors.border }]}
          onPress={(e) => e.stopPropagation?.()}
        >
          <Text style={[pickerStyles.sheetTitle, { color: colors.text }]}>Chat settings</Text>
          <ScrollView style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: colors.textMuted, paddingHorizontal: 16, marginBottom: 12, fontSize: 13 }}>
            {isBotChat
              ? `${pipelineLabel} · Bot stays on this device`
              : storedInCloud
                ? `${pipelineLabel} · Saved in the cloud`
                : pipelineLabel}
          </Text>

          <View style={{ paddingHorizontal: 16 }}>
            <AiConnectionPanel
              health={health}
              checking={healthChecking}
              onRetry={onRetryHealth}
              colors={colors}
              aiBackend={aiBackend}
              onAiBackendChange={onAiBackendChange}
            />
          </View>

          <Text style={[styles.settingsLabel, { color: colors.textMuted, paddingHorizontal: 16, marginTop: 12 }]}>
            Languages
          </Text>
          <View style={[styles.modeRow, { paddingHorizontal: 16, marginTop: 8 }]}>
            <Pressable
              onPress={() => setPicker('native')}
              style={[styles.selectChip, { borderColor: colors.border, backgroundColor: colors.background }]}
              accessibilityRole="button"
              accessibilityLabel={`I speak ${languageLabel(nativeLang)}`}
            >
              <Text style={[styles.selectHint, { color: colors.textMuted }]}>I speak</Text>
              <Text style={[styles.selectValue, { color: colors.text }]}>{languageLabel(nativeLang)}</Text>
            </Pressable>
            <Pressable
              onPress={() => setPicker('learning')}
              style={[styles.selectChip, { borderColor: colors.border, backgroundColor: colors.background }]}
              accessibilityRole="button"
              accessibilityLabel={`Learning ${languageLabel(learningLang)}`}
            >
              <Text style={[styles.selectHint, { color: colors.textMuted }]}>Learning</Text>
              <Text style={[styles.selectValue, { color: colors.text }]}>{languageLabel(learningLang)}</Text>
            </Pressable>
          </View>
          <Pressable
            onPress={() => setPicker('partner')}
            style={[
              styles.selectChip,
              {
                borderColor: colors.border,
                backgroundColor: colors.background,
                marginHorizontal: 16,
                marginTop: 8,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Partner reads ${languageLabel(partnerLearningLang)}`}
          >
            <Text style={[styles.selectHint, { color: colors.textMuted }]}>They read</Text>
            <Text style={[styles.selectValue, { color: colors.text }]}>
              {languageLabel(partnerLearningLang)}
            </Text>
          </Pressable>

          <Text
            style={[styles.settingsLabel, { color: colors.textMuted, paddingHorizontal: 16, marginTop: 16 }]}
          >
            Display
          </Text>
          <View style={[styles.modeRow, { paddingHorizontal: 16, marginTop: 8 }]}>
            <Pressable
              onPress={() => onModeChange('lines')}
              style={[styles.modeChip, mode === 'lines' && { backgroundColor: colors.accentSoft }]}
              accessibilityRole="button"
              accessibilityLabel="Standard display mode"
              accessibilityState={{ selected: mode === 'lines' }}
            >
              <Text style={{ color: colors.text, fontWeight: mode === 'lines' ? '700' : '500' }}>Standard</Text>
            </Pressable>
            <Pressable
              onPress={() => onModeChange('birkenbihl')}
              style={[styles.modeChip, mode === 'birkenbihl' && { backgroundColor: colors.accentSoft }]}
              accessibilityRole="button"
              accessibilityLabel="Birkenbihl display mode"
              accessibilityState={{ selected: mode === 'birkenbihl' }}
            >
              <Text style={{ color: colors.text, fontWeight: mode === 'birkenbihl' ? '700' : '500' }}>
                Birkenbihl
              </Text>
            </Pressable>
          </View>
          {mode === 'birkenbihl' && onRecalculateBirkenbihl ? (
            <Pressable
              onPress={onRecalculateBirkenbihl}
              disabled={birkenbihlBusy}
              style={[
                styles.modeChip,
                {
                  marginHorizontal: 16,
                  marginTop: 8,
                  backgroundColor: colors.accentSoft,
                  opacity: birkenbihlBusy ? 0.55 : 1,
                  alignSelf: 'flex-start',
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Recalculate Birkenbihl"
              accessibilityState={{ disabled: Boolean(birkenbihlBusy), busy: Boolean(birkenbihlBusy) }}
            >
              {birkenbihlBusy ? <ActivityIndicator size="small" color={colors.text} /> : null}
              <Text style={{ color: colors.text, fontWeight: '700' }}>
                {birkenbihlBusy ? 'Recalculating…' : 'Recalculate Birkenbihl'}
              </Text>
            </Pressable>
          ) : null}

          {isBotChat ? (
            <>
              <Text
                style={[styles.settingsLabel, { color: colors.textMuted, paddingHorizontal: 16, marginTop: 16 }]}
              >
                Bot replies
              </Text>
              <View style={[styles.modeRow, { paddingHorizontal: 16, marginTop: 8 }]}>
                <Pressable
                  onPress={() => onBotRepliesChange(true)}
                  style={[styles.modeChip, botReplies && { backgroundColor: colors.accentSoft }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: botReplies }}
                >
                  <Text style={{ color: colors.text, fontWeight: botReplies ? '700' : '500' }}>On</Text>
                </Pressable>
                <Pressable
                  onPress={() => onBotRepliesChange(false)}
                  style={[styles.modeChip, !botReplies && { backgroundColor: colors.accentSoft }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: !botReplies }}
                >
                  <Text style={{ color: colors.text, fontWeight: !botReplies ? '700' : '500' }}>Off</Text>
                </Pressable>
              </View>
            </>
          ) : null}

          <Pressable onPress={onClose} style={pickerStyles.cancel} accessibilityRole="button">
            <Text style={{ color: colors.accent, fontWeight: '700' }}>Done</Text>
          </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>

      <ChatLangPickers
        picker={picker}
        nativeLang={nativeLang}
        learningLang={learningLang}
        partnerLearningLang={partnerLearningLang}
        colors={colors}
        onNativeLangChange={(code) => {
          onNativeLangChange(code);
          setPicker(null);
        }}
        onLearningLangChange={(code) => {
          onLearningLangChange(code);
          setPicker(null);
        }}
        onPartnerLearningLangChange={(code) => {
          onPartnerLearningLangChange(code);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  infraRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8, alignItems: 'center' },
  infraItem: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, maxWidth: '100%' },
  backendGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  backendTile: {
    flexGrow: 1,
    flexBasis: '47%',
    maxWidth: '48.5%',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 64,
    gap: 4,
  },
  backendTileHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  modeChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  settingsLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  selectChip: {
    flex: 1,
    minWidth: 140,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
  selectHint: { fontSize: 11, fontWeight: '600' },
  selectValue: { flex: 1, fontSize: 14, fontWeight: '700' },
});

const inlineStyles = StyleSheet.create({
  bar: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 32,
  },
  chipHint: { fontSize: 10, fontWeight: '600' },
  vrule: { width: StyleSheet.hairlineWidth, height: 18, marginHorizontal: 2 },
});

const pickerStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(26, 10, 8, 0.45)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  sheet: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
    paddingBottom: 8,
    maxHeight: '70%',
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '800',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
});
