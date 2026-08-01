export type SeriesData = {
  team1Id: number;
  team2Id: number;
  divisionId: number;
  enemyCaptainId: string;
  stage: string;
};

/**
 * Field codecs for the button `custom_id` (layout lives in `src/buttons/button.ts`).
 *
 * Discord caps a custom_id at 100 characters and Todd packs the whole series
 * context into one. In decimal that budget was already spent: the longest tag
 * plus two 19-digit snowflakes, three ids and a stage name the length of
 * PROMOTION_RELEGATION comes to exactly 100, so the first four-digit team id
 * would push a live series over and setCustomId would start rejecting it.
 *
 * Base36 is a pure win here - every id is an integer, and 36 values per
 * character take a snowflake from 19 characters to 13 and a team id from 4 to
 * 3. That frees ~30 characters, which all go to the stage name: dennys returns
 * `eventStages` as arbitrary strings, so it is the one field whose length we
 * do not control and the only realistic way to overflow what is left.
 */

// Anything that isn't a plain non-negative integer is stored verbatim behind
// this marker. Base36 output is [0-9a-z]+, so the prefix keeps the two apart.
const LITERAL_PREFIX = '~';

/**
 * Base36 for the small ids (division, teams).
 *
 * The empty string is a real input, not a bug: the select-menu flow seeds
 * `team1Id`/`team2Id` with `''` to mean "not chosen yet". Number('') is 0, so
 * it round-trips to 0 exactly as the old decimal encoding did, which is what
 * the "Not Selected!" checks in tournament.ts read.
 */
export function encodeId(value: number): string {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return '';
  return n.toString(36);
}

export function decodeId(value: string | undefined): number {
  if (!value) return 0;
  // parseInt stops at the first invalid digit, so reject the field outright
  // rather than decoding "12:x" style garbage into a plausible-looking id.
  if (!/^[0-9a-z]+$/.test(value)) return 0;
  const n = parseInt(value, 36);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Base36 for snowflakes, via BigInt - a 19-digit id is past Number.MAX_SAFE_INTEGER,
 * so going through Number would silently round the last digits off a user id.
 */
export function encodeSnowflake(id: string): string {
  if (!id) return '';
  if (!/^\d+$/.test(id)) return LITERAL_PREFIX + id;
  return BigInt(id).toString(36);
}

export function decodeSnowflake(value: string | undefined): string {
  if (!value) return '';
  if (value.startsWith(LITERAL_PREFIX)) return value.slice(LITERAL_PREFIX.length);
  if (!/^[0-9a-z]+$/.test(value)) return value;
  let acc = 0n;
  for (const ch of value) acc = acc * 36n + BigInt(parseInt(ch, 36));
  return acc.toString();
}

export function encodeSeriesData(data: SeriesData): string[] {
  return [
    encodeSnowflake(data.enemyCaptainId),
    encodeId(data.divisionId),
    encodeId(data.team1Id),
    encodeId(data.team2Id),
    data.stage,
  ];
}

export function decodeSeriesData(arr: string[]): SeriesData {
  return {
    enemyCaptainId: decodeSnowflake(arr[0]),
    divisionId: decodeId(arr[1]),
    team1Id: decodeId(arr[2]),
    team2Id: decodeId(arr[3]),
    stage: arr[4] ?? '',
  };
}

// Number('') and Number(undefined) are 0 / NaN, and `?? 0` does NOT catch NaN
// (?? only guards null/undefined). A missing or non-numeric field must fall back
// to 0 rather than silently poisoning SeriesData with NaN.
function toLegacyId(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Reads the pre-base36 decimal layout.
 *
 * Buttons live in Discord messages, not in Todd, so ids minted before this
 * change keep arriving after a redeploy - dropping the old reader would break
 * every series already in flight.
 */
export function decodeLegacySeriesData(arr: string[]): SeriesData {
  return {
    enemyCaptainId: arr[0] ?? '',
    divisionId: toLegacyId(arr[1]),
    team1Id: toLegacyId(arr[2]),
    team2Id: toLegacyId(arr[3]),
    stage: arr[4] ?? '',
  };
}
