# Appearance

SavignaLearn ships **Rosa** as the default look (rose / blush). **Orange** is the previous ember–coral palette and stays selectable in **Settings → Appearance**.

System light/dark still follows the OS. Appearance only swaps the hue pack.

## Persistence

Choice is stored on-device as `savigna.appearanceTheme.v1` (`rosa` | `orange`). Missing or unknown values fall back to Rosa. Switching a tile saves immediately.

## Wiring

- Palettes: `constants/Colors.ts` (`APPEARANCE_THEMES`, `DEFAULT_APPEARANCE_THEME`)
- Load/save: `adapters/appearance.ts`
- Provider + Settings tiles: `features/shell/AppearanceProvider.tsx`
- Screens read `useAppearance()` / `useThemeColors(scheme)` so gradients, bubbles, and CTAs follow the active pack

Do not hardcode ember/coral hex in UI; use the active pack.
