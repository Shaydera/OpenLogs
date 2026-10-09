import type { ConsumableKind, PlayerDetail } from '../../api/types';
import { formatAmount, formatAmountTenths, formatEventTime, formatInteger } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/i18n';
import { Kpi, KpiStrip } from '../Kpi';
import { shortName } from '../overview/players';

const CONSUMABLE_LABEL: Record<ConsumableKind, MessageKey> = {
  combat_potion: 'consumables.combatPotion',
  healthstone: 'consumables.healthstone',
  health_potion: 'consumables.healthPotion',
  mana_potion: 'consumables.manaPotion',
};

export function PlayerKpis({ detail }: { detail: PlayerDetail }) {
  const healing = detail.metric === 'healing';
  const otherMode = t(detail.attribution === 'augmented' ? 'aug.reattributed' : 'aug.augmented');
  const names = new Map(detail.roster.map((p) => [p.actorId, shortName(p.name)]));
  const firstDeath = detail.deaths[0];
  const kinds = [...new Set(detail.consumables.map((u) => u.kind))].map((kind) => t(CONSUMABLE_LABEL[kind]));
  const noConsumables = detail.consumables.length === 0;
  const deathSub = firstDeath
    ? firstDeath.resurrectedAt !== null
      ? t('player.deathRes', { time: formatEventTime(firstDeath.t), res: formatEventTime(firstDeath.resurrectedAt) })
      : formatEventTime(firstDeath.t)
    : detail.deadSince !== null
      ? t('player.deadSince', { time: formatEventTime(detail.deadSince) })
      : t('player.survived');
  return (
    <KpiStrip label={t('player.kpis')} variant="player">
      <Kpi
        label={t(healing ? 'tabs.healing' : 'player.damage')}
        value={formatAmount(detail.total)}
        sub={t('player.otherMode', { mode: otherMode, amount: formatAmount(detail.otherModeTotal) })}
      />
      <Kpi
        label={t(healing ? 'report.hps' : 'report.dps')}
        value={formatAmountTenths(detail.perSecond)}
        sub={detail.rank > 0 ? t('player.rank', { rank: formatInteger(detail.rank), count: detail.rankedPlayers }) : t('player.unranked')}
      />
      <Kpi
        label={t('player.supportReceived')}
        value={formatAmount(detail.supportReceived)}
        tone="support"
        sub={
          detail.supportReceivedFrom.length > 0
            ? t('player.supportFrom', { names: detail.supportReceivedFrom.map((s) => names.get(s.player) ?? '?').join(', ') })
            : t('player.none')
        }
      />
      <Kpi label={t('player.healingReceived')} value={formatAmount(detail.healingReceived)} tone="kill" sub={t('player.effective')} />
      <Kpi label={t('kpi.deaths')} value={formatInteger(detail.deaths.length)} tone={detail.deaths.length > 0 ? 'death' : undefined} sub={deathSub} />
      <Kpi
        label={t('player.consumables')}
        value={formatInteger(detail.consumables.length)}
        tone={noConsumables ? 'warn' : undefined}
        subTone={noConsumables ? 'warn' : undefined}
        sub={noConsumables ? t('player.noneUsed') : kinds.join(', ')}
      />
    </KpiStrip>
  );
}
