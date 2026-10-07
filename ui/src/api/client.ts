import { invoke } from '@tauri-apps/api/core';
import type {
  GameDataStatus,
  DamageReport,
  DamageTakenReport,
  FightTimeline,
  HealingReport,
  LogView,
  RecentLog,
  ReportFilter,
} from './types';

/** Typed wrappers around the Tauri commands in `src-tauri/src/commands.rs`. */
export const api = {
  openLog: (path: string) => invoke<LogView>('open_log', { path }),
  recentLogs: () => invoke<RecentLog[]>('recent_logs'),
  removeRecent: (path: string) => invoke<void>('remove_recent', { path }),
  fightTimeline: (path: string, fightIndex: number) => invoke<FightTimeline>('fight_timeline', { path, fightIndex }),
  damageDoneReport: (path: string, fightIndex: number, filter: ReportFilter) =>
    invoke<DamageReport>('damage_done_report', { path, fightIndex, filter }),
  healingReport: (path: string, fightIndex: number, filter: ReportFilter) =>
    invoke<HealingReport>('healing_report', { path, fightIndex, filter }),
  damageTakenReport: (path: string, fightIndex: number, filter: ReportFilter) =>
    invoke<DamageTakenReport>('damage_taken_report', { path, fightIndex, filter }),
  gameDataStatus: () => invoke<GameDataStatus>('game_data_status'),
  refreshGameData: () => invoke<GameDataStatus>('refresh_game_data'),
};
