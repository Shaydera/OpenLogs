import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PlayerRef } from '../../api/types';
import { PlayerName } from './PlayerName';

const FAELAN: PlayerRef = {
  actorId: 4,
  name: 'Faelan-Emberfall-EU',
  specId: 62,
  specName: 'Arcane Mage',
  specIcon: 'spell_holy_magicalsentry',
  classId: 8,
  classToken: 'MAGE',
  role: 'damage',
};

describe('PlayerName', () => {
  it('shows the spec icon, falls back to the class icon, then the monogram', () => {
    const { container, rerender } = render(<PlayerName player={FAELAN} />);
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/icon\/spell_holy_magicalsentry$/);
    rerender(<PlayerName player={{ ...FAELAN, specId: null, specName: null, specIcon: null }} />);
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/class\/8$/);
    rerender(<PlayerName player={{ ...FAELAN, specId: 1482, specName: null, specIcon: null }} />);
    expect(container.querySelector('img')?.getAttribute('src'), 'a spec ID without a known spec').toMatch(/class\/8$/);
    rerender(<PlayerName player={{ ...FAELAN, specId: null, specName: null, specIcon: null, classId: null, classToken: null }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('F')).toBeInTheDocument();
    rerender(<PlayerName player={undefined} />);
    expect(screen.getByText('Unknown player')).toBeInTheDocument();
  });
});
