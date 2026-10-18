import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';

const GAP_PX = 6;
const EDGE_PX = 4;

interface OpenTip {
  id: string;
  anchor: HTMLElement;
}

const useOpenTip = create<{ tip: OpenTip | null }>(() => ({ tip: null }));

const show = (tip: OpenTip) => useOpenTip.setState({ tip });
const hide = (id: string) => useOpenTip.setState((state) => (state.tip?.id === id ? { tip: null } : state));

/** One tooltip across the HUD: hover or tap opens it, leaving, a tap elsewhere or Escape closes it. */
export function useAuraTip() {
  const id = useId();
  const anchor = useOpenTip((state) => (state.tip?.id === id ? state.tip.anchor : null));

  useEffect(() => () => hide(id), [id]);

  useEffect(() => {
    if (!anchor) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node && anchor.contains(event.target))) hide(id);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide(id);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anchor, id]);

  const open = (event: { currentTarget: HTMLElement }) => show({ id, anchor: event.currentTarget });
  const openOnTap = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch') open(event);
  };
  return { anchor, handlers: { onMouseEnter: open, onPointerUp: openOnTap, onMouseLeave: () => hide(id) } };
}

/** Above the anchor where the stage has room, else below it; clamped inside the stage sideways. */
function place(tip: HTMLElement, anchor: HTMLElement, stage: HTMLElement) {
  const at = anchor.getBoundingClientRect();
  const box = stage.getBoundingClientRect();
  const width = tip.offsetWidth;
  const height = tip.offsetHeight;
  const centred = at.left + at.width / 2 - width / 2 - box.left;
  const left = Math.max(EDGE_PX, Math.min(box.width - width - EDGE_PX, centred));
  const above = at.top - box.top - GAP_PX - height;
  const below = at.bottom - box.top + GAP_PX;
  const fitsBelow = below + height <= box.height - EDGE_PX;
  const top = above >= EDGE_PX || (!fitsBelow && at.top - box.top > box.bottom - at.bottom) ? above : below;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

/** The tooltip of an aura icon, drawn on the stage so a HUD panel's edge does not cut it off. */
export function AuraTip({ anchor, children }: { anchor: HTMLElement; children: ReactNode }) {
  const tip = useRef<HTMLDivElement>(null);
  const stage = anchor.closest<HTMLElement>('.replay-plot') ?? document.body;

  useLayoutEffect(() => {
    if (tip.current) place(tip.current, anchor, stage);
  });

  return createPortal(
    <div ref={tip} className="hud-aura-tip" role="tooltip">
      {children}
    </div>,
    stage,
  );
}
