export type SeriesData = {
  team1Id: number;
  team2Id: number;
  divisionId: number;
  enemyCaptainId: string;
  stage: string;
};

export function encodeSeriesData(data: SeriesData): string[] {
  return [
    data.enemyCaptainId,
    data.divisionId.toString(),
    data.team1Id.toString(),
    data.team2Id.toString(),
    data.stage,
  ];
}

// Number('') and Number(undefined) are 0 / NaN, and `?? 0` does NOT catch NaN
// (?? only guards null/undefined). A missing or non-numeric field must fall back
// to 0 rather than silently poisoning SeriesData with NaN.
function toId(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function decodeSeriesData(arr: string[]): SeriesData {
  return {
    enemyCaptainId: arr[0] ?? '',
    divisionId: toId(arr[1]),
    team1Id: toId(arr[2]),
    team2Id: toId(arr[3]),
    stage: arr[4] ?? '',
  };
}
