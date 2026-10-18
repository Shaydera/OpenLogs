import type { ReplayAura } from '../../api/types';
import type { HudIndex } from './hudIndex';

export type AuraHolder = 'enemy' | 'player';

export function shownAuras(auras: ReplayAura[], holder: AuraHolder, ownPlayer: number | null, all: boolean): ReplayAura[] {
  if (all) return auras;
  return auras.filter((aura) => {
    if (holder === 'enemy') {
      if (aura.buff) return aura.category === 'encounter';
      return aura.category !== 'other' || (ownPlayer !== null && aura.sourcePlayer === ownPlayer);
    }
    return aura.buff ? aura.category === 'cooldown' || aura.category === 'encounter' : aura.category === 'encounter' || aura.category === 'crowdControl';
  });
}

export function ownPlayerOf(hud: HudIndex, selected: number | null): number | null {
  const unit = selected === null ? undefined : hud.units.get(selected);
  if (!unit) return null;
  if (unit.kind === 'player') return unit.actor;
  return unit.kind === 'pet' ? unit.owner : null;
}
