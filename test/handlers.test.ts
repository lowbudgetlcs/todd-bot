import { describe, it, expect } from 'vitest';
import { getButtonHandler } from '../src/buttons/handlers.ts';

/**
 * Routing is the one step between a click and a handler, and it fails silently:
 * `index.ts` drops a button whose tag has no handler without acknowledging it,
 * so the only symptom is Discord's "This interaction failed" three seconds
 * later. A tag can be registered in TAG_CODES, minted onto a real button, and
 * never routed.
 */

const ROUTED = [
  'generate_another',
  'cancel_switch',
  'generate_another_confirm',
  'switch_sides',
  'confirm',
  'switch',
  'cancel',
  'cancel_flow',
];

describe('getButtonHandler', () => {
  it.each(ROUTED)('routes %s to a handler', tag => {
    expect(getButtonHandler(tag)).toBeTypeOf('function');
  });

  it('returns null for a tag it does not know', () => {
    expect(getButtonHandler('brand_new_tag')).toBeNull();
  });

  it('returns null for end_series, which is retired', () => {
    // The wire code stays reserved in TAG_CODES so a new tag cannot inherit it,
    // but nothing handles it: closing a series is Dennys' job.
    expect(getButtonHandler('end_series')).toBeNull();
  });

  it('sends both aliases of the sides prompt to the same handler', () => {
    expect(getButtonHandler('cancel_switch')).toBe(getButtonHandler('generate_another'));
  });

  it('sends the setup switch and cancel to the same handler', () => {
    expect(getButtonHandler('switch')).toBe(getButtonHandler('cancel'));
  });
});
