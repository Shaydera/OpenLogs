import { useMemo } from 'react';
import type { EffectInstance } from '../../api/types';
import { formatSeconds } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { spellIcon } from '../../icons';
import { useApp } from '../../store';
import { GameIcon } from '../GameIcon';
import { type EffectState, effectsAt } from './effects';
import { type HudIndex, unitLabel } from './hudIndex';
import { HudPanel } from './HudParts';
import { useReplayTime } from './useReplayTime';

const ICON_PX = 22;

const byKindThenStart = (a: EffectState, b: EffectState) => Number(a.effect.kind === 'harmful') - Number(b.effect.kind === 'harmful') || a.effect.startMs - b.effect.startMs;

function casterLabel(hud: HudIndex, caster: number): string | null {
  const unit = hud.units.get(caster);
  if (!unit) return null;
  const spec = hud.roster.get(caster)?.specName;
  return spec ? `${unitLabel(unit)}${t('replay.separator')}${spec}` : unitLabel(unit);
}

function Reached({ state }: { state: EffectState }) {
  const count = state.affected.length;
  if (state.effect.kind === 'harmful') return <span className="num">{t('replay.effectHit', { count })}</span>;
  const total = count + state.missing.length;
  return (
    <span className={state.missing.length > 0 ? 'num hud-effect-missing' : 'num'}>
      <span aria-hidden="true">{t('replay.effectReached', { count, total })}</span>
      <span className="sr-only">{t('replay.effectReachedLabel', { count, total })}</span>
    </span>
  );
}

interface Props {
  hud: HudIndex;
  selected: EffectInstance | null;
  onSelect: (effect: EffectInstance | null) => void;
  defaultCollapsed?: boolean;
}

/** Top right, under the boss frames: the effects up now with their caster, remaining time and how many players the log shows them reaching; a click highlights one on the stage, a second click clears it. */
export function EffectList({ hud, selected, onSelect, defaultCollapsed = false }: Props) {
  const time = useReplayTime();
  const shown = useApp((s) => s.replay.layers.effects);
  const keys = useMemo(() => new Map(hud.data.effects.map((effect, i) => [effect, i])), [hud]);
  const states = shown ? effectsAt(hud.data, time).sort(byKindThenStart) : [];
  return (
    <HudPanel label={t('replay.activeEffects')} className="hud-effects" defaultCollapsed={defaultCollapsed} hidden={states.length === 0}>
      {states.map((state) => {
        const { effect } = state;
        const picked = effect === selected;
        const caster = casterLabel(hud, effect.caster);
        return (
          <button
            key={keys.get(effect)}
            type="button"
            className={`hud-effect hud-effect-${effect.category.replace('_', '-')}`}
            aria-pressed={picked}
            onClick={() => onSelect(picked ? null : effect)}
          >
            <GameIcon icon={spellIcon(effect.spellId)} size={ICON_PX} name={effect.name} />
            <span className="hud-effect-text">
              <span className="hud-effect-name">{effect.name}</span>
              {caster && <span className="hud-effect-caster">{caster}</span>}
            </span>
            <span className="hud-effect-facts">
              <span className="num">{formatSeconds(effect.endMs - time)}</span>
              <Reached state={state} />
            </span>
          </button>
        );
      })}
    </HudPanel>
  );
}
