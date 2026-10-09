import { Fragment, useState } from 'react';
import type { PlayerAbility, PlayerDetail, PlayerRef } from '../../api/types';
import { classIconUrl, spellIconUrl } from '../../icons';
import { formatAmountTenths, formatCount, formatShare } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { GameIcon } from '../GameIcon';
import { classColor, shortName } from '../overview/players';
import { reportSpellName, rosterIndex } from '../reports/reportData';

const DASH = '—';
/** The expanded pet row's parts, controlled by the pet row's disclosure. */
const PET_ROWS_ID = 'player-pet-abilities';

/**
 * In Reattributed mode an Evoker's own buff share is credited to his support row and deducted again; on
 * his own page the deduction is folded into that row instead of reading as support to himself.
 */
function foldOwnShare(abilities: PlayerAbility[], player: number): PlayerAbility[] {
  const rows = abilities.map((row) => ({ ...row }));
  const folded = rows.filter((row) => {
    if (row.kind !== 'support_deducted' || row.actorId !== player) return true;
    const given = rows.find((other) => other.kind === 'support_given' && other.spellId === row.spellId && other.actorId === player);
    if (!given) return true;
    given.amount += row.amount;
    return false;
  });
  return folded.sort((a, b) => b.amount - a.amount);
}

/** Own rows merged by name, pets in one row. */
export function PlayerAbilities({ detail }: { detail: PlayerDetail }) {
  const openAbility = useApp((s) => s.openAbility);
  const [petsOpen, setPetsOpen] = useState(false);
  const healing = detail.metric === 'healing';
  const roster = rosterIndex(detail.roster);
  const abilities = foldOwnShare(detail.abilities, detail.player.actorId);
  const largest = Math.max(1, ...abilities.map((a) => Math.abs(a.amount)));
  const color = classColor(detail.player.classToken);
  const grid = healing ? 'ab-row ab-row-heal' : 'ab-row';
  const caps = [
    t('report.ability'),
    t(healing ? 'tabs.healing' : 'player.damage'),
    t('report.share'),
    ...(healing ? [t('report.overheal')] : []),
    t('player.casts'),
    t('report.hits'),
    t('report.crit'),
    t('player.avgHit'),
    t('player.maxHit'),
  ];
  return (
    <section className="panel panel-clip" id="p-abilities" aria-labelledby="player-abilities-title">
      <div className="panel-head panel-head-ab">
        <h2 id="player-abilities-title" tabIndex={-1} className="h2">
          {t('player.abilities')}
        </h2>
        <span className="chart-hint">{t('player.abilitiesHint')}</span>
      </div>
      {abilities.length === 0 ? (
        <p className="muted pad">{t('player.noAbilities')}</p>
      ) : (
        <div className="scroll-x">
          <div className={healing ? 'ab-rows ab-rows-heal' : 'ab-rows'} role="table" aria-label={t('report.abilitiesOf', { name: shortName(detail.player.name) })}>
            <div className={`${grid} ab-row-head`} role="row">
              <span role="columnheader">
                <span className="sr-only">{t('player.icon')}</span>
              </span>
              {caps.map((cap, i) => (
                <span key={cap} role="columnheader" className={i >= 2 ? 'cap ab-cap ab-end' : 'cap ab-cap'}>
                  {cap}
                </span>
              ))}
            </div>
            {abilities.map((row) => (
              <Fragment key={`${row.kind}-${row.spellId}-${row.actorId}`}>
                <AbilityLine
                  row={row}
                  detail={detail}
                  evoker={roster.get(row.actorId)}
                  widthPct={(Math.abs(row.amount) / largest) * 100}
                  color={color}
                  grid={grid}
                  healing={healing}
                  onOpen={openAbility}
                  petsOpen={petsOpen}
                  onTogglePets={detail.petAbilities.length > 0 ? () => setPetsOpen(!petsOpen) : undefined}
                />
                {/* The pet row expanded: every pet's abilities, each with its ability page. */}
                {row.kind === 'pet' && petsOpen && (
                  <div role="rowgroup" id={PET_ROWS_ID} aria-label={t('player.petAbilities')}>
                    {detail.petAbilities.map((part) => (
                      <AbilityLine
                        key={`${part.spellId}-${part.actorName}`}
                        row={part}
                        detail={detail}
                        evoker={undefined}
                        widthPct={(Math.abs(part.amount) / largest) * 100}
                        color={color}
                        grid={`${grid} ab-row-sub`}
                        healing={healing}
                        onOpen={openAbility}
                        part
                      />
                    ))}
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

interface LineProps {
  row: PlayerAbility;
  detail: PlayerDetail;
  evoker: PlayerRef | undefined;
  widthPct: number;
  color: string;
  grid: string;
  healing: boolean;
  onOpen: (spellId: number, pet: string | null) => Promise<void>;
  /** The pet row: whether its parts are shown, and the disclosure's toggle (none without parts). */
  petsOpen?: boolean;
  onTogglePets?: () => void;
  /** One pet ability of the expanded pet row. */
  part?: boolean;
}

function AbilityLine({ row, detail, evoker, widthPct, color, grid, healing, onOpen, petsOpen = false, onTogglePets, part = false }: LineProps) {
  // A pet ability of the expanded pet row reads like an own row and opens the pet's ability page.
  const own = row.kind === 'own' || part;
  const pet = row.kind === 'pet' && !part;
  const given = row.kind === 'support_given';
  const deducted = row.kind === 'support_deducted';
  const label = pet
    ? t('player.petGroup', { name: shortName(row.actorName), count: row.pets })
    : deducted
      ? row.actorId === detail.player.actorId
        ? t('report.ownShareDeducted')
        : t('report.reattributedTo', { name: shortName(evoker?.name ?? row.actorName) })
      : reportSpellName(detail.spells, row.spellId);
  const icon = deducted && evoker?.classId != null ? classIconUrl(evoker.classId) : spellIconUrl(row.spellId);
  const fill = deducted ? 'bar-fill-negative' : row.aug || given ? 'bar-fill-support' : undefined;
  const stats = own && row.hits > 0;
  return (
    <div className={deducted ? `${grid} ab-row-negative` : grid} role="row">
      <span role="cell">
        <GameIcon name={label} src={icon} />
      </span>
      <span role="cell" className="ab-name-cell">
        {own ? (
          <button type="button" className="ab-name ab-name-link" onClick={() => void onOpen(row.spellId, part ? row.actorName : null)}>
            {label}
          </button>
        ) : pet && onTogglePets ? (
          <button
            type="button"
            className="ab-name ab-name-link ab-disclosure"
            aria-expanded={petsOpen}
            aria-controls={petsOpen ? PET_ROWS_ID : undefined}
            onClick={onTogglePets}
          >
            {label}
            <svg className={petsOpen ? 'chevron chevron-open' : 'chevron'} width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        ) : (
          <span className="ab-name">{label}</span>
        )}
        {part && <span className="ab-pet">{shortName(row.actorName)}</span>}
        {row.aug && <span className="rtag rtag-support">{t('player.augTag')}</span>}
        {given && <span className="rtag rtag-support">{t('report.supportTag')}</span>}
        {own && row.ticks * 2 > row.hits && <span className="rtag">{t(healing ? 'player.hotTag' : 'player.dotTag')}</span>}
      </span>
      <span role="cell" className="ab-amount">
        <span className="bar bar-md" aria-hidden="true">
          <span className={fill} style={{ width: `${widthPct}%`, background: fill ? undefined : color }} />
        </span>
        <span className="num ab-value">{formatAmountTenths(row.amount)}</span>
      </span>
      <span role="cell" className="num ab-end ab-share">
        {row.amount > 0 && detail.total > 0 ? formatShare((row.amount / detail.total) * 100) : ''}
      </span>
      {healing && (
        <span role="cell" className="num ab-end">
          {own || pet ? formatAmountTenths(row.overheal) : DASH}
        </span>
      )}
      <span role="cell" className="num ab-end">
        {row.casts !== null ? formatCount(row.casts) : DASH}
      </span>
      <span role="cell" className="num ab-end">
        {own ? formatCount(row.hits) : DASH}
      </span>
      <span role="cell" className="num ab-end">
        {stats ? formatShare((row.crits / row.hits) * 100) : DASH}
      </span>
      <span role="cell" className="num ab-end">
        {stats ? formatAmountTenths(row.amount / row.hits) : DASH}
      </span>
      <span role="cell" className="num ab-end">
        {own && row.maxHit > 0 ? formatAmountTenths(row.maxHit) : DASH}
      </span>
    </div>
  );
}
