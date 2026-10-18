export function cssZoom(element: Element | null): number {
  const zoom = (element as { currentCSSZoom?: unknown } | null)?.currentCSSZoom;
  return typeof zoom === 'number' && zoom > 0 ? zoom : 1;
}
