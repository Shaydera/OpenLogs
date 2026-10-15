import type { PlayerRef, UnitInfo } from '../../api/types';
import { t } from '../../i18n/i18n';
import { classColor } from '../overview/players';
import { reportSpellName, rosterIndex, type SpellNames } from '../reports/reportData';

/** The names a view payload carries for its actor and spell IDs. */
export interface ViewNames {
  /** The logged unit's name ("Blightscale Rawling #7"); empty for none. */
  unit(actorId: number): string;
  /** The player a pet or guardian belongs to; `null` for other units. */
  owner(actorId: number): string | null;
  /** A player's class colour; `undefined` for other units. */
  colour(actorId: number): string | undefined;
  spell(spellId: number): string;
}

/** The unit's name with its owner beside it: "Wild Imp (Wendel)". */
export const unitLabel = (names: ViewNames, actorId: number, fallback: string): string => {
  const owner = names.owner(actorId);
  return `${names.unit(actorId) || fallback}${owner ? ` (${owner})` : ''}`;
};

export function viewNames(payload: { units: UnitInfo[]; roster: PlayerRef[]; spells: SpellNames }): ViewNames {
  const units = new Map(payload.units.map((unit) => [unit.actorId, unit]));
  const roster = rosterIndex(payload.roster);
  const unit = (actorId: number) => {
    const info = units.get(actorId);
    if (!info) return '';
    const name = info.name || t('scope.unknownUnit');
    return info.number === null ? name : t('scope.instance', { name, number: info.number });
  };
  return {
    unit,
    owner: (actorId) => {
      const owner = units.get(actorId)?.owner;
      return owner == null ? null : unit(owner);
    },
    colour: (actorId) => {
      const player = units.get(actorId)?.player ? roster.get(actorId) : undefined;
      return player ? classColor(player.classToken) : undefined;
    },
    spell: (spellId) => reportSpellName(payload.spells, spellId),
  };
}
