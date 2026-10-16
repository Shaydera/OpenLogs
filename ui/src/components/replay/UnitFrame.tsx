import type { ReplayUnit } from '../../api/types';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { classColor } from '../overview/players';
import { AuraIcons } from './AuraIcons';
import { CastBar } from './CastBar';
import { type HudIndex, healthShareAt, isDeadAt, unitLabel } from './hudIndex';
import { HealthBar, HudPanel } from './HudParts';
import { aurasAt, lastTargetAt } from './playback';
import { useReplayTime } from './useReplayTime';

const AURA_PX = 18;

function nameColor(hud: HudIndex, unit: ReplayUnit): string | undefined {
  if (unit.kind !== 'player' && unit.kind !== 'pet') return undefined;
  const player = hud.roster.get(unit.kind === 'pet' ? (unit.owner ?? -1) : unit.actor);
  return player ? classColor(player.classToken) : undefined;
}

/** Bottom centre: the selected unit's health, cast, target and all of its auras. */
export function UnitFrame({ hud }: { hud: HudIndex }) {
  const time = useReplayTime();
  const selected = useApp((s) => s.replay.selected);
  const unit = selected === null ? undefined : hud.units.get(selected);
  if (!unit) return null;
  const label = unitLabel(unit);
  const dead = isDeadAt(hud, unit.actor, time);
  const health = healthShareAt(hud, unit.actor, time);
  const targetId = lastTargetAt(hud.casts.get(unit.actor) ?? [], unit.actor, time);
  const target = targetId === null ? undefined : hud.units.get(targetId);
  const byStart = aurasAt(hud.auras.get(unit.actor) ?? [], unit.actor, time).sort((a, b) => a.startMs - b.startMs);
  return (
    <HudPanel label={t('replay.unitFrame')} className="hud-unit">
      <div role="group" aria-label={label} className="hud-frame">
        <div className="hud-frame-head">
          <span className="hud-frame-name" style={{ color: dead ? undefined : nameColor(hud, unit) }}>
            {label}
            {dead && (
              <span className="hud-frame-status">
                {t('replay.separator')}
                {t('replay.dead')}
              </span>
            )}
          </span>
          {target && <span className="hud-unit-target">{t('replay.target', { name: unitLabel(target) })}</span>}
        </div>
        <HealthBar percent={dead ? 0 : (health?.percent ?? null)} tone="unit" />
        <CastBar hud={hud} actor={unit.actor} time={time} />
        <div className="hud-unit-auras">
          <AuraIcons hud={hud} auras={byStart.filter((aura) => !aura.buff)} time={time} label={t('replay.debuffs')} size={AURA_PX} />
          <AuraIcons hud={hud} auras={byStart.filter((aura) => aura.buff)} time={time} label={t('replay.buffs')} size={AURA_PX} />
        </div>
      </div>
    </HudPanel>
  );
}
