import type { ItemAmount, TimelineItem } from '../../api/types';
import { formatDuration, formatEventTimeMs, formatScaled, formatSecondsExact } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import type { ViewNames } from './viewNames';

/** What a mark's card says: what, who → whom, when, how long, how much, and the log lines behind it. */
export interface ItemTip {
  spell: string;
  spellId: number;
  what: string;
  source: string;
  target: string;
  when: string;
  howLong: string;
  howMuch: string | null;
  amountNote: string | null;
  log: { time: string; event: string; extra: string }[];
  /** Lines the card does not list. */
  more: string | null;
}

function howMuch(amount: ItemAmount, source: string): { text: string; note: string | null } {
  const value = formatScaled(amount.amount);
  if (amount.rule === 'hit') return { text: value, note: null };
  if (amount.support !== 0 && amount.support === amount.amount) {
    return { text: t('tl.much.credited', { amount: value, name: source }), note: t('tl.note.untilNext') };
  }
  const kind = t(amount.healing ? 'tl.much.healing' : 'tl.much.damage');
  const text =
    amount.rule === 'whileUp'
      ? t('tl.much.whileUp', { amount: value, kind, count: amount.hits })
      : t('tl.much.hits', { amount: value, kind, count: amount.hits, targets: t('tl.much.targets', { count: amount.targets }) });
  const note = amount.rule === 'untilNextCast' ? t('tl.note.untilNext') : amount.rule === 'bossCast' ? t('tl.note.bossCast') : t('tl.note.whileUp');
  const support = amount.support > 0 ? t('tl.much.support', { amount: formatScaled(amount.support) }) : null;
  return { text: support ? `${text} · ${support}` : text, note };
}

function what(item: TimelineItem, names: ViewNames, boss: boolean): string {
  if (boss) return t(item.endMs !== undefined ? 'tl.what.bossCastTime' : 'tl.what.bossCast');
  switch (item.kind) {
    case 'empowered':
      return t('tl.what.empowered', { stage: item.stage ?? 0 });
    case 'aura':
      return t('tl.what.aura', { name: names.unit(item.source) || t('scope.environment') });
    case 'interrupt':
    case 'dispel':
    case 'steal':
      return t(`tl.what.${item.kind}`, { spell: names.spell(item.spellId) });
    default:
      return t(`tl.what.${item.kind}`);
  }
}

function howLong(item: TimelineItem, names: ViewNames): string {
  const held = item.endMs !== undefined ? formatSecondsExact(item.endMs - item.startMs) : null;
  switch (item.kind) {
    case 'instant':
      return t('tl.long.instant');
    case 'castTime':
      return held ? t('tl.long.castTime', { duration: held }) : '—';
    case 'empowered':
      return held ? t('tl.long.empowered', { duration: held, stage: item.stage ?? 0 }) : '—';
    case 'interrupted': {
      const by = item.by ? t('tl.long.by', { name: names.unit(item.by.actorId), spell: names.spell(item.by.spellId) }) : '';
      return [held ? t('tl.long.interrupted', { duration: held }) : null, by || null].filter(Boolean).join(' · ') || '—';
    }
    case 'noOutcome':
      return t('tl.long.noOutcome');
    case 'rejected':
      return item.reason ? t('tl.long.rejected', { reason: item.reason }) : '—';
    case 'aura':
      return [held, item.stacks !== undefined ? t('tl.long.stacks', { count: item.stacks }) : null].filter(Boolean).join(' · ') || '—';
    case 'death':
      if (item.aliveMs !== undefined) return t('tl.long.alive', { duration: formatDuration(item.aliveMs) });
      if (item.rezzedMs !== undefined) return t('tl.long.rezzed', { time: formatEventTimeMs(item.rezzedMs) });
      return t('tl.long.dead');
    case 'interrupt':
      return item.castStartMs !== undefined ? t('tl.long.into', { duration: formatSecondsExact(item.startMs - item.castStartMs) }) : '—';
    default:
      return '—';
  }
}

/** `boss`: a cast of the context lane above the lanes. */
export function itemTip(item: TimelineItem, names: ViewNames, linesListed: boolean, boss = false): ItemTip {
  const death = item.kind === 'death';
  const source = death ? (item.by ? names.unit(item.by.actorId) : '') : names.unit(item.source);
  const spellId = death ? (item.by?.spellId ?? 0) : item.kind === 'interrupt' || item.kind === 'dispel' || item.kind === 'steal' ? (item.used ?? item.spellId) : item.spellId;
  const at = death && item.endMs !== undefined ? item.endMs : item.startMs;
  const span = !death && item.endMs !== undefined && item.endMs !== item.startMs;
  const much = item.amount ? howMuch(item.amount, source) : null;
  const overkill = item.overkill !== undefined ? t('tl.much.overkill', { amount: formatScaled(item.overkill) }) : null;
  const lines = item.log ?? [];
  const hidden = item.logMore ?? 0;
  return {
    spell: death && !item.by ? t('events.noBlow') : names.spell(spellId),
    spellId,
    what: what(item, names, boss),
    source: source || (death ? '—' : t('scope.environment')),
    target: names.unit(item.target) || t('events.noTarget'),
    when: span ? `${formatEventTimeMs(item.startMs)} → ${formatEventTimeMs(item.endMs ?? item.startMs)}` : formatEventTimeMs(at),
    howLong: howLong(item, names),
    howMuch: much?.text ?? overkill,
    amountNote: much?.note ?? null,
    log: lines.map((line) => ({
      time: formatEventTimeMs(line.t),
      event: line.event,
      extra: [line.stage !== undefined ? t('tl.log.stage', { stage: line.stage }) : null, line.reason ?? null].filter(Boolean).join(' · '),
    })),
    more: hidden === 0 ? null : t(linesListed ? 'tl.log.more' : 'tl.log.zoomIn', { count: hidden }),
  };
}
