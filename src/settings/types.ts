export const API = 'http://localhost:7770';

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
  queued: number;
}

export interface Reward {
  id: string;
  key: string;
  title: string;
  cost: number;
  enabled: boolean;
  kind: 'loot' | 'spawn';
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

export interface BitsReward {
  key: string;
  bits: number;
  kind: 'loot' | 'spawn';
  count: number | null;
  category: 'mutants' | 'enemies' | null;
  rolls: number | null;
}

export interface BitsDraft {
  bits: string;
}

export function draftFromBitsReward(reward: BitsReward): BitsDraft {
  return { bits: String(reward.bits) };
}

export function bitsRewardLabel(reward: BitsReward): string {
  return reward.kind === 'spawn'
    ? `Spawn ${reward.category === 'enemies' ? 'Enemies' : 'Mutants'}${
        reward.rolls && reward.rolls > 1 ? ` ×${reward.rolls}` : ''
      }`
    : `Loot Roll ×${reward.count ?? 1}`;
}

export interface EnemyFaction {
  key: string;
  label: string;
  icon: string | null;
  enabled: boolean;
}

export interface DeviceFlow {
  userCode: string;
  verificationUri: string;
}
