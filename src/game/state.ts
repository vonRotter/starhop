import { profileKey } from '../couch';
import { SPECIES, type PlanetId, type ResourceId, type SpeciesId } from './planets';

// Everything that is saved, per Couch profile (profileKey) or plain when played on its own.

export interface GameState {
  v: 1;
  where: 'space' | PlanetId;
  shipPos: [number, number, number];
  shipQuat: [number, number, number, number];
  /** Where the ship stands on `where` (surface coordinates). */
  land: [number, number];
  inv: Record<ResourceId, number>;
  finds: SpeciesId[];
  /** Index into QUESTS; QUESTS.length = all done. */
  quest: number;
  accepted: boolean;
  probe: boolean;
  jetpack: boolean;
  hyperdrive: boolean;
  scanner2: boolean;
  target: PlanetId;
  visited: PlanetId[];
}

export function newState(): GameState {
  return {
    v: 1,
    where: 'pebble',
    shipPos: [0, 0, 0],
    shipQuat: [0, 0, 0, 1],
    land: [0, 0],
    inv: { crystal: 0, ice: 0, fruit: 0 },
    finds: [],
    quest: 0,
    accepted: false,
    probe: false,
    jetpack: false,
    hyperdrive: false,
    scanner2: false,
    target: 'bloom',
    visited: ['pebble'],
  };
}

const SAVE_KEY = 'starhop.save';

export function loadState(): GameState | null {
  try {
    const raw = localStorage.getItem(profileKey(SAVE_KEY));
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<GameState>;
    if (s.v !== 1) return null;
    const base = newState();
    return { ...base, ...s, inv: { ...base.inv, ...(s.inv ?? {}) } } as GameState;
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
  title: string;
  offer: string;
  thanks: string;
  reward: string; // i18n key of the gear
  objectives(s: GameState): Objective[];
  /** Takes the delivered items and hands out the reward. */
  complete(s: GameState): void;
}

export const QUESTS: QuestDef[] = [
  {
    title: 'q1Title',
    offer: 'pipQ1',
    thanks: 'pipThanks1',
    reward: 'gearJetpack',
    objectives: (s) => [
      { icon: '🔍', label: 'oScanKinds', have: Math.min(3, creatureKinds(s)), need: 3 },
      { icon: '⭐', label: 'oFruit', have: Math.min(3, s.inv.fruit), need: 3 },
    ],
    complete: (s) => {
      s.inv.fruit -= 3;
      s.jetpack = true;
    },
  },
  {
    title: 'q2Title',
    offer: 'pipQ2',
    thanks: 'pipThanks2',
    reward: 'gearHyper',
    objectives: (s) => [{ icon: '🧊', label: 'oIce', have: Math.min(5, s.inv.ice), need: 5 }],
    complete: (s) => {
      s.inv.ice -= 5;
      s.hyperdrive = true;
      s.inv.crystal += 3;
      s.target = 'dune';
    },
  },
  {
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
];

export function questReady(s: GameState): boolean {
  const q = QUESTS[s.quest];
  return !!q && s.accepted && q.objectives(s).every((o) => o.have >= o.need);
}
