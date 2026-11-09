// Where the daily event repost is searched (spec 005 FR-011): one group of fields per weekday, each with the
// accounts that announce events in them, the words such posts use and a floor of likes. Owner-chosen; the bot
// never adds an account. Handles go into `from:`, so no id lookup is ever paid for.
export type RepostGroup = {
  name: string;
  handles: readonly string[];
  words: readonly string[];
  minLikes: number;
};

// X refuses a longer query on pay-per-use access (src/content/repost-groups.test.ts keeps every group under it).
export const MAX_QUERY_CHARS = 512;
const EXCLUDE = '-is:retweet -is:reply -highlights -recap -giveaway';

// Index = UTC weekday, 0 = Sunday. Accounts researched and checked by the owner on 2026-11-09.
export const REPOST_GROUPS: readonly RepostGroup[] = [
  {
    name: 'markets and crypto',
    handles: [
      'KobeissiLetter',
      'NickTimiraos',
      'DeItaone',
      'eWhispers',
      'StockMKTNewz',
      'wallstengine',
      'EleanorTerrett',
      'CoinDesk',
      'Cointelegraph',
      'solana',
    ],
    words: [
      '"this week"',
      '"key events"',
      '"reports earnings"',
      '"most anticipated"',
      '"rate decision"',
      '"Fed meeting"',
      'deadline',
      'unlock',
    ],
    minLikes: 100,
  },
  {
    name: 'F1, MotoGP and space',
    handles: [
      'F1',
      'ScuderiaFerrari',
      'MercedesAMGF1',
      'McLarenF1',
      'SkySportsF1',
      'MotoGP',
      'SpaceX',
      'SciGuySpace',
      'RocketLab',
      'NASASpaceflight',
    ],
    words: [
      '"race week"',
      '"this weekend"',
      '"next stop"',
      '"could be decided"',
      '"launch window"',
      'targeting',
      '"no earlier than"',
    ],
    minLikes: 300,
  },
  {
    name: 'football',
    handles: [
      'premierleague',
      'ChampionsLeague',
      'FabrizioRomano',
      'SkySportsPL',
      'ESPNFC',
    ],
    words: [
      '"this weekend"',
      '"kicks off"',
      'matchweek',
      'matchday',
      'tomorrow',
      'tonight',
    ],
    minLikes: 1000,
  },
  {
    name: 'combat sports',
    handles: [
      'ufc',
      'danawhite',
      'Home_of_Fight',
      'trboxing',
      'ringmagazine',
      'DAZNBoxing',
      'PFLMMA',
    ],
    words: [
      '"fight week"',
      '"this Saturday"',
      '"this weekend"',
      '"press conference"',
      'weigh-ins',
      '"fight night"',
      'tomorrow',
    ],
    minLikes: 100,
  },
  {
    name: 'US sports',
    handles: [
      'NFL',
      'AdamSchefter',
      'RapSheet',
      'BleacherReport',
      'NBA',
      'ShamsCharania',
      'ESPNNBA',
      'MLB',
    ],
    words: [
      '"will start"',
      '"expected to play"',
      'tonight',
      '"this week"',
      'Sunday',
      '"Thursday night"',
      '"will be announced"',
    ],
    minLikes: 500,
  },
  {
    name: 'cricket, tennis, golf and racing',
    handles: [
      'BCCI',
      'ICC',
      'cricinfo',
      'atptour',
      'WTA',
      'TennisTV',
      'josemorgado',
      'PGATOUR',
      'DPWorldTour',
      'NUCLRGOLF',
      'BreedersCup',
      'CheltenhamRaces',
    ],
    words: [
      '"starts tomorrow"',
      '"series opener"',
      '"this week"',
      'draw',
      '"tee times"',
      '"this weekend"',
      '"days to go"',
    ],
    minLikes: 100,
  },
  {
    name: 'launches and awards',
    handles: [
      'RockstarGames',
      'XBOX',
      'PlayStation',
      'MacRumors',
      'markgurman',
      'PopBase',
      'PopCrave',
      'thegameawards',
      'geoffkeighley',
      'goldenglobes',
    ],
    words: [
      '"release date"',
      'launches',
      'nominations',
      '"will be announced"',
      '"next week"',
      'tomorrow',
    ],
    minLikes: 500,
  },
];

// The group of `now`'s UTC weekday, or of the day `offset` days later (the one fallback search).
export function groupFor(now: Date, offset = 0): RepostGroup {
  return REPOST_GROUPS[(now.getUTCDay() + offset) % REPOST_GROUPS.length]!;
}

export function groupQuery(group: RepostGroup): string {
  const from = group.handles.map((h) => `from:${h}`).join(' OR ');
  return `(${from}) (${group.words.join(' OR ')}) ${EXCLUDE} min_likes:${group.minLikes}`;
}
