import { useState } from 'react';
import { bossIconUrl } from '../icons';
import { bossMonogram } from '../monogram';

/**
 * The boss portrait (Warcraft Logs, Encounter Journal or shipped icon), else a monogram tile.
 * `large` is the fight header's portrait.
 */
export function BossTile({ encounterId, name, large = false }: { encounterId: number; name: string; large?: boolean }) {
  const src = encounterId > 0 ? bossIconUrl(encounterId) : null;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (src !== null && failedSrc !== src) {
    return <img className={large ? 'boss-icon boss-icon-lg' : 'boss-icon'} src={src} alt="" onError={() => setFailedSrc(src)} />;
  }
  return (
    <div className={large ? 'mono mono-lg' : 'mono'} aria-hidden="true">
      {bossMonogram(name)}
    </div>
  );
}
