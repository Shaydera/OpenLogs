import { useState } from 'react';
import { bossIconUrl } from '../../icons';
import { bossMonogram, initials } from '../../monogram';
import { useApp } from '../../store';

/**
 * An enemy's tile: the boss portrait for the encounter's main boss, else a monogram of the first
 * letters of the first two words (BR, VH). `large` is the header's tile.
 */
export function EnemyTile({ name, primary, large = false }: { name: string; primary: boolean; large?: boolean }) {
  const encounterId = useApp((s) => {
    const view = s.view;
    if (view.kind !== 'fight') return 0;
    return s.log?.fights.find((f) => f.index === view.fightIndex)?.encounterId ?? 0;
  });
  const src = primary && encounterId > 0 ? bossIconUrl(encounterId) : null;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (src !== null && failedSrc !== src) {
    return <img className={large ? 'enemy-icon enemy-icon-lg' : 'enemy-icon'} src={src} alt="" onError={() => setFailedSrc(src)} />;
  }
  return (
    <span className={large ? 'mono mono-enemy mono-enemy-lg' : 'mono mono-enemy'} aria-hidden="true">
      {primary ? bossMonogram(name) : initials(name).toUpperCase()}
    </span>
  );
}
