/**
 * Copied from GigolingoConcept/services/ai/prompts/vocabularyPrompts.ts
 * Import path rewritten from @/config/languages → ./languages (no Gigolingo package).
 */

import { getLanguageName, needsReadingAttribute } from './languages';

export interface PromptConfig {
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Get vocabulary card generation prompt for a specific word
 * Works with both Executorch (on-device) and cloud-based AI services
 */
export function getVocabularyCardPrompt(
  word: string,
  sentence: string,
  language: string = 'JA',
  translationLanguage: string = 'EN'
): PromptConfig {
  const languageName = getLanguageName(language);
  const translationLanguageName = getLanguageName(translationLanguage);
  const needsReading = needsReadingAttribute(language);
  const isJapanese = language === 'JA';

  return {
    systemPrompt: `You are an expert ${languageName} language teacher and vocabulary analyzer.
You provide accurate translations${needsReading ? ', readings' : ''}, difficulty levels, and usage examples.
Always return valid JSON only, with no additional text or formatting.
${!needsReading ? `IMPORTANT: ${languageName} uses Latin script and does NOT need a reading field. Do NOT include "reading" in your JSON response.` : ''}`,
    userPrompt: `Analyze the ${languageName} word "${word}" from this sentence context:
"${sentence}"

Return ONLY valid JSON with this exact structure:
{
  "word": "${word}"${needsReading ? `,\n  "reading": "${isJapanese ? 'hiragana or katakana reading' : 'pronunciation/reading'}"` : ''},
  "translation": "concise ${translationLanguageName} translation",
  "sentenceOrig": "${sentence}"${needsReading ? `,\n  "sentenceReading": "${isJapanese ? 'hiragana/katakana reading of the entire sentence' : 'pronunciation/reading of the entire sentence'}"` : ''},
  "sentenceEng": "natural ${translationLanguageName} translation of the sentence",
  "languageLevel": "A1, A2, B1, B2, C1, or C2 (CEFR level)",
  "frequency": "high, medium, or low (how common this word is)"${isJapanese ? ',\n  "jlpt": "N5, N4, N3, N2, or N1 (or null if not applicable)"' : ''}
}

Requirements:
${needsReading ? `- reading: ${isJapanese ? 'Must be in hiragana for kanji words, katakana for foreign loanwords' : 'Provide pronunciation/reading'}\n- sentenceReading: ${isJapanese ? 'Provide hiragana/katakana reading of the entire sentenceOrig' : 'Provide pronunciation/reading of the entire sentenceOrig'}\n` : `- DO NOT include "reading" or "sentenceReading" fields - ${languageName} uses Latin script and does not need reading\n`}- translation: Keep it concise, 1-3 words if possible, in ${translationLanguageName}
- sentenceEng: Natural, fluent ${translationLanguageName} that captures the meaning
- languageLevel: Use CEFR standards (A1=beginner, C2=native-like)
- frequency: Based on common usage in everyday ${languageName}${isJapanese ? '\n- jlpt: Official JLPT level if applicable, or null' : ''}

Return ONLY the JSON object, no markdown formatting, no explanations.`,
    temperature: 0.3,
    maxTokens: 500,
  };
}

/**
 * Build a combined prompt string from PromptConfig
 * Useful for services that need a single prompt string
 */
export function buildPromptString(config: PromptConfig): string {
  if (config.systemPrompt) {
    return `${config.systemPrompt}\n\n${config.userPrompt}`;
  }
  return config.userPrompt;
}
