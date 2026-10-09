import { useId, useState } from 'react';
import type { DamageReport } from '../../api/types';
import { formatMillions, formatShare, formatSignedMillions } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { shortName } from '../overview/players';
import { AugTip, useAugTip } from './AugTip';
import { augDelta, augTipLines, deltaClass } from './augSplit';
import { abilityBreakdown } from './breakdown';
import { GivenCallout, RankedHead, RankedRow, RecipientList, ReportHead, SideBreakdown, SideHead } from './ReportParts';
import { rosterIndex } from './reportData';

/** Damage Done: players ranked by damage, the selected player's breakdown aside. */
export function DamageDoneTab({ report }: { report: DamageReport }) {
  const attribution = useApp((s) => s.attribution);
  const showAugDelta = useApp((s) => s.showAugDelta);
  const setShowAugDelta = useApp((s) => s.setShowAugDelta);
  const openPlayer = useApp((s) => s.openPlayer);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const tipId = useId();
  const { panel, tip, open } = useAugTip(report);
  const roster = rosterIndex(report.roster);

  if (report.players.length === 0) {
    return (
      <section className="panel panel-pad">
        <h2 className="h2">{t('tabs.damageDone')}</h2>
        <p className="muted">{t('report.noDamage')}</p>
      </section>
    );
  }
  const selected = report.players.find((p) => p.player === selectedId) ?? report.players[0];
  const top = Math.max(0, ...report.players.map((p) => p.total));
  const grid = showAugDelta ? undefined : 'rrow-nodelta';
  const reattributed = attribution === 'reattributed';
  const tipPlayer = tip ? report.players.find((p) => p.player === tip.player) : undefined;
  const columns = [
    { label: t('report.rank') },
    { label: t('report.player') },
    { label: t('report.damage') },
    { label: t('report.dps'), end: true },
    ...(showAugDelta ? [{ label: t('aug.delta'), end: true }] : []),
    { label: t('report.share'), end: true },
  ];

  return (
    <div className="report-layout">
      <section className="panel report-main" aria-labelledby="dd-title" ref={panel}>
        <ReportHead id="dd-title" title={t('tabs.damageDone')} hint={t(reattributed ? 'aug.hintReattributed' : 'aug.hintAugmented')}>
          <label className="toggle toggle-sm">
            <input type="checkbox" checked={showAugDelta} onChange={(event) => setShowAugDelta(event.target.checked)} />
            {t('aug.showDelta')}
          </label>
        </ReportHead>
        <div className="scroll-x">
          <div className="report-rows" role="group" aria-label={t('report.damageByPlayer')}>
            <RankedHead grid={grid} columns={columns} />
            {report.players.map((p, index) => {
              const delta = augDelta(p);
              return (
                <RankedRow
                  key={p.player}
                  grid={grid}
                  rank={index + 1}
                  player={roster.get(p.player)}
                  barPct={top > 0 ? (p.total / top) * 100 : 0}
                  total={<span className={delta !== 0 ? 'num dotted' : 'num'}>{formatMillions(p.total)}</span>}
                  selected={p.player === selected.player}
                  onSelect={() => setSelectedId(p.player)}
                  onTip={delta !== 0 ? (row) => open(p.player, row) : undefined}
                  describedBy={tip?.player === p.player ? tipId : undefined}
                >
                  <span className="num rrow-end">{formatMillions(p.perSecond)}</span>
                  {showAugDelta && <span className={`num rrow-end ${deltaClass(delta)}`}>{formatSignedMillions(delta)}</span>}
                  <span className="num rrow-share">{formatShare(p.share * 100)}</span>
                </RankedRow>
              );
            })}
          </div>
        </div>
        {tip && tipPlayer && <AugTip id={tipId} player={roster.get(tip.player)} lines={augTipLines(tipPlayer, roster, 'damage')} top={tip.top} />}
      </section>
      <aside className="panel report-side" aria-labelledby="dd-side-title">
        <SideHead
          id="dd-side-title"
          player={roster.get(selected.player)}
          total={selected.total}
          perSecond={selected.perSecond}
          unit={t('report.dps')}
          onDetails={() => void openPlayer(selected.player)}
        />
        <SideBreakdown
          caption={t('report.abilitiesOf', { name: shortName(roster.get(selected.player)?.name ?? '?') })}
          amountLabel={t('report.damage')}
          rows={abilityBreakdown(selected.abilities, { player: selected.player, total: selected.total, spells: report.spells, roster })}
        />
        {reattributed && selected.supportByRecipient.length > 0 && (
          <RecipientList entries={selected.supportByRecipient} base={selected.supportGiven + selected.supportSelf} roster={roster} />
        )}
        {selected.supportReceived > 0 && (
          <GivenCallout amount={selected.supportReceived} from={selected.supportReceivedFrom} roster={roster} metric="damage" />
        )}
      </aside>
    </div>
  );
}
