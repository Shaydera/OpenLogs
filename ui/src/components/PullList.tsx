import { formatClock, formatDuration, formatInteger, formatKeystoneLevel, formatPercent, formatSeconds } from '../i18n/format';
import { t } from '../i18n/i18n';
import { type BossGroup, type PullStatus, type PullView, RUN_CHIP, type RunView, runChipLabel, runSubtitle, runTimeMs } from '../pulls/groupPulls';
import { BossTile } from './BossTile';

interface Props {
  groups: BossGroup[];
  onOpen: (fightIndex: number) => void;
}

const CHIP: Record<PullStatus, string> = { kill: 'kill', wipe: 'wipe', incomplete: 'wipe', aborted: 'abort' };
const FILL: Record<PullStatus, string> = { kill: 'fill-kill', wipe: 'fill-wipe', incomplete: 'fill-wipe', aborted: 'fill-abort' };

function bestLabel(group: BossGroup): string {
  if (group.killDurationMs !== null) return t('pulls.bestKill', { duration: formatDuration(group.killDurationMs) });
  if (group.bestWipePercent !== null) return t('pulls.bestWipe', { percent: formatPercent(group.bestWipePercent) });
  return t('pulls.noKill');
}

function hpLabel(pull: PullView): string {
  if (pull.status === 'kill') return formatPercent(0);
  return pull.bossHpPercent !== null ? formatPercent(pull.bossHpPercent) : '—';
}

function pullDuration(pull: PullView): string {
  return pull.status === 'aborted' ? formatSeconds(pull.durationMs) : formatDuration(pull.durationMs);
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

function Chevron() {
  return (
    <svg className="chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Column captions of a pull grid; each row names itself, so the captions are hidden from assistive tech. */
function PullHead() {
  return (
    <div className="pull pull-head" aria-hidden="true">
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
export function PullList({ groups, onOpen }: Props) {
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
              <span className={group.killPull !== null ? 'chip kill' : 'chip wipe'}>{bestLabel(group)}</span>
            </div>
            <PullHead />
            {group.pulls.map((pull) => (
              <button
                key={pull.index}
                type="button"
                className="pull"
                aria-label={t('pulls.open', { n: pull.n, boss: group.name })}
                onClick={() => onOpen(pull.index)}
              >
                <span className="num text-muted">#{pull.n}</span>
                <span className={`chip ${CHIP[pull.status]}`}>{t(`status.${pull.status}`)}</span>
                <span className="num">{pullDuration(pull)}</span>
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

interface RunProps {
  runs: RunView[];
  onOpen: (fightIndex: number) => void;
}

/** One card per Mythic+ run, built like a boss card: the first row opens the whole run, the boss pulls follow. */
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
            <PullHead />
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
            {run.pulls.map((pull) => (
              <button
                key={pull.index}
                type="button"
                className="pull"
                aria-label={t('runs.openPull', { boss: pull.name, n: pull.n })}
                onClick={() => onOpen(pull.index)}
              >
                <span className="num text-muted">#{pull.n}</span>
                <span className={`chip ${CHIP[pull.status]}`}>{t(`status.${pull.status}`)}</span>
                <span className="num">{pullDuration(pull)}</span>
                <PullHp pull={pull} name={pull.name} />
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
