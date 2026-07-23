/**
 * JSON and string helpers so API text (team names, stages, etc.) stays valid Unicode
 * for Discord and the rest of the bot.
 */

/**
 * True when every code unit fits in a byte, i.e. the string *could* be UTF-8 bytes
 * that were decoded as Latin-1. Any code point above 0xff means real Unicode
 * survived intact and there is nothing to repair.
 */
function isLatin1Only(s: string): boolean {
  let hasHighByte = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xff) return false;
    if (c >= 0x80) hasHighByte = true;
  }
  // Pure ASCII can't be mojibake, so treat it as "nothing to do".
  return hasHighByte;
}

/**
 * Undo one round of "UTF-8 bytes decoded as Latin-1" (mojibake).
 *
 * Decodes with fatal: true so that anything which isn't a clean UTF-8 byte
 * sequence is left alone. That matters for names that legitimately contain
 * Latin-1 accents: "Café" is [43 61 66 E9], an invalid UTF-8 sequence, so it
 * throws and we return the original rather than corrupting it.
 */
function repairOnce(s: string): string {
  if (!isLatin1Only(s)) return s;
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return s;
  }
}

/**
 * Repairs mojibake across the full UTF-8 range, not just 2-byte sequences.
 *
 * The characters that actually show up in team names are mostly 3- and 4-byte:
 * ’ (E2 80 99 -> "â€™"), – and — (E2 80 9x), ★ (E2 98 85), and emoji (F0 9F ..).
 * Runs a few passes because names occasionally come back double-encoded.
 */
export function repairMisdecodedUtf8(s: string): string {
  if (!s) return s;
  let out = s;
  for (let pass = 0; pass < 3; pass++) {
    const next = repairOnce(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

export function normalizeApiStrings<T>(data: T): T {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') return repairMisdecodedUtf8(data) as T;
  if (Array.isArray(data)) return data.map((x) => normalizeApiStrings(x)) as T;
  if (typeof data === 'object') {
    const o = data as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = normalizeApiStrings(o[k]);
    return out as T;
  }
  return data;
}

export async function parseJsonResponseUtf8<T>(response: Response): Promise<T> {
  const buf = await response.arrayBuffer();
  let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (text.length > 0 && text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text) as T;
}
