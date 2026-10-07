import { formatClock, formatDuration, formatInteger, formatPercent, formatSeconds } from '../i18n/format';
import { t } from '../i18n/i18n';
import type { BossGroup, PullStatus, PullView } from '../pulls/groupPulls';
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

/** Boss HP at the end of a pull as a bar and a value. */
function PullHp({ pull }: { pull: PullView }) {
  return (
    <span className="hp">
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
