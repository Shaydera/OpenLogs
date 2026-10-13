import type { CastsReport, SpellCasts } from '../../api/types';
import { spellIcon } from '../../icons';
import { formatCpm, formatDuration, formatInteger, formatShare } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { type CastsSortKey, useApp } from '../../store';
import { GameIcon } from '../GameIcon';
import { classColor, shortName } from '../overview/players';
import { PlayerIcon } from '../reports/PlayerName';
import { barWidth, reportSpellName, rosterIndex } from '../reports/reportData';

export function CastsTab({ report }: { report: CastsReport }) {
  const hideProcs = useApp((s) => s.hideProcs);
  const range = useApp((s) => s.range);
  const openPlayer = useApp((s) => s.openPlayer);
  const openAbilityOf = useApp((s) => s.openAbilityOf);
  // Kept in the store, so Back from a spell's ability page returns to the same player and sort.
  const selectedId = useApp((s) => s.castsPlayer);
  const selectCastsPlayer = useApp((s) => s.selectCastsPlayer);
  const sort = useApp((s) => s.castsSort);
  const setCastsSort = useApp((s) => s.setCastsSort);
  if (report.players.length === 0) {
    return (
      <section className="panel panel-pad">
        <h2 className="h2">{t('tabs.casts')}</h2>
        <p className="muted">{t('casts.none')}</p>
      </section>
    );
  }
  const roster = rosterIndex(report.roster);
  const minutes = report.durationMs / 60_000;
  const cpm = (casts: number) => (minutes > 0 ? formatCpm(casts / minutes) : '—');
  const visible = (spells: SpellCasts[]) => spells.filter((s) => !hideProcs || !s.procTrigger);
  const players = report.players
    .map((p) => {
      const spells = visible(p.spells);
      return { player: p.player, spells, casts: spells.reduce((sum, s) => sum + s.casts, 0) };
    })
    .sort((a, b) => b.casts - a.casts || a.player - b.player);
  const raidCasts = players.reduce((sum, p) => sum + p.casts, 0);
  const top = Math.max(1, ...players.map((p) => p.casts));
  const selected = players.find((p) => p.player === selectedId) ?? players[0];
  const selectedInfo = selected ? roster.get(selected.player) : undefined;
  const color = classColor(selectedInfo?.classToken ?? null);
  const name = (id: number) => shortName(roster.get(id)?.name ?? '?');

  // Rows without an uptime ("—") stay last in both directions; equal values in the order of the first cast.
  const compare = (a: SpellCasts, b: SpellCasts) => {
    if (sort.key === 'uptime' && (a.uptime === null) !== (b.uptime === null)) return a.uptime === null ? 1 : -1;
    const diff = sort.key === 'uptime' ? (a.uptime ?? 0) - (b.uptime ?? 0) : a.casts - b.casts;
    return (sort.desc ? -diff : diff) || a.firstCastMs - b.firstCastMs || a.spellId - b.spellId;
  };
  const rows = selected ? [...selected.spells].sort(compare) : [];
  const largest = Math.max(1, ...rows.map((s) => s.casts));
  const sortButton = (key: CastsSortKey, label: string) => {
    const on = sort.key === key;
    return (
      <button
        type="button"
        className={on ? 'sort-btn sort-btn-on' : 'sort-btn'}
        onClick={() => setCastsSort(on ? { key, desc: !sort.desc } : { key, desc: true })}
      >
        {label}
        {on && ` ${sort.desc ? '↓' : '↑'}`}
      </button>
    );
  };

  return (
    <div className="casts-layout">
      <section className="panel casts-players" aria-labelledby="casts-title">
        <div className="panel-head panel-head-casts">
          <h2 className="h2" id="casts-title">
            {t('casts.byPlayer')}
          </h2>
          <span className="casts-summary">
            <span className="num value-text">{formatInteger(raidCasts)}</span> {t('casts.castsUnit', { count: raidCasts })}
            {' · '}
            <span className="num value-text">{cpm(raidCasts)}</span> {t('casts.raidCpm')}
          </span>
        </div>
        <div className="scroll-x">
          <div className="casts-player-rows" role="group" aria-label={t('casts.byPlayer')}>
            <div className="cast-prow cast-prow-head" aria-hidden="true">
              <span />
              <span className="cap rrow-cap">{t('report.player')}</span>
              <span className="cap rrow-cap">{t('casts.role')}</span>
              <span className="cap rrow-cap">{t('casts.casts')}</span>
              <span className="cap rrow-cap rrow-end">{t('casts.cpm')}</span>
              <span className="cap rrow-cap rrow-end">{t('casts.spells')}</span>
            </div>
            {players.map((p) => {
              const info = roster.get(p.player);
              const on = p.player === selected?.player;
              return (
                <button
                  key={p.player}
                  type="button"
                  className={on ? 'cast-prow cast-prow-sel' : 'cast-prow'}
                  aria-pressed={on}
                  onClick={() => selectCastsPlayer(p.player)}
                >
                  <PlayerIcon player={info} />
                  <span className="cast-name" style={{ color: classColor(info?.classToken ?? null) }}>
                    {info ? shortName(info.name) : t('report.unknownPlayer')}
                  </span>
                  {info?.role ? <span className="role-pill">{t(`role.short.${info.role}`)}</span> : <span />}
                  <span className="cast-bar">
                    <span className="bar bar-lg" aria-hidden="true">
                      <span style={{ width: barWidth((p.casts / top) * 100), background: classColor(info?.classToken ?? null) }} />
                    </span>
                    <span className="num cast-count">{formatInteger(p.casts)}</span>
                  </span>
                  <span className="num rrow-end">{cpm(p.casts)}</span>
                  <span className="num rrow-end text-muted">{formatInteger(p.spells.length)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>
      {selected && (
        <section className="panel casts-spells" aria-labelledby="casts-player-title">
          <div className="panel-head panel-head-side">
            <PlayerIcon player={selectedInfo} size={36} />
            <div className="side-title">
              <h2 className="h2" id="casts-player-title">
                <span style={{ color }}>{name(selected.player)}</span> <span className="casts-title-suffix">{t('casts.spellCasts')}</span>
              </h2>
              <span className="side-sub">
                {selectedInfo?.specName && (
                  <>
                    {selectedInfo.specName}
                    {' · '}
                  </>
                )}
                <span className="num value-text">{formatInteger(selected.casts)}</span> {t('casts.castsUnit', { count: selected.casts })}
                {' · '}
                <span className="num value-text">{cpm(selected.casts)}</span> {t('casts.cpm')}
                {' · '}
                {t('casts.spellCount', { count: selected.spells.length })}
              </span>
            </div>
            <button type="button" className="link-accent" onClick={() => void openPlayer(selected.player)}>
              {t('report.playerDetails')}
            </button>
          </div>
          {rows.length === 0 ? (
            <div className="casts-empty">{t('casts.onlyProcs')}</div>
          ) : (
            <div className="scroll-x">
              <div className="casts-spell-rows" role="table" aria-label={t('casts.tableLabel', { name: name(selected.player) })}>
                <div role="row" className="cast-srow cast-srow-head">
                  <span role="columnheader" />
                  <span role="columnheader" className="cap rrow-cap">
                    {t('casts.spell')}
                  </span>
                  <span role="columnheader">{sortButton('amount', t('report.amount'))}</span>
                  <span role="columnheader" className="rrow-end">
                    {sortButton('uptime', t('casts.uptime'))}
                  </span>
                  <span role="columnheader" className="rrow-end">
                    {sortButton('cpm', t('casts.cpm'))}
                  </span>
                </div>
                {rows.map((s) => {
                  const spellName = reportSpellName(report.spells, s.spellId);
                  return (
                    <div role="row" className="cast-srow" key={s.spellId}>
                      <span role="cell">
                        <GameIcon name={spellName} icon={spellIcon(s.spellId)} />
                      </span>
                      <span role="cell" className="cast-spell">
                        {s.link ? (
                          <button
                            type="button"
                            className="link-btn cast-spell-name"
                            onClick={() => s.link && void openAbilityOf(selected.player, s.link.spellId, s.link.metric)}
                          >
                            {spellName}
                          </button>
                        ) : (
                          <span className="cast-spell-name">{spellName}</span>
                        )}
                        {s.procTrigger && <span className="rtag">{t('casts.proc')}</span>}
                      </span>
                      <span role="cell" className="cast-spell-bar">
                        <span className="bar bar-lg" aria-hidden="true">
                          <span style={{ width: barWidth((s.casts / largest) * 100), background: color }} />
                        </span>
                        <span className="num cast-spell-count">{formatInteger(s.casts)}</span>
                      </span>
                      <span role="cell" className="num rrow-end">
                        {s.uptime !== null ? formatShare(s.uptime * 100) : <span className="dash">—</span>}
                      </span>
                      <span role="cell" className="num rrow-end">
                        {cpm(s.casts)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="casts-note">{t(range ? 'casts.noteRange' : 'casts.note', { duration: formatDuration(report.durationMs) })}</div>
        </section>
      )}
    </div>
  );
}
