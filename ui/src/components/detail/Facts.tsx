import { Fragment, isValidElement, type ReactNode } from 'react';

/**
 * A detail header's facts line: separate spans with a `·` span between them.
 * An item that already is a `<span>` (a coloured fact) is used as it is.
 */
export function Facts({ items }: { items: ReactNode[] }) {
  const shown = items.filter((item) => item !== null && item !== undefined && item !== false && item !== '');
  return (
    <div className="dhead-facts">
      {shown.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden="true">·</span>}
          {isValidElement(item) && item.type === 'span' ? item : <span>{item}</span>}
        </Fragment>
      ))}
    </div>
  );
}
