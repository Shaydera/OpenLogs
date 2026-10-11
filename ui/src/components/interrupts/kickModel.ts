import type { InterruptsReport } from '../../api/types';

export interface KickPlayer {
  player: number;
  interrupts: number;
  dispels: number;
}

/** Interrupts and dispels per player: most actions first, then most interrupts, then by name. */
export function kickPlayers(report: InterruptsReport, nameOf: (id: number) => string): KickPlayer[] {
  const counts = new Map<number, KickPlayer>();
  const entry = (player: number) => {
    const found = counts.get(player);
    if (found) return found;
    const created = { player, interrupts: 0, dispels: 0 };
    counts.set(player, created);
    return created;
  };
  for (const kick of report.interrupts) entry(kick.player).interrupts += 1;
  for (const dispel of report.dispels) entry(dispel.player).dispels += 1;
  return [...counts.values()].sort(
    (a, b) =>
      b.interrupts + b.dispels - (a.interrupts + a.dispels) ||
      b.interrupts - a.interrupts ||
      nameOf(a.player).localeCompare(nameOf(b.player)),
  );
}

/** The spell interrupted most often; on a tie the one interrupted first. */
export function mostInterrupted(report: InterruptsReport): { spellId: number; count: number } | null {
  const counts = new Map<number, number>();
  for (const kick of report.interrupts) counts.set(kick.interruptedId, (counts.get(kick.interruptedId) ?? 0) + 1);
  let best: { spellId: number; count: number } | null = null;
  for (const [spellId, count] of counts) {
    if (!best || count > best.count) best = { spellId, count };
  }
  return best;
}
