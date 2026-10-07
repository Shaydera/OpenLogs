import { useState } from 'react';
import type { DamageTakenReport } from '../../api/types';
import { formatInteger, formatMillions, formatShare } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { GameIcon } from '../GameIcon';
import { shortName } from '../overview/players';
import { takenBreakdown, takenSource } from './breakdown';
import { RankedHead, RankedRow, ReportHead, SideBreakdown, SideHead } from './ReportParts';
import { barWidth, hitIconUrl, hitName, reportSpellName, rosterIndex } from './reportData';

/**
 * Damage Taken: players ranked, the selected player's damage by ability and source aside, and below
 * the raid-wide list by ability.
 */
export function DamageTakenTab({ report }: { report: DamageTakenReport }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const roster = rosterIndex(report.roster);
  if (report.byPlayer.length === 0 && report.byAbility.length === 0) {
    return (
      <section className="panel panel-pad">
        <h2 className="h2">{t('tabs.damageTaken')}</h2>
        <p className="muted">{t('report.noDamageTaken')}</p>
      </section>
    );
  }
  const selected = report.byPlayer.find((p) => p.player === selectedId) ?? report.byPlayer[0];
  const top = Math.max(0, ...report.byPlayer.map((p) => p.amount));
  const largest = Math.max(0, ...report.byAbility.map((a) => a.amount));
  const spellOf = (id: number) => reportSpellName(report.spells, id);
  const columns = [
    { label: t('report.rank') },
    { label: t('report.player') },
    { label: t('report.damageTaken') },
    { label: t('report.dtps'), end: true },
    { label: t('report.share'), end: true },
  ];

  return (
    <>
      <div className="report-layout">
        <section className="panel report-main" aria-labelledby="taken-title">
          <ReportHead id="taken-title" title={t('tabs.damageTaken')} hint={t('report.takenHint')} />
          <div className="scroll-x">
            <div className="report-rows" role="group" aria-label={t('report.takenByPlayer')}>
              <RankedHead grid="rrow-nodelta" columns={columns} />
              {report.byPlayer.map((p, index) => (
                <RankedRow
                  key={p.player}
                  grid="rrow-nodelta"
                  rank={index + 1}
                  player={roster.get(p.player)}
                  barPct={top > 0 ? (p.amount / top) * 100 : 0}
                  total={<span className="num">{formatMillions(p.amount)}</span>}
                  selected={p.player === selected?.player}
                  onSelect={() => setSelectedId(p.player)}
                >
                  <span className="num rrow-end">{formatMillions(p.perSecond)}</span>
                  <span className="num rrow-share">{formatShare(p.share * 100)}</span>
                </RankedRow>
              ))}
            </div>
          </div>
        </section>
        {selected && (
          <aside className="panel report-side" aria-labelledby="taken-side-title">
            <SideHead
              id="taken-side-title"
              player={roster.get(selected.player)}
              total={selected.amount}
              perSecond={selected.perSecond}
              unit={t('report.dtps')}
            />
            <SideBreakdown
              caption={t('report.takenOf', { name: shortName(roster.get(selected.player)?.name ?? '?') })}
              amountLabel={t('report.damage')}
              rows={takenBreakdown(selected.abilities, { total: selected.amount, spells: report.spells, roster })}
            />
          </aside>
        )}
      </div>
      <section className="panel" aria-labelledby="taken-abilities-title">
        <ReportHead id="taken-abilities-title" title={t('report.takenByAbilityTitle')} />
        <div className="scroll-x">
          <div className="taken-rows" role="table" aria-label={t('report.takenByAbility')}>
            <div role="row" className="taken-row taken-row-head">
              <span role="columnheader" />
              <span role="columnheader" className="cap rrow-cap">
                {t('report.ability')}
              </span>
              <span role="columnheader" className="cap rrow-cap rrow-end">
                {t('report.damage')}
              </span>
              <span role="columnheader" className="cap rrow-cap rrow-end">
                {t('report.absorbed')}
              </span>
              <span role="columnheader" className="cap rrow-cap rrow-end">
                {t('report.hits')}
              </span>
              <span role="columnheader" className="cap rrow-cap rrow-end">
                {t('report.playersHit')}
              </span>
            </div>
            {report.byAbility.map((row) => {
              const spell = hitName(row, spellOf);
              const source = takenSource(row, roster);
              return (
                <div role="row" className="taken-row" key={`${row.spellId}-${row.environmental}-${row.sourceName ?? ''}`}>
                  <span role="cell">
                    <GameIcon name={spell} src={hitIconUrl(row)} />
                  </span>
                  <span role="cell" className="side-cell">
                    <span className="side-label">
                      {spell}
                      <span className="side-note" style={source.color ? { color: source.color } : undefined}>
                        {source.label}
                      </span>
                    </span>
                    <span className="bar bar-thin" aria-hidden="true">
                      <span className="bar-fill-normal" style={{ width: barWidth(largest > 0 ? (row.amount * 100) / largest : 0) }} />
                    </span>
                  </span>
                  <span role="cell" className="num rrow-end">
                    {formatMillions(row.amount)}
                  </span>
                  <span role="cell" className="num rrow-end text-muted">
                    {formatMillions(row.absorbed)}
                  </span>
                  <span role="cell" className="num rrow-end text-muted">
                    {formatInteger(row.hits)}
                  </span>
                  <span role="cell" className="num rrow-end text-muted">
                    {formatInteger(row.playersHit)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
