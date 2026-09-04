import { describe, expect, it } from 'vitest';
import { iconFontFamilyNames, iconFontsForWeb, waitForWebIconFonts } from './webFonts';

describe('webFonts', () => {
  it('collects icon font family names from vector-icon maps', () => {
    expect(iconFontFamilyNames([{ ionicons: 1 }, { FontAwesome: 2 }])).toEqual([
      'ionicons',
      'FontAwesome',
    ]);
  });

  it('loads icon fonts with block display so Safari does not drop glyphs', () => {
    expect(iconFontsForWeb({ ionicons: 7 })).toEqual({
      ionicons: {
        uri: 7,
        display: 'block',
        testString: String.fromCodePoint(0xf086, 0xf229),
      },
    });
  });

  it('no-ops when document.fonts is missing (native / tests)', async () => {
    await expect(waitForWebIconFonts(['ionicons'])).resolves.toBeUndefined();
  });
});
