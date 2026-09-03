import type { ImageSourcePropType } from 'react-native';
import { parseStickerId } from '@/domain/chat';

const BUNDLED: Record<string, ImageSourcePropType> = {
  cat: require('../../assets/stickers/cat.png'),
  hand: require('../../assets/stickers/hand.png'),
  slay: require('../../assets/stickers/slay.gif'),
  'savignas-boi': require('../../assets/stickers/savignas-boi.png'),
  'hand-fox': require('../../assets/stickers/hand-fox.png'),
};

export function bundledStickerSource(id: string): ImageSourcePropType | undefined {
  return BUNDLED[id];
}

export function mediaImageSource(url: string): ImageSourcePropType {
  const stickerId = parseStickerId(url);
  if (stickerId && BUNDLED[stickerId]) return BUNDLED[stickerId];
  return { uri: url };
}
