import type { CSSProperties } from 'react';
import type { ReplayUnit } from '../../api/types';
import { formatAmount, formatPercent } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { classColor } from '../overview/players';
import { powerName } from '../resources/powerNames';
import { AuraIcons } from './AuraIcons';
import { CastBar } from './CastBar';
import { type HudIndex, healthShareAt, isDeadAt, unitLabel } from './hudIndex';
import { HealthBar, HudPanel, healthText } from './HudParts';
import { aurasAt, powerAt, targetAt } from './playback';
import { powerColorVar, powerTextVar } from './powerColors';
import { useReplayTime } from './useReplayTime';

const AURA_PX = 18;

function nameColor(hud: HudIndex, unit: ReplayUnit): string | undefined {
  if (unit.kind !== 'player' && unit.kind !== 'pet') return undefined;
  const player = hud.roster.get(unit.kind === 'pet' ? (unit.owner ?? -1) : unit.actor);
  return player ? classColor(player.classToken) : undefined;
}

const share = (current: number, max: number) => (max > 0 ? Math.min(100, Math.max(0, (current / max) * 100)) : 0);

const valueOfMax = (current: number, max: number) => t('replay.valueOfMax', { current: formatAmount(current), max: formatAmount(max) });

function UnitName({ hud, unit, dead, onSelect }: { hud: HudIndex; unit: ReplayUnit; dead: boolean; onSelect?: () => void }) {
  const color = dead ? undefined : nameColor(hud, unit);
  const spec = hud.roster.get(unit.actor)?.specName;
  const content = (
    <>
      {unitLabel(unit)}
      {dead ? (
        <span className="hud-frame-status">{`${t('replay.separator')}${t('replay.dead')}`}</span>
      ) : (
        spec && <span className="hud-frame-status">{`${t('replay.separator')}${spec}`}</span>
      )}
    </>
  );
  return onSelect ? (
    <button type="button" className="hud-frame-name hud-frame-pick" style={{ color }} onClick={onSelect}>
      {content}
    </button>
  ) : (
    <span className="hud-frame-name" style={{ color }}>
      {content}
    </span>
  );
}

function BigFrame({ hud, unit, time, label, onSelect }: { hud: HudIndex; unit: ReplayUnit; time: number; label: string; onSelect?: () => void }) {
  const dead = isDeadAt(hud, unit.actor, time);
  const health = healthShareAt(hud, unit.actor, time);
  const power = powerAt(hud, unit.actor, time);
  const auras = aurasAt(hud.auras.get(unit.actor) ?? [], unit.actor, time).sort((a, b) => a.startMs - b.startMs);
  const healthFill = dead || !health ? 0 : share(health.current, health.max);
  return (
    <div role="group" aria-label={label} className="hud-frame hud-unit-frame">
      <div className="hud-unit-auras">
        <AuraIcons hud={hud} auras={auras.filter((aura) => aura.buff)} time={time} label={t('replay.buffs')} size={AURA_PX} />
        <AuraIcons hud={hud} auras={auras.filter((aura) => !aura.buff)} time={time} label={t('replay.debuffs')} size={AURA_PX} />
      </div>
      <UnitName hud={hud} unit={unit} dead={dead} onSelect={onSelect} />
      <div className="hud-bar hud-bar-health" style={{ '--fill': `${healthFill}%` } as CSSProperties}>
        <HealthBar percent={dead ? 0 : (health?.percent ?? null)} tone="unit" />
        {health && !dead && (
          <div className="hud-bar-text num">
            <span>{valueOfMax(health.current, health.max)}</span>
            {health.percent !== null && <span>{formatPercent(health.percent)}</span>}
          </div>
        )}
      </div>
      {power && !dead && (
        <div className="hud-bar hud-bar-power" style={{ '--fill': `${share(power.current, power.max)}%`, '--bar-text-fill': powerTextVar(power.powerType) } as CSSProperties}>
          <div
            className="hud-power"
            role="meter"
            aria-label={powerName(power.powerType)}
            aria-valuemin={0}
            aria-valuemax={power.max}
            aria-valuenow={power.current}
            aria-valuetext={valueOfMax(power.current, power.max)}
          >
            <span style={{ width: `${share(power.current, power.max)}%`, background: powerColorVar(power.powerType) }} />
          </div>
          <div className="hud-bar-text num">
            <span>{valueOfMax(power.current, power.max)}</span>
            <span>{powerName(power.powerType)}</span>
          </div>
        </div>
      )}
      <CastBar hud={hud} actor={unit.actor} time={time} />
    </div>
  );
}

function TargetOfTarget({ hud, unit, time, onSelect }: { hud: HudIndex; unit: ReplayUnit; time: number; onSelect: () => void }) {
  const dead = isDeadAt(hud, unit.actor, time);
  const health = healthShareAt(hud, unit.actor, time);
  return (
    <div role="group" aria-label={t('replay.targetOfTarget')} className="hud-frame hud-unit-tot">
      <span className="hud-unit-caption">{t('replay.targetOfTarget')}</span>
      <UnitName hud={hud} unit={unit} dead={dead} onSelect={onSelect} />
      <HealthBar percent={dead ? 0 : (health?.percent ?? null)} tone="unit" />
      {health && !dead && <span className="hud-frame-hp num">{healthText(health)}</span>}
    </div>
  );
}

/** Bottom centre: the selected unit, its target and the target's target. */
export function UnitFrames({ hud, defaultCollapsed = false }: { hud: HudIndex; defaultCollapsed?: boolean }) {
  const time = useReplayTime();
  const selected = useApp((s) => s.replay.selected);
  const selectReplayUnit = useApp((s) => s.selectReplayUnit);
  const unit = selected === null ? undefined : hud.units.get(selected);
  if (!unit) return null;
  const targetId = targetAt(hud, unit.actor, time);
  const target = targetId === null ? undefined : hud.units.get(targetId);
  const targetsTargetId = target ? targetAt(hud, target.actor, time) : null;
  const targetsTarget = targetsTargetId === null ? undefined : hud.units.get(targetsTargetId);
  return (
    <HudPanel label={t('replay.unitFrames')} className="hud-unit" defaultCollapsed={defaultCollapsed}>
      <div className="hud-unit-row">
        <BigFrame hud={hud} unit={unit} time={time} label={unitLabel(unit)} />
        {targetsTarget && <TargetOfTarget hud={hud} unit={targetsTarget} time={time} onSelect={() => selectReplayUnit(targetsTarget.actor)} />}
        {target && <BigFrame hud={hud} unit={target} time={time} label={t('replay.targetFrame')} onSelect={() => selectReplayUnit(target.actor)} />}
      </div>
    </HudPanel>
  );
}
