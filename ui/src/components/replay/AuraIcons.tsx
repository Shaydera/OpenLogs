import type { ReplayAura } from '../../api/types';
import { formatInteger, formatSpan } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { spellIcon } from '../../icons';
import { GameIcon } from '../GameIcon';
import { spellName } from '../overview/players';
import type { HudIndex } from './hudIndex';
import { stacksAt } from './playback';

/** Whole seconds below a minute (`12`), else whole minutes (`3m`). */
function shortRemaining(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return seconds < 60 ? formatInteger(seconds) : t('replay.auraMinutes', { value: formatInteger(Math.floor(seconds / 60)) });
}

function AuraIcon({ hud, aura, time, size }: { hud: HudIndex; aura: ReplayAura; time: number; size: number }) {
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
      <span className="hud-aura" role="img" aria-label={name} aria-description={description || undefined}>
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
