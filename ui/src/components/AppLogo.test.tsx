import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import beaverOnDark from '../../../brand/openlogs-beaver-on-dark.svg?raw';
import beaverOnLight from '../../../brand/openlogs-beaver-on-light.svg?raw';
import mark from '../../../brand/openlogs-mark.svg?raw';
import { AppWordmark } from './AppLogo';

const GEOMETRY = ['d', 'transform', 'points', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'fill-rule'];

/** Inside a mask the app marks keep/cut by class (theme tokens), the files by a fixed white/black fill. */
function maskRole(shape: Element): string | null {
  if (!shape.closest('mask')) return null;
  if (shape.classList.contains('wm-mask-keep') || shape.getAttribute('fill') === '#ffffff') return 'keep';
  if (shape.classList.contains('wm-mask-cut') || shape.getAttribute('fill') === '#000000') return 'cut';
  return 'unknown';
}

/** Every shape below `root` with its geometry, mask role and whether it is masked or clipped; colours do not count. */
function shapes(root: Element): string[] {
  return [...root.querySelectorAll('path, circle, ellipse, rect, polygon')].map((shape) =>
    [
      shape.tagName,
      ...GEOMETRY.filter((name) => shape.hasAttribute(name)).map((name) => `${name}=${shape.getAttribute(name)}`),
      maskRole(shape),
      shape.hasAttribute('mask') || shape.closest('g[mask]') ? 'masked' : null,
      shape.hasAttribute('clip-path') ? 'clipped' : null,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

const parse = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;

describe('AppWordmark', () => {
  it('draws the log and the beaver exactly as the files in brand/', () => {
    const { container } = render(<AppWordmark size={32} />);
    expect(shapes(container.querySelector('.wm-log')!)).toEqual(shapes(parse(mark)));
    const beaver = shapes(container.querySelector('.wm-beaver')!);
    expect(beaver).toEqual(shapes(parse(beaverOnDark)));
    expect(beaver).toEqual(shapes(parse(beaverOnLight)));
  });
});
