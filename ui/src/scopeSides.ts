import type { MetricTab } from './store';

export const ownDimension = (tab: MetricTab): 'source' | 'target' => (tab === 'taken' ? 'target' : 'source');
export const otherDimension = (tab: MetricTab): 'source' | 'target' => (tab === 'taken' ? 'source' : 'target');
