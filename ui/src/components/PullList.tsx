import { useId, useState } from 'react';
import type { PullSet } from '../api/types';
import { formatClock, formatDuration, formatInteger, formatKeystoneLevel, formatPercent } from '../i18n/format';
import { t } from '../i18n/i18n';
import {
  type BossGroup,
  type CombatPullView,
  PULL_CHIP,
  type PullStatus,
  type PullView,
  RUN_CHIP,
  type RunView,
  pullTime,
  pullViewTime,
  runChipLabel,
  runSubtitle,
  runTimeMs,
  spokenCombatName,
} from '../pulls/groupPulls';
import { BossTile } from './BossTile';
import { CombatName } from './CombatName';

interface Props {
  groups: BossGroup[];
  onOpen: (fightIndex: number) => void;
  onOpenSet: (set: PullSet) => void;
}

const FILL: Record<PullStatus, string> = { kill: 'fill-kill', wipe: 'fill-wipe', incomplete: 'fill-wipe', ended: 'fill-abort', aborted: 'fill-abort' };

function bestLabel(group: BossGroup): string {
  if (group.killDurationMs !== null) return t('pulls.bestKill', { duration: formatDuration(group.killDurationMs) });
  if (group.bestWipePercent !== null) return t('pulls.bestWipe', { percent: formatPercent(group.bestWipePercent) });
  return t('pulls.noKill');
}

function hpLabel(pull: PullView): string {
  if (pull.status === 'kill') return formatPercent(0);
  return pull.bossHpPercent !== null ? formatPercent(pull.bossHpPercent) : '—';
}

/** Boss HP at the end of a pull as a bar and a value; inside a run the boss name comes first. */
function PullHp({ pull, name }: { pull: PullView; name?: string }) {
  return (
    <span className="hp">
      {name && <span className="run-boss">{name}</span>}
      <span className="bar" style={{ flex: 1 }}>
        <span className={FILL[pull.status]} style={{ width: `${pull.hpBarPercent}%` }} />
      </span>
      <span className="num hp-value">{hpLabel(pull)}</span>
    </span>
  );
}

function Chevron({ open }: { open?: boolean }) {
  return (
    <svg className={open ? 'chevron chevron-open' : 'chevron'} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SetIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 4h12M2 8h12M2 12h12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Column captions of a pull grid; each row names itself, so the captions are hidden from assistive tech. */
function PullColumns() {
  return (
    <div className="pull pull-columns" aria-hidden="true">
      <span className="cap">{t('pulls.column.pull')}</span>
      <span className="cap">{t('pulls.column.result')}</span>
      <span className="cap">{t('pulls.column.duration')}</span>
      <span className="cap">{t('pulls.column.bossHp')}</span>
      <span className="cap">{t('pulls.column.players')}</span>
      <span className="cap">{t('pulls.column.start')}</span>
      <span />
    </div>
  );
}

/** One boss card per boss and difficulty. */
export function PullList({ groups, onOpen, onOpenSet }: Props) {
  return (
    <>
      {groups.map((group) => {
        const subtitle = [
          group.difficulty,
          t('pulls.count', { count: group.pullCount }),
          group.killPull !== null ? t('pulls.killedOn', { n: group.killPull }) : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <section key={group.key} className="panel boss" aria-label={group.name}>
            <div className="boss-head">
              <BossTile encounterId={group.encounterId} name={group.name} />
              <div className="boss-title">
                <h2 className="boss-name">{group.name}</h2>
                <div className="boss-sub">{subtitle}</div>
              </div>
              {group.sets.length > 0 && (
                <nav className="set-buttons" aria-label={t('pulls.sets', { boss: group.name })}>
                  {group.sets.map(({ set }) => {
                    const label = t(`pulls.set.${set.kind}`);
                    return (
                      <button
                        key={set.kind}
                        type="button"
                        className="set-button"
                        aria-label={t('pulls.openSet', { set: label, boss: group.name, count: set.fights.length })}
                        onClick={() => onOpenSet(set)}
                      >
                        <SetIcon />
                        <span>{label}</span>
                        <span className="num set-count">{formatInteger(set.fights.length)}</span>
                      </button>
                    );
                  })}
                </nav>
              )}
              <span className={group.killPull !== null ? 'chip kill' : 'chip wipe'}>{bestLabel(group)}</span>
            </div>
            <PullColumns />
            {group.pulls.map((pull) => (
              <button
                key={pull.index}
                type="button"
                className="pull"
                aria-label={t('pulls.open', { n: pull.n, boss: group.name })}
                onClick={() => onOpen(pull.index)}
              >
                <span className="num text-muted">#{pull.n}</span>
                <span className={`chip ${PULL_CHIP[pull.status]}`}>{t(`status.${pull.status}`)}</span>
                <span className="num">{pullViewTime(pull)}</span>
                <PullHp pull={pull} />
                <span className="num text-soft">{formatInteger(pull.playerCount)}</span>
                <span className="num text-muted pull-start">{formatClock(pull.startUnixMs)}</span>
                <Chevron />
              </button>
            ))}
          </section>
        );
      })}
    </>
  );
}

function combatPullLabel(pull: CombatPullView): string {
  return t('combat.open', {
    pull: spokenCombatName(pull.name, pull.moreEnemies),
    result: t(`status.${pull.status}`),
    duration: pullTime(pull.durationMs, pull.aborted),
    start: formatClock(pull.startUnixMs),
  });
}

/** The fights outside boss encounters and runs, in log order, in one panel. */
export function CombatPullList({ pulls, onOpen }: { pulls: CombatPullView[]; onOpen: (fightIndex: number) => void }) {
  return (
    <section className="panel boss combat-pulls" aria-label={t('combat.title')}>
      <div className="pull pull-columns" aria-hidden="true">
        <span className="cap">{t('combat.column.enemies')}</span>
        <span className="cap">{t('combat.column.zone')}</span>
        <span className="cap">{t('pulls.column.result')}</span>
        <span className="cap">{t('pulls.column.duration')}</span>
        <span className="cap">{t('pulls.column.players')}</span>
        <span className="cap">{t('pulls.column.start')}</span>
        <span />
      </div>
      {pulls.map((pull) => (
        <button key={pull.index} type="button" className="pull" aria-label={combatPullLabel(pull)} onClick={() => onOpen(pull.index)}>
          <span className="combat-enemies">
            <CombatName name={pull.name} more={pull.moreEnemies} />
          </span>
          <span className="combat-zone">{pull.zone ?? '—'}</span>
          <span className={`chip ${PULL_CHIP[pull.status]}`}>{t(`status.${pull.status}`)}</span>
          <span className="num">{pullTime(pull.durationMs, pull.aborted)}</span>
          <span className="num text-soft">{formatInteger(pull.playerCount)}</span>
          <span className="num text-muted pull-start">{formatClock(pull.startUnixMs)}</span>
          <Chevron />
        </button>
      ))}
    </section>
  );
}

/** Bosses killed of the dungeon's list as a bar and `3/3`; empty and `—` without dungeon data. */
function RunProgress({ run }: { run: RunView }) {
  const bosses = run.bosses;
  const width = bosses !== null && bosses.total > 0 ? (bosses.killed / bosses.total) * 100 : 0;
  const fill = bosses === null ? 'fill-abort' : run.status === 'completed' ? 'fill-kill' : 'fill-wipe';
  return (
    <span className="hp">
      <span className="bar" style={{ flex: 1 }}>
        <span className={fill} style={{ width: `${width}%` }} />
      </span>
      <span className="num hp-value">
        {bosses === null ? '—' : t('runs.bossCount', { killed: formatInteger(bosses.killed), total: formatInteger(bosses.total) })}
      </span>
    </span>
  );
}

function TrashRow({ pull, onOpen }: { pull: CombatPullView; onOpen: (fightIndex: number) => void }) {
  return (
    <button type="button" className="pull pull-trash" aria-label={combatPullLabel(pull)} onClick={() => onOpen(pull.index)}>
      <span />
      <span className={`chip ${PULL_CHIP[pull.status]}`}>{t(`status.${pull.status}`)}</span>
      <span className="num text-muted">{pullTime(pull.durationMs, pull.aborted)}</span>
      <span className="combat-enemies">
        <CombatName name={pull.name} more={pull.moreEnemies} />
      </span>
      <span className="num text-muted">{formatInteger(pull.playerCount)}</span>
      <span className="num text-muted pull-start">{formatClock(pull.startUnixMs)}</span>
      <Chevron />
    </button>
  );
}

/** Two or more combat pulls between two boss pulls of a run, folded into one row that opens to list them. */
function TrashFold({ pulls, onOpen }: { pulls: CombatPullView[]; onOpen: (fightIndex: number) => void }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const label = t('runs.combatPulls', { count: pulls.length });
  return (
    <>
      <button
        type="button"
        className="pull pull-trash pull-fold"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen(!open)}
      >
        <span />
        <span />
        <span />
        <span className="combat-enemies">
          <span className="combat-name">{label}</span>
        </span>
        <span />
        <span className="num text-muted pull-start">{formatClock(pulls[0].startUnixMs)}</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div id={listId}>
          {pulls.map((pull) => (
            <TrashRow key={pull.index} pull={pull} onOpen={onOpen} />
          ))}
        </div>
      )}
    </>
  );
}

interface RunProps {
  runs: RunView[];
  onOpen: (fightIndex: number) => void;
}

/** One card per Mythic+ run, built like a boss card: the first row opens the whole run, the boss pulls and the folded combat pulls follow. */
export function RunCards({ runs, onOpen }: RunProps) {
  return (
    <>
      {runs.map((run) => {
        const level = formatKeystoneLevel(run.keystoneLevel);
        return (
          <section key={run.index} className="panel boss run-card" aria-label={t('runs.heading', { dungeon: run.dungeon, level })}>
            <div className="boss-head">
              <BossTile encounterId={0} name={run.dungeon} />
              <div className="boss-title">
                <div className="boss-name-row">
                  <h2 className="boss-name">{run.dungeon}</h2>
                  <span className="chip chip-key">{level}</span>
                </div>
                <div className="boss-sub">{runSubtitle(run)}</div>
              </div>
              <span className={`chip ${RUN_CHIP[run.status]}`}>{runChipLabel(run)}</span>
            </div>
            <PullColumns />
            <button
              type="button"
              className="pull"
              aria-label={t('runs.open', { dungeon: run.dungeon, level })}
              onClick={() => onOpen(run.index)}
            >
              <span className="cap run-label">{t('runs.run')}</span>
              <span className={`chip ${RUN_CHIP[run.status]}`}>{t(`runs.status.${run.status}`)}</span>
              <span className="num">{formatDuration(runTimeMs(run))}</span>
              <RunProgress run={run} />
              <span className="num text-soft">{formatInteger(run.playerCount)}</span>
              <span className="num text-muted pull-start">{formatClock(run.startUnixMs)}</span>
              <Chevron />
            </button>
            {run.entries.map((entry) =>
              entry.kind === 'trash' ? (
                entry.pulls.length === 1 ? (
                  <TrashRow key={entry.pulls[0].index} pull={entry.pulls[0]} onOpen={onOpen} />
                ) : (
                  <TrashFold key={`trash-after-${entry.after}`} pulls={entry.pulls} onOpen={onOpen} />
                )
              ) : (
                <button
                  key={entry.pull.index}
                  type="button"
                  className="pull"
                  aria-label={t('runs.openPull', { boss: entry.pull.name, n: entry.pull.n })}
                  onClick={() => onOpen(entry.pull.index)}
                >
                  <span className="num text-muted">#{entry.pull.n}</span>
                  <span className={`chip ${PULL_CHIP[entry.pull.status]}`}>{t(`status.${entry.pull.status}`)}</span>
                  <span className="num">{pullViewTime(entry.pull)}</span>
                  <PullHp pull={entry.pull} name={entry.pull.name} />
                  <span className="num text-soft">{formatInteger(entry.pull.playerCount)}</span>
                  <span className="num text-muted pull-start">{formatClock(entry.pull.startUnixMs)}</span>
                  <Chevron />
                </button>
              ),
            )}
          </section>
        );
      })}
    </>
  );
}
