// The topics an event post is drawn from (spec 005 FR-019), weighted toward sports (owner, 2026-11-28).
export type Topic = {
  id: string;
  // Relative chance of being drawn: sports 3, crypto 2, money 1, politics, tech, space and awards 0.5.
  weight: number;
  name: string;
  events: string;
  // Months (1–12) when the topic usually has a scheduled event; out of season it is not drawn.
  months: readonly number[];
  // Official pages to take the date from and check it against (FR-008a).
  sources: readonly string[];
};

const ALL_YEAR = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export const TOPICS: readonly Topic[] = [
  {
    id: 'football',
    weight: 3,
    name: 'Football (soccer)',
    events: 'Premier League, La Liga, Champions League, World Cup, Euros',
    months: ALL_YEAR,
    sources: [
      'https://www.premierleague.com',
      'https://www.uefa.com',
      'https://www.fifa.com',
    ],
  },
  {
    id: 'american-football',
    weight: 3,
    name: 'American football',
    events: 'NFL weeks, playoffs, Super Bowl, draft',
    months: [1, 2, 4, 9, 10, 11, 12],
    sources: ['https://www.nfl.com'],
  },
  {
    id: 'basketball',
    weight: 3,
    name: 'Basketball',
    events: 'NBA season, playoffs, Finals, draft',
    months: [1, 2, 3, 4, 5, 6, 10, 11, 12],
    sources: ['https://www.nba.com'],
  },
  {
    id: 'tennis',
    weight: 3,
    name: 'Tennis',
    events: 'Australian Open, Roland Garros, Wimbledon, US Open, ATP and WTA Finals',
    months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    sources: ['https://www.atptour.com', 'https://www.wtatennis.com'],
  },
  {
    id: 'formula-1',
    weight: 3,
    name: 'Formula 1',
    events: 'each Grand Prix, the championship',
    months: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    sources: ['https://www.formula1.com'],
  },
  {
    id: 'horse-racing',
    weight: 3,
    name: 'Horse racing',
    events: 'Cheltenham, Grand National, Kentucky Derby, Royal Ascot, Breeders’ Cup',
    months: ALL_YEAR,
    sources: ['https://www.britishhorseracing.com', 'https://www.kentuckyderby.com'],
  },
  {
    id: 'cricket',
    weight: 3,
    name: 'Cricket',
    events: 'IPL, the Ashes, T20 World Cup, test series',
    months: ALL_YEAR,
    sources: ['https://www.icc-cricket.com', 'https://www.iplt20.com'],
  },
  {
    id: 'baseball',
    weight: 3,
    name: 'Baseball',
    events: 'MLB season, playoffs, World Series',
    months: [4, 5, 6, 7, 8, 9, 10],
    sources: ['https://www.mlb.com'],
  },
  {
    id: 'combat-sports',
    weight: 3,
    name: 'Combat sports',
    events: 'UFC numbered events, big boxing fights',
    months: ALL_YEAR,
    sources: ['https://www.ufc.com'],
  },
  {
    id: 'golf',
    weight: 3,
    name: 'Golf',
    events: 'the Masters, the Open, PGA Championship, US Open, Ryder Cup',
    months: [4, 5, 6, 7, 8, 9],
    sources: [
      'https://www.masters.com',
      'https://www.theopen.com',
      'https://www.pgatour.com',
    ],
  },
  {
    id: 'crypto',
    weight: 2,
    name: 'Crypto',
    events:
      'BTC and ETH price levels by a date, network upgrades, token unlocks, fund approvals',
    months: ALL_YEAR,
    sources: ['https://ethereum.org', 'https://www.sec.gov'],
  },
  {
    id: 'central-banks',
    weight: 1,
    name: 'Central banks',
    events: 'Fed, ECB and Bank of England meetings and rate decisions',
    months: ALL_YEAR,
    sources: [
      'https://www.federalreserve.gov',
      'https://www.ecb.europa.eu',
      'https://www.bankofengland.co.uk',
    ],
  },
  {
    id: 'economic-data',
    weight: 1,
    name: 'Economic data',
    events: 'US inflation (CPI), jobs report, GDP',
    months: ALL_YEAR,
    sources: ['https://www.bls.gov/schedule/', 'https://www.bea.gov'],
  },
  {
    id: 'earnings',
    weight: 1,
    name: 'Company earnings',
    events: 'quarterly results of the largest companies',
    months: [1, 2, 4, 5, 7, 8, 10, 11],
    sources: ['the company’s investor-relations page'],
  },
  {
    id: 'politics',
    weight: 0.5,
    name: 'Politics and elections',
    events: 'elections, referendums, parliament votes, Supreme Court decisions',
    months: ALL_YEAR,
    sources: [
      'the election commission',
      'https://apnews.com',
      'https://www.supremecourt.gov',
    ],
  },
  {
    id: 'tech',
    weight: 0.5,
    name: 'Tech',
    events: 'product launches, keynotes, AI model releases',
    months: ALL_YEAR,
    sources: ['the company’s own announcement'],
  },
  {
    id: 'space',
    weight: 0.5,
    name: 'Space and science',
    events: 'launches, missions, landings',
    months: ALL_YEAR,
    sources: ['https://www.nasa.gov', 'https://www.spacex.com'],
  },
  {
    id: 'awards',
    weight: 0.5,
    name: 'Awards and entertainment',
    events: 'Oscars, Grammys, Ballon d’Or, box office',
    months: [1, 2, 3, 9, 10, 11, 12],
    sources: ['https://www.oscars.org', 'https://www.grammy.com'],
  },
];

// One topic by weight, in season this month, never the one drawn last time.
export function drawTopic(
  month: number,
  last: string | undefined,
  random: () => number = Math.random,
): Topic {
  const open = TOPICS.filter((t) => t.months.includes(month) && t.id !== last);
  return pickWeighted(open, random())!;
}

// `r` in [0, 1) lands in one topic's share of the open topics' total weight.
export function pickWeighted(open: readonly Topic[], r: number): Topic | undefined {
  let left = r * open.reduce((sum, t) => sum + t.weight, 0);
  for (const topic of open) {
    left -= topic.weight;
    if (left < 0) return topic;
  }
  return open.at(-1);
}
