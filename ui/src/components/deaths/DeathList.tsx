import { useEffect, useMemo, useRef } from 'react';
import type { DeathRecap, DeathsReport } from '../../api/types';
import { formatEventTime } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import type { PullView } from '../../pulls/groupPulls';
import { replaySplitShown, useApp } from '../../store';
import { GameIcon, MonogramTile } from '../GameIcon';
import { NoMatch } from '../filters/NoMatch';
import { ReportHead } from '../filters/ReportHead';
import { classColor, playerIndex, shortName } from '../overview/players';
import { hitIcon, hitName, reportSpellName, rosterIndex } from '../reports/reportData';
import { deathJumpMs } from '../replay/playback';
import { PullHead } from '../set/PullHead';
import { DeathRecapView } from './DeathRecapView';
import { hitSource } from './recapModel';

/** The deaths of one pull; a single pull's list has one group with `fight` and `pull` `null`. */
export interface DeathGroup {
  fight: number | null;
  pull: PullView | null;
  deaths: DeathRecap[];
}

export interface ListedDeath {
  group: DeathGroup;
  death: DeathRecap;
}

type DeathFocus = { fight: number | null; player: number; t: number };

const sameDeath = (a: ListedDeath, b: DeathFocus) => a.group.fight === b.fight && a.death.player === b.player && a.death.t === b.t;
const keyOf = ({ group, death }: ListedDeath) => `${group.fight}-${death.player}-${death.t}`;

/** The focused death, picked by (pull, player, time): a range change keeps it or falls back to the first. */
export function pickDeath(groups: DeathGroup[], focus: DeathFocus | null): ListedDeath | undefined {
  const listed = groups.flatMap((group) => group.deaths.map((death) => ({ group, death })));
  return (focus && listed.find((entry) => sameDeath(entry, focus))) ?? listed[0];
}

/** Scrolls the list box, not the page, so a death picked elsewhere on the page shows in the list. */
function keepInView(box: HTMLElement, item: HTMLElement) {
  const top = item.offsetTop;
  if (top >= box.scrollTop && top + item.offsetHeight <= box.scrollTop + box.clientHeight) return;
  box.scrollTop = top - (box.clientHeight - item.offsetHeight) / 2;
}

/** The deaths with the selected one's recap; a set's are grouped by pull under the pull's heading. */
export function DeathList({ report, groups }: { report: DeathsReport; groups: DeathGroup[] }) {
  const focus = useApp((s) => s.focusDeath);
  const selectDeath = useApp((s) => s.selectDeath);
  const split = useApp(replaySplitShown);
  const setReplayTime = useApp((s) => s.setReplayTime);
  const range = useApp((s) => s.range);
  const scope = useApp((s) => s.scope);
  const overview = useApp((s) => s.overview);
  const scrollRef = useRef<HTMLDivElement>(null);
  const roster = useMemo(() => new Map([...(overview ? playerIndex(overview) : []), ...rosterIndex(report.roster)]), [overview, report.roster]);
  const inSet = groups.some((group) => group.pull !== null);
  const count = groups.reduce((sum, group) => sum + group.deaths.length, 0);
  const selected = pickDeath(groups, focus);
  const selectedKey = selected ? keyOf(selected) : null;
  useEffect(() => {
    const box = scrollRef.current;
    const item = box?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (box && item) keepInView(box, item);
  }, [selectedKey]);

  const one = scope.target.length === 1 ? scope.target[0] : null;
  const onePlayer = one?.kind === 'player' ? roster.get(one.actorId) : undefined;
  const title = onePlayer ? t('deaths.of', { name: shortName(onePlayer.name) }) : t('recap.all', { count });
  // A set's filter pickers sit on its first panel.
  const head = (id: string, text: string) =>
    inSet ? (
      <div className="panel-head panel-head-list">
        <h2 className="h2" id={id}>
          {text}
        </h2>
      </div>
    ) : (
      <ReportHead tab="deaths" id={id} title={text} />
    );
  if (!selected) {
    return (
      <section className="panel" aria-labelledby="deaths-empty-title">
        {head('deaths-empty-title', onePlayer ? title : t('tabs.deaths'))}
        <NoMatch nothing={t(inSet ? 'deaths.noneInSet' : range ? 'deaths.noneInRange' : 'deaths.none')} />
      </section>
    );
  }
  const spellName = (id: number) => reportSpellName(report.spells, id);
  const replayFrom = (ms: number) => deathJumpMs(ms, range?.startMs);
  // A selected killing-blow source or ability is the same for every death: the line leaves it out.
  const blowText = (kb: NonNullable<DeathRecap['killingBlow']>) =>
    [scope.ability.length === 0 && hitName(kb, spellName), scope.source.length === 0 && hitSource(kb)].filter(Boolean).join(' · ');
  const item = (entry: ListedDeath) => {
    const { group, death } = entry;
    const name = shortName(death.playerName);
    const kb = death.killingBlow;
    const blow = kb ? hitName(kb, spellName) : '';
    const on = keyOf(entry) === selectedKey;
    return (
      <button
        key={keyOf(entry)}
        type="button"
        className={on ? 'dlink dlink-on' : 'dlink'}
        aria-pressed={on}
        onClick={() => {
          selectDeath(death.player, death.t, group.fight);
          if (split) setReplayTime(replayFrom(death.t));
        }}
      >
        <span className="num dlink-time">{formatEventTime(death.t)}</span>
        {kb ? <GameIcon name={blow} icon={hitIcon(kb)} size={22} /> : <MonogramTile name={name} size={22} />}
        <span className="dlink-text">
          {!onePlayer && (
            <span className="dlink-name" style={{ color: classColor(roster.get(death.player)?.classToken ?? null) }} title={name}>
              {name}
            </span>
          )}
          <span className="dlink-blow">{kb ? blowText(kb) : t('deaths.noLethalHit')}</span>
          {split && on && <span className="dlink-replay">{t('replay.at', { time: formatEventTime(replayFrom(death.t)) })}</span>}
        </span>
      </button>
    );
  };
  return (
    <div className="deaths-page">
      <aside className="panel panel-clip deaths-list" aria-labelledby="deaths-list-title">
        {head('deaths-list-title', title)}
        <div role="group" aria-label={title}>
          {inSet ? (
            <div ref={scrollRef} className="dlist-scroll">
              {groups.map(
                (group) =>
                  group.pull &&
                  group.deaths.length > 0 && (
                    <div key={group.fight} role="group" aria-label={t('setDeaths.pull', { n: group.pull.n })}>
                      <div className="dlist-head">
                        <PullHead pull={group.pull} count={t('deaths.count', { count: group.deaths.length })} />
                      </div>
                      {group.deaths.map((death) => item({ group, death }))}
                    </div>
                  ),
              )}
            </div>
          ) : (
            groups.flatMap((group) => group.deaths.map((death) => item({ group, death })))
          )}
        </div>
      </aside>
      <div className="deaths-main">
        <DeathRecapView recap={selected.death} report={report} pull={selected.group.pull} />
      </div>
    </div>
  );
}
