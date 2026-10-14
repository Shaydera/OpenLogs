import type { BuffShare, PlayerAmount, PlayerRef } from '../../api/types';
import { formatScaled, formatSignedScaled } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { shortName } from '../overview/players';
import { reportSpellName, type SpellNames } from './reportData';

/** A player's total in both Aug modes and the parts the Aug tooltip shows. */
export interface AugSplit {
  /** As logged (Augmented): own and pet damage, or healing + absorbs. */
  own: number;
  supportReceived: number;
  supportGiven: number;
  /** The Evoker's share inside their own events. */
  supportSelf: number;
  supportReceivedFrom: PlayerAmount[];
  supportReceivedByBuff: BuffShare[];
  supportCreditedByBuff: BuffShare[];
}

export type AugMetric = 'damage' | 'healing';
export type TipTone = 'plain' | 'gain' | 'loss';

export interface TipLine {
  label: string;
  value: string;
  tone: TipTone;
  /** The result line under a rule. */
  total: boolean;
  /** A buff's part of the line above it, with the buff's icon. */
  buff?: number;
}

/** The Reattributed total; saturates at zero like the backend's. */
export function reattributedTotal(split: AugSplit): number {
  return Math.max(0, split.own - split.supportReceived + split.supportGiven);
}

/** Reattributed minus Augmented: the Aug Δ column; zero means no tooltip. */
export function augDelta(split: AugSplit): number {
  return reattributedTotal(split) - split.own;
}

export function deltaClass(delta: number): 'delta-gain' | 'delta-loss' | 'delta-none' {
  if (delta > 0) return 'delta-gain';
  return delta < 0 ? 'delta-loss' : 'delta-none';
}

export function toneClass(tone: TipTone): string {
  if (tone === 'gain') return 'delta-gain';
  return tone === 'loss' ? 'delta-loss' : '';
}

const line = (label: string, value: string, tone: TipTone = 'plain', total = false): TipLine => ({ label, value, tone, total });

/**
 * The Aug tooltip lines, each Evoker's lines broken down by buff. An Evoker's
 * credited support includes his own buff share, which is then deducted again — the same total as the
 * backend's, where it cancels out.
 */
export function augTipLines(split: AugSplit, roster: Map<number, PlayerRef>, metric: AugMetric, spells: SpellNames): TipLine[] {
  const healing = metric === 'healing';
  const credited = split.supportGiven + split.supportSelf;
  const first = credited > 0 ? (healing ? 'aug.tipOwnHealing' : 'aug.tipOwn') : healing ? 'aug.tipLoggedHealing' : 'aug.tipLogged';
  const byBuff = (shares: BuffShare[], tone: 'gain' | 'loss'): TipLine[] =>
    shares.map((share) => ({
      ...line(reportSpellName(spells, share.buffId), formatSignedScaled(tone === 'loss' ? -share.amount : share.amount), tone),
      buff: share.buffId,
    }));
  const lines = [line(t(first), formatScaled(split.own))];
  for (const from of split.supportReceivedFrom) {
    lines.push(line(t('aug.tipFrom', { name: shortName(roster.get(from.player)?.name ?? '?') }), formatSignedScaled(-from.amount), 'loss'));
    lines.push(...byBuff(split.supportReceivedByBuff.filter((share) => share.evoker === from.player), 'loss'));
  }
  const named = split.supportReceivedFrom.reduce((sum, from) => sum + from.amount, 0);
  if (split.supportReceived > named) lines.push(line(t('aug.tipFromEvokers'), formatSignedScaled(named - split.supportReceived), 'loss'));
  if (credited > 0) {
    lines.push(line(t('aug.tipCredited'), formatSignedScaled(credited), 'gain'));
    lines.push(...byBuff(split.supportCreditedByBuff, 'gain'));
  }
  if (split.supportSelf > 0) lines.push(line(t('aug.tipOwnShare'), formatSignedScaled(-split.supportSelf), 'loss'));
  lines.push(line(t('aug.reattributed'), formatScaled(reattributedTotal(split)), 'plain', true));
  return lines;
}
