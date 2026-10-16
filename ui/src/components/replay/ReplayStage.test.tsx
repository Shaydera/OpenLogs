import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { replayFixture } from '../../test/replayFixture';
import { fitCamera, toScreen } from './camera';
import { ReplayStage } from './ReplayStage';
import { STAGE_PAD_PX, stageBounds } from './stageDraw';

vi.mock('../../api/client', () => ({ api: {} }));

const W = 640;
const H = 480;

beforeEach(() => {
  useApp.setState({ ...initialState(), tab: 'replay', replayData: replayFixture });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, W, H));
});
afterEach(() => vi.restoreAllMocks());

describe('ReplayStage', () => {
  it('clicking a unit selects it', async () => {
    render(<ReplayStage data={replayFixture} highlight={null} />);
    const bounds = stageBounds(replayFixture);
    if (!bounds) throw new Error('the fixture has positions');
    const [clientX, clientY] = toScreen(fitCamera(bounds, W, H, STAGE_PAD_PX), 100, 200, W, H);
    await userEvent.pointer({ keys: '[MouseLeft]', target: screen.getByRole('img', { name: 'Replay stage' }), coords: { clientX, clientY } });
    expect(useApp.getState().replay.selected).toBe(1);
  });
});
