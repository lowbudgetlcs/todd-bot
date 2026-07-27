import { describe, it, expect } from 'vitest';
import {
  repairMisdecodedUtf8,
  normalizeApiStrings,
  parseJsonResponseUtf8,
} from '../src/encoding.ts';

/**
 * Simulate the corruption Todd is designed to undo: UTF-8 bytes that got decoded
 * as Latin-1 upstream. Each UTF-8 byte becomes a single code point 0x00-0xff.
 * This is the *true* Latin-1 (ISO-8859-1) form the repair targets — note it is
 * not the Windows-1252 rendering a human sees (ARCHITECTURE.md#text-encoding).
 */
function mojibake(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

describe('repairMisdecodedUtf8', () => {
  it('repairs a single-round mojibake back to the original character', () => {
    // ’ RIGHT SINGLE QUOTATION MARK (U+2019) = E2 80 99, the example from the docs.
    const original = 'Todd’s Team';
    expect(repairMisdecodedUtf8(mojibake(original))).toBe(original);
  });

  it('repairs 3- and 4-byte sequences (star, em dash, emoji)', () => {
    for (const original of ['★ Stars ★', 'Blue — Red', 'GG 😀']) {
      expect(repairMisdecodedUtf8(mojibake(original))).toBe(original);
    }
  });

  it('undoes double-encoding (names sometimes arrive double-mojibaked)', () => {
    const original = 'Café’s ★'; // forces >1 repair pass
    expect(repairMisdecodedUtf8(mojibake(mojibake(original)))).toBe(original);
  });

  it('leaves a legitimately Latin-1 name alone rather than corrupting it', () => {
    // "Café" as raw bytes is [43 61 66 E9] — not valid UTF-8, so fatal decode
    // throws and the original must survive untouched.
    expect(repairMisdecodedUtf8('Café')).toBe('Café');
  });

  it('leaves pure ASCII untouched (it cannot be mojibake)', () => {
    expect(repairMisdecodedUtf8('Plain Team Name 123')).toBe('Plain Team Name 123');
  });

  it('leaves real surviving Unicode (code points > 0xff) untouched', () => {
    expect(repairMisdecodedUtf8('日本語')).toBe('日本語');
  });

  it('handles empty / falsy input', () => {
    expect(repairMisdecodedUtf8('')).toBe('');
  });
});

describe('normalizeApiStrings', () => {
  it('repairs strings anywhere in a nested structure', () => {
    const input = {
      name: mojibake('Todd’s'),
      nested: { teams: [mojibake('Caf★'), 'Plain'] },
    };
    const out = normalizeApiStrings(input);
    expect(out).toEqual({
      name: 'Todd’s',
      nested: { teams: ['Caf★', 'Plain'] },
    });
  });

  it('preserves non-string leaves (numbers, booleans, null)', () => {
    const input = { id: 42, active: true, missing: null, name: 'x' };
    expect(normalizeApiStrings(input)).toEqual(input);
  });

  it('passes null and undefined through unchanged', () => {
    expect(normalizeApiStrings(null)).toBeNull();
    expect(normalizeApiStrings(undefined)).toBeUndefined();
  });
});

describe('parseJsonResponseUtf8', () => {
  it('decodes a UTF-8 body correctly', async () => {
    const body = new TextEncoder().encode(JSON.stringify({ name: 'Todd’s' }));
    const res = new Response(body);
    await expect(parseJsonResponseUtf8<{ name: string }>(res)).resolves.toEqual({
      name: 'Todd’s',
    });
  });

  it('strips a leading UTF-8 BOM before parsing', async () => {
    const json = new TextEncoder().encode(JSON.stringify({ ok: true }));
    const withBom = new Uint8Array(json.length + 3);
    withBom.set([0xef, 0xbb, 0xbf], 0);
    withBom.set(json, 3);
    const res = new Response(withBom);
    await expect(parseJsonResponseUtf8<{ ok: boolean }>(res)).resolves.toEqual({ ok: true });
  });
});
