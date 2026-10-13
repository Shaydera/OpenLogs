import { useRef } from 'react';
import type { PlayerDetail } from '../../api/types';
import { useFocusRequest } from '../../hooks/useFocusRequest';
import { classIcon } from '../../icons';
import { formatAmount, formatInteger } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { Facts } from '../detail/Facts';
import { GameIcon } from '../GameIcon';
import { classColor, shortName } from '../overview/players';

export function PlayerHeader({ detail }: { detail: PlayerDetail }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useFocusRequest('page', () => titleRef.current);
  const closeDetail = useApp((s) => s.closeDetail);
  const openPlayer = useApp((s) => s.openPlayer);
  const back = useApp((s) => s.back);
  // Opened on top of an enemy page: go back to it instead of closing every page.
  const nested = useApp((s) => s.details.length > 1);
  const player = detail.player;
  const name = shortName(player.name);
  const color = classColor(player.classToken);
  return (
    <section className="dhead">
      <button type="button" className="accent-link" onClick={() => void (nested ? back() : closeDetail())}>
        {t(nested ? 'detail.back' : 'player.back')}
      </button>
      {player.classId !== null && (
        <GameIcon name={name} icon={classIcon(player.classId)} large ring={`color-mix(in srgb, ${color} 50%, var(--bg))`} />
      )}
      <div className="dhead-id">
        <h1 ref={titleRef} tabIndex={-1} className="dhead-title" style={{ color }}>
          {name}
        </h1>
        <Facts
          items={[
            detail.specName,
            player.role ? t(`player.role.${player.role}`) : null,
            detail.itemLevel !== null ? (
              <>
                {t('player.itemLevelLabel')} <span className="num value-text">{formatInteger(detail.itemLevel)}</span>
              </>
            ) : null,
            detail.maxHp !== null ? (
              <>
                {t('player.maxHpLabel')} <span className="num value-text">{formatAmount(detail.maxHp)}</span>
              </>
            ) : null,
          ]}
        />
      </div>
      <label className="dhead-switch">
        {t('player.switch')}
        <select className="dhead-select" value={player.actorId} onChange={(event) => void openPlayer(Number(event.target.value))}>
          {/* Players without a spec are only named on the page; the page's own player always stays selectable. */}
          {detail.roster
            .filter((entry) => entry.specId !== null || entry.actorId === player.actorId)
            .map((entry) => (
              <option key={entry.actorId} value={entry.actorId}>
                {shortName(entry.name)}
              </option>
            ))}
        </select>
      </label>
    </section>
  );
}
