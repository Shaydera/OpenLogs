import type { ReactNode } from 'react';
import type { Seam } from '../../api/types';
import { formatDuration, formatSeconds } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { PULL_CHIP, type PullView } from '../../pulls/groupPulls';
import { seamBoxes } from './seams';

export function PullHead({ pull, count }: { pull: PullView; count?: ReactNode }) {
  return (
    <div className="pull-head">
      <span className="num text-muted">{t('set.pullChip', { n: pull.n })}</span>
      <span className={`chip ${PULL_CHIP[pull.status]}`}>{t(`status.${pull.status}`)}</span>
      <span className="num text-soft">{pull.status === 'aborted' ? formatSeconds(pull.durationMs) : formatDuration(pull.durationMs)}</span>
      {count !== undefined && <span className="pull-head-count num">{count}</span>}
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
