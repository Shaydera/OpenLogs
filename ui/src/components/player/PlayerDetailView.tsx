import type { PlayerDetail } from '../../api/types';
import { pageScope, useApp } from '../../store';
import { PageFilter } from '../detail/PageFilter';
import { CastsAndBuffs } from './CastsAndBuffs';
import { OverTimeChart } from './OverTimeChart';
import { PlayerAbilities } from './PlayerAbilities';
import { PlayerHeader } from './PlayerHeader';
import { PlayerKpis } from './PlayerKpis';
import { PlayerSectionNav } from './PlayerSectionNav';
import { PlayerSidePanels } from './PlayerSidePanels';

/** A dimension the page filter narrows to one value is no block of its own. */
export function PlayerDetailView({ detail }: { detail: PlayerDetail }) {
  const filters = useApp((s) => s.filters);
  const scope = pageScope(filters, detail.metric === 'healing' ? 'healing' : 'damage');
  const abilities = scope.ability.length === 0;
  const targets = scope.target.length === 0;
  const openAbility = useApp((s) => s.openAbility);
  const ownRow = detail.abilities.find((row) => row.kind === 'own');
  const petRow = detail.petAbilities[0];
  const openSelectedAbility = ownRow
    ? () => void openAbility(ownRow.spellId, null)
    : petRow
      ? () => void openAbility(petRow.spellId, petRow.actorName)
      : undefined;
  return (
    <div className="player-page">
      <PlayerHeader detail={detail} />
      <PageFilter dimensions={['target', 'ability']} onOpenAbility={openSelectedAbility} />
      <PlayerKpis detail={detail} />
      <PlayerSectionNav healing={detail.metric === 'healing'} hidden={[...(abilities ? [] : ['p-abilities']), ...(targets ? [] : ['p-targets'])]} />
      <OverTimeChart detail={detail} />
      {/* Keyed: opened rows belong to one player and metric. */}
      {abilities && <PlayerAbilities key={`${detail.player.actorId}-${detail.metric}`} detail={detail} />}
      <CastsAndBuffs detail={detail} />
      <PlayerSidePanels detail={detail} targets={targets} />
    </div>
  );
}
