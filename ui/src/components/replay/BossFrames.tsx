import type { ReplayUnit } from '../../api/types';
import { t } from '../../i18n/i18n';
import { CastBar } from './CastBar';
import { type HudIndex, bossFrameUnits, healthShareAt, unitLabel } from './hudIndex';
import { HealthBar, HudPanel, healthText } from './HudParts';
import { useReplayTime } from './useReplayTime';

function EnemyFrame({ hud, unit, time }: { hud: HudIndex; unit: ReplayUnit; time: number }) {
  const boss = unit.kind === 'boss';
  const health = healthShareAt(hud, unit.actor, time);
  const label = unitLabel(unit);
  return (
    <div role="group" aria-label={label} className={boss ? 'hud-frame hud-boss' : 'hud-frame hud-add'}>
      <div className="hud-frame-head">
        <span className="hud-frame-name">{label}</span>
        {health && <span className="hud-frame-hp num">{healthText(health)}</span>}
      </div>
      <HealthBar percent={health?.percent ?? null} tone={boss ? 'boss' : 'add'} />
      <CastBar hud={hud} actor={unit.actor} time={time} hideIdle={!boss} />
    </div>
  );
}

/** Top right: every boss with its cast bar, then the adds alive now, numbered per name, with a cast bar while they cast. */
export function BossFrames({ hud }: { hud: HudIndex }) {
  const time = useReplayTime();
  const { units, more } = bossFrameUnits(hud, time);
  if (units.length === 0) return null;
  return (
    <HudPanel label={t('replay.bossFrames')} className="hud-bosses">
      {units.map((unit) => (
        <EnemyFrame key={unit.actor} hud={hud} unit={unit} time={time} />
      ))}
      {more > 0 && <p className="hud-more">{t('replay.moreAdds', { count: more })}</p>}
    </HudPanel>
  );
}
