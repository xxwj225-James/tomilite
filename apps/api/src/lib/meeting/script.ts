// ═══ Chinese script: simplified / traditional ═══
//
// whisper.cpp has no notion of simplified vs. traditional. Its whole Chinese
// vocabulary is the single token `<|zh|>`, so `-l zh` means "Chinese" and the
// orthography is the model's own choice. The bundled `base` model chooses
// Traditional for Mandarin audio — measured on a real recording, every character
// came back Traditional, including the ones that differ only in the script
// (認為 / 發布會 / 會不會).
//
// The fix is a post-pass, not a decoding hint. `--prompt` was tried first and it
// does flip the script, but it primes the whole decoder: across four runs of the
// same file it also changed the *words* — the speaker's name came out three
// different ways, none of them the right one — and invented punctuation. A
// deterministic conversion changes the script and nothing else.
//
// Dictionaries come from OpenCC via `opencc-js`, which inlines them (no file
// reads, no network), so this survives esbuild bundling into server.cjs.
import OpenCC from 'opencc-js';

export type TextScript = 'source' | 'simplified' | 'traditional';

/**
 * Simplified by default: the failure this exists to fix is a Mainland Mandarin
 * meeting coming back in Traditional, which is simply wrong. A user who wants
 * Traditional, or who records Taiwanese audio, can say so once in Settings.
 */
export const DEFAULT_TEXT_SCRIPT: TextScript = 'simplified';

/**
 * Only Chinese is converted. A Japanese or English meeting must pass through
 * untouched, and `yue`/`cmn` are the other tags whisper can emit for Chinese.
 */
function isChinese(lang: string): boolean {
  const l = (lang || '').toLowerCase();
  return l.startsWith('zh') || l === 'yue' || l === 'cmn';
}

// Building a converter parses its dictionary, so each direction is built once,
// on the first meeting that needs it — not at import, where it would cost every
// boot including the ones that never transcribe anything.
let toSimplified: ((s: string) => string) | null = null;
let toTraditional: ((s: string) => string) | null = null;

function converter(script: TextScript): (s: string) => string {
  if (script === 'simplified') {
    // `t → cn` is the character-level table on purpose. The `tw`/`twp`/`hk`
    // presets also rewrite Taiwan and Hong Kong *vocabulary* (軟體 → 软件,
    // 計程車 → 出租车), which is a claim about what the speaker said rather than
    // about how it is written. This pass only changes the writing.
    toSimplified ??= OpenCC.Converter({ from: 't', to: 'cn' });
    return toSimplified;
  }
  // `cn → t` generic rather than `tw`: the option says "Traditional", not
  // "Taiwan", so it must not silently pick a region's character variants.
  toTraditional ??= OpenCC.Converter({ from: 'cn', to: 't' });
  return toTraditional;
}

/**
 * Rewrite `text` in the requested script. Returns the input untouched for
 * `source`, for a non-Chinese `lang`, and on any conversion error — a
 * transcript that is merely in the wrong script beats no transcript at all.
 *
 * `lang` should be whisper's *detected* language where available, since with
 * `-l auto` the requested one says nothing.
 */
export function convertScript(text: string, lang: string, script: TextScript): string {
  if (!text || script === 'source' || !isChinese(lang)) return text;
  try {
    return converter(script)(text);
  } catch {
    return text;
  }
}
