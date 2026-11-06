// The topics an event post is drawn from (spec 005 FR-019), all weighted alike (owner, 2026-11-06).
export type Topic = {
  id: string;
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
    name: 'American football',
    events: 'NFL weeks, playoffs, Super Bowl, draft',
    months: [1, 2, 4, 9, 10, 11, 12],
    sources: ['https://www.nfl.com'],
  },
  {
    id: 'basketball',
    name: 'Basketball',
    events: 'NBA season, playoffs, Finals, draft',
    months: [1, 2, 3, 4, 5, 6, 10, 11, 12],
    sources: ['https://www.nba.com'],
  },
  {
    id: 'tennis',
    name: 'Tennis',
    events: 'Australian Open, Roland Garros, Wimbledon, US Open, ATP and WTA Finals',
    months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    sources: ['https://www.atptour.com', 'https://www.wtatennis.com'],
  },
  {
    id: 'formula-1',
    name: 'Formula 1',
    events: 'each Grand Prix, the championship',
    months: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    sources: ['https://www.formula1.com'],
  },
  {
    id: 'horse-racing',
    name: 'Horse racing',
    events: 'Cheltenham, Grand National, Kentucky Derby, Royal Ascot, Breeders’ Cup',
    months: ALL_YEAR,
    sources: ['https://www.britishhorseracing.com', 'https://www.kentuckyderby.com'],
  },
  {
    id: 'cricket',
    name: 'Cricket',
    events: 'IPL, the Ashes, T20 World Cup, test series',
    months: ALL_YEAR,
    sources: ['https://www.icc-cricket.com', 'https://www.iplt20.com'],
  },
  {
    id: 'baseball',
    name: 'Baseball',
    events: 'MLB season, playoffs, World Series',
    months: [4, 5, 6, 7, 8, 9, 10],
    sources: ['https://www.mlb.com'],
  },
  {
    id: 'combat-sports',
    name: 'Combat sports',
    events: 'UFC numbered events, big boxing fights',
    months: ALL_YEAR,
    sources: ['https://www.ufc.com'],
  },
  {
    id: 'golf',
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
    name: 'Crypto',
    events:
      'BTC and ETH price levels by a date, network upgrades, token unlocks, fund approvals',
    months: ALL_YEAR,
    sources: ['https://ethereum.org', 'https://www.sec.gov'],
  },
  {
    id: 'central-banks',
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
    name: 'Economic data',
    events: 'US inflation (CPI), jobs report, GDP',
    months: ALL_YEAR,
    sources: ['https://www.bls.gov/schedule/', 'https://www.bea.gov'],
  },
  {
    id: 'earnings',
    name: 'Company earnings',
    events: 'quarterly results of the largest companies',
    months: [1, 2, 4, 5, 7, 8, 10, 11],
    sources: ['the company’s investor-relations page'],
  },
  {
    id: 'politics',
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
    name: 'Tech',
    events: 'product launches, keynotes, AI model releases',
    months: ALL_YEAR,
    sources: ['the company’s own announcement'],
  },
  {
    id: 'space',
    name: 'Space and science',
    events: 'launches, missions, landings',
    months: ALL_YEAR,
    sources: ['https://www.nasa.gov', 'https://www.spacex.com'],
  },
  {
    id: 'awards',
    name: 'Awards and entertainment',
    events: 'Oscars, Grammys, Ballon d’Or, box office',
    months: [1, 2, 3, 9, 10, 11, 12],
    sources: ['https://www.oscars.org', 'https://www.grammy.com'],
  },
];

// One topic at random, in season this month, never the one drawn last time.
export function drawTopic(
  month: number,
  last: string | undefined,
  random: () => number = Math.random,
): Topic {
  const open = TOPICS.filter((t) => t.months.includes(month) && t.id !== last);
  return open[Math.floor(random() * open.length)]!;
}
