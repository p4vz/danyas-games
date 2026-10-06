/**
 * Playable slime characters. Every number here feeds the physics directly, so
 * a new character is just one more entry — no code changes needed.
 *
 *  radius   – dome size (world units). Bigger = more reach, bigger target.
 *  mass     – used in every collision impulse: heavy slimes shove light ones
 *             and barely flinch when the ball hits them.
 *  maxSpeed – top run speed. When you drag faster than this the slime lags
 *             behind your finger.
 *  accel    – how quickly it reaches top speed / stops (responsiveness).
 *  jump     – take-off velocity (apex ≈ jump² / 2g).
 *  bounce   – coefficient of restitution vs. ball and other slimes:
 *             0 = dead (ball sticks / soft touch), 1 = perfectly elastic.
 */
export interface SlimeCharacter {
  id: string;
  name: string;
  blurb: string;
  color: string;
  /** Darker rim / outline color. */
  rim: string;
  radius: number;
  mass: number;
  maxSpeed: number;
  accel: number;
  jump: number;
  bounce: number;
}

export const CHARACTERS: SlimeCharacter[] = [
  {
    id: "classic",
    name: "Blue",
    blurb: "The all-rounder. Good at everything.",
    color: "#3fa9ff",
    rim: "#1d6fb8",
    radius: 50,
    mass: 5,
    maxSpeed: 430,
    accel: 3300,
    jump: 930,
    bounce: 0.6,
  },
  {
    id: "zip",
    name: "Zip",
    blurb: "Tiny and quick. Easy to shove around.",
    color: "#ffe14a",
    rim: "#b89a10",
    radius: 38,
    mass: 2.8,
    maxSpeed: 580,
    accel: 5000,
    jump: 960,
    bounce: 0.65,
  },
  {
    id: "tank",
    name: "Tank",
    blurb: "Huge and heavy. Slow, but nothing moves it.",
    color: "#9b6bff",
    rim: "#5f37b8",
    radius: 66,
    mass: 10,
    maxSpeed: 320,
    accel: 2000,
    jump: 830,
    bounce: 0.35,
  },
  {
    id: "boing",
    name: "Boing",
    blurb: "Super bouncy. The ball flies off it.",
    color: "#ff6ad5",
    rim: "#b8338f",
    radius: 46,
    mass: 3.8,
    maxSpeed: 440,
    accel: 3100,
    jump: 1000,
    bounce: 0.95,
  },
  {
    id: "rocky",
    name: "Rocky",
    blurb: "Dense and dead-soft. Ball control king.",
    color: "#c48a55",
    rim: "#7d5229",
    radius: 54,
    mass: 8,
    maxSpeed: 380,
    accel: 2700,
    jump: 870,
    bounce: 0.15,
  },
  {
    id: "leafy",
    name: "Leafy",
    blurb: "Springy legs. Highest jumper.",
    color: "#5be37d",
    rim: "#2a9a48",
    radius: 44,
    mass: 4,
    maxSpeed: 470,
    accel: 3700,
    jump: 1070,
    bounce: 0.55,
  },
  {
    id: "ember",
    name: "Ember",
    blurb: "Fast and punchy. Hard hitter.",
    color: "#ff6b3d",
    rim: "#b8381a",
    radius: 50,
    mass: 6,
    maxSpeed: 490,
    accel: 2700,
    jump: 900,
    bounce: 0.78,
  },
];

export function getCharacter(id: string): SlimeCharacter {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

/** Normalised 0..1 stats for the character-select bars. */
export function characterStats(c: SlimeCharacter): { label: string; value: number }[] {
  const norm = (v: number, lo: number, hi: number) => Math.max(0.08, Math.min(1, (v - lo) / (hi - lo)));
  return [
    { label: "Size", value: norm(c.radius, 30, 70) },
    { label: "Mass", value: norm(c.mass, 2, 10.5) },
    { label: "Speed", value: norm(c.maxSpeed, 280, 600) },
    { label: "Jump", value: norm(c.jump, 780, 1090) },
    { label: "Bounce", value: norm(c.bounce, 0, 1) },
  ];
}
