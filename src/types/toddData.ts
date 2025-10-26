export type SeriesData = {
    team1Id: number;
    team2Id: number;
    divisionId: number;
    enemyCaptainId: string;
}

export function encodeSeriesData(data: SeriesData): string[] {
  return [
    data.enemyCaptainId,
    data.divisionId.toString(),
    data.team1Id.toString(),
    data.team2Id.toString()
  ];
}

export function decodeSeriesData(arr: string[]): SeriesData {
  return {
    enemyCaptainId: arr[0] ?? "",
    divisionId: Number(arr[1]) ?? 0,
    team1Id: Number(arr[2]) ?? 0,
    team2Id: Number(arr[3]) ?? 0
  };
}