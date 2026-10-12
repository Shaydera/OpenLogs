import { Fragment, type ReactNode, useId, useState } from 'react';
import type { PlayerAbility, PlayerDetail, PlayerRef, SupportRecipient, TargetRef } from '../../api/types';
import { spellIconUrl } from '../../icons';
import { formatAmountTenths, formatCount, formatShare } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { GameIcon } from '../GameIcon';
import { classColor, shortName } from '../overview/players';
import { toneClass } from '../reports/augSplit';
import { PlayerIcon } from '../reports/PlayerName';
import { barWidth, reportSpellName, rosterIndex } from '../reports/reportData';
import { type PopupAnchor, SegmentPopup, StackedFill, targetRows, usePanelPopup } from '../reports/TargetParts';
import { type GroupPart, type TargetGroup, splitByGroup, targetColors } from '../reports/targetGroups';

const DASH = '—';
/** The expanded pet row's parts, controlled by the pet row's disclosure. */
const PET_ROWS_ID = 'player-pet-abilities';

const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');

interface Toggle {
  open: boolean;
  onToggle: () => void;
  /** Space-separated ids of the parts it shows. */
  controls: string;
}

function useOpenRows() {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return { isOpen: (key: string) => open.has(key), toggle };
}

/** The Aug split of a line's value, or one target group of a line's strip. */
interface AbilityPopup {
  kind: 'aug' | 'segment';
  key: string;
  row: PlayerAbility;
  label: string;
  part?: GroupPart;
}

interface Table {
  detail: PlayerDetail;
  roster: Map<number, PlayerRef>;
  grid: string;
  healing: boolean;
  reattributed: boolean;
  largest: number;
  color: string;
  groups: TargetGroup[];
  keyOf: (target: TargetRef) => string;
  colorOf: (target: TargetRef) => string;
  popupId: string;
  popup: AbilityPopup | null;
  openPopup: (data: AbilityPopup, anchor: HTMLElement | null) => void;
  closePopup: () => void;
}

const rowKey = (row: PlayerAbility, part: boolean) => (part ? `part-${row.spellId}-${row.actorName}` : `${row.kind}-${row.spellId}-${row.actorId}`);

/** Own rows merged by name, pets in one row; an Evoker's support rows open into the players they supported. */
export function PlayerAbilities({ detail }: { detail: PlayerDetail }) {
  const openAbility = useApp((s) => s.openAbility);
  const { isOpen, toggle } = useOpenRows();
  const baseId = useId();
  const popupId = useId();
  const { panel, popup, open: openPopup, close: closePopup } = usePanelPopup<AbilityPopup>(detail);
  const healing = detail.metric === 'healing';
  const reattributed = detail.attribution === 'reattributed';
  const abilities = detail.abilities;
  const roster = rosterIndex(detail.roster);
  const table: Table = {
    detail,
    roster,
    grid: classes('ab-row', healing && 'ab-row-heal', reattributed && 'ab-row-aug'),
    healing,
    reattributed,
    largest: Math.max(1, ...abilities.map((a) => Math.abs(a.amount))),
    color: classColor(detail.player.classToken),
    ...targetColors(detail.metric, detail.colorGroups, roster),
    popupId,
    popup: popup?.data ?? null,
    openPopup: (data, anchor) => openPopup(data, anchor, anchor?.closest<HTMLElement>('[role="row"]') ?? null),
    closePopup,
  };
  const caps = [
    t('report.ability'),
    t(healing ? 'tabs.healing' : 'player.damage'),
    ...(reattributed ? [t('player.augColumn')] : []),
    t('report.share'),
    ...(healing ? [t('report.overheal')] : []),
    t('player.casts'),
    t('report.hits'),
    t('report.crit'),
    t('player.avgHit'),
    t('player.maxHit'),
  ];
  return (
    <section className="panel ab-panel" id="p-abilities" aria-labelledby="player-abilities-title" ref={panel}>
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
          <div
            className={classes('ab-rows', healing && 'ab-rows-heal', reattributed && 'ab-rows-aug')}
            role="table"
            aria-label={t('report.abilitiesOf', { name: shortName(detail.player.name) })}
          >
            <div className={`${table.grid} ab-row-head`} role="row">
              <span role="columnheader">
                <span className="sr-only">{t('player.icon')}</span>
              </span>
              {caps.map((cap, i) => (
                <span key={cap} role="columnheader" className={i >= 2 ? 'cap ab-cap ab-end' : 'cap ab-cap'}>
                  {cap}
                </span>
              ))}
            </div>
            {abilities.map((row, index) => {
              const key = rowKey(row, false);
              const petParts = row.kind === 'pet' ? detail.petAbilities : [];
              const targets = row.kind === 'support_given' ? [] : row.targets;
              const parts = petParts.length + targets.length + row.recipients.length;
              const controls = row.kind === 'pet' ? PET_ROWS_ID : `${baseId}-r${index}`;
              const open = isOpen(key);
              const name = rowLabel(row, detail);
              return (
                <Fragment key={key}>
                  <AbilityLine
                    row={row}
                    table={table}
                    onOpen={openAbility}
                    toggle={parts > 0 ? { open, onToggle: () => toggle(key), controls } : undefined}
                  />
                  {open && (
                    <div role="rowgroup" id={controls} aria-label={partsLabel(row, name, petParts.length > 0, healing)}>
                      {petParts.map((part) => (
                        <AbilityLine key={rowKey(part, true)} row={part} table={table} onOpen={openAbility} part />
                      ))}
                      {targets.length > 0 && <TargetLines row={row} name={name} table={table} />}
                      {row.recipients.map((recipient) => {
                        const recipientKey = `${key}/${recipient.player}`;
                        return (
                          <RecipientLines
                            key={recipient.player}
                            recipient={recipient}
                            table={table}
                            idPrefix={`${controls}-p${recipient.player}`}
                            open={isOpen(recipientKey)}
                            onToggle={() => toggle(recipientKey)}
                          />
                        );
                      })}
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
      {popup && <AbilityPopupView popup={popup.data} at={popup.at} table={table} />}
    </section>
  );
}

function partsLabel(row: PlayerAbility, name: string, hasPets: boolean, healing: boolean): string {
  if (row.kind === 'pet' && hasPets) return t(row.targets.length > 0 ? 'player.petAbilitiesAndTargets' : 'player.petAbilities');
  if (row.kind === 'support_given') return t('player.supportedBy', { name });
  return targetsOf(name, healing);
}

const targetsOf = (name: string, healing: boolean) => t(healing ? 'targets.healedOf' : 'targets.of', { name });

function rowLabel(row: PlayerAbility, detail: PlayerDetail): string {
  if (row.kind === 'pet') return t('player.petGroup', { name: shortName(row.actorName), count: row.pets });
  if (row.kind === 'unmatched') return t('report.unmatchedHits');
  return reportSpellName(detail.spells, row.spellId);
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={open ? 'chevron chevron-open' : 'chevron'} width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** A line's label as the disclosure of its parts. */
function Disclosure({ toggle, children }: { toggle: Toggle; children: ReactNode }) {
  return (
    <button
      type="button"
      className="ab-name ab-name-link ab-disclosure"
      aria-expanded={toggle.open}
      aria-controls={toggle.open ? toggle.controls : undefined}
      onClick={toggle.onToggle}
    >
      {children}
      <Chevron open={toggle.open} />
    </button>
  );
}

function DotsIcon() {
  return (
    <span className="ph-ico" aria-hidden="true">
      …
    </span>
  );
}

function BlankCells({ count }: { count: number }) {
  return Array.from({ length: count }, (_, i) => <span key={i} role="cell" />);
}

/** The Aug value a line gave away; dotted and explaining itself by buff and Evoker on hover or focus. */
function AugValue({ row, popupKey, label, table }: { row: PlayerAbility; popupKey: string; label: string; table: Table }) {
  if (row.support <= 0) return <>{DASH}</>;
  const show = (anchor: HTMLElement) => table.openPopup({ kind: 'aug', key: popupKey, row, label }, anchor);
  const shown = table.popup?.kind === 'aug' && table.popup.key === popupKey;
  return (
    <button
      type="button"
      className="num dotted ab-aug-value"
      aria-describedby={shown ? table.popupId : undefined}
      onMouseEnter={(event) => show(event.currentTarget)}
      onMouseLeave={table.closePopup}
      onFocus={(event) => show(event.currentTarget)}
      onBlur={table.closePopup}
      onKeyDown={(event) => {
        if (event.key === 'Escape') table.closePopup();
      }}
    >
      {formatAmountTenths(-row.support)}
    </button>
  );
}

interface LineProps {
  row: PlayerAbility;
  table: Table;
  onOpen: (spellId: number, pet: string | null) => Promise<void>;
  toggle?: Toggle;
  /** One pet ability of the expanded pet row. */
  part?: boolean;
}

function AbilityLine({ row, table, onOpen, toggle, part = false }: LineProps) {
  const { detail, grid, healing, reattributed } = table;
  // A pet ability of the expanded pet row reads like an own row and opens the pet's ability page.
  const own = row.kind === 'own' || part;
  const pet = row.kind === 'pet' && !part;
  const given = row.kind === 'support_given';
  const unmatched = row.kind === 'unmatched';
  const label = part ? reportSpellName(detail.spells, row.spellId) : rowLabel(row, detail);
  const fill = unmatched ? 'bar-fill-negative' : row.aug || given ? 'bar-fill-support' : undefined;
  const stats = own && row.hits > 0;
  return (
    <div className={classes(grid, part && 'ab-row-sub', unmatched && 'ab-row-negative')} role="row">
      <span role="cell">{unmatched ? <DotsIcon /> : <GameIcon name={label} src={spellIconUrl(row.spellId)} />}</span>
      <span role="cell" className="ab-name-cell">
        {own ? (
          <>
            <button type="button" className="ab-name ab-name-link" onClick={() => void onOpen(row.spellId, part ? row.actorName : null)}>
              {label}
            </button>
            {toggle && (
              <button
                type="button"
                className="ab-chevron"
                aria-expanded={toggle.open}
                aria-controls={toggle.open ? toggle.controls : undefined}
                aria-label={targetsOf(label, healing)}
                onClick={toggle.onToggle}
              >
                <Chevron open={toggle.open} />
              </button>
            )}
          </>
        ) : toggle ? (
          <Disclosure toggle={toggle}>{label}</Disclosure>
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
          <span className={fill} style={{ width: `${(Math.abs(row.amount) / table.largest) * 100}%`, background: fill ? undefined : table.color }} />
        </span>
        <span className="num ab-value">{formatAmountTenths(row.amount)}</span>
      </span>
      {reattributed && (
        <span role="cell" className="num ab-end ab-aug">
          <AugValue row={row} popupKey={rowKey(row, part)} label={label} table={table} />
        </span>
      )}
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
      {/* Avg hit as logged, like max hit; the Aug column shows what moved away. */}
      <span role="cell" className="num ab-end">
        {stats ? formatAmountTenths((row.amount + row.support) / row.hits) : DASH}
      </span>
      <span role="cell" className="num ab-end">
        {own && row.maxHit > 0 ? formatAmountTenths(row.maxHit) : DASH}
      </span>
    </div>
  );
}

function TargetLines({ row, name, table }: { row: PlayerAbility; name: string; table: Table }) {
  const { grid, healing, reattributed } = table;
  const parts = splitByGroup(row.targets, table.groups, table.keyOf);
  const lines = targetRows(row.targets, { total: row.amount, roster: table.roster, colorOf: table.colorOf });
  const widest = Math.max(1, ...lines.map((line) => Math.abs(line.amount)));
  // Pets merge several abilities, whose hits the pet row does not add up either.
  const stats = row.kind === 'own';
  const caption = t('targets.count', { label: t(healing ? 'targets.healedPlayers' : 'targets.title'), count: row.targets.length });
  const shareOfRow = (amount: number) => (row.amount > 0 ? ` ${formatShare((amount / row.amount) * 100)}` : '');
  const stripLabel = [t('targets.splitOf', { name }), ...parts.map((part) => part.group.label + shareOfRow(part.amount))].join(', ');
  const key = rowKey(row, false);
  return (
    <>
      <div className={classes(grid, 'ab-row-sub')} role="row">
        <span role="cell" />
        <span role="cell" className="ab-name-cell">
          <span className="cap ab-strip-cap">{caption}</span>
        </span>
        <span role="cell" className="ab-amount">
          {parts.length > 0 && (
            <span className="bar bar-md" role="img" aria-label={stripLabel}>
              <StackedFill
                parts={parts}
                total={row.amount}
                widthPct={100}
                onSegment={(part, segment) => (segment ? table.openPopup({ kind: 'segment', key, row, label: name, part }, segment) : table.closePopup())}
              />
            </span>
          )}
          <span className="ab-value" />
        </span>
        {reattributed && <span role="cell" />}
        <span role="cell" className="cap ab-cap ab-end">
          {t('targets.ofAbility')}
        </span>
        <BlankCells count={healing ? 6 : 5} />
      </div>
      {lines.map((line) => (
        <div key={line.key} className={classes(grid, 'ab-row-sub')} role="row">
          <span role="cell" className="tswatch-cell">
            <span className="tswatch" style={{ background: line.swatch }} aria-hidden="true" />
          </span>
          <span role="cell" className="ab-name-cell">
            <span className="ab-name" style={line.nameColor ? { color: line.nameColor } : undefined}>
              {line.name}
              {line.note && <span className="side-note">{line.note}</span>}
            </span>
          </span>
          <span role="cell" className="ab-amount">
            <span className="bar bar-sm" aria-hidden="true">
              <span style={{ width: barWidth((Math.abs(line.amount) / widest) * 100), background: line.barColor }} />
            </span>
            <span className={line.amount < 0 ? 'num ab-value ab-value-negative' : 'num ab-value'}>{formatAmountTenths(line.amount)}</span>
          </span>
          {reattributed && <span role="cell" />}
          <span role="cell" className="num ab-end ab-share">
            {line.share === null ? '' : formatShare(line.share * 100)}
          </span>
          {healing && <span role="cell" />}
          <span role="cell" />
          <span role="cell" className="num ab-end">
            {stats ? formatCount(line.hits) : DASH}
          </span>
          <span role="cell" className="num ab-end">
            {stats && line.hits > 0 ? formatShare((line.crits / line.hits) * 100) : DASH}
          </span>
          <BlankCells count={2} />
        </div>
      ))}
    </>
  );
}

function AbilityPopupView({ popup, at, table }: { popup: AbilityPopup; at: PopupAnchor; table: Table }) {
  if (popup.kind === 'segment' && popup.part)
    return (
      <SegmentPopup
        id={table.popupId}
        at={at}
        part={popup.part}
        ofName={popup.label}
        total={popup.row.amount}
        metric={table.detail.metric}
        spells={table.detail.spells}
        roster={table.roster}
        list="targets"
        withHits={popup.row.kind === 'own'}
      />
    );
  return <AugPopup at={at} popup={popup} table={table} />;
}

/** "As logged", what each buff moved to its Evoker (with the buff's icon), and the value the table shows. */
function AugPopup({ at, popup, table }: { at: PopupAnchor; popup: AbilityPopup; table: Table }) {
  const { row, label } = popup;
  const { spells } = table.detail;
  const named = row.supportFrom.reduce((sum, share) => sum + share.amount, 0);
  return (
    <div role="tooltip" id={table.popupId} className="aug-tip" style={{ top: at.top, left: at.left }}>
      <div className="aug-tip-head">
        {row.kind === 'unmatched' ? <DotsIcon /> : <GameIcon name={label} src={spellIconUrl(row.spellId)} size={18} />}
        <span className="rpop-title">{label}</span>
        <span className="cap rrow-cap aug-tip-cap">{t('aug.popupTitle')}</span>
      </div>
      <div className="aug-tip-line">
        <span className="aug-tip-label">{t('aug.popupLogged')}</span>
        <span className="num">{formatAmountTenths(row.amount + row.support)}</span>
      </div>
      {/* By position: two Evokers can share a short name. */}
      {row.supportFrom.map((share, index) => {
        const buff = reportSpellName(spells, share.buffId);
        const evoker = table.roster.get(share.evoker);
        return (
          <div key={index} className="aug-tip-line">
            <span className="aug-tip-label aug-tip-buff">
              <GameIcon name={buff} src={spellIconUrl(share.buffId)} size={16} />
              {buff}
              <span className="ab-sep"> · </span>
              <span style={{ color: classColor(evoker?.classToken ?? null) }}>{evoker ? shortName(evoker.name) : t('report.unknownPlayer')}</span>
            </span>
            <span className={`num ${toneClass('loss')}`}>{formatAmountTenths(-share.amount)}</span>
          </div>
        );
      })}
      {row.support > named && (
        <div className="aug-tip-line">
          <span className="aug-tip-label">{t('aug.tipFromEvokers')}</span>
          <span className={`num ${toneClass('loss')}`}>{formatAmountTenths(named - row.support)}</span>
        </div>
      )}
      <div className="aug-tip-line aug-tip-line-total">
        <span className="aug-tip-label">{t('aug.popupShown')}</span>
        <span className="num">{formatAmountTenths(row.amount)}</span>
      </div>
    </div>
  );
}

/** A part line without hit statistics: a support amount and its bar. */
function PartLine({ table, depth, icon, name, amount, id }: { table: Table; depth: 1 | 2; icon: ReactNode; name: ReactNode; amount: number; id?: string }) {
  const { detail, grid, healing, reattributed } = table;
  return (
    <div className={classes(grid, 'ab-row-sub', depth === 2 && 'ab-row-sub2')} role="row" id={id}>
      <span role="cell">{icon}</span>
      <span role="cell" className="ab-name-cell">
        {name}
      </span>
      <span role="cell" className="ab-amount">
        <span className="bar bar-md" aria-hidden="true">
          <span className="bar-fill-support" style={{ width: `${(amount / table.largest) * 100}%` }} />
        </span>
        <span className="num ab-value">{formatAmountTenths(amount)}</span>
      </span>
      {reattributed && <span role="cell" />}
      <span role="cell" className="num ab-end ab-share">
        {amount > 0 && detail.total > 0 ? formatShare((amount / detail.total) * 100) : ''}
      </span>
      {/* Overheal (healing), casts, hits, crit, avg and max hit stay empty. */}
      <BlankCells count={healing ? 6 : 5} />
    </div>
  );
}

/** The supported abilities stay in the parent rowgroup (rowgroups may not nest): the disclosure controls them by row id. */
function RecipientLines({ recipient, table, idPrefix, open, onToggle }: { recipient: SupportRecipient; table: Table; idPrefix: string; open: boolean; onToggle: () => void }) {
  const player = table.roster.get(recipient.player);
  const name = player ? shortName(player.name) : t('report.unknownPlayer');
  const rowId = (i: number) => `${idPrefix}-${i}`;
  const toggle: Toggle = { open, onToggle, controls: recipient.abilities.map((_, i) => rowId(i)).join(' ') };
  return (
    <>
      <PartLine
        table={table}
        depth={1}
        icon={<PlayerIcon player={player} />}
        name={
          <Disclosure toggle={toggle}>
            <span style={{ color: classColor(player?.classToken ?? null) }}>{name}</span>
          </Disclosure>
        }
        amount={recipient.amount}
      />
      {open &&
        recipient.abilities.map((ability, i) => {
          const spell = ability.spellId === null ? t('report.unmatchedHits') : reportSpellName(table.detail.spells, ability.spellId);
          return (
            <PartLine
              key={rowId(i)}
              id={rowId(i)}
              table={table}
              depth={2}
              icon={ability.spellId === null ? <DotsIcon /> : <GameIcon name={spell} src={spellIconUrl(ability.spellId)} />}
              name={
                <>
                  <span className="ab-name">{spell}</span>
                  {ability.petName && <span className="ab-pet">{shortName(ability.petName)}</span>}
                </>
              }
              amount={ability.amount}
            />
          );
        })}
    </>
  );
}
