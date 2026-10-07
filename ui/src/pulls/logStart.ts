/** `WoWCombatLog-MMDDYY_HHMMSS`, also inside `Archive-WoWCombatLog-…`. */
const FILE_STAMP = /WoWCombatLog-(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/;

/**
 * When the game started writing the log, from its file name (zone-less wall-clock like every log
 * time); `fallback` (the first pull's start) when the name has no valid stamp.
 */
export function logStartMs(fileName: string, fallback: number | null): number | null {
  const match = FILE_STAMP.exec(fileName);
  if (!match) return fallback;
  const [month, day, year, hour, minute, second] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return fallback;
  const ms = Date.UTC(2000 + year, month - 1, day, hour, minute, second);
  // Feb 31 would roll over into March.
  return new Date(ms).getUTCDate() === day ? ms : fallback;
}
