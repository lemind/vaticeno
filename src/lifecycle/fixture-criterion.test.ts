import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixtureCriterion } from './claims.js';

const fight = {
  found: true,
  home: 'Mario Pinto',
  away: 'Serghei Spivac',
  competition: 'UFC',
  kickoff_utc: null,
};

test('a two-sided event always names the opponent (live 2026-11-24)', () => {
  assert.equal(
    fixtureCriterion(
      {
        ...fight,
        criterion:
          'Mario Pinto wins their fight at UFC Saudi Arabia on December 5, 2026',
      },
      'Mario Pinto wins his fight',
    ),
    'Mario Pinto vs Serghei Spivac: Mario Pinto wins their fight at UFC Saudi Arabia on December 5, 2026',
  );
  assert.equal(
    fixtureCriterion(
      { ...fight, criterion: 'Mario Pinto beats Serghei Spivac (UFC Saudi Arabia)' },
      'Pinto wins',
    ),
    'Mario Pinto beats Serghei Spivac (UFC Saudi Arabia)',
  );
  assert.equal(
    fixtureCriterion(
      { ...fight, criterion: 'Pinto wins at UFC' },
      'Pinto beats Spivac',
    ),
    'Pinto beats Spivac',
    "the author's wording when only it names the opponent",
  );
});

test('a field event keeps the search wording', () => {
  assert.equal(
    fixtureCriterion(
      { ...fight, away: null, criterion: 'So My Folks wins Race 1 at Sha Tin' },
      'my horse wins',
    ),
    'So My Folks wins Race 1 at Sha Tin',
  );
});
