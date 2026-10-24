import { useEffect, useSyncExternalStore } from 'react';
import classesSpecs from '../../crates/openlogs-gamedata/data/classes_specs.json';
import { type IconTables, iconTables, loadIconTables, spellIconName, subscribeIconTables } from './gameData';
import { imageUrl } from './imageBase';
import { MELEE_ICON, type NamedIcon, classIconName, iconPath, portraitPath } from './imagePaths';

/** What a game icon shows: `spell/<id>`, `class/<id>`, `spec/<id>`, `icon/<name>` or `boss/<encounter id>`. */
export type IconRef = string;

export const spellIcon = (spellId: number): IconRef => `spell/${spellId}`;
export const classIcon = (classId: number): IconRef => `class/${classId}`;
export const specIcon = (specId: number): IconRef => `spec/${specId}`;
export const namedIcon = (name: NamedIcon): IconRef => `icon/${name}`;
/** A boss's Encounter Journal portrait; none for encounters without one. */
export const bossIcon = (encounterId: number): IconRef => `boss/${encounterId}`;

const classTokens = new Map(classesSpecs.classes.map((c) => [c.id, c.token]));
const specIcons = new Map(classesSpecs.specs.map((s) => [s.id, s.icon]));

/** The image URL of `ref`; `null` when there is none, also while the tables are loading. */
export function iconSrc(ref: IconRef, tables: IconTables): string | null {
  const slash = ref.indexOf('/');
  const kind = ref.slice(0, slash);
  const value = ref.slice(slash + 1);
  const icon = (name: string | null | undefined) => (name ? imageUrl(iconPath(name)) : null);
  switch (kind) {
    case 'spell': {
      const id = Number(value);
      if (id === 0) return icon(MELEE_ICON);
      return tables.spells ? icon(spellIconName(tables.spells, id)) : null;
    }
    case 'class': {
      const token = classTokens.get(Number(value));
      return icon(token && classIconName(token));
    }
    case 'spec':
      return icon(specIcons.get(Number(value)));
    case 'icon':
      return icon(value);
    case 'boss': {
      const portrait = tables.portraits?.[value];
      return portrait ? imageUrl(portraitPath(portrait)) : null;
    }
    default:
      return null;
  }
}

/** Resolves an icon for an `<img>`, loading the icon tables on first use. */
export function useIconSrc(ref: IconRef | null): string | null {
  const tables = useSyncExternalStore(subscribeIconTables, iconTables);
  useEffect(loadIconTables, []);
  return ref === null ? null : iconSrc(ref, tables);
}
