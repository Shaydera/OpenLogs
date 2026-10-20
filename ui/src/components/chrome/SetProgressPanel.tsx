import { useId } from 'react';
import type { FightRow, SetProgress } from '../../api/types';
import { t } from '../../i18n/i18n';
import { pullView } from '../../pulls/groupPulls';
import { useApp } from '../../store';

const chipState = (at: number, done: number) => (at < done ? 'done' : at === done ? 'current' : 'pending');

/** The pass over a set's pulls while nothing of it shows yet: how far it is, each pull's state and a way out. */
export function SetProgressPanel({ progress, fights, pulls }: { progress: SetProgress; fights: FightRow[]; pulls: number[] }) {
  const cancelSet = useApp((s) => s.cancelSet);
  const titleId = useId();
  const { done, total } = progress;
  const text = t('set.progress', { done, total });
  return (
    <section className="panel set-progress" aria-labelledby={titleId}>
      <div className="set-progress-head">
        <h2 id={titleId} className="set-progress-title">
          {t('set.reading')}
        </h2>
        <span className="num muted">{text}</span>
        <button type="button" className="btn set-progress-cancel" onClick={cancelSet}>
          {t('set.cancel')}
        </button>
      </div>
      <div className="bar" role="progressbar" aria-labelledby={titleId} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-valuetext={text}>
        <span className="set-progress-fill" style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }} />
      </div>
      <ol className="set-progress-pulls" aria-hidden="true">
        {pulls.map((index, at) => (
          <li key={index} className={`set-progress-pull set-progress-${chipState(at, done)}`}>
            {t('set.pullChip', { n: pullView(fights, index)?.n ?? index })}
          </li>
        ))}
      </ol>
    </section>
  );
}
