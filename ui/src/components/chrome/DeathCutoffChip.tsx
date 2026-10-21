import { formatEventTimeTenths, formatInteger, formatOrdinal } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { cutoffOffered, useApp } from '../../store';

function SkullIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3a8 8 0 0 0-8 8c0 2.6 1.2 4.2 3 5.3V19a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2.7c1.8-1.1 3-2.7 3-5.3a8 8 0 0 0-8-8z" />
      <circle cx="9" cy="11.5" r="1.3" />
      <circle cx="15" cy="11.5" r="1.3" />
      <path d="M10.5 20v-2M13.5 20v-2" />
    </svg>
  );
}

export function DeathCutoffChip() {
  const deathCutoff = useApp((s) => s.deathCutoff);
  const offered = useApp(cutoffOffered);
  const inSet = useApp((s) => s.view.kind === 'set');
  const loaded = useApp((s) => s.overviewCutoff === s.deathCutoff);
  const cutoffMs = useApp((s) => s.overview?.timeline.cutoffMs ?? null);
  const deaths = useApp((s) => s.overview?.timeline.markers.deaths.length ?? 0);
  const setPulls = useApp((s) => s.setPulls);
  const setDeathCutoff = useApp((s) => s.setDeathCutoff);
  if (deathCutoff === null || !offered) return null;
  const nth = formatOrdinal(deathCutoff);
  const cutPulls = setPulls?.filter((p) => p.cutoffMs !== null).length ?? 0;
  const uncut = deaths >= deathCutoff ? 'cutoff.nothingCut' : 'cutoff.notReached';
  return (
    <span className="death-chip">
      <SkullIcon />
      {inSet ? (
        <>
          <span>{t('cutoff.setUntil', { nth })}</span>
          {loaded && <span className="death-chip-time">{t('cutoff.setCut', { cut: formatInteger(cutPulls), count: formatInteger(setPulls?.length ?? 0) })}</span>}
        </>
      ) : !loaded ? (
        <span>{t('cutoff.until', { nth })}</span>
      ) : cutoffMs === null ? (
        <span>{t(uncut, { nth })}</span>
      ) : (
        <>
          <span>{t('cutoff.until', { nth })}</span>
          <span className="death-chip-time">{formatEventTimeTenths(cutoffMs)}</span>
        </>
      )}
      <button type="button" className="death-chip-clear" aria-label={t('cutoff.clear')} onClick={() => void setDeathCutoff(null)}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <path d="M2 2l6 6M8 2l-6 6" />
        </svg>
      </button>
    </span>
  );
}

/** One compared pull: its number, where its death cut it (`null`: nothing cut) and how many players died in it. */
export interface ComparedCut {
  n: number;
  cutoffMs: number | null;
  deaths: number;
}

/** The death cutoff of a pull comparison, read-only: each pull ends at its own death; `pulls` is empty until both are loaded. */
export function ComparisonCutoffChip({ pulls }: { pulls: ComparedCut[] }) {
  const deathCutoff = useApp((s) => (cutoffOffered(s) ? s.deathCutoff : null));
  if (deathCutoff === null) return null;
  const cuts = pulls.map(({ n, cutoffMs, deaths }) =>
    cutoffMs !== null ? t('compare.cutAt', { n, time: formatEventTimeTenths(cutoffMs) }) : t(deaths >= deathCutoff ? 'compare.cutNothing' : 'compare.cutNotReached', { n }),
  );
  return (
    <span className="death-chip death-chip-static">
      <SkullIcon />
      <span>{t('cutoff.until', { nth: formatOrdinal(deathCutoff) })}</span>
      {cuts.length > 0 && <span className="death-chip-time">{cuts.join(' · ')}</span>}
    </span>
  );
}
