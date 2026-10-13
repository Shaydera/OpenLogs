import { useState } from 'react';
import { bossIcon, useIconSrc } from '../icons';
import { bossMonogram } from '../monogram';

/**
 * The boss's Encounter Journal portrait, else a monogram tile — also for
 * Mythic+ runs, whose rows have no encounter (0). `large` is the Overview header's portrait.
 */
export function BossTile({ encounterId, name, large = false }: { encounterId: number; name: string; large?: boolean }) {
  const src = useIconSrc(encounterId > 0 ? bossIcon(encounterId) : null);
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
