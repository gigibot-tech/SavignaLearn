/**
 * Copied from GigolingoConcept/config/languages.ts
 * Media detectors (detectMediaLanguages / getPrimaryMediaLanguage) omitted — chat stays I/O-free.
 */

export type ScriptType = 'latin' | 'cyrillic' | 'arabic' | 'cjk' | 'devanagari' | 'other';

export interface LanguageConfig {
  code: string;
  name: string;
  flag: string;
  script: ScriptType;
  needsReading: boolean;
}

export const LANGUAGE_CONFIGS: LanguageConfig[] = [
  { code: 'JA', name: 'Japanese', flag: '🇯🇵', script: 'cjk', needsReading: true },
  { code: 'KO', name: 'Korean', flag: '🇰🇷', script: 'cjk', needsReading: true },
  { code: 'ZH', name: 'Chinese', flag: '🇨🇳', script: 'cjk', needsReading: true },
  { code: 'EN', name: 'English', flag: '🇺🇸', script: 'latin', needsReading: false },
  { code: 'ES', name: 'Spanish', flag: '🇪🇸', script: 'latin', needsReading: false },
  { code: 'FR', name: 'French', flag: '🇫🇷', script: 'latin', needsReading: false },
  { code: 'DE', name: 'German', flag: '🇩🇪', script: 'latin', needsReading: false },
  { code: 'IT', name: 'Italian', flag: '🇮🇹', script: 'latin', needsReading: false },
  { code: 'TR', name: 'Turkish', flag: '🇹🇷', script: 'latin', needsReading: false },
  { code: 'TL', name: 'Tagalog', flag: '🇵🇭', script: 'latin', needsReading: false },
  { code: 'VI', name: 'Vietnamese', flag: '🇻🇳', script: 'latin', needsReading: false },
];

export function getLanguageConfig(code: string): LanguageConfig | undefined {
  return LANGUAGE_CONFIGS.find((lang) => lang.code === code.toUpperCase());
}

export function getLanguageName(code: string): string {
  return getLanguageConfig(code)?.name || code;
}

export function needsReadingAttribute(code: string): boolean {
  return getLanguageConfig(code)?.needsReading ?? false;
}

export function isLatinScript(code: string): boolean {
  return getLanguageConfig(code)?.script === 'latin';
}

export function isNonLatinScript(code: string): boolean {
  return !isLatinScript(code);
}

export const SUBSET_MIN_LENGTH_MAP: Record<string, number> = {
  JA: 2,
  KO: 2,
  ZH: 2,
  TR: 3,
  DE: 3,
  EN: 3,
  ES: 3,
  FR: 3,
  IT: 3,
  TL: 3,
  VI: 3,
};

export function getSubsetMinLength(languageCode: string): number {
  return SUBSET_MIN_LENGTH_MAP[languageCode.toUpperCase()] || 3;
}

const KANA = /[\u3040-\u309F\u30A0-\u30FF]/;
const HANGUL = /[\uAC00-\uD7AF]/;
const HAN = /[\u4E00-\u9FFF]/;

export function hasKana(text: string): boolean {
  return KANA.test(text);
}

export function hasHangul(text: string): boolean {
  return HANGUL.test(text);
}

export function hasHanScript(text: string): boolean {
  return HAN.test(text) || KANA.test(text);
}

/**
 * Card language from the tapped token, not the bubble tag.
 * Script order matches Gigolingo `ContentCreationService.detectLanguageFromContent`
 * (kana → JA, hangul → KO) so Japanese tipped on an EN line still gets hiragana.
 */
export function inferVocabLanguageFromWord(word: string, fallback?: string): string {
  const trimmed = word.trim();
  const fallbackNorm = fallback?.trim() || undefined;
  const fallbackBase = fallbackNorm?.toLowerCase().split('-')[0];

  if (hasKana(trimmed)) return 'ja';
  if (hasHangul(trimmed)) return 'ko';
  if (HAN.test(trimmed)) {
    if (fallbackBase === 'zh') return fallbackNorm!;
    return 'ja';
  }
  return fallbackNorm ? fallbackNorm.toLowerCase() : 'en';
}

/** Sentence is in the same script as a reading-required vocab language. */
export function sentenceMatchesReadingLanguage(sentence: string, language: string): boolean {
  const base = language.toUpperCase().split('-')[0];
  if (base === 'JA') return hasHanScript(sentence);
  if (base === 'KO') return hasHangul(sentence);
  if (base === 'ZH') return HAN.test(sentence);
  return true;
}
