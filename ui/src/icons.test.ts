import { describe, expect, it } from 'vitest';
import { decodeSpellIcons } from './gameData';
import { bossIcon, classIcon, iconSrc, specIcon, spellIcon } from './icons';

const ICONS = 'https://wow.zamimg.com/images/wow/icons/large/';

describe('iconSrc', () => {
  const tables = {
    // Spells 5, 99 and 44425; 99 and 44425 share an icon.
    spells: decodeSpellIcons({ names: ['spell_normal', 'spell_holy_magicalsentry'], ids: [5, 94, 44326], icons: [0, 1, 1] }),
    portraits: { '3492': 'ui-ej-boss-ulatek' },
  };

  it('finds spell icons in the exported table', () => {
    expect(iconSrc(spellIcon(5), tables)).toBe(`${ICONS}spell_normal.jpg`);
    expect(iconSrc(spellIcon(44425), tables)).toBe(`${ICONS}spell_holy_magicalsentry.jpg`);
    expect(iconSrc(spellIcon(6), tables)).toBeNull();
    expect(iconSrc(spellIcon(0), tables)).toBe(`${ICONS}ability_meleedamage.jpg`);
    expect(iconSrc(spellIcon(5), { spells: null, portraits: null }), 'tables still loading').toBeNull();
  });

  it('knows class and spec icons without game data and boss portraits with it', () => {
    const none = { spells: null, portraits: null };
    expect(iconSrc(classIcon(8), none)).toBe(`${ICONS}classicon_mage.jpg`);
    expect(iconSrc(specIcon(62), none)).toBe(`${ICONS}spell_holy_magicalsentry.jpg`);
    expect(iconSrc(bossIcon(3492), tables)).toBe('https://wow.zamimg.com/images/wow/journal/ui-ej-boss-ulatek.png');
    expect(iconSrc(bossIcon(1), tables)).toBeNull();
  });
});
