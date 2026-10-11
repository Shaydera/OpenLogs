import { invoke } from '@tauri-apps/api/core';
import type {
  GameDataStatus,
  Attribution,
  AuraScope,
  AurasReport,
  InterruptsReport,
  ResourcesReport,
  CastsReport,
  DeathsReport,
  AbilityDetail,
  DamageReport,
  DamageTakenReport,
  HealingReport,
  LogView,
  Metric,
  PlayerDetail,
  PullComparison,
  QuickOverview,
  RecentLog,
  TargetDetail,
  ReportFilter,
} from './types';

/** Typed wrappers around the Tauri commands in `src-tauri/src/commands.rs`. */
export const api = {
  openLog: (path: string) => invoke<LogView>('open_log', { path }),
  recentLogs: () => invoke<RecentLog[]>('recent_logs'),
  removeRecent: (path: string) => invoke<void>('remove_recent', { path }),
  quickOverview: (path: string, fightIndex: number, filter: ReportFilter | null) =>
    invoke<QuickOverview>('quick_overview', { path, fightIndex, filter }),
  damageDoneReport: (path: string, fightIndex: number, filter: ReportFilter) =>
    invoke<DamageReport>('damage_done_report', { path, fightIndex, filter }),
  healingReport: (path: string, fightIndex: number, filter: ReportFilter) =>
    invoke<HealingReport>('healing_report', { path, fightIndex, filter }),
  damageTakenReport: (path: string, fightIndex: number, filter: ReportFilter) =>
    invoke<DamageTakenReport>('damage_taken_report', { path, fightIndex, filter }),
  playerDetail: (path: string, fightIndex: number, player: number, metric: Metric, filter: ReportFilter) =>
    invoke<PlayerDetail>('player_detail', { path, fightIndex, player, metric, filter }),
  abilityDetail: (path: string, fightIndex: number, player: number, spell: number, pet: string | null, metric: Metric, filter: ReportFilter) =>
    invoke<AbilityDetail>('ability_detail', { path, fightIndex, player, spell, pet, metric, filter }),
  targetDetail: (path: string, fightIndex: number, name: string, filter: ReportFilter) =>
    invoke<TargetDetail>('target_detail', { path, fightIndex, name, filter }),
  deathsReport: (path: string, fightIndex: number, filter: ReportFilter) =>
    invoke<DeathsReport>('deaths_report', { path, fightIndex, filter }),
  castsReport: (path: string, fightIndex: number, filter: ReportFilter) =>
    invoke<CastsReport>('casts_report', { path, fightIndex, filter }),
  aurasReport: (path: string, fightIndex: number, scope: AuraScope, filter: ReportFilter) =>
    invoke<AurasReport>('auras_report', { path, fightIndex, scope, filter }),
  interruptsReport: (path: string, fightIndex: number, filter: ReportFilter) =>
    invoke<InterruptsReport>('interrupts_report', { path, fightIndex, filter }),
  resourcesReport: (path: string, fightIndex: number, filter: ReportFilter) =>
    invoke<ResourcesReport>('resources_report', { path, fightIndex, filter }),
  comparePulls: (path: string, fightA: number, fightB: number, attribution: Attribution) =>
    invoke<PullComparison>('compare_pulls', { path, fightA, fightB, attribution }),
  gameDataStatus: () => invoke<GameDataStatus>('game_data_status'),
  refreshGameData: () => invoke<GameDataStatus>('refresh_game_data'),
};
