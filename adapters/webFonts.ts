/**
 * expo-font’s web loader skips FontFaceObserver on Safari / iOS, so useFonts()
 * can resolve before the icon TTF is actually usable. Wait on document.fonts
 * or icon glyphs stay blank.
 */

const WAIT_MS = 4000;
/** Private-use glyphs (FontAwesome comments + Ionicons chevron-back) so subset loaders fetch icons. */
const ICON_PROBE = String.fromCodePoint(0xf086, 0xf229);

export function iconFontFamilyNames(fonts: Record<string, unknown>[]): string[] {
  return fonts.flatMap((map) => Object.keys(map));
}

export function iconFontsForWeb(fontMap: Record<string, unknown>): Record<
  string,
  { uri: unknown; display: 'block'; testString: string }
> {
  return Object.fromEntries(
    Object.entries(fontMap).map(([family, uri]) => [
      family,
      { uri, display: 'block' as const, testString: ICON_PROBE },
    ])
  );
}

function fontSpecs(family: string): string[] {
  return [`24px ${family}`, `24px "${family}"`];
}

export async function waitForWebIconFonts(families: string[]): Promise<void> {
  if (typeof document === 'undefined') return;
  const fonts = document.fonts;
  if (!fonts || typeof fonts.load !== 'function') return;

  const unique = [...new Set(families.filter(Boolean))];
  if (!unique.length) return;

  const probes = unique.map((family) => {
    const el = document.createElement('span');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText =
      'position:absolute;left:-9999px;top:0;font-size:24px;visibility:hidden;pointer-events:none;';
    el.style.fontFamily = `"${family}", ${family}`;
    el.textContent = ICON_PROBE;
    document.body?.appendChild(el);
    return el;
  });

  const settle = async () => {
    if (fonts.ready) {
      await Promise.resolve(fonts.ready).catch(() => undefined);
    }
    await Promise.all(
      unique.flatMap((family) =>
        fontSpecs(family).map((spec) => fonts.load(spec, ICON_PROBE).catch(() => undefined))
      )
    );
    if (typeof requestAnimationFrame === 'function') {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    }
  };

  try {
    await Promise.race([
      settle(),
      new Promise<void>((resolve) => setTimeout(resolve, WAIT_MS)),
    ]);
  } finally {
    for (const el of probes) el.remove();
  }
}
