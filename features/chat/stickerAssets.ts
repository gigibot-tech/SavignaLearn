import type { ImageSourcePropType } from 'react-native';
import { parseStickerId } from '@/domain/chat';

const BUNDLED: Record<string, ImageSourcePropType> = {
  cat: require('../../assets/stickers/cat.png'),
  hand: require('../../assets/stickers/hand.png'),
  slay: require('../../assets/stickers/slay.gif'),
};

export function bundledStickerSource(id: string): ImageSourcePropType | undefined {
  return BUNDLED[id];
}

export function mediaImageSource(url: string): ImageSourcePropType {
  const stickerId = parseStickerId(url);
  if (stickerId && BUNDLED[stickerId]) return BUNDLED[stickerId];
  return { uri: url };
}
