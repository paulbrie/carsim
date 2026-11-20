import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueTicket, verifyTicket } from '../lib/race/ticket.mjs';

test('a ticket verifies with its secret until it expires', () => {
  const t = issueTicket({ id: 'u1', name: 'Ann', image: 'https://x/y.png' }, 's3cret', 1000, 5000);
  assert.deepEqual(verifyTicket(t, 's3cret', 5500), { id: 'u1', name: 'Ann', image: 'https://x/y.png' });
  assert.equal(verifyTicket(t, 's3cret', 6001), null);
  assert.equal(verifyTicket(t, 'other', 5500), null);
});

test('a tampered ticket fails', () => {
  const t = issueTicket({ id: 'u1', name: 'Ann' }, 's3cret', 1000, 5000);
  const [body, mac] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ id: 'admin', name: 'X', exp: 9e15 })).toString('base64url');
  assert.equal(verifyTicket(`${forged}.${mac}`, 's3cret', 5500), null);
  assert.equal(verifyTicket(body, 's3cret', 5500), null);
  assert.equal(verifyTicket('', 's3cret'), null);
  assert.equal(verifyTicket(t, '', 5500), null);
});
