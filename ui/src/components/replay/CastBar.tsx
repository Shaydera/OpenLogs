import { formatSeconds } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { spellIcon } from '../../icons';
import { GameIcon } from '../GameIcon';
import { spellName } from '../overview/players';
import type { HudIndex } from './hudIndex';
import { castAt } from './playback';

const ICON_PX = 16;

/** The cast `actor` has running at `time` with its remaining time, else "No cast". */
export function CastBar({ hud, actor, time }: { hud: HudIndex; actor: number; time: number }) {
  const running = castAt(hud.castBars.get(actor) ?? [], actor, time);
  if (!running)
    return (
      <div className="hud-cast hud-cast-idle">
        <span className="hud-cast-none" aria-hidden="true" />
        <span>{t('replay.noCast')}</span>
      </div>
    );
  const { cast, progress } = running;
  const name = spellName(hud.data, cast.spellId);
  const left = formatSeconds(cast.endMs - time);
  return (
    <div className="hud-cast">
      <GameIcon icon={spellIcon(cast.spellId)} size={ICON_PX} name={name} />
      <div
        className="hud-cast-bar"
        role="progressbar"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-valuetext={t('replay.castLeft', { time: left })}
      >
        <span className="hud-cast-fill" style={{ width: `${progress * 100}%` }} />
        <span className="hud-cast-name">{name}</span>
      </div>
      <span className="hud-cast-time num">{left}</span>
    </div>
  );
}
