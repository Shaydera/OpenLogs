import { useState } from 'react';
import { initials } from '../monogram';

const ICON_SIZE = 22;
const SMALL_ICON_SIZE = 18;

const hasStockSize = (size: number) => size === ICON_SIZE || size === SMALL_ICON_SIZE;

interface Props {
  src: string;
  /** Edge in px; sizes other than the stylesheet's 22 and 18 are set inline. */
  size?: number;
  /** Accessible name; omit for decorative icons. */
  label?: string;
  /** What the icon shows (spell, player, item): its initials fill the tile when the image is missing. */
  name: string;
}

/**
 * A framed game icon. A missing image (the icon protocol answers 404 for unknown spells, failed
 * downloads and offline starts) becomes a monogram tile.
 */
export function GameIcon({ src, size = ICON_SIZE, label, name }: Props) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) return <MonogramTile name={name} size={size} label={label} />;
  return (
    <img
      className={size <= SMALL_ICON_SIZE ? 'ico-s' : 'ico'}
      src={src}
      alt={label ?? ''}
      style={hasStockSize(size) ? undefined : { width: size, height: size }}
      onError={() => setFailedSrc(src)}
    />
  );
}

/** A tile with the initials of `name`, e.g. for a missing icon. */
export function MonogramTile({ name, size = ICON_SIZE, label }: { name: string; size?: number; label?: string }) {
  const style = hasStockSize(size) ? undefined : { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.4)) };
  return (
    <span
      className={size <= SMALL_ICON_SIZE ? 'ph-ico-s' : 'ph-ico'}
      style={style}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {initials(name)}
    </span>
  );
}
