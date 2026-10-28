import { profileKey } from '../couch';
import { SPECIES, type PlanetId, type ResourceId, type SpeciesId } from './planets';

// Everything that is saved, per Couch profile (profileKey) or plain when played on its own.

export type NpcId = 'pip' | 'bolt';
export const NPC_HOME: Record<NpcId, PlanetId> = { pip: 'pebble', bolt: 'bloom' };

export type UpgradeId = 'boost' | 'tank' | 'suit' | 'superjet';
export type PaintId = 'coral' | 'sky' | 'mint' | 'grape' | 'sun' | 'gold';
export type HatId = 'none' | 'party' | 'flower' | 'propeller' | 'hardhat' | 'crown';

export interface GameState {
  v: 2;
  where: 'space' | PlanetId;
  shipPos: [number, number, number];
  shipQuat: [number, number, number, number];
  /** Where the ship stands on `where` (surface coordinates). */
  land: [number, number];
  inv: Record<ResourceId, number>;
  finds: SpeciesId[];
  /** Per NPC: index into QUESTS[npc] (length = all done) and whether it is accepted. */
  npc: Record<NpcId, { i: number; acc: boolean }>;
  probe: boolean;
  jetpack: boolean;
  hyperdrive: boolean;
  scanner2: boolean;
  target: PlanetId;
  visited: PlanetId[];
  // milestone 2
  /** Workbench plans the player has been given. */
  plans: UpgradeId[];
  upgrades: UpgradeId[];
  paints: PaintId[];
  hats: HatId[];
  paint: PaintId;
  hat: HatId;
  /** Resource node uids ever collected (planet completion). */
  got: string[];
  /** Geyser indices on Frost with one of Bolt's sensors. */
  sensors: number[];
  /** Bolt's gear parts found on Dune (indices). */
  gears: number[];
  raceBest: number | null;
}

export function newState(): GameState {
  return {
    v: 2,
    where: 'pebble',
    shipPos: [0, 0, 0],
    shipQuat: [0, 0, 0, 1],
    land: [0, 0],
    inv: { crystal: 0, ice: 0, fruit: 0 },
    finds: [],
    npc: { pip: { i: 0, acc: false }, bolt: { i: 0, acc: false } },
    probe: false,
    jetpack: false,
    hyperdrive: false,
    scanner2: false,
    target: 'bloom',
    visited: ['pebble'],
    plans: [],
    upgrades: [],
    paints: ['coral'],
    hats: ['none'],
    paint: 'coral',
    hat: 'none',
    got: [],
    sensors: [],
    gears: [],
    raceBest: null,
  };
}

/** Brings an older save up to the current format (milestone 1 saves are v1). */
export function migrate(raw: Record<string, unknown>): GameState | null {
  const base = newState();
  if (raw.v === 1) {
    const quest = typeof raw.quest === 'number' ? raw.quest : 0;
    const accepted = !!raw.accepted;
    delete raw.quest;
    delete raw.accepted;
    raw.npc = { pip: { i: quest, acc: accepted }, bolt: { i: 0, acc: false } };
    raw.v = 2;
  }
  if (raw.v !== 2) return null;
  const s = raw as Partial<GameState>;
  return {
    ...base,
    ...s,
    inv: { ...base.inv, ...(s.inv ?? {}) },
    npc: { pip: { ...base.npc.pip, ...(s.npc?.pip ?? {}) }, bolt: { ...base.npc.bolt, ...(s.npc?.bolt ?? {}) } },
  } as GameState;
}

const SAVE_KEY = 'starhop.save';

export function loadState(): GameState | null {
  try {
    const raw = localStorage.getItem(profileKey(SAVE_KEY));
    if (!raw) return null;
    return migrate(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return null;
  }
}

export function saveState(s: GameState): void {
  try {
    localStorage.setItem(profileKey(SAVE_KEY), JSON.stringify(s));
  } catch {
    /* storage full or blocked */
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(profileKey(SAVE_KEY));
  } catch {
    /* ignore */
  }
}

export function loadSetting(key: string): string | null {
  try {
    return localStorage.getItem(profileKey(`starhop.${key}`));
  } catch {
    return null;
  }
}

export function saveSetting(key: string, value: string): void {
  try {
    localStorage.setItem(profileKey(`starhop.${key}`), value);
  } catch {
    /* ignore */
  }
}

export const creatureKinds = (s: GameState): number =>
  s.finds.filter((f) => SPECIES.find((x) => x.id === f)?.kind === 'creature').length;

// ------------------------------------------------------------------ quests

export interface Objective {
  icon: string;
  label: string; // i18n key
  have: number;
  need: number;
}

export interface QuestDef {
  id: string;
  npc: NpcId;
  /** Where the quest happens (planet completion stars; the target planet on accept). */
  planet: PlanetId;
  title: string;
  offer: string;
  thanks: string;
  reward: string; // i18n key of the reward
  /** i18n key of what the NPC says when the quest cannot be started yet. */
  blocked?(s: GameState): string | null;
  objectives(s: GameState): Objective[];
  /** Takes the delivered items and hands out the reward. */
  complete(s: GameState): void;
}

const take = (s: GameState, r: ResourceId, n: number): void => {
  s.inv[r] = Math.max(0, s.inv[r] - n);
};
const have = (s: GameState, r: ResourceId, n: number): number => Math.min(n, s.inv[r]);

export const QUESTS: Record<NpcId, QuestDef[]> = {
  pip: [
    {
      id: 'p1',
      npc: 'pip',
      planet: 'bloom',
      title: 'q1Title',
      offer: 'pipQ1',
      thanks: 'pipThanks1',
      reward: 'gearJetpack',
      objectives: (s) => [
        { icon: '🔍', label: 'oScanKinds', have: Math.min(3, creatureKinds(s)), need: 3 },
        { icon: '⭐', label: 'oFruit', have: have(s, 'fruit', 3), need: 3 },
      ],
      complete: (s) => {
        take(s, 'fruit', 3);
        s.jetpack = true;
      },
    },
    {
      id: 'p2',
      npc: 'pip',
      planet: 'frost',
      title: 'q2Title',
      offer: 'pipQ2',
      thanks: 'pipThanks2',
      reward: 'gearHyper',
      objectives: (s) => [{ icon: '🧊', label: 'oIce', have: have(s, 'ice', 5), need: 5 }],
      complete: (s) => {
        take(s, 'ice', 5);
        s.hyperdrive = true;
        s.inv.crystal += 3;
        s.target = 'dune';
      },
    },
    {
      id: 'p3',
      npc: 'pip',
      planet: 'dune',
      title: 'q3Title',
      offer: 'pipQ3',
      thanks: 'pipThanks3',
      reward: 'gearScanner2',
      objectives: (s) => [{ icon: '📡', label: 'oProbe', have: s.probe ? 1 : 0, need: 1 }],
      complete: (s) => {
        s.probe = false;
        s.scanner2 = true;
      },
    },
    {
      id: 'p4',
      npc: 'pip',
      planet: 'pebble',
      title: 'q4Title',
      offer: 'pipQ4',
      thanks: 'pipThanks4',
      reward: 'rewardCrown',
      objectives: (s) => [
        { icon: '⭐', label: 'oFruit', have: have(s, 'fruit', 4), need: 4 },
        { icon: '🧊', label: 'oIce', have: have(s, 'ice', 4), need: 4 },
      ],
      complete: (s) => {
        take(s, 'fruit', 4);
        take(s, 'ice', 4);
        if (!s.hats.includes('crown')) s.hats.push('crown');
        if (!s.paints.includes('gold')) s.paints.push('gold');
        s.hat = 'crown';
      },
    },
  ],
  bolt: [
    {
      id: 'b1',
      npc: 'bolt',
      planet: 'bloom',
      title: 'b1Title',
      offer: 'boltQ1',
      thanks: 'boltThanks1',
      reward: 'rewardPlanBoost',
      objectives: (s) => [
        { icon: '💎', label: 'oCrystal', have: have(s, 'crystal', 3), need: 3 },
        { icon: '⭐', label: 'oFruit', have: have(s, 'fruit', 2), need: 2 },
      ],
      complete: (s) => {
        take(s, 'crystal', 3);
        take(s, 'fruit', 2);
        if (!s.plans.includes('boost')) s.plans.push('boost');
      },
    },
    {
      id: 'b2',
      npc: 'bolt',
      planet: 'frost',
      title: 'b2Title',
      offer: 'boltQ2',
      thanks: 'boltThanks2',
      reward: 'rewardPlanSuit',
      objectives: (s) => [{ icon: '📍', label: 'oSensors', have: Math.min(3, s.sensors.length), need: 3 }],
      complete: (s) => {
        if (!s.plans.includes('suit')) s.plans.push('suit');
      },
    },
    {
      id: 'b3',
      npc: 'bolt',
      planet: 'pebble',
      title: 'b3Title',
      offer: 'boltQ3',
      thanks: 'boltThanks3',
      reward: 'rewardPlanTank',
      objectives: (s) => [{ icon: '🏁', label: 'oRace', have: s.raceBest !== null && s.raceBest <= RACE_MEDALS[2] ? 1 : 0, need: 1 }],
      complete: (s) => {
        if (!s.plans.includes('tank')) s.plans.push('tank');
      },
    },
    {
      id: 'b4',
      npc: 'bolt',
      planet: 'dune',
      title: 'b4Title',
      offer: 'boltQ4',
      thanks: 'boltThanks4',
      reward: 'rewardSuperjet',
      blocked: (s) => (s.hyperdrive ? null : 'boltNeedHyper'),
      objectives: (s) => [{ icon: '⚙️', label: 'oGears', have: Math.min(3, s.gears.length), need: 3 }],
      complete: (s) => {
        if (!s.upgrades.includes('superjet')) s.upgrades.push('superjet');
        if (!s.hats.includes('hardhat')) s.hats.push('hardhat');
      },
    },
  ],
};

/** Gold, silver and bronze times for the ring race (seconds). */
export const RACE_MEDALS = [34, 46, 70];

export const currentQuest = (s: GameState, npc: NpcId): QuestDef | undefined => QUESTS[npc][s.npc[npc].i];

export function questReady(s: GameState, npc: NpcId = 'pip'): boolean {
  const q = currentQuest(s, npc);
  return !!q && s.npc[npc].acc && q.objectives(s).every((o) => o.have >= o.need);
}

export const questDone = (s: GameState, id: string): boolean => {
  for (const npc of Object.keys(QUESTS) as NpcId[]) {
    const k = QUESTS[npc].findIndex((q) => q.id === id);
    if (k >= 0) return s.npc[npc].i > k;
  }
  return false;
};

/** True while this quest is the accepted, unfinished one. */
export const questActive = (s: GameState, id: string): boolean => {
  for (const npc of Object.keys(QUESTS) as NpcId[]) {
    const q = currentQuest(s, npc);
    if (q?.id === id) return s.npc[npc].acc;
  }
  return false;
};

// ------------------------------------------------------------------ workbench

export type ItemKind = 'upgrade' | 'paint' | 'hat';
export interface Recipe {
  id: string;
  kind: ItemKind;
  icon: string;
  cost: Partial<Record<ResourceId, number>>;
  /** Needs a plan from Bolt first. */
  plan?: boolean;
}

export const PAINT_COLORS: Record<PaintId, number> = {
  coral: 0xff5d73,
  sky: 0x4cc9f0,
  mint: 0x3ddc97,
  grape: 0x9b5de5,
  sun: 0xffc93c,
  gold: 0xffd23f,
};

export const RECIPES: Recipe[] = [
  { id: 'boost', kind: 'upgrade', icon: '🚀', cost: { crystal: 3, ice: 2 }, plan: true },
  { id: 'tank', kind: 'upgrade', icon: '🔋', cost: { crystal: 2, ice: 3 }, plan: true },
  { id: 'suit', kind: 'upgrade', icon: '🫧', cost: { ice: 2, fruit: 3 }, plan: true },
  { id: 'sky', kind: 'paint', icon: '🎨', cost: { crystal: 1, ice: 1 } },
  { id: 'mint', kind: 'paint', icon: '🎨', cost: { crystal: 1, ice: 1 } },
  { id: 'grape', kind: 'paint', icon: '🎨', cost: { crystal: 1, ice: 1 } },
  { id: 'sun', kind: 'paint', icon: '🎨', cost: { crystal: 1, ice: 1 } },
  { id: 'party', kind: 'hat', icon: '🥳', cost: { fruit: 2 } },
  { id: 'flower', kind: 'hat', icon: '🌼', cost: { fruit: 2 } },
  { id: 'propeller', kind: 'hat', icon: '🧢', cost: { fruit: 2 } },
];

export function owns(s: GameState, kind: ItemKind, id: string): boolean {
  if (kind === 'upgrade') return s.upgrades.includes(id as UpgradeId);
  if (kind === 'paint') return s.paints.includes(id as PaintId);
  return s.hats.includes(id as HatId);
}

export const canAfford = (s: GameState, r: Recipe): boolean =>
  (Object.entries(r.cost) as [ResourceId, number][]).every(([k, n]) => s.inv[k] >= n);

export function craft(s: GameState, r: Recipe): boolean {
  if (owns(s, r.kind, r.id) || !canAfford(s, r) || (r.plan && !s.plans.includes(r.id as UpgradeId))) return false;
  for (const [k, n] of Object.entries(r.cost) as [ResourceId, number][]) s.inv[k] -= n;
  if (r.kind === 'upgrade') s.upgrades.push(r.id as UpgradeId);
  else if (r.kind === 'paint') {
    s.paints.push(r.id as PaintId);
    s.paint = r.id as PaintId;
  } else {
    s.hats.push(r.id as HatId);
    s.hat = r.id as HatId;
  }
  return true;
}
