// ═══ Token estimation: CJK chars ≈2 tokens each, others ≈0.25 tokens (4 chars/token). Includes thinking content. ═══
export function estimateTokens(msgs: Array<{ text?: string; reasoningContent?: string }>) {
  let tokens = 0;
  for (const m of msgs) {
    if (!m) continue;
    if ((m as any).status === 'running') continue; // skip partial running content
    const combined = (m?.text || '') + (m?.reasoningContent || '');
    for (let i = 0; i < combined.length; i++) {
      const c = combined.charCodeAt(i);
      // CJK Unified (U+4E00-9FFF), CJK Ext A (U+3400-4DBF), Korean (U+AC00-D7AF), Japanese kana (U+3040-30FF)
      tokens += (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF) || (c >= 0xAC00 && c <= 0xD7AF) || (c >= 0x3040 && c <= 0x30FF) ? 2 : 0.25;
    }
  }
  return Math.ceil(tokens);
}
