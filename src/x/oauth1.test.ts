import assert from 'node:assert/strict';
import { test } from 'node:test';
import { oauth1Header } from './oauth1.js';

// The worked example from X's "Creating a signature" page (the RFC 5849 procedure).
test('signs the documented example exactly', () => {
  const header = oauth1Header(
    'POST',
    'https://api.twitter.com/1.1/statuses/update.json?include_entities=true&status=' +
      encodeURIComponent('Hello Ladies + Gentlemen, a signed OAuth request!'),
    {
      consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
      consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
      token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
      tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
    },
    new Date(1318622958 * 1000),
    'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
  );
  assert.match(header, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);
});
