import { describe, it, expect } from 'vitest';
import { createButtonData, parseButtonData } from '../src/buttons/button.ts';
import { SeriesData } from '../src/types/toddData.ts';

const seriesData: SeriesData = {
  enemyCaptainId: '223456789012345678',
  divisionId: 7,
  team1Id: 11,
  team2Id: 22,
  stage: 'Week 1',
};

describe('custom_id serialize/parse round-trip', () => {
  it('recovers tag, originalUserId and seriesData', () => {
    const data = createButtonData('confirm', '123456789012345678', seriesData);
    const parsed = parseButtonData(data.serialize());
    expect(parsed.tag).toBe('confirm');
    expect(parsed.originalUserId).toBe('123456789012345678');
    expect(parsed.seriesData).toEqual(seriesData);
  });

  it('serializes in the documented field order', () => {
    // tag : originalUserId : enemyCaptainId : divisionId : team1Id : team2Id : stage
    const data = createButtonData('switch_sides', 'orig', seriesData);
    expect(data.serialize()).toBe('switch_sides:orig:223456789012345678:7:11:22:Week 1');
  });

  it("stays within Discord's 100-character custom_id cap for realistic input", () => {
    const data = createButtonData('generate_another', '123456789012345678', seriesData);
    expect(data.serialize().length).toBeLessThanOrEqual(100);
  });
});

describe('the colon-in-stage caveat (documented limitation)', () => {
  it('corrupts fields when a stage name contains a colon', () => {
    // ARCHITECTURE.md / TROUBLESHOOTING.md: nothing in the id may contain ':'.
    // A stage like "Week 1: Opener" shifts every field after it. This test pins
    // that known behavior so anyone adding colon escaping notices the change.
    const data = createButtonData('confirm', 'orig', { ...seriesData, stage: 'Week 1: Opener' });
    const parsed = parseButtonData(data.serialize());
    expect(parsed.seriesData.stage).not.toBe('Week 1: Opener');
    expect(parsed.seriesData.stage).toBe('Week 1');
  });
});
