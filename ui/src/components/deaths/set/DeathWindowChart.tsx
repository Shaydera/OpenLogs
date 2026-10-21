import { useId, useMemo, useState } from 'react';
import type { DeathRecap, PlayerRef, Seam, SetDeaths } from '../../../api/types';
import { formatEventTimeTenths, formatInteger, formatSeconds } from '../../../i18n/format';
import { type MessageKey, t } from '../../../i18n/i18n';
import type { PullView } from '../../../pulls/groupPulls';
import { useApp } from '../../../store';
import { ReportHead } from '../../filters/ReportHead';
import { classColor, shortName } from '../../overview/players';
import { hitName, reportSpellName, rosterIndex } from '../../reports/reportData';
import { PullHead, SeamRow } from '../../set/PullHead';
import { deathWindowMs, windowScaleMs, windowTicksMs } from './lifetimeModel';
import type { PullPart } from './SetDeathsPage';

/** A tooltip past this share of its pull opens to the left of the bar. */
const TIP_FLIP_PCT = 55;

const atPct = (value: number, whole: number) => (whole > 0 ? Math.min(100, Math.max(0, (value / whole) * 100)) : 0);

function windowKey(death: DeathRecap): MessageKey {
  if (death.windowFromFullHp) return 'setDeaths.window.fullHp';
  return death.windowStartMs === 0 ? 'setDeaths.window.pullStart' : 'setDeaths.window.revived';
}

/** Pulls back to back on one axis, each as long as it ran. */
function seamsOf(parts: PullPart[]): Seam[] {
  let startMs = 0;
  return parts.map(({ part }) => {
    const seam = { fightIndex: part.fightIndex, startMs, endMs: startMs + part.durationMs };
    startMs = seam.endMs;
    return seam;
  });
}

/** One bar per death at its time in the pull, as tall as the time from the player's last full HP to the death. */
export function DeathWindowChart({ parts, report, selected }: { parts: PullPart[]; report: SetDeaths; selected: DeathRecap | null }) {
  const selectDeath = useApp((s) => s.selectDeath);
  const [tipKey, setTipKey] = useState<string | null>(null);
  const titleId = useId();
  const tipId = useId();
  const roster = useMemo(() => rosterIndex(report.roster), [report.roster]);
  const byFight = useMemo(() => new Map(parts.map((entry) => [entry.part.fightIndex, entry])), [parts]);
  const count = parts.reduce((sum, { part }) => sum + part.deaths.length, 0);
  const scaleMs = windowScaleMs(parts.flatMap(({ part }) => part.deaths.map(deathWindowMs)));
  const ticks = windowTicksMs(scaleMs);
  const spellName = (id: number) => reportSpellName(report.spells, id);

  const box = (seam: Seam) => {
    const entry = byFight.get(seam.fightIndex);
    if (!entry) return null;
    const { part, pull } = entry;
    const keyOf = (death: DeathRecap) => `${part.fightIndex}-${death.player}-${death.t}`;
    const tipped = part.deaths.find((death) => keyOf(death) === tipKey);
    return (
      <>
        <div className="dw-head">
          <PullHead pull={pull} />
        </div>
        <div className="dw-plot">
          {ticks.slice(1).map((ms) => (
            <span key={ms} className="dw-grid" style={{ bottom: `${atPct(ms, scaleMs)}%` }} aria-hidden="true" />
          ))}
          {part.deaths.map((death) => {
            const key = keyOf(death);
            const player = roster.get(death.player);
            const on = death === selected;
            const className = ['dw-bar', !death.windowFromFullHp && 'dw-bar-dim', on && 'dw-bar-on'].filter(Boolean).join(' ');
            return (
              <button
                key={key}
                type="button"
                className={className}
                style={{
                  left: `${atPct(death.t, part.durationMs)}%`,
                  height: `${Math.max(2, atPct(deathWindowMs(death), scaleMs))}%`,
                  background: classColor(player?.classToken ?? null),
                }}
                aria-label={t('setDeaths.bar', {
                  n: pull.n,
                  time: formatEventTimeTenths(death.t),
                  name: shortName(death.playerName),
                  window: formatSeconds(deathWindowMs(death)),
                })}
                aria-pressed={on}
                aria-describedby={key === tipKey ? tipId : undefined}
                onMouseEnter={() => setTipKey(key)}
                onMouseLeave={() => setTipKey(null)}
                onFocus={() => setTipKey(key)}
                onBlur={() => setTipKey(null)}
                onClick={() => selectDeath(death.player, death.t, part.fightIndex)}
              />
            );
          })}
          {tipped && <DeathTip id={tipId} death={tipped} pull={pull} player={roster.get(tipped.player)} durationMs={part.durationMs} spellName={spellName} />}
        </div>
      </>
    );
  };

  return (
    <section className="panel" aria-labelledby={titleId}>
      <ReportHead
        tab="deaths"
        id={titleId}
        title={t('setDeaths.windows')}
        summary={<span className="panel-hint">{t('setDeaths.windowsHint')}</span>}
        tools={<span className="num panel-hint">{t('deaths.count', { count })}</span>}
      />
      <div className="dw-body">
        <div className="num dw-axis" aria-hidden="true">
          {ticks.map((ms) => (
            <span key={ms} style={{ bottom: `${atPct(ms, scaleMs)}%` }}>
              {ms === 0 ? formatInteger(0) : t('unit.seconds', { value: formatInteger(ms / 1000) })}
            </span>
          ))}
        </div>
        <div className="dw-scroll">
          <SeamRow seams={seamsOf(parts)}>{box}</SeamRow>
        </div>
      </div>
    </section>
  );
}

function DeathTip(props: { id: string; death: DeathRecap; pull: PullView; player: PlayerRef | undefined; durationMs: number; spellName: (id: number) => string }) {
  const { id, death, pull, player, durationMs, spellName } = props;
  const kb = death.killingBlow;
  const blow = !kb
    ? t('setDeaths.diesNoBlow')
    : kb.sourceName
      ? t('setDeaths.diesFrom', { source: shortName(kb.sourceName), spell: hitName(kb, spellName) })
      : t('setDeaths.diesFromSpell', { spell: hitName(kb, spellName) });
  const x = atPct(death.t, durationMs);
  const side = x > TIP_FLIP_PCT ? { right: `${100 - x + 1}%` } : { left: `${x + 1}%` };
  return (
    <div role="tooltip" id={id} className="dw-tip" style={side}>
      <span className="num text-muted">{t('setDeaths.tipAt', { n: pull.n, time: formatEventTimeTenths(death.t) })}</span>
      <span>
        <b style={{ color: classColor(player?.classToken ?? null) }}>{shortName(death.playerName)}</b> {blow}
      </span>
      <span className="text-muted">{t(windowKey(death), { window: formatSeconds(deathWindowMs(death)) })}</span>
    </div>
  );
}
