import { type RefObject, useEffect, useRef } from 'react';

interface Handlers {
  onDismiss: () => void;
  onEscape: () => void;
}

/**
 * Closes an open popup on Escape, on a press outside `container` and when keyboard focus moves out.
 * Focus moving to nothing is ignored: WebKit does not focus clicked buttons, so the popup would close before their click lands.
 */
export function useDismiss(container: RefObject<HTMLElement | null>, open: boolean, handlers: Handlers): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const root = container.current;
    if (!open || !root) return;
    const outside = (target: EventTarget | null) => target instanceof Node && !root.contains(target);
    const onPointerDown = (event: Event) => {
      if (outside(event.target)) latest.current.onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      latest.current.onEscape();
    };
    const onFocusOut = (event: FocusEvent) => {
      if (outside(event.relatedTarget)) latest.current.onDismiss();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    root.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('focusout', onFocusOut);
    };
  }, [container, open]);
}
