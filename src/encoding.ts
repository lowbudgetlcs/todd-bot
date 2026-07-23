/**
 * JSON and string helpers so API text (team names, stages, etc.) stays valid Unicode
 * for Discord and the rest of the bot.
 */

// Latin-1 misread of UTF-8 2-byte sequences (e.g. "JosÃ©" / "cafÃ©" -> proper accents)
const MOJIBAKE_2BYTE_UTF8 = /[\u00c2-\u00df][\u0080-\u00bf]/;

export function repairMisdecodedUtf8(s: string): string {
  if (!s || !MOJIBAKE_2BYTE_UTF8.test(s)) return s;
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  const repaired = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (repaired.includes('\uFFFD') && !s.includes('\uFFFD')) return s;
  return repaired;
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
