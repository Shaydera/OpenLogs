/** Letters of a boss tile: the first two without a leading "The", e.g. `UL`, `LO`. */
export function bossMonogram(name: string): string {
  return name.replace(/^The /, '').slice(0, 2).toUpperCase();
}

/**
 * Letters of a missing icon: the first letters of the first two words as written, e.g. `AB`
 * (Arcane Barrage), `Fo` (Font of Venomous Rage), `M` (Melee).
 */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('');
}
