import type { PlayerDetail } from '../../api/types';
import { spellIcon } from '../../icons';
import { formatAmount, formatAxisAmount, formatPercent } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { TimeAxis } from '../detail/TimeAxis';
import { GameIcon } from '../GameIcon';
import { classColor, shortName } from '../overview/players';
import { reportSpellName, rosterIndex } from '../reports/reportData';
import { band, intervalList, manaPath, seriesPaths } from './chartGeometry';

const EBON_MIGHT = 395152;

type Band = { leftPct: number; widthPct: number };
const isBand = (b: Band | null): b is Band => b !== null;
const position = (b: Band) => ({ left: `${b.leftPct}%`, width: `${b.widthPct}%` });

export function OverTimeChart({ detail }: { detail: PlayerDetail }) {
  const { startMs, endMs } = detail;
  const healing = detail.metric === 'healing';
  const unit = t(healing ? 'report.hps' : 'report.dps');
  const color = classColor(detail.player.classToken);
  const name = (spellId: number) => reportSpellName(detail.spells, spellId);
  const roster = rosterIndex(detail.roster);
  const paths = seriesPaths(detail.series, detail.seriesStepMs, startMs, endMs);
  const mana = manaPath(detail.mana, detail.seriesStepMs, startMs, endMs, detail.dead);
  const cooldowns = detail.castRows.filter((row) => row.durationMs > 0);
  // A cooldown is drawn over its own buff when the player has one (Arcane Surge casts as 365350 and
  // buffs as 365362); else over its curated duration from each cast.
  const cooldownIntervals = (row: (typeof cooldowns)[number]): [number, number][] => {
    const buff = detail.buffRows.find(
      (b) => b.kind === 'cooldown' && b.source === detail.player.actorId && name(b.spellId) === name(row.spellId),
    );
    return buff ? buff.intervals : row.times.map((time): [number, number] => [time, time + row.durationMs]);
  };
  const cdBands = cooldowns.flatMap((row) => cooldownIntervals(row).map(([a, b]) => band(a, b, startMs, endMs)).filter(isBand));
  const ebonBands = detail.ebonMight.map(([a, b]) => band(a, b, startMs, endMs)).filter(isBand);
  const deadBands = detail.dead.map(([a, b]) => band(a, b, startMs, endMs)).filter(isBand);
  // "Dead · Rebirth by Serrik" at each death inside the range, from the middle of its dead band.
  const deadLabels = detail.deaths.flatMap((death) => {
    // The band's end, not the resurrect: a released Mythic+ player logs none (the backend ends his
    // dead phase when he is alive again or at the next segment).
    const from = Math.max(death.t, startMs);
    const until = detail.dead.find(([a, b]) => a <= from && from < b)?.[1] ?? death.resurrectedAt ?? endMs;
    const at = band(death.t, until, startMs, endMs);
    if (!at) return [];
    const rez = death.resurrectedBy;
    const caster = rez?.source != null ? roster.get(rez.source) : undefined;
    const text = !rez
      ? t('player.dead')
      : caster
        ? t('player.deadRezBy', { spell: name(rez.spellId), name: shortName(caster.name) })
        : t('player.deadRez', { spell: name(rez.spellId) });
    return [{ key: death.t, leftPct: Math.round((at.leftPct + at.widthPct / 2) * 100) / 100, text }];
  });
  const peak = formatAmount(paths.peak);
  const named = (label: string, intervals: [number, number][]) => {
    const list = intervalList(intervals, startMs, endMs);
    return list ? t('chart.intervals', { name: label, list }) : null;
  };
  const manaKnown = detail.mana.filter((value): value is number => value !== null);
  const description = [
    ...cooldowns.map((row) => named(name(row.spellId), cooldownIntervals(row))),
    named(name(EBON_MIGHT), detail.ebonMight),
    named(t('player.dead'), detail.dead),
    manaKnown.length > 0 ? t('player.manaSummary', { from: formatPercent(manaKnown[0]), to: formatPercent(manaKnown[manaKnown.length - 1]) }) : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className="panel chart-panel" id="p-dps" aria-labelledby="player-chart-title">
      <div className="chart-head">
        <h2 id="player-chart-title" tabIndex={-1} className="h2">
          {t(healing ? 'player.healingOverTime' : 'player.damageOverTime')}
        </h2>
        <ul className="chart-legend" aria-label={t('player.legend')}>
          <li className="chart-key">
            <span className="lg-swatch lg-swatch-area" style={{ background: color }} />
            {t('player.perStep', { unit })}
          </li>
          {mana && (
            <li className="chart-key">
              <span className="lg-swatch lg-swatch-line" />
              {t('player.mana')}
            </li>
          )}
          {cooldowns.map((row) => (
            <li key={row.spellId} className="chart-key">
              <GameIcon name={name(row.spellId)} icon={spellIcon(row.spellId)} size={18} />
              {name(row.spellId)}
            </li>
          ))}
          {ebonBands.length > 0 && (
            <li className="chart-key">
              <GameIcon name={name(EBON_MIGHT)} icon={spellIcon(EBON_MIGHT)} size={18} />
              {name(EBON_MIGHT)}
            </li>
          )}
          {deadBands.length > 0 && (
            <li className="chart-key">
              <span className="lg-swatch lg-swatch-dead" />
              {t('player.dead')}
            </li>
          )}
        </ul>
      </div>
      <div className="pchart" role="img" aria-label={t('player.chartLabel', { unit, peak })} aria-describedby={description ? 'player-chart-desc' : undefined}>
        {cdBands.map((b, i) => (
          <div key={`cd-${i}`} className="pc-cd" style={position(b)} />
        ))}
        {deadBands.map((b, i) => (
          <div key={`dead-${i}`} className="pc-dead" style={position(b)} />
        ))}
        <svg viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true">
          {paths.area && <path d={paths.area} className="pc-area" style={{ fill: color }} />}
          {paths.line && <path d={paths.line} className="pc-line" style={{ stroke: color }} />}
          {mana && <path d={mana} className="pc-mana" />}
        </svg>
        {ebonBands.map((b, i) => (
          <div key={`ebon-${i}`} className="pc-ebon" style={position(b)} />
        ))}
        {paths.ceiling > 0 && <span className="pc-peak num">{formatAxisAmount(paths.ceiling)}</span>}
        {deadLabels.map((label) => (
          <span key={label.key} className="pc-dead-label" style={{ left: `calc(${label.leftPct}% + 6px)` }}>
            {label.text}
          </span>
        ))}
      </div>
      {description && (
        <p id="player-chart-desc" className="sr-only">
          {description}
        </p>
      )}
      <TimeAxis startMs={startMs} endMs={endMs} />
    </section>
  );
}
