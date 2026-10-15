import type { Dimension } from '../../api/types';
import { t } from '../../i18n/i18n';
import type { FilterTab } from '../../scopeSides';
import { useApp } from '../../store';
import { GroupMenu } from './GroupMenu';

/** The tab's row groupings; a tab with one grouping or none has no menu. */
export function RowsMenu({ tab, group }: { tab: FilterTab; group: Dimension }) {
  const setGrouping = useApp((s) => s.setGrouping);
  return <GroupMenu tab={tab} caption={t('rows.caption')} value={group} onPick={(dimension) => void setGrouping(dimension)} />;
}
