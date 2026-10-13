import type { PlayerRef } from '../../api/types';
import { classIcon, specIcon } from '../../icons';
import { t } from '../../i18n/i18n';
import { GameIcon, MonogramTile } from '../GameIcon';
import { classColor, shortName } from '../overview/players';

/**
 * A player's icon: the spec icon, the class icon when the spec is unknown, else the monogram tile of
 * the name.
 */
export function PlayerIcon({ player, size = 22 }: { player: PlayerRef | undefined; size?: number }) {
  const name = player ? shortName(player.name) : t('report.unknownPlayer');
  if (player?.specId != null) return <GameIcon icon={specIcon(player.specId)} size={size} name={name} />;
  if (player?.classId != null) return <GameIcon icon={classIcon(player.classId)} size={size} name={name} />;
  return <MonogramTile name={name} size={size} />;
}

/** A player in a row: icon and the name in the class colour, with a tooltip since rows cut a long name off. */
export function PlayerName({ player, size = 22 }: { player: PlayerRef | undefined; size?: number }) {
  if (!player) return <span className="player-name">{t('report.unknownPlayer')}</span>;
  const name = shortName(player.name);
  return (
    <span className="player-name">
      <PlayerIcon player={player} size={size} />
      <span className="player-name-text" style={{ color: classColor(player.classToken) }} title={name}>
        {name}
      </span>
    </span>
  );
}
