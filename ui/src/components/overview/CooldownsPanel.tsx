import { useState } from 'react';
import type { CooldownEntry, QuickOverview } from '../../api/types';
import { spellIcon } from '../../icons';
import { formatEventTime } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { GameIcon } from '../GameIcon';
import { PlayerName } from '../reports/PlayerName';
import { ROLE_ORDER, roleTitle, sortedRoster, spellName } from './players';
import { minuteTicks, percentOf } from './timelineGeometry';

type Filter = 'all' | 'offensive' | 'raid_defensive';

const FILTERS: { key: Filter; label: 'cooldowns.all' | 'cooldowns.offensive' | 'cooldowns.raidDefensive' }[] = [
  { key: 'all', label: 'cooldowns.all' },
  { key: 'offensive', label: 'cooldowns.offensive' },
  { key: 'raid_defensive', label: 'cooldowns.raidDefensive' },
];

function matches(filter: Filter, use: CooldownEntry): boolean {
  if (filter === 'all') return true;
  if (filter === 'offensive') return use.category === 'offensive' || use.category === 'bloodlust';
  return use.category === 'raid_defensive';
}

export function CooldownsPanel({ overview }: { overview: QuickOverview }) {
  const [filter, setFilter] = useState<Filter>('all');
  const duration = overview.timeline.durationMs;
  const roster = sortedRoster(overview);
  const lines = [
    ...overview.timeline.markers.bloodlust.map((c) => ({ key: `l-${c.player}-${c.t}`, t: c.t, kind: 'lust' })),
    ...overview.timeline.markers.deaths.map((d) => ({ key: `d-${d.player}-${d.t}`, t: d.t, kind: 'death' })),
  ];

  return (
    <section className="panel" aria-labelledby="cooldowns-title">
      <div className="panel-head panel-head-ov">
        <h2 id="cooldowns-title" className="h2">
          {t('cooldowns.title')}
        </h2>
        <div className="filters" role="group" aria-label={t('cooldowns.filter')}>
          {FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={filter === option.key ? 'pill on' : 'pill'}
              aria-pressed={filter === option.key}
              onClick={() => setFilter(option.key)}
            >
              {t(option.label)}
            </button>
          ))}
        </div>
      </div>
      <div className="cd-scroll">
        <div className="cd-body">
          <div className="cdrow cdrow-axis" aria-hidden="true">
            <span />
            <div className="track track-axis">
              {minuteTicks(duration).map((tick) => (
                <span key={tick.label} className="num" style={{ left: `${tick.leftPct}%` }}>
                  {tick.label}
                </span>
              ))}
            </div>
          </div>
          {ROLE_ORDER.map((role) => {
            const players = roster.filter((p) => p.role === role);
            if (players.length === 0) return null;
            return (
              <div key={role ?? 'unknown'} role="group" aria-label={roleTitle(role)}>
                <div className="cap cd-role" aria-hidden="true">
                  {roleTitle(role)}
                </div>
                {players.map((player) => (
                  <div key={player.actorId} className="cdrow">
                    <span className="cd-name">
                      <PlayerName player={player} size={18} />
                    </span>
                    <div className="track">
                      {lines.map((line) => (
                        <span key={line.key} className={`vline vline-${line.kind}`} style={{ left: `${percentOf(line.t, duration)}%` }} />
                      ))}
                      {overview.cooldowns
                        .filter((use) => use.player === player.actorId && matches(filter, use))
                        .map((use) => {
                          const name = spellName(overview, use.spellId);
                          const label = t('cooldowns.use', { spell: name, time: formatEventTime(use.t) });
                          return (
                            <span key={`${use.spellId}-${use.t}`} className="cd" style={{ left: `${percentOf(use.t, duration)}%` }} title={label}>
                              <GameIcon name={name} icon={spellIcon(use.spellId)} size={22} label={label} />
                            </span>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
