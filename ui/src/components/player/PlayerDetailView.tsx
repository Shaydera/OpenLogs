import type { PlayerDetail } from '../../api/types';
import { CastsAndBuffs } from './CastsAndBuffs';
import { OverTimeChart } from './OverTimeChart';
import { PlayerAbilities } from './PlayerAbilities';
import { PlayerHeader } from './PlayerHeader';
import { PlayerKpis } from './PlayerKpis';
import { PlayerSectionNav } from './PlayerSectionNav';
import { PlayerSidePanels } from './PlayerSidePanels';

export function PlayerDetailView({ detail }: { detail: PlayerDetail }) {
  return (
    <div className="player-page">
      <PlayerHeader detail={detail} />
      <PlayerKpis detail={detail} />
      <PlayerSectionNav healing={detail.metric === 'healing'} />
      <OverTimeChart detail={detail} />
      <PlayerAbilities detail={detail} />
      <CastsAndBuffs detail={detail} />
      <PlayerSidePanels detail={detail} />
    </div>
  );
}
