import type { GroupedRow } from '../../api/types';
import { formatInteger, formatScaled, formatShare } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import type { ExtraColumn } from './BreakdownPanel';
import { averageHits, directAndTick, directHits, missCount, missShare } from './hitStats';

const dash = <span className="dash">—</span>;

const cell = (text: string | null) => <span className="num rrow-end">{text ?? dash}</span>;

const castsColumn = (): ExtraColumn => ({
  label: t('report.casts'),
  width: 64,
  hasValue: (row) => row.casts > 0,
  render: (row) => cell(row.casts > 0 ? formatInteger(row.casts) : null),
});

const hitsColumn = (): ExtraColumn => ({
  label: t('report.hits'),
  width: 104,
  hasValue: (row) => row.hits > 0,
  render: (row) => {
    const direct = directHits(row);
    return cell(directAndTick(direct > 0 ? formatInteger(direct) : null, row.ticks > 0 ? formatInteger(row.ticks) : null));
  },
});

const avgHitColumn = (): ExtraColumn => ({
  label: t('report.avgHit'),
  width: 140,
  hasValue: (row) => row.hits > 0,
  render: (row) => {
    const { direct, tick } = averageHits(row);
    return cell(directAndTick(direct === null ? null : formatScaled(direct), tick === null ? null : formatScaled(tick)));
  },
});

const missTypes = (row: GroupedRow): string => row.misses.map((miss) => `${formatInteger(miss.count)} ${t(`missType.${miss.type}`)}`).join(' · ');

const missColumn = (): ExtraColumn => ({
  label: t('report.missShare'),
  width: 64,
  hasValue: (row) => missCount(row) > 0,
  render: (row) => {
    const share = missShare(row);
    return share === null ? (
      cell(null)
    ) : (
      <span className="num rrow-end" title={missTypes(row)}>
        {formatShare(share * 100)}
      </span>
    );
  },
});

/** Hits and their average, with casts and misses where the tab's attacks can have them. */
export function hitColumns(attacks: boolean): ExtraColumn[] {
  return attacks ? [castsColumn(), hitsColumn(), avgHitColumn(), missColumn()] : [hitsColumn(), avgHitColumn()];
}
