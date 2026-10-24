import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GameIcon } from './GameIcon';

describe('GameIcon', () => {
  it('falls back to the monogram when the image is missing and retries a new icon', () => {
    const { container, rerender } = render(<GameIcon icon="icon/missing" name="Time Warp" label="Time Warp at 0:02" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'Time Warp at 0:02' })).toHaveTextContent('TW');
    rerender(<GameIcon icon="icon/ability_mage_timewarp" name="Time Warp" label="Time Warp at 0:02" />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'icon/ability_mage_timewarp');
  });
});
