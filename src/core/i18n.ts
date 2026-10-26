// English and Norwegian bokmål. Short lines: the players are young.
export type Lang = 'en' | 'no';

let lang: Lang = 'en';
const listeners: (() => void)[] = [];

export function getLang(): Lang {
  return lang;
}

export function setLang(l: Lang): void {
  lang = l;
  document.documentElement.lang = l === 'no' ? 'nb' : 'en';
  for (const f of listeners) f();
}

export function onLangChange(f: () => void): void {
  listeners.push(f);
}

const S: Record<string, [string, string]> = {
  // title and menus
  tagline: ['Fly, land, explore!', 'Fly, land, utforsk!'],
  continue: ['Continue', 'Fortsett'],
  newGame: ['New game', 'Nytt spill'],
  confirmNew: ['Start over? Your old game is lost.', 'Starte på nytt? Det gamle spillet blir borte.'],
  yesNew: ['Yes, start over', 'Ja, start på nytt'],
  no: ['No', 'Nei'],
  voiceOn: ['Read aloud: on', 'Lese høyt: på'],
  voiceOff: ['Read aloud: off', 'Lese høyt: av'],
  paused: ['Paused', 'Pause'],
  resume: ['Play', 'Spill'],
  questLog: ['Quest log', 'Oppdrag'],
  quitTitle: ['To title', 'Til start'],
  close: ['Close', 'Lukk'],
  ok: ['OK!', 'OK!'],
  yay: ['Yay!', 'Hurra!'],
  // log tabs
  tabQuests: ['Quests', 'Oppdrag'],
  tabFinds: ['Discoveries', 'Funn'],
  tabGear: ['Gear', 'Utstyr'],
  unknown: ['???', '???'],
  found: ['{n} of {m} found', '{n} av {m} funnet'],
  questDone: ['Done!', 'Ferdig!'],
  questNow: ['Now', 'Nå'],
  questLater: ['Later', 'Senere'],
  allQuestsDone: ['All quests done. Keep exploring!', 'Alle oppdrag er ferdige. Utforsk videre!'],
  talkToPip: ['Talk to Pip on Pebble', 'Snakk med Pip på Pebble'],
  // gear
  gearShip: ['Starhopper ship', 'Romskipet Starhopper'],
  gearScanner: ['Scanner', 'Skanner'],
  gearScanner2: ['Super scanner (far + fast)', 'Superskanner (langt + raskt)'],
  gearJetpack: ['Jetpack', 'Jetpakke'],
  gearHyper: ['Hyperdrive', 'Hyperdrift'],
  gearLocked: ['Not yet', 'Ikke ennå'],
  // resources
  crystal: ['Crystal', 'Krystall'],
  ice: ['Ice', 'Is'],
  fruit: ['Star fruit', 'Stjernefrukt'],
  // HUD
  speed: ['Speed', 'Fart'],
  boost: ['Boost', 'Turbo'],
  height: ['Height', 'Høyde'],
  autopilotOn: ['Autopilot', 'Autopilot'],
  target: ['Target', 'Mål'],
  flyUp: ['Fly up to go to space', 'Fly opp for å dra ut i rommet'],
  edge: ['Turn back!', 'Snu!'],
  entering: ['Landing on {p}', 'Lander på {p}'],
  leaving: ['Off to space!', 'Ut i rommet!'],
  storm: ['Space storm! You need a hyperdrive.', 'Romstorm! Du trenger hyperdrift.'],
  hyperCharging: ['Hyperdrive...', 'Hyperdrift...'],
  hyperNoTarget: ['Pick a planet first', 'Velg en planet først'],
  hyperNeed: ['You need a hyperdrive', 'Du trenger hyperdrift'],
  hyperNoCrystal: ['A jump costs 1 crystal', 'Et hopp koster 1 krystall'],
  hyperHere: ['You are already here', 'Du er allerede her'],
  landHere: ['Land', 'Land'],
  tooHigh: ['Fly lower to land', 'Fly lavere for å lande'],
  // prompts
  pGetIn: ['Get in', 'Gå inn'],
  pTalk: ['Talk', 'Snakk'],
  pGather: ['Hold: collect', 'Hold: samle'],
  pScan: ['Hold: scan', 'Hold: skann'],
  pProbe: ['Pick up the probe', 'Ta sonden'],
  scanned: ['Already scanned', 'Allerede skannet'],
  tooFar: ['Get closer to scan', 'Gå nærmere for å skanne'],
  newFind: ['New find: {x}!', 'Nytt funn: {x}!'],
  gotItem: ['+{n} {x}', '+{n} {x}'],
  gotProbe: ['You found the probe!', 'Du fant sonden!'],
  jetpackHint: ['Hold jump in the air to fly!', 'Hold hopp i lufta for å fly!'],
  // controls
  cMove: ['Move', 'Gå'],
  cLook: ['Look', 'Se'],
  cJump: ['Jump', 'Hopp'],
  cJet: ['Jump (hold: jetpack)', 'Hopp (hold: jetpakke)'],
  cRun: ['Run', 'Løp'],
  cUse: ['Use / collect', 'Bruk / samle'],
  cScan: ['Scan', 'Skann'],
  cLog: ['Quest log', 'Oppdrag'],
  cThrottle: ['Speed', 'Fart'],
  cSteer: ['Steer', 'Styr'],
  cRoll: ['Roll', 'Rull'],
  cStrafe: ['Slide sideways', 'Gli til siden'],
  cBoost: ['Boost', 'Turbo'],
  cSlide: ['Drift', 'Drift'],
  cTarget: ['Next planet', 'Neste planet'],
  cAuto: ['Autopilot', 'Autopilot'],
  cLand: ['Land', 'Land'],
  cHyper: ['Hyperjump', 'Hyperhopp'],
  cPause: ['Pause', 'Pause'],
  // planets
  pebble: ['Pebble', 'Pebble'],
  bloom: ['Bloom', 'Blomst'],
  frost: ['Frost', 'Frost'],
  dune: ['Dune', 'Dyne'],
  pebbleDesc: ['Home. Pip lives here.', 'Hjemme. Pip bor her.'],
  bloomDesc: ['Green and full of life', 'Grønn og full av liv'],
  frostDesc: ['Ice and geysers', 'Is og geysirer'],
  duneDesc: ['Sand and crystals. Behind the storm!', 'Sand og krystaller. Bak stormen!'],
  locked: ['Needs hyperdrive', 'Trenger hyperdrift'],
  // NPC
  pipName: ['Pip', 'Pip'],
  pipHello: ['Hi {name}! I am Pip. Welcome to my outpost!', 'Hei {name}! Jeg er Pip. Velkommen til basen min!'],
  pipQ1: [
    'Fly to green Bloom. Scan 3 kinds of creatures and bring me 3 star fruit. I will give you a jetpack!',
    'Fly til grønne Blomst. Skann 3 slags dyr og gi meg 3 stjernefrukter. Da får du en jetpakke!',
  ],
  pipQ2: [
    'Brr! Fly to Frost and bring me 5 ice. Some ice is up high. Use the jetpack! I will build you a hyperdrive.',
    'Brr! Fly til Frost og hent 5 is. Noe is ligger høyt oppe. Bruk jetpakka! Da bygger jeg hyperdrift til deg.',
  ],
  pipQ3: [
    'My probe got lost on Dune, behind the space storm. Jump there with the hyperdrive and find it!',
    'Sonden min ble borte på Dyne, bak romstormen. Hopp dit med hyperdrift og finn den!',
  ],
  pipBusy: ['You can do it! Look at the quest log.', 'Du klarer det! Se i oppdragsloggen.'],
  pipThanks1: ['Wow, thank you! Here is your jetpack. Hold jump in the air!', 'Tusen takk! Her er jetpakka. Hold hopp i lufta!'],
  pipThanks2: [
    'Cool ice! Your ship has a hyperdrive now. A jump costs 1 crystal. Here are 3!',
    'Kult is! Skipet ditt har hyperdrift nå. Et hopp koster 1 krystall. Her får du 3!',
  ],
  pipThanks3: [
    'My probe! You are a real star hopper. Here is a super scanner!',
    'Sonden min! Du er en ekte stjernehopper. Her er en superskanner!',
  ],
  pipAllDone: [
    'Thank you, star hopper! Can you find every creature and plant?',
    'Takk, stjernehopper! Klarer du å finne alle dyr og planter?',
  ],
  // quests
  q1Title: ['Life on Bloom', 'Liv på Blomst'],
  q2Title: ['Ice for Pip', 'Is til Pip'],
  q3Title: ['The lost probe', 'Den borte sonden'],
  oScanKinds: ['Scan creature kinds', 'Skann slags dyr'],
  oFruit: ['Star fruit', 'Stjernefrukt'],
  oIce: ['Ice', 'Is'],
  oProbe: ['Find the probe on Dune', 'Finn sonden på Dyne'],
  oReturn: ['Go back to Pip', 'Dra tilbake til Pip'],
  questNew: ['New quest!', 'Nytt oppdrag!'],
  questComplete: ['Quest done! Go to Pip.', 'Oppdrag klart! Dra til Pip.'],
  reward: ['Reward', 'Belønning'],
  // species
  rockpup: ['Rockpup', 'Steinvalp'],
  bouncer: ['Bouncer', 'Sprett'],
  shellby: ['Shellby', 'Snegletass'],
  flutter: ['Flutter', 'Flagre'],
  waddle: ['Waddle', 'Vralte'],
  snowpuff: ['Snowpuff', 'Snøfnugg'],
  scuttle: ['Scuttle', 'Krabbetass'],
  skyjelly: ['Sky jelly', 'Himmelmanet'],
  glowcap: ['Glowcap', 'Lyssopp'],
  sunpuff: ['Sunpuff', 'Solblomst'],
  frostbell: ['Frostbell', 'Frostklokke'],
  spinecactus: ['Spiny', 'Piggen'],
  probe: ['Probe', 'Sonde'],
  saved: ['Saved', 'Lagret'],
};

export function t(key: string, vars: Record<string, string | number> = {}): string {
  const e = S[key];
  let s = e ? e[lang === 'no' ? 1 : 0] : key;
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
