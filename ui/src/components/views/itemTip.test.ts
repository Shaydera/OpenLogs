import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../api/types';
import { itemTip } from './itemTip';
import type { ViewNames } from './viewNames';

const UNITS: Record<number, string> = { 3: 'Wendel', 4: 'Faelan', 7: 'Felhunter', 9: "Ula'tek #1" };
const SPELLS: Record<number, string> = { 1766: 'Kick', 30451: 'Arcane Blast', 1287012: 'Venom Volley', 774: 'Rejuvenation', 133: 'Fireball', 15407: 'Mind Flay' };
const names: ViewNames = {
  unit: (actorId) => UNITS[actorId] ?? '',
  owner: (actorId) => (actorId === 7 ? 'Wendel' : null),
  colour: () => undefined,
  spell: (spellId) => SPELLS[spellId] ?? String(spellId),
};

describe("a mark's card", () => {
  it('states how much a cast did until the next cast of the same spell', () => {
    const cast: TimelineItem = {
      kind: 'instant',
      startMs: 130_000,
      spanEndMs: 130_000,
      source: 4,
      spellId: 133,
      target: 9,
      amount: { rule: 'untilNextCast', amount: 845_000, hits: 2, targets: 1, support: 0, healing: false },
    };
    const tip = itemTip(cast, names, true);
    expect(tip).toMatchObject({ what: 'Instant cast', source: 'Faelan', target: "Ula'tek #1", howLong: 'Instant, no begin cast logged' });
    expect(tip.howMuch).toBe('845.00k damage in 2 hits on 1 target');
    expect(tip.amountNote).toBe('until the next cast of the same spell (15 s max)');
  });

  it('names the killer, the victim and the overkill of a death', () => {
    const death: TimelineItem = { kind: 'death', startMs: 140_000, endMs: 145_000, spanEndMs: 145_000, source: 0, spellId: 0, target: 3, by: { actorId: 9, spellId: 1287012 }, overkill: 120_000 };
    const tip = itemTip(death, names, true);
    expect(tip).toMatchObject({ spell: 'Venom Volley', what: 'Death', source: "Ula'tek #1", target: 'Wendel', when: '2:25.000', howMuch: '120.00k overkill' });
  });

  it("names a pet's owner beside it, as the events do", () => {
    const lock: TimelineItem = { kind: 'interrupt', startMs: 133_950, spanEndMs: 133_950, source: 7, spellId: 30451, target: 9, used: 19647 };
    expect(itemTip(lock, names, true)).toMatchObject({ source: 'Felhunter (Wendel)', target: "Ula'tek #1" });
  });

  it('says how far into the cast an interrupt landed and which spell it stopped', () => {
    const kick: TimelineItem = { kind: 'interrupt', startMs: 133_950, spanEndMs: 133_950, source: 9, spellId: 30451, target: 3, used: 1766, castStartMs: 133_000 };
    const tip = itemTip(kick, names, true);
    expect(tip).toMatchObject({ spell: 'Kick', what: 'Interrupt of Arcane Blast', howLong: '0.95 s into the cast' });
  });

  it('gives an aura its holding time and stacks, and a dash when the log has neither', () => {
    const aura: TimelineItem = { kind: 'aura', startMs: 120_000, endMs: 132_000, spanEndMs: 132_000, source: 4, spellId: 774, target: 3, stacks: 3 };
    expect(itemTip(aura, names, true)).toMatchObject({ what: 'Aura from Faelan', howLong: '12.00 s · up to 3 stacks' });
    expect(itemTip({ ...aura, endMs: undefined, stacks: undefined }, names, true).howLong).toBe('—');
  });

  it('shows a rejected input with its logged reason and never calls it a failed cast', () => {
    const rejected: TimelineItem = { kind: 'rejected', startMs: 121_000, spanEndMs: 121_000, source: 4, spellId: 133, target: 0, reason: 'Not yet recovered' };
    const tip = itemTip(rejected, names, true);
    expect(tip).toMatchObject({ what: 'Rejected input, logged for the logging player only', howLong: 'Not yet recovered', target: 'no target logged' });
    expect(`${tip.what} ${tip.howLong}`).not.toMatch(/fail/i);
    expect(itemTip({ ...rejected, reason: undefined }, names, true).howLong).toBe('—');
  });

  it("describes a boss cast with the damage to players after it", () => {
    const boss: TimelineItem = {
      kind: 'castTime',
      startMs: 125_000,
      endMs: 127_000,
      spanEndMs: 127_000,
      source: 9,
      spellId: 1287012,
      target: 0,
      amount: { rule: 'bossCast', amount: 2_400_000, hits: 12, targets: 6, support: 0, healing: false },
    };
    const tip = itemTip(boss, names, true, true);
    expect(tip).toMatchObject({ what: 'Boss cast with a cast time', howMuch: '2.40M damage in 12 hits on 6 targets' });
    expect(tip.amountNote).toBe('to players, from the cast start to 10 s after');
  });

  it('counts the log lines of a wide window instead of listing them', () => {
    const cast: TimelineItem = { kind: 'instant', startMs: 130_000, spanEndMs: 130_000, source: 4, spellId: 133, target: 9, logMore: 3 };
    expect(itemTip(cast, names, false).more).toBe('3 log lines · zoom to a minute or less to list them');
  });

  it("gives a channel its logged end, its ticks and the time held after the last one", () => {
    const flay: TimelineItem = { kind: 'channel', startMs: 3_775, spanEndMs: 5_099, source: 4, spellId: 15407, target: 9, channel: { endMs: 5_099, lastTickMs: 4_975, ticks: [4_389, 4_975] } };
    expect(itemTip(flay, names, true)).toMatchObject({
      what: 'Channel',
      howLong: 'Channel 0:03.775 → 0:05.099 · 1.32 s',
      spans: ['Ticks 2 · last at 0:04.975', 'Held after the last tick 0.12 s'],
    });
    expect(itemTip(flay, names, true, true).what).toBe('Boss channel');
    const released = { ...flay, channel: { endMs: 4_975, lastTickMs: 4_975, ticks: [4_389, 4_975] } };
    expect(itemTip(released, names, true).spans).toEqual(['Ticks 2 · last at 0:04.975']);
    const unended = itemTip({ ...flay, channel: { lastTickMs: 4_975, ticks: [4_389, 4_975] } }, names, true);
    expect(unended).toMatchObject({ howLong: 'Channel from 0:03.775', spans: ['Ticks 2 · last at 0:04.975', 'Channel end not logged'] });
    expect(itemTip({ ...flay, channel: { ticks: [] } }, names, true).spans).toEqual(['Channel end not logged']);
  });
});
