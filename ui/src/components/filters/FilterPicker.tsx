import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Dimension, FilterOption, PlayerRef } from '../../api/types';
import { useDismiss } from '../../hooks/useDismiss';
import { t } from '../../i18n/i18n';
import { spellIcon } from '../../icons';
import { useApp } from '../../store';
import { GameIcon } from '../GameIcon';
import { classColor, playerIndex } from '../overview/players';
import { PlayerIcon } from '../reports/PlayerName';
import { rosterIndex } from '../reports/reportData';
import { type ScopeValue, optionLabel, optionValue } from './labels';
import { pickerSections, selectionLabel } from './pickerModel';

const INSTANCE_CHIPS = 24;

interface Props {
  dimension: Dimension;
  caption: string;
  allLabel: string;
  value: ScopeValue | null;
  playersByRole?: boolean;
  large?: boolean;
}

export function FilterPicker({ dimension, caption, allLabel, value, playersByRole = true, large }: Props) {
  const loadOptions = useApp((s) => s.filterOptions);
  const select = useApp((s) => s.select);
  const overview = useApp((s) => s.overview);
  const breakdownRoster = useApp((s) => s.breakdown?.roster);
  const boss = useApp((s) => {
    const view = s.view;
    return view.kind === 'fight' ? (s.log?.fights.find((f) => f.index === view.fightIndex)?.name ?? '') : '';
  });
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<FilterOption[]>([]);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const dialogId = useId();
  const roster = useMemo(
    () => new Map([...(overview ? playerIndex(overview) : []), ...rosterIndex(breakdownRoster ?? [])]),
    [overview, breakdownRoster],
  );

  useEffect(() => {
    if (!open && !value) return;
    let live = true;
    void loadOptions(dimension).then((list) => live && setOptions(list));
    return () => {
      live = false;
    };
  }, [open, value, dimension, loadOptions]);

  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setExpanded(null);
    button.current?.focus();
  };
  const dismiss = () => {
    setOpen(false);
    setQuery('');
    setExpanded(null);
  };
  useDismiss(root, open, { onDismiss: dismiss, onEscape: close });
  const pick = (next: ScopeValue | null) => {
    void select(dimension, next);
    close();
  };
  const sections = pickerSections(options, { roster, boss, playersByRole }, query);
  const current = value ? selectionLabel(value, options, roster) : allLabel;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...(pop.current?.querySelectorAll<HTMLButtonElement>('button[data-pick]') ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (at + 1) % items.length : at <= 0 ? items.length - 1 : at - 1;
    items[next].focus();
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    const first = sections[0]?.options[0];
    if (!first) return;
    const spellId = /^[0-9]+$/.test(query.trim()) ? Number(query.trim()) : null;
    const isVariant = spellId !== null && first.primarySpell !== spellId && first.variants.some((v) => v.spellId === spellId);
    pick(isVariant ? { kind: 'id', spellId } : optionValue(first));
  }

  return (
    <div ref={root} className="picker">
      <button
        ref={button}
        type="button"
        className={['dd', large && 'dd-large', value && 'dd-set'].filter(Boolean).join(' ')}
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="dd-caption">{caption}</span>
        <span className="dd-value">{current}</span>
      </button>
      {value && (
        <button type="button" className="dd-clear" aria-label={t('picker.clear', { caption })} onClick={() => pick(null)}>
          ×
        </button>
      )}
      {open && (
        <div ref={pop} id={dialogId} className="picker-pop" role="dialog" aria-label={caption} tabIndex={-1} onKeyDown={onKeyDown}>
          <input
            ref={search}
            type="search"
            className="picker-search"
            placeholder={t('picker.search')}
            aria-label={t('picker.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
          <button type="button" data-pick className="picker-all" onClick={() => pick(null)}>
            {allLabel}
          </button>
          <div className="picker-list">
            {sections.map((section) => (
              <section key={section.title || 'all'} aria-label={section.title || caption}>
                {section.title && <h3 className="cap picker-head">{section.title}</h3>}
                <div className={section.title ? 'picker-grid' : 'picker-col'}>
                  {section.options.map((option) => {
                    const id = JSON.stringify(option.value);
                    return (
                      <PickerOption
                        key={id}
                        option={option}
                        expanded={expanded === id}
                        onToggle={() => setExpanded(expanded === id ? null : id)}
                        onPick={pick}
                        roster={roster}
                      />
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PickerOption(props: {
  option: FilterOption;
  expanded: boolean;
  onToggle: () => void;
  onPick: (value: ScopeValue) => void;
  roster: Map<number, PlayerRef>;
}) {
  const { option, expanded, onToggle, onPick, roster } = props;
  const [allChips, setAllChips] = useState(false);
  const value = optionValue(option);
  const label = optionLabel(option);
  const player = value.kind === 'player' ? roster.get(value.actorId) : undefined;
  const others = option.variants.filter((v) => v.spellId !== option.primarySpell);
  const instances = option.instances.length > 1 ? option.instances : [];
  const chips = allChips ? instances : instances.slice(0, INSTANCE_CHIPS);
  const childCount = option.pets.length + instances.length + others.length;
  const id = option.npcId ?? option.primarySpell;
  return (
    <div className="picker-item">
      <div className="picker-row">
        <button type="button" data-pick className="picker-option" onClick={() => onPick(value)}>
          {player ? (
            <PlayerIcon player={player} />
          ) : option.primarySpell !== null ? (
            <GameIcon name={label} icon={spellIcon(option.primarySpell)} />
          ) : null}
          <span className="picker-name" style={player ? { color: classColor(player.classToken) } : undefined}>
            {label}
          </span>
          {id !== null && <span className="num picker-id">{id}</span>}
        </button>
        {childCount > 0 && (
          <button
            type="button"
            className="picker-expand"
            aria-expanded={expanded}
            aria-label={t(option.value.kind === 'ability' ? 'picker.moreIds' : 'picker.moreUnits', { count: childCount, name: label })}
            onClick={onToggle}
          >
            {expanded ? '▾' : '▸'}
          </button>
        )}
      </div>
      {expanded && (
        <div className="picker-children">
          {option.pets.map((pet) => (
            <button
              key={pet}
              type="button"
              data-pick
              className="picker-option"
              onClick={() => value.kind === 'player' && onPick({ kind: 'pet', owner: value.actorId, name: pet })}
            >
              <span className="picker-name">{pet}</span>
            </button>
          ))}
          {chips.map((instance) => (
            <button
              key={instance.actorId}
              type="button"
              data-pick
              className="picker-chip num"
              onClick={() => onPick({ kind: 'instance', actorId: instance.actorId })}
            >
              {t('scope.instanceNumber', { number: instance.number })}
            </button>
          ))}
          {chips.length < instances.length && (
            <button type="button" className="picker-chip num" onClick={(e) => {
                e.currentTarget.closest<HTMLElement>('[role="dialog"]')?.focus();
                setAllChips(true);
              }}>
              {t('picker.moreChips', { count: instances.length - chips.length })}
            </button>
          )}
          {others.map((v) => (
            <button key={v.spellId} type="button" data-pick className="picker-option" onClick={() => onPick({ kind: 'id', spellId: v.spellId })}>
              <span className="picker-name">{variantUsage(v)}</span>
              <span className="num picker-id">{v.spellId}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function variantUsage(v: FilterOption['variants'][number]): string {
  const parts: string[] = [];
  if (v.casts) parts.push(t('picker.casts', { count: v.casts }));
  if (v.hits) parts.push(t('picker.hits', { count: v.hits }));
  if (v.heals) parts.push(t('picker.heals', { count: v.heals }));
  if (v.auras) parts.push(t('picker.auras', { count: v.auras }));
  return parts.join(' · ') || t('picker.unused');
}
