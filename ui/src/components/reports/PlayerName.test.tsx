import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PlayerRef } from '../../api/types';
import { PlayerName } from './PlayerName';

const FAELAN: PlayerRef = {
  actorId: 4,
  name: 'Faelan-Emberfall-EU',
  specId: 62,
  specName: 'Arcane Mage',
  classId: 8,
  classToken: 'MAGE',
  role: 'damage',
};

describe('PlayerName', () => {
  it('shows the spec icon, falls back to the class icon, then the monogram', () => {
    const { container, rerender } = render(<PlayerName player={FAELAN} />);
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/spec\/62$/);
    rerender(<PlayerName player={{ ...FAELAN, specId: null, specName: null }} />);
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/class\/8$/);
    rerender(<PlayerName player={{ ...FAELAN, specId: null, specName: null, classId: null, classToken: null }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('F')).toBeInTheDocument();
    rerender(<PlayerName player={undefined} />);
    expect(screen.getByText('Unknown player')).toBeInTheDocument();
  });
});
