import { useId } from 'react';
import { t } from '../i18n/i18n';
import { LOG_CRACK, LOG_OUTLINE, LOG_PITH, LOG_RING, LOG_WOOD } from './logoGeometry';

/** The log at text size: bark, wood, growth ring, pith and the chart-line crack opening the bark. */
function LogO() {
  // Inline SVG ids are document-wide: each logo needs its own mask and clip path.
  const id = useId().replace(/[^\w-]/g, '');
  return (
    <svg className="wm-glyph wm-log" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <mask id={`${id}-cut`}>
          <rect className="wm-mask-keep" width="100" height="100" />
          <path className="wm-mask-cut" d={LOG_CRACK} />
          <path className="wm-mask-keep" d={LOG_OUTLINE} transform={LOG_WOOD} />
        </mask>
        <clipPath id={`${id}-wood`}>
          <path d={LOG_OUTLINE} transform={LOG_WOOD} />
        </clipPath>
      </defs>
      <g mask={`url(#${id}-cut)`}>
        <path className="wm-bark" d={LOG_OUTLINE} />
        <path className="wm-wood" d={LOG_OUTLINE} transform={LOG_WOOD} />
        <path className="wm-ink" d={LOG_RING} fillRule="evenodd" />
        <circle className="wm-ink" {...LOG_PITH} />
        <path className="wm-ink" d={LOG_CRACK} clipPath={`url(#${id}-wood)`} />
      </g>
    </svg>
  );
}

/** The beaver: the Fraunces "o" with ears, eyes, nose and two teeth, all in the letter colour. */
function BeaverO() {
  const id = useId().replace(/[^\w-]/g, '');
  return (
    <svg className="wm-glyph wm-beaver" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <mask id={`${id}-counter`}>
          <rect className="wm-mask-keep" width="100" height="100" />
          <ellipse className="wm-mask-cut" cx="50" cy="54" rx="26" ry="29" transform="rotate(-14 50 54)" />
        </mask>
      </defs>
      <circle className="wm-letter" cx="26" cy="18" r="9" />
      <circle className="wm-letter" cx="74" cy="18" r="9" />
      <ellipse className="wm-letter" cx="50" cy="54" rx="44" ry="42" mask={`url(#${id}-counter)`} />
      <circle className="wm-letter" cx="40" cy="46" r="4" />
      <circle className="wm-letter" cx="60" cy="46" r="4" />
      <ellipse className="wm-letter" cx="50" cy="60" rx="7" ry="5" />
      <rect className="wm-letter" x="42.5" y="66.5" width="6.6" height="14.8" rx="1.8" />
      <rect className="wm-letter" x="50.9" y="66.5" width="6.6" height="14.8" rx="1.8" />
    </svg>
  );
}

/** "openlogs" in Fraunces, the beaver as the first "o", the log as the "o" of "logs". */
export function AppWordmark({ size }: { size: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }} role="img" aria-label={t('app.name')}>
      <BeaverO />
      <span aria-hidden="true">penl</span>
      <LogO />
      <span aria-hidden="true">gs</span>
    </span>
  );
}
