# Media

Gigolingo `Media` / `Block` / `Line` / shield UX stays behind `MediaCatalogPort` (still unused on purpose). Chat excerpts can become catalog media later via `toMediaBlock` without rewriting the thread. Deleting catalog media later must not break chat.

## Chat stickers and image send (MVP)

Sendable pictures live on `SourceMessage` as **image messages**, not a second chat kind. `kind` stays `user` | `ai` | `system`. Stickers are images with tighter bubbles:

- `mediaKind: 'sticker' | 'image'`
- Pixel URI on `lines[].imageUrls` (already on Gigolingo-compatible `MessageLine`)
- Bundled stickers persist as `sticker:<id>` so Metro hashes are not required
- Picked photos persist as `data:image/…` URLs in the in-memory repo for this session

One send path: `sourceMessageFromImage` / `stickerMessageFromPack` → `ChatRepository.appendMessage`. Composer text and media both go through `ThreadScreen.send`.

### Default pack (`assets/stickers/`, not `assets/icon.png` or the bot avatar)

Copies only — `assets/icon.png` and `assets/savignas-boi.png` stay the app icon and bot avatar.

| Id | File | What |
| --- | --- | --- |
| `cat` | `assets/stickers/cat.png` | SavignasBoi cat meme |
| `hand` | `assets/stickers/hand.png` | Hand fox/wolf gesture (same pixels as the app icon, copied) |
| `slay` | `assets/stickers/slay.gif` | Slay gif (animated in the bubble) |
| `savignas-boi` / `hand-fox` | aliases of cat / hand | Same pixels; `sticker://` ids from `domain/chatMedia.ts` |

Tray is next to Send. Tapping a tile sends that sticker. Web also has Attach photo (file input). No cloud bucket; Supabase `savigna_messages.lines` jsonb can round-trip `imageUrls` if chat is already on Supabase.

### Translation

`shouldTranslateMessage` is false for stickers and photos. `processOutgoingTranslation` does not call the engine. Birkenbihl recalc skips media. The bubble shows the image (and gif animation), not interlinear text.
