import { type InterruptsReport, type SetInterrupts, isSetReport } from '../../api/types';

type KickLists = Pick<InterruptsReport, 'interrupts' | 'dispels' | 'missed'>;

export type KickTotals = ReturnType<typeof kickTotals>;

/** How many interrupts, dispels and missed casts a report lists; a set lists them in its pulls. */
export function kickTotals(report: InterruptsReport | SetInterrupts) {
  const lists: KickLists[] = isSetReport(report) ? report.pulls : [report];
  const total = (pick: (lists: KickLists) => unknown[]) => lists.reduce((sum, entry) => sum + pick(entry).length, 0);
  return { interrupts: total((l) => l.interrupts), dispels: total((l) => l.dispels), missed: total((l) => l.missed) };
}
