export { API } from '../api';

export interface TwitchStatus {
  connected: boolean;
  login: string | null;
}

export interface EventSubStatus {
  running: boolean;
  connected: boolean;
  sessionId: string | null;
}

export interface RouletteStatus {
  overlayPresent: boolean;
  preset: string;
  presets: string[];
  spawnTier: string;
  spawnTiers: string[];
  rollMode: 'random' | 'count-roll';
  queued: number;
}

export interface SpawnBonus {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  chance: number; // fraction 0-1, e.g. 0.033 = 3.3%
}

export interface Reward {
  id: string;
  key: string;
  title: string;
  cost: number;
  enabled: boolean;
  kind: 'loot' | 'spawn' | 'perk';
  category: 'mutants' | 'enemies' | null;
  count: number | null;
  rolls: number | null;
  maxPerUserPerStream: number | null;
  cooldownSeconds: number | null;
}

export interface RewardDraft {
  cost: string;
  maxPerUserPerStream: string;
  cooldownSeconds: string;
}

export function draftFromReward(reward: Reward): RewardDraft {
  return {
    cost: String(reward.cost),
    maxPerUserPerStream:
      reward.maxPerUserPerStream != null ? String(reward.maxPerUserPerStream) : '',
    cooldownSeconds: reward.cooldownSeconds != null ? String(reward.cooldownSeconds) : '',
  };
}

export interface Perk {
  key: string;
  label: string;
  description: string;
  icon: string | null;
  chance: number; // relative roll weight, e.g. 0.3 = 30%
  enabled: boolean;
}

export interface EnemyFaction {
  key: string;
  label: string;
  icon: string | null;
  enabled: boolean;
  expertOnly: boolean;
}

export interface DeviceFlow {
  userCode: string;
  verificationUri: string;
}
