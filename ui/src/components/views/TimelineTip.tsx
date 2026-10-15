import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TimelineItem } from '../../api/types';
import { spellIcon } from '../../icons';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { GameIcon } from '../GameIcon';
import type { ItemTip } from './itemTip';

/** A mark's card: shown on hover, pinned by a click. */
export interface Tip {
  item: TimelineItem;
  /** A cast of the context lane above the lanes. */
  context: boolean;
  /** The pointer, in px from the timeline body's corner. */
  x: number;
  y: number;
  pinned: boolean;
  /** The mark that opened the card; focus returns to it when a pinned card closes. */
  opener: HTMLElement;
  /** Pinned from the keyboard: the card takes the focus. */
  keyboard: boolean;
}

export const TIP_PX = 320;
const OFFSET_PX = 14;

/** Below the pointer where the body has room, else above it; never past the body's top. */
function cardTop(card: HTMLElement | null, pointerY: number): number {
  const below = pointerY + OFFSET_PX;
  const room = card?.offsetParent?.clientHeight ?? 0;
  if (!card || room === 0 || below + card.offsetHeight <= room) return below;
  return Math.max(0, Math.min(room - card.offsetHeight, pointerY - OFFSET_PX - card.offsetHeight));
}

export function TipCard({ id, tip, tipText, onClose }: { id: string; tip: Tip; tipText: ItemTip; onClose: () => void }) {
  const showEventsAt = useApp((s) => s.showEventsAt);
  const card = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [top, setTop] = useState(tip.y + OFFSET_PX);

  useLayoutEffect(() => setTop(cardTop(card.current, tip.y)), [tip]);

  useEffect(() => {
    if (tip.pinned && tip.keyboard) close.current?.focus();
  }, [tip]);

  return (
    <div ref={card} id={id} className="tl-tip" role={tip.pinned ? 'dialog' : 'tooltip'} aria-label={tipText.spell} style={{ left: tip.x + OFFSET_PX, top }}>
      <div className="tl-tip-head">
        <GameIcon icon={spellIcon(tipText.spellId)} size={22} name={tipText.spell} />
        <div className="tl-tip-title">
          <span className="tl-tip-spell">{tipText.spell}</span>
          <span className="num faint">{t('tl.spellId', { id: tipText.spellId })}</span>
        </div>
        {tip.pinned && (
          <button ref={close} type="button" className="dd-clear" aria-label={t('tl.close')} onClick={onClose}>
            ×
          </button>
        )}
      </div>
      <dl className="tl-tip-grid">
        <dt className="cap">{t('tl.tip.what')}</dt>
        <dd>{tipText.what}</dd>
        <dt className="cap">{t('tl.tip.who')}</dt>
        <dd>
          {tipText.source} <span className="faint">→</span> {tipText.target}
        </dd>
        <dt className="cap">{t('tl.tip.when')}</dt>
        <dd className="num">{tipText.when}</dd>
        <dt className="cap">{t('tl.tip.long')}</dt>
        <dd>
          {tipText.howLong}
          {tipText.spans.map((line) => (
            <span key={line} className="tl-tip-line">
              {line}
            </span>
          ))}
        </dd>
        {tipText.howMuch && (
          <>
            <dt className="cap">{t('tl.tip.much')}</dt>
            <dd>
              <span className="tl-tip-amount">{tipText.howMuch}</span>
              {tipText.amountNote && <span className="tl-tip-note">{tipText.amountNote}</span>}
            </dd>
          </>
        )}
      </dl>
      <div className="tl-tip-log">
        <span className="cap">{t('tl.tip.log')}</span>
        {tipText.log.map((line, i) => (
          <span key={i}>
            <span className="muted">{line.time}</span> {line.event} <span className="faint">{line.extra}</span>
          </span>
        ))}
        {tipText.more && <span className="faint">{tipText.more}</span>}
      </div>
      {tip.pinned && (
        <button type="button" className="lnk" onClick={() => void showEventsAt(tip.item.kind === 'death' ? (tip.item.endMs ?? tip.item.startMs) : tip.item.startMs)}>
          {t('tl.toEvents')}
        </button>
      )}
    </div>
  );
}
