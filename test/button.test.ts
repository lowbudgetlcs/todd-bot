import { describe, it, expect } from 'vitest';
import {
  createButtonData,
  parseButtonData,
  seriesDataFits,
  CustomIdTooLongError,
  MAX_CUSTOM_ID_LENGTH,
} from '../src/buttons/button.ts';
import { SeriesData } from '../src/types/toddData.ts';

const seriesData: SeriesData = {
  enemyCaptainId: '223456789012345678',
  divisionId: 7,
  team1Id: 11,
  team2Id: 22,
  seriesId: 756,
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

  it('serializes in the documented field order behind a version marker', () => {
    // tag : v1 : originalUserId : enemyCaptainId : divisionId : team1Id : team2Id
    //     : seriesId : stage
    const data = createButtonData('switch_sides', '123456789012345678', seriesData);
    const parts = data.serialize().split(':');
    expect(parts[0]).toBe('ws');
    expect(parts[1]).toBe('v1');
    expect(parts.slice(2, 8).every((p) => /^[0-9a-z~]*$/.test(p))).toBe(true);
    expect(parts[8]).toBe('Week 1');
  });
});

describe('tag wire codes', () => {
  // The tag was the biggest field in the id: 24 of 100 characters for a value
  // with thirteen possibilities.
  const tags = [
    'division_select', 'team1_select', 'team2_select', 'stage_select',
    'confirm', 'switch', 'switch_sides', 'cancel', 'cancel_flow',
    'cancel_switch', 'generate_another', 'generate_another_confirm', 'end_series',
  ];

  it('round-trips every tag back to the readable name handlers.ts switches on', () => {
    for (const tag of tags) {
      const data = createButtonData(tag, '123456789012345678', seriesData);
      expect(parseButtonData(data.serialize()).tag).toBe(tag);
    }
  });

  it('puts a short code on the wire, never the full name', () => {
    for (const tag of tags) {
      const code = createButtonData(tag, '123456789012345678', seriesData).serialize().split(':')[0];
      expect(code.length).toBeLessThanOrEqual(2);
    }
  });

  it('assigns no two tags the same code', () => {
    const codes = tags.map(
      (tag) => createButtonData(tag, '1', seriesData).serialize().split(':')[0],
    );
    expect(new Set(codes).size).toBe(tags.length);
  });

  it('passes an unregistered tag through so it still routes', () => {
    const data = createButtonData('brand_new_tag', '123456789012345678', seriesData);
    expect(parseButtonData(data.serialize()).tag).toBe('brand_new_tag');
  });
});

describe("Discord's 100-character custom_id cap", () => {
  // The case from review: the longest tag, two 19-digit snowflakes, three ids
  // and the longest stage name dennys currently returns. In decimal this came
  // to exactly 100, so any four-digit team id tipped a live series over.
  const worstCase: SeriesData = {
    enemyCaptainId: '1234567890123456789',
    divisionId: 9999,
    team1Id: 9999,
    team2Id: 9999,
    seriesId: 9999,
    stage: 'PROMOTION_RELEGATION',
  };

  it('leaves room to spare on the worst case that used to sit exactly at the limit', () => {
    const data = createButtonData('generate_another_confirm', '1234567890123456789', worstCase);
    expect(data.serialize().length).toBeLessThan(MAX_CUSTOM_ID_LENGTH);
  });

  it('keeps headroom for another field beyond the ones already carried', () => {
    // Pinning the number means the next field can be judged against a fact
    // rather than an estimate. A base36 id plus its separator is ~5 characters.
    const data = createButtonData('generate_another_confirm', '1234567890123456789', worstCase);
    expect(MAX_CUSTOM_ID_LENGTH - data.serialize().length).toBeGreaterThanOrEqual(20);
  });

  it('still fits with ids an order of magnitude larger than today', () => {
    const data = createButtonData('generate_another_confirm', '1234567890123456789', {
      ...worstCase,
      divisionId: 9999999,
      team1Id: 9999999,
      team2Id: 9999999,
    });
    expect(data.serialize().length).toBeLessThanOrEqual(MAX_CUSTOM_ID_LENGTH);
  });

  it('throws a named error instead of letting discord.js reject the form body', () => {
    const data = createButtonData('generate_another_confirm', '1234567890123456789', {
      ...worstCase,
      stage: 'X'.repeat(80),
    });
    expect(() => data.serialize()).toThrow(CustomIdTooLongError);
  });

  it('fits a stage name of 52 characters alongside everything else', () => {
    // Dennys hands us eventStages as free-form strings, so this is the budget
    // that actually matters. 'PROMOTION_RELEGATION' is 20.
    const data = createButtonData('generate_another_confirm', '1234567890123456789', {
      ...worstCase,
      stage: 'X'.repeat(52),
    });
    expect(data.serialize().length).toBeLessThanOrEqual(MAX_CUSTOM_ID_LENGTH);
  });
});

describe('seriesDataFits', () => {
  it('accepts a realistic series', () => {
    expect(seriesDataFits('123456789012345678', seriesData)).toBe(true);
  });

  it('rejects a stage name that would only overflow at a later, longer tag', () => {
    // Sized against the longest code on purpose: a stage can fit inside
    // 's' (stage_select) and still blow up inside 'gc'
    // (generate_another_confirm), which is built after the game exists.
    // Abbreviating the tags narrowed that window from 12 characters to 1, so
    // this pins the exact boundary rather than a comfortable margin.
    const stage = 'X'.repeat(53);
    const user = '1234567890123456789';
    const worst = { ...seriesData, enemyCaptainId: user, divisionId: 9999, team1Id: 9999, team2Id: 9999, seriesId: 9999, stage };
    const short = createButtonData('stage_select', user, worst);
    expect(short.serialize().length).toBeLessThanOrEqual(MAX_CUSTOM_ID_LENGTH);
    expect(seriesDataFits(user, worst)).toBe(false);
    expect(seriesDataFits(user, { ...worst, stage: 'X'.repeat(52) })).toBe(true);
  });
});

describe('a stage name containing a colon', () => {
  it('survives the round-trip now that the stage absorbs the rest of the split', () => {
    // Was a documented corruption: "Week 1: Opener" shifted every field after it.
    const data = createButtonData('confirm', '123456789012345678', {
      ...seriesData,
      stage: 'Week 1: Opener',
    });
    const parsed = parseButtonData(data.serialize());
    expect(parsed.seriesData.stage).toBe('Week 1: Opener');
    expect(parsed.seriesData.team2Id).toBe(22);
  });
});

describe('ids minted before base36', () => {
  it('still parses, so buttons already sitting in Discord keep working', () => {
    const legacy = 'generate_another:123456789012345678:223456789012345678:7:11:22:Week 1';
    const parsed = parseButtonData(legacy);
    expect(parsed.tag).toBe('generate_another');
    expect(parsed.originalUserId).toBe('123456789012345678');
    // Predates seriesId, so it decodes unpinned and the series is resolved from
    // the team pair as it always was for these ids.
    expect(parsed.seriesData).toEqual({ ...seriesData, seriesId: 0 });
  });

  it('re-serializes verbatim rather than rewriting the id under the user', () => {
    const legacy = 'generate_another:123456789012345678:223456789012345678:7:11:22:Week 1';
    expect(parseButtonData(legacy).serialize()).toBe(legacy);
  });
});
