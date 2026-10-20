import type { Dimension, ReportView } from './api/types';
import { t } from './i18n/i18n';
import { type FilterTab, SIDES } from './scopeSides';
import type { FightTab } from './store';

/** The views each tab has; the first is its default. */
export const VIEWS: Record<FightTab, ReportView[]> = {
  overview: ['table'],
  damage: ['table', 'timeline', 'events'],
  healing: ['table', 'timeline', 'events'],
  taken: ['table', 'timeline', 'events'],
  deaths: ['table', 'timeline', 'events'],
  casts: ['table', 'timeline', 'events'],
  buffs: ['table', 'timeline', 'events'],
  interrupts: ['table', 'timeline', 'events'],
  resources: ['table', 'timeline'],
  replay: ['table'],
};

/** The view a tab shows: the chosen one where the tab has it, else its table; detail pages are tables. */
export function effectiveView(tab: FightTab, inDetail: boolean, chosen: ReportView): ReportView {
  return !inDetail && VIEWS[tab].includes(chosen) ? chosen : 'table';
}

/** Why a view is not offered, or `undefined` when it is. */
export function unavailableReason(tab: FightTab, inDetail: boolean, inSet: boolean, view: ReportView): string | undefined {
  if (inDetail) return view === 'table' ? undefined : t('view.detailOnly');
  if (inSet && view !== 'table') return t('view.singlePullOnly');
  if (VIEWS[tab].includes(view)) return undefined;
  return t(tab === 'overview' ? 'view.overviewOnly' : 'view.resourcesNoEvents');
}

/** The tab's lane dimension: the user's choice, else the tab's own side. */
export const lanesOf = (lanes: Partial<Record<FilterTab, Dimension>>, tab: FilterTab): Dimension => lanes[tab] ?? SIDES[tab].own;
