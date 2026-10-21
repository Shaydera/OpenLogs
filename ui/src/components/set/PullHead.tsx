import type { ReactNode } from 'react';
import type { Seam } from '../../api/types';
import { formatDuration, formatSeconds } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { PULL_CHIP, type PullView } from '../../pulls/groupPulls';
import { seamBoxes } from './seams';

const pullTime = (pull: PullView) => (pull.status === 'aborted' ? formatSeconds(pull.durationMs) : formatDuration(pull.durationMs));

export function PullHead({ pull, count }: { pull: PullView; count?: ReactNode }) {
  return (
    <div className="pull-head">
      <span className="num text-muted">{t('set.pullChip', { n: pull.n })}</span>
      <span className={`chip ${PULL_CHIP[pull.status]}`}>{t(`status.${pull.status}`)}</span>
      <span className="num text-soft">{pullTime(pull)}</span>
      {count !== undefined && <span className="pull-head-count num">{count}</span>}
    </div>
  );
}

/** For narrow pull segments: the number and the result's letter; the full heading is the title and the accessible name. */
export function CompactPullHead({ pull }: { pull: PullView }) {
  const full = t('set.pullHead', { n: pull.n, status: t(`status.${pull.status}`), duration: pullTime(pull) });
  return (
    <div className="pull-head pull-head-compact" title={full}>
      <span className="num text-muted" aria-hidden="true">
        {t('set.pullChip', { n: pull.n })}
      </span>
      <span className={`chip ${PULL_CHIP[pull.status]}`} aria-hidden="true">
        {t(`status.letter.${pull.status}`)}
      </span>
      <span className="sr-only">{full}</span>
    </div>
  );
}

export function SeamRow({ seams, children }: { seams: Seam[]; children: (seam: Seam) => ReactNode }) {
  return (
    <div className="seam-row">
      {seamBoxes(seams).map((box) => (
        <div key={box.fightIndex} className="seam-box" style={{ flex: box.flex }}>
          {children(box)}
        </div>
      ))}
    </div>
  );
}
