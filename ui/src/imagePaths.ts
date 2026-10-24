// No imports and only erasable TypeScript: scripts/fetch-images.mjs runs this file in Node to fetch every image the app can show.

export const MELEE_ICON = 'ability_meleedamage';
export const ENVIRONMENT_ICON = 'spell_nature_earthquake';
/** Icons shown by name instead of through a spell: melee swings and environmental damage. */
export const NAMED_ICONS = [MELEE_ICON, ENVIRONMENT_ICON] as const;
export type NamedIcon = (typeof NAMED_ICONS)[number];

export const classIconName = (token: string): string => `classicon_${token.toLowerCase()}`;

export const iconPath = (name: string): string => `icons/large/${name}.jpg`;
export const portraitPath = (name: string): string => `journal/${name}.png`;
export const mapPath = (map: { zone: number; floor: number | null }): string =>
  `maps/enus/original/${map.floor === null ? map.zone : `${map.zone}-${map.floor}`}.jpg`;
