import { describe, it, expect } from 'vitest';
import { encodeSeriesData, decodeSeriesData, SeriesData } from '../src/types/toddData.ts';

const sample: SeriesData = {
  enemyCaptainId: '123456789012345678',
  divisionId: 7,
  team1Id: 11,
  team2Id: 22,
  stage: 'Week 1',
};

describe('encodeSeriesData', () => {
  it('emits the five fields in the documented custom_id order', () => {
    // ARCHITECTURE.md: enemyCaptainId : divisionId : team1Id : team2Id : stage
    expect(encodeSeriesData(sample)).toEqual(['123456789012345678', '7', '11', '22', 'Week 1']);
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

describe('decodeSeriesData fallbacks for a truncated array', () => {
  it('defaults a missing stage to an empty string', () => {
    expect(decodeSeriesData(['cap', '1', '2', '3']).stage).toBe('');
  });

  it('defaults missing numeric fields to 0', () => {
    // The code intends `Number(arr[i]) ?? 0` to yield 0 when a field is absent.
    const decoded = decodeSeriesData(['cap']);
    expect(decoded.divisionId).toBe(0);
    expect(decoded.team1Id).toBe(0);
    expect(decoded.team2Id).toBe(0);
  });
});
