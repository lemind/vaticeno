import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CallCost } from '../llm/client.js';
import type { Contract } from './schema.js';
import { SourceUnavailable } from '../resolve/fetch.js';
import {
  followerAccount,
  followerReadFromProfile,
  parseCount,
  profileHandle,
  resolveFollowerContract,
} from './x-profile.js';

// The contract the normalizer wrote for claim gzrt3 (2026-10-06). "author" meant the account the post replied
// to, @0xPaulvibe; reading the poster's count gave a wrong MISS.
const GZRT3: Contract = {
  subject: "author's X account",
  criterion: 'The author reaches a count of 3,000 followers on X.',
  deadline_at: '2026-10-13T23:59:59Z',
  source: {
    name: 'X.com',
    kind: 'tech_releases',
    locator: 'https://twitter.com/i/api/1.1/users/show.json?screen_name=author',
    scope: 'The follower count displayed on the user profile.',
    entity_id: 'author',
    absence_is_meaningful: false,
    fallback: 'same_issuer_only',
  },
  negative_condition:
    'The follower count is below 3,000 at the end of the deadline day.',
  resolution_method: 'model',
};
const GZRT3_POST =
  '@0xPaulvibe @vaticeno @0xPaulvibe reaches 3k followers in a week';
const POSTER = '85641384';
const lookup = {
  getUserByUsername: async (username: string) => ({
    id: username === '0xPaulvibe' ? '1614958779489026048' : '99',
    username,
  }),
};

test('the account comes from the post: gzrt3 is about @0xPaulvibe, not the poster', async () => {
  assert.deepEqual(followerAccount(GZRT3_POST, 'vaticeno'), {
    kind: 'handle',
    handle: '0xPaulvibe',
  });
  const costs: CallCost[] = [];
  const out = await resolveFollowerContract(
    lookup,
    'vaticeno',
    GZRT3,
    GZRT3_POST,
    POSTER,
    costs,
  );
  assert.deepEqual(out.followers, {
    user_id: '1614958779489026048',
    comparison: 'AT_LEAST',
    threshold: 3000,
  });
  assert.equal(out.source.locator, 'https://x.com/i/user/1614958779489026048');
  assert.equal(
    out.criterion,
    '@0xPaulvibe reaches 3,000 followers on X',
    'said by name, never "Author"',
  );
  assert.equal(costs.length, 1, 'the handle lookup is paid and recorded');
});

test('the poster only when the post says so or names nobody', () => {
  assert.deepEqual(
    followerAccount("I'll reach 3k followers by Friday", 'vaticeno'),
    { kind: 'poster' },
  );
  assert.deepEqual(
    followerAccount('@elonmusk I will reach 3k followers this month', 'vaticeno'),
    { kind: 'poster' },
  );
  assert.deepEqual(
    followerAccount('@vaticeno my account hits 5,000 followers', 'vaticeno'),
    { kind: 'poster' },
  );
  assert.deepEqual(
    followerAccount('@a @vaticeno @b gets to 10k followers', 'vaticeno'),
    { kind: 'handle', handle: 'b' },
    'the handle right before the phrase',
  );
  assert.equal(
    followerAccount('@a will be bigger than @b soon', 'vaticeno'),
    null,
    'no follower phrase: not ours to read',
  );
});

test('when the account is not certain, the contract stays as the model wrote it', async () => {
  assert.equal(
    await resolveFollowerContract(
      undefined,
      'vaticeno',
      GZRT3,
      GZRT3_POST,
      POSTER,
      [],
    ),
    GZRT3,
    'no X client',
  );
  const failing = {
    getUserByUsername: async () => {
      throw new Error('404');
    },
  };
  assert.equal(
    await resolveFollowerContract(
      failing,
      'vaticeno',
      GZRT3,
      GZRT3_POST,
      POSTER,
      [],
    ),
    GZRT3,
    'unknown handle',
  );
  const notX = {
    ...GZRT3,
    source: {
      ...GZRT3.source,
      name: 'Instagram',
      locator: 'https://instagram.com/x',
    },
  };
  assert.equal(
    await resolveFollowerContract(lookup, 'vaticeno', notX, GZRT3_POST, POSTER, []),
    notX,
    'not X',
  );
  const noCount = { ...GZRT3, criterion: 'The author posts every day on X.' };
  assert.equal(
    await resolveFollowerContract(
      lookup,
      'vaticeno',
      noCount,
      GZRT3_POST,
      POSTER,
      [],
    ),
    noCount,
    'no follower number',
  );
});

test('"below" compares the other way, and counts read like people write them', async () => {
  const below = await resolveFollowerContract(
    lookup,
    'vaticeno',
    { ...GZRT3, criterion: 'The author has fewer than 3k followers on X.' },
    "I'll stay under 3k followers",
    POSTER,
    [],
  );
  assert.deepEqual(below.followers, {
    user_id: POSTER,
    comparison: 'BELOW',
    threshold: 3000,
  });
  assert.equal(parseCount('3,000', undefined), 3000);
  assert.equal(parseCount('3.5', 'k'), 3500);
  assert.equal(parseCount('2', 'M'), 2_000_000);
  assert.equal(
    parseCount('1.5', undefined),
    null,
    'a fraction of a follower is not a count',
  );
  assert.equal(parseCount('1.1', 'k'), 1100, 'no floating-point leftovers');
});

// Claim ymjep (2026-11-06): read from the thread, the post itself said nothing about followers. The model put
// the account in the source; it was locked as a web claim and would have gone VOID at the deadline.
const YMJEP: Contract = {
  subject: "Bhoomi's X account",
  criterion: 'Bhoomi reaches 1000 followers on X',
  deadline_at: '2026-12-06T23:59:59Z',
  source: {
    name: 'X',
    kind: 'social_media',
    locator: 'https://x.com/Bhoomi1021',
    scope: 'Follower count on the profile of Bhoomi1021',
    entity_id: 'Bhoomi1021',
    absence_is_meaningful: false,
    fallback: 'same_issuer_only',
  },
  negative_condition: 'Bhoomi has fewer than 1000 followers on X by the deadline',
  resolution_method: 'model',
};
const YMJEP_POST =
  '@Bhoomi1021 @vaticeno @X This is my predictions project. \n@vaticeno selfpromo';
const bhoomi = {
  getUserByUsername: async (username: string) => ({ id: '777', username }),
};

test('no account in the post: the profile the source names is read (ymjep)', async () => {
  assert.equal(profileHandle(YMJEP), 'Bhoomi1021');
  assert.equal(profileHandle(GZRT3), null, 'an API path is no profile');
  const atAuthor = {
    ...YMJEP,
    source: { ...YMJEP.source, locator: 'https://x.com/author' },
  };
  assert.equal(profileHandle(atAuthor), null, 'the model’s word is no handle');
  const intent = {
    ...YMJEP,
    source: {
      ...YMJEP.source,
      locator: 'https://x.com/intent/user?screen_name=gusto',
    },
  };
  assert.equal(profileHandle(intent), 'gusto', 'cgc9k’s form');

  const costs: CallCost[] = [];
  const out = await resolveFollowerContract(
    bhoomi,
    'vaticeno',
    YMJEP,
    YMJEP_POST,
    POSTER,
    costs,
  );
  assert.deepEqual(out.followers, {
    user_id: '777',
    comparison: 'AT_LEAST',
    threshold: 1000,
  });
  assert.equal(out.criterion, '@Bhoomi1021 reaches 1,000 followers on X');
  assert.equal(costs.length, 1);

  const unnamed = await resolveFollowerContract(
    bhoomi,
    'vaticeno',
    YMJEP,
    'reaches 1k+ followers by December',
    POSTER,
    [],
  );
  assert.equal(
    unnamed.followers?.user_id,
    '777',
    'names nobody: the profile, not the poster',
  );
  const mine = await resolveFollowerContract(
    bhoomi,
    'vaticeno',
    YMJEP,
    'I will reach 1000 followers',
    POSTER,
    [],
  );
  assert.equal(mine.followers?.user_id, POSTER, 'first person is still the poster');
});

test('a follower claim locked as a web claim is read from the profile at the deadline, or waits', async () => {
  const costs: CallCost[] = [];
  const read = await followerReadFromProfile(bhoomi, YMJEP, costs);
  assert.equal(read.followers?.user_id, '777');
  assert.equal(read.source.locator, 'https://x.com/i/user/777');
  assert.equal(costs.length, 1);

  const down = {
    getUserByUsername: async () => {
      throw new Error('503');
    },
  };
  await assert.rejects(
    followerReadFromProfile(down, YMJEP, []),
    SourceUnavailable,
    'an outage, never a web search',
  );
  await assert.rejects(
    followerReadFromProfile(undefined, YMJEP, []),
    SourceUnavailable,
  );
  assert.equal(
    await followerReadFromProfile(bhoomi, GZRT3, []),
    GZRT3,
    'no profile in the source: unchanged',
  );
  assert.equal(
    await followerReadFromProfile(down, read, []),
    read,
    'already a follower read: no lookup',
  );
});

test('"won\'t reach" is a call that the count stays below, never "reaches" (kzhj7)', async () => {
  for (const criterion of [
    "@sly won't reach 500 followers on X",
    '@sly will not reach 500 followers on X',
    '@sly does not reach 500 followers on X',
    '@sly fails to reach 500 followers on X',
  ]) {
    const out = await resolveFollowerContract(
      bhoomi,
      'vaticeno',
      { ...YMJEP, criterion },
      "@sly won't reach 500 followers by tomorrow",
      POSTER,
      [],
    );
    assert.equal(out.followers?.comparison, 'BELOW', criterion);
    assert.equal(out.followers?.threshold, 500);
    assert.equal(out.criterion, '@sly has fewer than 500 followers on X', criterion);
  }
});
