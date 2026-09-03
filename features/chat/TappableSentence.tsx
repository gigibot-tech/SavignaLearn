/**
 * Selectable learning sentence + per-token vocab tap.
 * Web: one text node so clipboard stays a paragraph; click hit-tests the token.
 * Native: nested Text so the run is still one sentence when copied.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { Platform, Text, type StyleProp, type TextStyle } from 'react-native';
import {
  joinSelectionAsSentence,
  splitTextWithTokens,
  tokenAtCharOffset,
} from '@/domain';

function webSelectionIsRange(): boolean {
  if (typeof window === 'undefined') return false;
  const sel = window.getSelection();
  return Boolean(sel && !sel.isCollapsed && (sel.toString()?.length ?? 0) > 0);
}

function clientPoint(event: {
  nativeEvent?: { clientX?: number; clientY?: number; pageX?: number; pageY?: number };
  clientX?: number;
  clientY?: number;
}): { x: number; y: number } | null {
  if (typeof event.clientX === 'number' && typeof event.clientY === 'number') {
    return { x: event.clientX, y: event.clientY };
  }
  const ne = event.nativeEvent;
  if (!ne) return null;
  if (typeof ne.clientX === 'number' && typeof ne.clientY === 'number') {
    return { x: ne.clientX, y: ne.clientY };
  }
  if (typeof ne.pageX === 'number' && typeof ne.pageY === 'number') {
    const scrollX = typeof window !== 'undefined' ? window.scrollX : 0;
    const scrollY = typeof window !== 'undefined' ? window.scrollY : 0;
    return { x: ne.pageX - scrollX, y: ne.pageY - scrollY };
  }
  return null;
}

function charOffsetFromCaret(clientX: number, clientY: number, rootText: string): number | null {
  if (typeof document === 'undefined') return null;
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };

  let node: Node | null = null;
  let offset = 0;
  if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(clientX, clientY);
    if (!range) return null;
    node = range.startContainer;
    offset = range.startOffset;
  } else if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(clientX, clientY);
    if (!pos) return null;
    node = pos.offsetNode;
    offset = pos.offset;
  } else {
    return null;
  }

  if (node.nodeType === Node.TEXT_NODE) {
    const full = node.textContent ?? '';
    if (full === rootText) return Math.min(offset, rootText.length);
    const startInRoot = rootText.indexOf(full);
    if (startInRoot >= 0) return Math.min(startInRoot + offset, rootText.length);
    return Math.min(offset, rootText.length);
  }
  return Math.min(offset, rootText.length);
}

function selectionIsInside(host: EventTarget | null, selected: string): boolean {
  if (!host || typeof window === 'undefined') return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !selected) return false;
  const node = host as Node;
  if (typeof node.contains !== 'function') return false;
  const ancestor = sel.getRangeAt(0).commonAncestorContainer;
  return node === ancestor || node.contains(ancestor);
}

/** Rewrite clipboard text when a selection inside `hostRef` would paste with token newlines. */
export function useWebClipboardJoin(
  hostRef: React.RefObject<unknown>,
  transform: (selected: string) => string
): void {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = hostRef.current as { addEventListener?: EventTarget['addEventListener']; removeEventListener?: EventTarget['removeEventListener'] } | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    const onCopy = (event: Event) => {
      const clipboardEvent = event as ClipboardEvent;
      const selected = window.getSelection()?.toString() ?? '';
      if (!selected || !selectionIsInside(node as EventTarget, selected)) return;
      const next = transform(selected);
      if (!next || next === selected) return;
      clipboardEvent.preventDefault();
      clipboardEvent.clipboardData?.setData('text/plain', next);
    };
    node.addEventListener('copy', onCopy);
    return () => node.removeEventListener?.('copy', onCopy);
  }, [hostRef, transform]);
}

export function TappableSentence({
  text,
  tokens,
  onTokenPress,
  style,
}: {
  text: string;
  tokens: string[];
  onTokenPress: (token: string) => void;
  style?: StyleProp<TextStyle>;
}) {
  const hostRef = useRef<Text>(null);
  const transform = useCallback((selected: string) => joinSelectionAsSentence(selected), []);
  useWebClipboardJoin(hostRef, transform);

  const handleWebClick = (event: {
    nativeEvent?: { clientX?: number; clientY?: number; pageX?: number; pageY?: number };
    clientX?: number;
    clientY?: number;
  }) => {
    if (webSelectionIsRange()) return;
    const point = clientPoint(event);
    if (!point) return;
    const offset = charOffsetFromCaret(point.x, point.y, text);
    if (offset == null) return;
    const token = tokenAtCharOffset(text, tokens, offset);
    if (token) onTokenPress(token);
  };

  if (Platform.OS === 'web') {
    return (
      <Text
        ref={hostRef}
        selectable
        style={[style, { userSelect: 'text' } as TextStyle]}
        {...({ onClick: handleWebClick } as object)}
      >
        {text}
      </Text>
    );
  }

  const pieces = splitTextWithTokens(text, tokens);
  return (
    <Text ref={hostRef} selectable style={style}>
      {pieces.map((piece, index) =>
        piece.kind === 'token' ? (
          <Text
            key={`token-${index}`}
            onPress={() => onTokenPress(piece.value)}
            accessibilityRole="button"
            accessibilityLabel={piece.value}
          >
            {piece.value}
          </Text>
        ) : (
          <Text key={`gap-${index}`}>{piece.value}</Text>
        )
      )}
    </Text>
  );
}
