import { describe, it, expect } from 'vitest';
import {
  encodeSeriesData,
  decodeSeriesData,
  decodeLegacySeriesData,
  encodeSnowflake,
  decodeSnowflake,
  encodeId,
  decodeId,
  SeriesData,
} from '../src/types/toddData.ts';

const sample: SeriesData = {
  enemyCaptainId: '123456789012345678',
  divisionId: 7,
  team1Id: 11,
  team2Id: 22,
  seriesId: 756,
  stage: 'Week 1',
};

describe('encodeSeriesData', () => {
  it('emits the fields in the documented custom_id order, base36 encoded', () => {
    // enemyCaptainId : divisionId : team1Id : team2Id : seriesId : stage
    expect(encodeSeriesData(sample)).toEqual([
      encodeSnowflake('123456789012345678'),
      '7',
      'b',
      'm',
      'l0',
      'Week 1',
    ]);
  });

  it('keeps the stage last, so a new field cannot displace it', () => {
    // The stage absorbs the rest of the split, which is the only reason a stage
    // containing a colon survives. Anything appended after it would break that.
    expect(encodeSeriesData(sample).at(-1)).toBe('Week 1');
  });
});

describe('encode/decode round-trip', () => {
  it('recovers the original SeriesData', () => {
    expect(decodeSeriesData(encodeSeriesData(sample))).toEqual(sample);
  });

  it('coerces the numeric fields back to numbers', () => {
    const decoded = decodeSeriesData(encodeSeriesData(sample));
    expect(typeof decoded.divisionId).toBe('number');
    expect(typeof decoded.team1Id).toBe('number');
    expect(typeof decoded.team2Id).toBe('number');
  });
});

describe('snowflake base36', () => {
  it('round-trips a 19-digit id exactly', () => {
    // Past Number.MAX_SAFE_INTEGER, so this is the case that catches a
    // BigInt-free implementation rounding the last digits off a user id.
    const id = '1234567890123456789';
    expect(decodeSnowflake(encodeSnowflake(id))).toBe(id);
  });

  it('is shorter than the decimal form it replaces', () => {
    expect(encodeSnowflake('1234567890123456789').length).toBeLessThanOrEqual(13);
  });

  it('keeps a non-numeric id verbatim rather than mangling it', () => {
    expect(decodeSnowflake(encodeSnowflake('cap'))).toBe('cap');
  });

  it('round-trips the largest snowflake Discord can issue', () => {
    const max = (2n ** 64n - 1n).toString();
    expect(decodeSnowflake(encodeSnowflake(max))).toBe(max);
    expect(encodeSnowflake(max).length).toBeLessThanOrEqual(13);
  });
});

describe('id base36', () => {
  it('round-trips ids well past the four digits that broke the decimal budget', () => {
    for (const n of [0, 1, 9999, 100000, 9999999]) {
      expect(decodeId(encodeId(n))).toBe(n);
    }
  });

  it("treats the flow's empty-string placeholder as 0, like the decimal encoding did", () => {
    // tournament.ts seeds team1Id/team2Id with '' to mean "not chosen yet",
    // and the "Not Selected!" checks downstream read the decoded 0.
    expect(decodeId(encodeId('' as unknown as number))).toBe(0);
    expect(decodeId('')).toBe(0);
  });

  it('rejects a field that is not a whole base36 number instead of parsing a prefix', () => {
    expect(decodeId('12 x')).toBe(0);
    expect(decodeId(undefined)).toBe(0);
  });
});

describe('decodeSeriesData fallbacks for a truncated array', () => {
  it('defaults a missing stage to an empty string', () => {
    expect(decodeSeriesData(['cap', '1', '2', '3', '4']).stage).toBe('');
  });

  it('defaults missing numeric fields to 0', () => {
    const decoded = decodeSeriesData(['cap']);
    expect(decoded.divisionId).toBe(0);
    expect(decoded.team1Id).toBe(0);
    expect(decoded.team2Id).toBe(0);
    expect(decoded.seriesId).toBe(0);
  });
});

describe('legacy decimal decoder', () => {
  it('still reads ids minted before base36', () => {
    // Buttons live in Discord messages, so these keep arriving after a deploy.
    expect(decodeLegacySeriesData(['123456789012345678', '7', '11', '22', 'Week 1'])).toEqual({
      ...sample,
      // Predates the field; the series is resolved from the team pair instead.
      seriesId: 0,
    });
  });
});
