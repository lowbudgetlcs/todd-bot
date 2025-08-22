import log from 'loglevel';

const logger =log.getLogger('playerPointCalculator');
logger.setLevel('info');

const rankMap: Record<string, number> = {
  "I4": 0, "I3": 0, "I2": 0, "I1": 0,        // Iron
  "B4": 0, "B3": 0, "B2": 0, "B1": 0,        // Bronze
  "S4": 1, "S3": 1, "S2": 1, "S1": 1,        // Silver
  "G4": 2, "G3": 2, "G2": 3, "G1": 3,        // Gold
  "P4": 4, "P3": 4, "P2": 5, "P1": 5,        // Platinum
  "E4": 6, "E3": 6, "E2": 7, "E1": 7,        // Emerald
  "D4": 8, "D3": 9, "D2": 10, "D1": 11,      // Diamond
};

export function rankToPoints(rank: string): number {
  const formatted = rank.toUpperCase();

  // Handle Masters and above (M0, M1, M2...)
  if (formatted.startsWith("M")) {
    const lpBand = parseInt(formatted.substring(1)); // number after M
    if (isNaN(lpBand)) throw new Error(`Invalid Masters rank: ${rank}`);
    return 12 + lpBand; // base 12, each +1 for 75 LP band
  }

  // Map Iron–Diamond


  const points = rankMap[formatted];
  if (points === undefined) throw new Error(`Invalid rank: ${rank}`);
  return points;
}
