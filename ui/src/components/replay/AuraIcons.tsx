import type { ReplayAura } from '../../api/types';
import { formatInteger, formatSpan } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { spellIcon } from '../../icons';
import { GameIcon } from '../GameIcon';
import { classColor, shortName, spellName } from '../overview/players';
import { AuraTip, useAuraTip } from './AuraTip';
import { type HudIndex, unitLabel } from './hudIndex';
import { stacksAt } from './playback';

/** Whole seconds below a minute (`12`), else whole minutes (`3m`). */
function shortRemaining(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return seconds < 60 ? formatInteger(seconds) : t('replay.auraMinutes', { value: formatInteger(Math.floor(seconds / 60)) });
}

function sourceOf(hud: HudIndex, aura: ReplayAura): { name: string; color?: string } | null {
  const player = aura.sourcePlayer === null ? undefined : hud.roster.get(aura.sourcePlayer);
  if (player) return { name: shortName(player.name), color: classColor(player.classToken) };
  const unit = hud.units.get(aura.source);
  return unit ? { name: unitLabel(unit) } : null;
}

function AuraTipCard({ hud, aura, name, remaining, stacks }: { hud: HudIndex; aura: ReplayAura; name: string; remaining: number | null; stacks: number | null }) {
  const source = sourceOf(hud, aura);
  return (
    <>
      <div className="hud-aura-tip-head">
        <span className="hud-aura-tip-name">{name}</span>
        <span className="hud-aura-tip-kind">{t(aura.buff ? 'replay.auraBuff' : 'replay.auraDebuff')}</span>
      </div>
      {source && (
        <span className="hud-aura-tip-source" style={{ color: source.color }}>
          {source.name}
        </span>
      )}
      {remaining === null ? (
        <span>{t('replay.auraUntilEnd')}</span>
      ) : (
        <span className="num">{`${t('replay.auraLeft', { time: formatSpan(remaining) })}${t('replay.separator')}${formatSpan(aura.endMs - aura.startMs)}`}</span>
      )}
      {stacks !== null && <span className="num">{t('replay.auraStacks', { count: stacks })}</span>}
    </>
  );
}

function AuraIcon({ hud, aura, time, size }: { hud: HudIndex; aura: ReplayAura; time: number; size: number }) {
  const { anchor, handlers } = useAuraTip();
  const name = spellName(hud.data, aura.spellId);
  const stacks = stacksAt(aura, time);
  const shownStacks = stacks !== null && stacks > 1 ? stacks : null;
  // An aura still up when the pull ends has no logged end: a countdown to the pull's end would be made up.
  const remaining = aura.endMs < hud.data.durationMs ? aura.endMs - time : null;
  const description = [remaining !== null && t('replay.auraLeft', { time: formatSpan(remaining) }), shownStacks !== null && t('replay.auraStacks', { count: shownStacks })]
    .filter(Boolean)
    .join(t('replay.separator'));
  return (
    <li>
      <span className="hud-aura" role="img" aria-label={name} aria-description={description || undefined} {...handlers}>
        <GameIcon icon={spellIcon(aura.spellId)} size={size} name={name} />
        {remaining !== null && (
          <span className="hud-aura-time" aria-hidden="true">
            {shortRemaining(remaining)}
          </span>
        )}
        {shownStacks !== null && (
          <span className="hud-aura-stacks" aria-hidden="true">
            {formatInteger(shownStacks)}
          </span>
        )}
      </span>
      {anchor && (
        <AuraTip anchor={anchor}>
          <AuraTipCard hud={hud} aura={aura} name={name} remaining={remaining} stacks={shownStacks} />
        </AuraTip>
      )}
    </li>
  );
}

/** A labelled row of aura icons with their remaining time and stacks at `time`; nothing when empty. */
export function AuraIcons({ hud, auras, time, label, size }: { hud: HudIndex; auras: ReplayAura[]; time: number; label: string; size: number }) {
  if (auras.length === 0) return null;
  return (
    <ul className="hud-auras" aria-label={label}>
      {auras.map((aura) => (
        <AuraIcon key={`${aura.spellId}-${aura.source}-${aura.startMs}`} hud={hud} aura={aura} time={time} size={size} />
      ))}
    </ul>
  );
}
