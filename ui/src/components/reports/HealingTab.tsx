import { useId, useState } from 'react';
import type { HealingReport, PlayerHealing } from '../../api/types';
import { formatMillions, formatShare, formatSignedMillions } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { shortName } from '../overview/players';
import { type AugSplit, augDelta, augTipLines, deltaClass } from './augSplit';
import { abilityBreakdown } from './breakdown';
import { RankedPopupView, useRankedTargets } from './rankedTargets';
import { AugSupportList, GivenCallout, RankedHead, RankedRow, RecipientList, ReportHead, SideBreakdown, SideHead } from './ReportParts';
import { ColorBySwitch, type SideView, SideViewSwitch, TOP_TARGETS, TargetBreakdown, TargetLegend, targetRows } from './TargetParts';

const healingSplit = (p: PlayerHealing): AugSplit => ({
  own: p.healing + p.absorbs,
  supportReceived: p.supportReceived,
  supportGiven: p.supportGiven,
  supportSelf: p.supportSelf,
  supportReceivedFrom: p.supportReceivedFrom,
  supportReceivedByBuff: p.supportReceivedByBuff,
  supportCreditedByBuff: p.supportCreditedByBuff,
});

/** Healing: ranked healers with absorbs and overheal, the breakdown aside. */
export function HealingTab({ report }: { report: HealingReport }) {
  const attribution = useApp((s) => s.attribution);
  const showAugDelta = useApp((s) => s.showAugDelta);
  const setShowAugDelta = useApp((s) => s.setShowAugDelta);
  const openPlayer = useApp((s) => s.openPlayer);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sideView, setSideView] = useState<SideView>('abilities');
  const popupId = useId();
  const targets = useRankedTargets(report, 'healing', []);
  const { roster, popup } = targets;

  if (report.players.length === 0) {
    return (
      <section className="panel panel-pad">
        <h2 className="h2">{t('tabs.healing')}</h2>
        <p className="muted">{t('report.noHealing')}</p>
      </section>
    );
  }
  const selected = report.players.find((p) => p.player === selectedId) ?? report.players[0];
  const top = Math.max(0, ...report.players.map((p) => p.total));
  const grid = showAugDelta ? 'rrow-heal' : 'rrow-heal-nodelta';
  const reattributed = attribution === 'reattributed';
  const columns = [
    { label: t('report.rank') },
    { label: t('report.player') },
    { label: t('report.healing') },
    { label: t('report.hps'), end: true },
    { label: t('report.absorbs'), end: true },
    { label: t('report.overheal'), end: true },
    ...(showAugDelta ? [{ label: t('aug.delta'), end: true }] : []),
    { label: t('report.share'), end: true },
  ];

  return (
    <div className="report-layout">
      <section className="panel report-main" aria-labelledby="heal-title" ref={targets.panel}>
        <ReportHead id="heal-title" title={t('tabs.healing')} hint={t(reattributed ? 'aug.hintReattributed' : 'aug.hintAugmentedHealing')}>
          <ColorBySwitch metric="healing" />
          <label className="toggle toggle-sm">
            <input type="checkbox" checked={showAugDelta} onChange={(event) => setShowAugDelta(event.target.checked)} />
            {t('aug.showDelta')}
          </label>
        </ReportHead>
        {targets.colorByTarget && <TargetLegend groups={targets.groups} highlight={targets.highlight} onToggle={targets.toggleHighlight} />}
        <div className="scroll-x">
          <div className="report-rows report-rows-heal" role="group" aria-label={t('report.healingByPlayer')}>
            <RankedHead grid={grid} columns={columns} />
            {report.players.map((p, index) => {
              const delta = augDelta(healingSplit(p));
              const healed = p.healing + p.overheal;
              const barPct = top > 0 ? (p.total / top) * 100 : 0;
              return (
                <RankedRow
                  key={p.player}
                  grid={grid}
                  rank={index + 1}
                  player={roster.get(p.player)}
                  barPct={barPct}
                  fill={targets.fill(p, barPct)}
                  total={targets.total(p, formatMillions(p.total), delta !== 0)}
                  selected={p.player === selected.player}
                  onSelect={() => setSelectedId(p.player)}
                  onPreview={targets.preview(p)}
                  describedBy={popup?.data.player === p.player ? popupId : undefined}
                >
                  <span className="num rrow-end">{formatMillions(p.perSecond)}</span>
                  <span className="num rrow-end">{formatMillions(p.absorbs)}</span>
                  <span className="num rrow-end">{healed > 0 ? formatShare((p.overheal / healed) * 100) : <span className="dash">—</span>}</span>
                  {showAugDelta && <span className={`num rrow-end ${deltaClass(delta)}`}>{formatSignedMillions(delta)}</span>}
                  <span className="num rrow-share">{formatShare(p.share * 100)}</span>
                </RankedRow>
              );
            })}
          </div>
        </div>
        <RankedPopupView
          id={popupId}
          popup={popup}
          report={report}
          metric="healing"
          roster={roster}
          colorOf={targets.colorOf}
          augLines={(p) => augTipLines(healingSplit(p), roster, 'healing', report.spells)}
        />
      </section>
      <aside className="panel report-side" aria-labelledby="heal-side-title">
        <SideHead
          id="heal-side-title"
          player={roster.get(selected.player)}
          total={selected.total}
          perSecond={selected.perSecond}
          unit={t('report.hps')}
          onDetails={() => void openPlayer(selected.player)}
        />
        <SideViewSwitch view={sideView} metric="healing" onChange={setSideView} />
        {sideView === 'targets' ? (
          <TargetBreakdown
            caption={t('targets.healedOf', { name: shortName(roster.get(selected.player)?.name ?? '?') })}
            nameLabel={t('targets.player')}
            amountLabel={t('report.healing')}
            rows={targetRows(selected.targets, { total: selected.total, roster, colorOf: targets.colorOf, top: TOP_TARGETS })}
          />
        ) : (
          <>
            <SideBreakdown
              caption={t('report.abilitiesOf', { name: shortName(roster.get(selected.player)?.name ?? '?') })}
              amountLabel={t('report.healing')}
              rows={abilityBreakdown(selected.abilities, { total: selected.total, spells: report.spells, roster })}
            />
            {reattributed && selected.supportByRecipient.length > 0 && (
              <RecipientList entries={selected.supportByRecipient} base={selected.supportGiven + selected.supportSelf} roster={roster} />
            )}
            {reattributed && selected.supportReceivedByBuff.length > 0 && (
              <AugSupportList shares={selected.supportReceivedByBuff} spells={report.spells} roster={roster} />
            )}
            {!reattributed && selected.supportReceived > 0 && (
              <GivenCallout amount={selected.supportReceived} from={selected.supportReceivedFrom} roster={roster} metric="healing" />
            )}
          </>
        )}
      </aside>
    </div>
  );
}
