/**
 * Crate upgrades. Each pickup is permanent for the match and stacks.
 */
export type UpgradeKind = "attack" | "health" | "speed";

export interface UpgradeInfo {
  kind: UpgradeKind;
  label: string;
  /** Short text shown when picked up. */
  blurb: string;
  icon: string;
  color: string;
}

export const UPGRADES: Record<UpgradeKind, UpgradeInfo> = {
  attack: { kind: "attack", label: "Attack", blurb: "+25% damage", icon: "⚔", color: "#ff6b5b" },
  health: { kind: "health", label: "Health", blurb: "+35 HP, +15 max", icon: "✚", color: "#5be37d" },
  speed: { kind: "speed", label: "Speed", blurb: "+30% move & fuel", icon: "⚡", color: "#ffd84d" },
};

export const UPGRADE_KINDS: UpgradeKind[] = ["attack", "health", "speed"];

export const ATTACK_STEP = 0.25;
export const HEAL = 35;
export const MAX_HP_STEP = 15;
export const SPEED_STEP = 0.3;
