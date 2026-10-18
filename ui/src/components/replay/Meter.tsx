import { type CSSProperties, useState } from 'react';
import type { MeterCategory, MeterData, MeterEntry, MeterRow } from '../../api/types';
import { formatAmount, formatEventTime, formatInteger, formatShare } from '../../i18n/format';
import { type MessageKey, t } from '../../i18n/i18n';
import { spellIcon } from '../../icons';
import { METER_CATEGORIES, METER_WINDOWS, type MeterMode, useApp } from '../../store';
import { GameIcon, MonogramTile } from '../GameIcon';
import { classColor, shortName } from '../overview/players';
import { PlayerIcon } from '../reports/PlayerName';
import { barWidth, hitIcon, hitName, reportSpellName } from '../reports/reportData';
import type { HudIndex } from './hudIndex';
import { HudPanel } from './HudParts';
import { meterSpan, useMeter } from './useMeter';
import { useReplayTime } from './useReplayTime';

const ICON_PX = 16;
const BREAKDOWN_ROWS = 6;

const CATEGORY_LABELS: Record<MeterCategory, MessageKey> = {
  damageDone: 'replay.meterDamageDone',
  healingDone: 'replay.meterHealingDone',
  damageTaken: 'replay.meterDamageTaken',
  healingReceived: 'replay.meterHealingReceived',
  interrupts: 'replay.meterInterrupts',
  dispels: 'replay.meterDispels',
};

const MODE_LABELS: Record<MeterMode, MessageKey> = { cumulative: 'replay.meterCumulative', window: 'replay.meterWindow' };

const isCount = (category: MeterCategory) => category === 'interrupts' || category === 'dispels';
const perSecond = (value: number) => t('replay.perSecond', { value: formatAmount(value) });

interface Shown {
  category: MeterCategory;
  mode: MeterMode;
  durationMs: number;
}

function rowValue(row: MeterRow, shown: Shown): { value: string; rate: string | null } {
  if (isCount(shown.category)) return { value: formatInteger(row.amount), rate: null };
  if (shown.mode === 'window') return { value: perSecond(row.perSecond), rate: null };
  return { value: formatAmount(row.amount), rate: perSecond(row.perSecond) };
}

function entryValue(amount: number, shown: Shown): string {
  if (isCount(shown.category)) return formatInteger(amount);
  if (shown.mode === 'window') return perSecond(shown.durationMs > 0 ? (amount * 1000) / shown.durationMs : 0);
  return formatAmount(amount);
}

function entryKey(entry: MeterEntry): string {
  switch (entry.kind) {
    case 'ability':
      return `a:${entry.spellId}:${entry.actorId}:${entry.rowKind}`;
    case 'spell':
      return `s:${entry.spellId}:${entry.environmental}`;
    case 'unit':
      return `u:${entry.actorId}`;
  }
}

function EntryLabel({ entry, data, hud }: { entry: MeterEntry; data: MeterData; hud: HudIndex }) {
  const spellName = (spellId: number) => reportSpellName(data.spells, spellId);
  if (entry.kind === 'unit') {
    const player = hud.roster.get(entry.actorId);
    if (player)
      return (
        <>
          <PlayerIcon player={player} size={ICON_PX} />
          <span className="hud-meter-entry-name" style={{ color: classColor(player.classToken) }}>
            {shortName(player.name)}
          </span>
        </>
      );
    const name = data.units[String(entry.actorId)] ?? t('report.unknownPlayer');
    return (
      <>
        <MonogramTile name={name} size={ICON_PX} />
        <span className="hud-meter-entry-name">{name}</span>
      </>
    );
  }
  if (entry.kind === 'spell') {
    const name = hitName(entry, spellName);
    return (
      <>
        <GameIcon icon={hitIcon(entry)} size={ICON_PX} name={name} />
        <span className="hud-meter-entry-name">{name}</span>
      </>
    );
  }
  if (entry.rowKind === 'unmatched')
    return (
      <>
        <MonogramTile name="…" size={ICON_PX} />
        <span className="hud-meter-entry-name">{t('report.unmatchedHits')}</span>
      </>
    );
  const name = spellName(entry.spellId);
  const pet = entry.rowKind === 'pet' ? data.units[String(entry.actorId)] : undefined;
  return (
    <>
      <GameIcon icon={spellIcon(entry.spellId)} size={ICON_PX} name={name} />
      <span className="hud-meter-entry-name">
        {name}
        {pet && <span className="hud-meter-entry-note">{shortName(pet)}</span>}
        {entry.rowKind === 'support_given' && <span className="rtag rtag-support">{t('report.supportTag')}</span>}
      </span>
    </>
  );
}

function Breakdown({ name, row, data, hud, shown }: { name: string; row: MeterRow; data: MeterData; hud: HudIndex; shown: Shown }) {
  const [all, setAll] = useState(false);
  const hiddenCount = all ? 0 : Math.max(0, data.breakdown.length - BREAKDOWN_ROWS);
  const entries = hiddenCount > 0 ? data.breakdown.slice(0, BREAKDOWN_ROWS) : data.breakdown;
  return (
    <ul className="hud-meter-breakdown" aria-label={t('replay.meterBreakdown', { name })}>
      {entries.map((entry) => (
        <li key={entryKey(entry)} className="hud-meter-entry">
          <EntryLabel entry={entry} data={data} hud={hud} />
          <span className="num">{entryValue(entry.amount, shown)}</span>
          <span className="num hud-meter-share">{entry.amount > 0 && row.amount > 0 ? formatShare((entry.amount / row.amount) * 100) : ''}</span>
        </li>
      ))}
      {hiddenCount > 0 && (
        <li>
          <button type="button" className="lnk hud-meter-more" onClick={() => setAll(true)}>
            {t('replay.meterMore', { count: hiddenCount })}
          </button>
        </li>
      )}
    </ul>
  );
}

function Segments<T extends string | number>({ label, options, value, text, onPick }: { label: string; options: readonly T[]; value: T; text: (option: T) => string; onPick: (option: T) => void }) {
  return (
    <div className="replay-seg hud-meter-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option} type="button" className={option === value ? 'on' : undefined} aria-pressed={option === value} onClick={() => onPick(option)}>
          {text(option)}
        </button>
      ))}
    </div>
  );
}

type Bounds = { startMs: number; endMs: number };

/**
 * Top left: the players by amount for the span up to the replay time, whole range or a trailing window.
 * A row click selects the player and opens their breakdown; a second click on it closes it again.
 */
export function Meter({ hud, bounds, defaultCollapsed = false }: { hud: HudIndex; bounds: Bounds; defaultCollapsed?: boolean }) {
  return (
    <HudPanel label={t('replay.meter')} className="hud-meter" defaultCollapsed={defaultCollapsed}>
      <MeterBody hud={hud} bounds={bounds} />
    </HudPanel>
  );
}

function MeterBody({ hud, bounds }: { hud: HudIndex; bounds: Bounds }) {
  const fightIndex = useApp((s) => (s.view.kind === 'fight' ? s.view.fightIndex : null));
  const time = useReplayTime();
  const selected = useApp((s) => s.replay.selected);
  const settings = useApp((s) => s.replay.meter);
  const setReplayMeter = useApp((s) => s.setReplayMeter);
  const selectReplayUnit = useApp((s) => s.selectReplayUnit);
  const [closed, setClosed] = useState(false);
  const [closedFor, setClosedFor] = useState(selected);
  if (closedFor !== selected) {
    setClosedFor(selected);
    setClosed(false);
  }
  const expand = selected !== null && hud.roster.has(selected) && !closed ? selected : null;
  const { data } = useMeter(fightIndex, bounds, expand);
  const span = meterSpan(bounds, time, settings.mode, settings.windowMs);
  const rows = span.endMs > span.startMs ? (data?.rows ?? null) : [];
  const shown: Shown = { category: settings.category, mode: settings.mode, durationMs: data?.durationMs ?? 0 };
  const top = rows?.[0]?.amount ?? 0;

  return (
    <>
      <div className="hud-meter-head">
        <select
          className="hud-meter-category"
          aria-label={t('replay.meterCategory')}
          value={settings.category}
          onChange={(event) => setReplayMeter({ category: event.target.value as MeterCategory })}
        >
          {METER_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {t(CATEGORY_LABELS[category])}
            </option>
          ))}
        </select>
        <div className="hud-meter-modes">
          <Segments<MeterMode>
            label={t('replay.meterMode')}
            options={['cumulative', 'window']}
            value={settings.mode}
            text={(mode) => t(MODE_LABELS[mode])}
            onPick={(mode) => setReplayMeter({ mode })}
          />
          {settings.mode === 'window' && (
            <Segments
              label={t('replay.meterWindowLength')}
              options={METER_WINDOWS}
              value={settings.windowMs}
              text={(windowMs) => t('replay.meterSeconds', { value: windowMs / 1000 })}
              onPick={(windowMs) => setReplayMeter({ windowMs })}
            />
          )}
          <span className="num hud-meter-span">{t('replay.meterSpan', { from: formatEventTime(span.startMs), to: formatEventTime(span.endMs) })}</span>
        </div>
      </div>
      {rows !== null && rows.length === 0 && <p className="hud-meter-empty">{t('replay.meterEmpty')}</p>}
      {rows !== null && rows.length > 0 && data && (
        <ol className="hud-meter-rows" aria-label={t('replay.players')}>
          {rows.map((row) => {
            const player = hud.roster.get(row.player);
            const name = player ? shortName(player.name) : t('report.unknownPlayer');
            const open = row.player === expand;
            const { value, rate } = rowValue(row, shown);
            const color = { '--meter-color': classColor(player?.classToken ?? null) } as CSSProperties;
            return (
              <li key={row.player}>
                <button
                  type="button"
                  className={row.player === selected ? 'hud-meter-row on' : 'hud-meter-row'}
                  style={color}
                  aria-expanded={open}
                  onClick={() => (row.player === selected ? setClosed(!closed) : selectReplayUnit(row.player))}
                >
                  <span className="hud-meter-fill" style={{ width: barWidth(top > 0 ? (row.amount / top) * 100 : 0) }} aria-hidden="true" />
                  <span className="hud-meter-name">
                    <span className="hud-meter-dot" aria-hidden="true" />
                    <span>{name}</span>
                  </span>
                  <span className="num hud-meter-value">
                    {value}
                    {rate && <span className="hud-meter-rate">{rate}</span>}
                  </span>
                </button>
                {open && data.breakdown.length > 0 && <Breakdown name={name} row={row} data={data} hud={hud} shown={shown} />}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
