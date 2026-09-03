/**
 * Text utilities: tokenization + Birkenbihl interlinear.
 * Copied/adapted from GigolingoConcept (no media imports).
 */

export interface InterlinearSegment {
  original: string;
  translation?: string;
}

export function parseInterlinear(text: string): InterlinearSegment[] {
  if (!text || text.trim().length === 0) {
    return [{ original: text }];
  }

  const segments: InterlinearSegment[] = [];
  let currentIndex = 0;
  const textLength = text.length;

  while (currentIndex < textLength) {
    const bracketStart = text.indexOf('[', currentIndex);
    if (bracketStart === -1) {
      const remaining = text.substring(currentIndex).trim();
      if (remaining.length > 0) segments.push({ original: remaining });
      break;
    }

    const beforeBracket = text.substring(currentIndex, bracketStart).trim();
    const bracketEnd = text.indexOf(']', bracketStart);
    if (bracketEnd === -1) {
      const remaining = text.substring(currentIndex).trim();
      if (remaining.length > 0) segments.push({ original: remaining });
      break;
    }

    const translation = text.substring(bracketStart + 1, bracketEnd).trim();
    if (beforeBracket.length > 0) {
      segments.push({ original: beforeBracket, translation });
    } else if (segments.length > 0) {
      segments[segments.length - 1].translation = translation;
    } else {
      segments.push({ original: '', translation });
    }
    currentIndex = bracketEnd + 1;
  }

  const cleaned: InterlinearSegment[] = [];
  for (const current of segments) {
    const previous = cleaned[cleaned.length - 1];
    if (
      previous &&
      !previous.translation &&
      !current.translation &&
      previous.original &&
      current.original
    ) {
      previous.original = `${previous.original} ${current.original}`.trim();
    } else {
      cleaned.push({ ...current });
    }
  }
  return cleaned;
}

export function extractOriginalText(text: string): string {
  return text.replace(/\[.*?\]/g, '').trim();
}

export function hasInterlinearFormat(text: string): boolean {
  return /\[.*?\]/.test(text);
}

export function createInterlinearFormat(original: string, translation: string): string {
  if (!original || !translation) return original;
  const originalWords = original.trim().split(/\s+/);
  const translationWords = translation.trim().split(/\s+/);
  if (Math.abs(originalWords.length - translationWords.length) > originalWords.length * 0.5) {
    return `${original} [${translation}]`;
  }
  const segments: string[] = [];
  const maxLength = Math.max(originalWords.length, translationWords.length);
  for (let i = 0; i < maxLength; i++) {
    const origWord = originalWords[i] ?? '';
    const transWord = translationWords[i] ?? '';
    if (origWord && transWord) segments.push(`${origWord} [${transWord}]`);
    else if (origWord) segments.push(origWord);
  }
  return segments.join(' ');
}

/** LONG-TERM: TokenizerPort wraps this so Shield/media can swap implementations. */
export function tokenizeText(text: string, language?: string): string[] {
  void language;
  if (!text || text.trim() === '') return [];

  const tokens: string[] = [];
  const segments = text.split(
    /[\s\u3000\u3001\u3002\u300C\u300D\u300E\u300F\u3010\u3011\u3012\u3013\u3014\u3015\u3016\u3017\u3018\u3019\u301A\u301B\u301C\u301D\u301E\u301F\u3020\u3030\u3031\u3032\u3033\u3034\u3035\u3036\u3037\u3038\u3039\u303A\u303B\u303C\u303D\u303E\u303F]+/
  );

  segments.forEach((segment) => {
    if (segment.trim() === '') return;
    const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(segment);
    // Only CJK-split when the token itself is Japanese — never because the picker is JA.
    if (hasJapanese) {
      tokens.push(...createJapaneseWordGroups(segment));
    } else {
      tokens.push(segment);
    }
  });

  return tokens.filter((token) => token.trim() !== '');
}

export function createJapaneseWordGroups(text: string): string[] {
  const words: string[] = [];
  let currentWord = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const isHiragana = /[\u3040-\u309F]/.test(char);
    const isKatakana = /[\u30A0-\u30FF]/.test(char);
    const isKanji = /[\u4E00-\u9FAF]/.test(char);

    if (isHiragana || isKatakana) {
      currentWord += char;
    } else if (isKanji) {
      if (currentWord) {
        words.push(currentWord);
        currentWord = '';
      }
      words.push(char);
    } else {
      if (currentWord) {
        words.push(currentWord);
        currentWord = '';
      }
      if (char.trim() !== '') words.push(char);
    }
  }

  if (currentWord) words.push(currentWord);
  return combineLonelyHiragana(words);
}

export function combineLonelyHiragana(words: string[]): string[] {
  const result: string[] = [];
  let i = 0;

  while (i < words.length) {
    const currentWord = words[i];
    const nextWord = words[i + 1];
    const isSingleHiragana = /^[\u3040-\u309F]$/.test(currentWord);
    const isSingleKatakana = /^[\u30A0-\u30FF]$/.test(currentWord);
    const isSingleKanji = /^[\u4E00-\u9FAF]$/.test(currentWord);
    const nextIsKanji = Boolean(nextWord && /^[\u4E00-\u9FAF]+$/.test(nextWord));
    const nextIsHiragana = Boolean(nextWord && /^[\u3040-\u309F]+$/.test(nextWord));
    const nextIsKatakana = Boolean(nextWord && /^[\u30A0-\u30FF]+$/.test(nextWord));

    if ((isSingleHiragana || isSingleKatakana) && nextIsKanji) {
      result.push(currentWord + nextWord);
      i += 2;
    } else if (isSingleKanji && (nextIsHiragana || nextIsKatakana)) {
      result.push(currentWord + nextWord);
      i += 2;
    } else if ((isSingleHiragana || isSingleKatakana) && (nextIsHiragana || nextIsKatakana)) {
      result.push(currentWord + nextWord);
      i += 2;
    } else {
      result.push(currentWord);
      i += 1;
    }
  }

  return result;
}
