import { useState } from 'react';
import { t } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/i18n';

const SECTIONS: { id: string; label: MessageKey }[] = [
  { id: 'p-dps', label: 'player.damageOverTime' },
  { id: 'p-abilities', label: 'player.abilities' },
  { id: 'p-timeline', label: 'player.castsAndBuffs' },
  { id: 'p-aug', label: 'player.section.aug' },
  { id: 'p-taken', label: 'player.damageTaken' },
];

/** Each pill scrolls to its section and moves the focus to its heading; the last one used stays marked. */
export function PlayerSectionNav({ healing }: { healing: boolean }) {
  const [active, setActive] = useState(SECTIONS[0].id);
  const go = (id: string) => {
    setActive(id);
    const section = document.getElementById(id);
    section?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    section?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  };
  return (
    <nav className="subnav" aria-label={t('player.sections')}>
      {SECTIONS.map((section) => (
        <button
          key={section.id}
          type="button"
          className={section.id === active ? 'subnav-pill subnav-pill-on' : 'subnav-pill'}
          aria-current={section.id === active ? 'true' : undefined}
          onClick={() => go(section.id)}
        >
          {section.id === 'p-dps' && healing ? t('player.healingOverTime') : t(section.label)}
        </button>
      ))}
    </nav>
  );
}
