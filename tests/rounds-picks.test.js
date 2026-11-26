// The decks already played against, offered as buttons when writing a round's rival: most played first, filtered by what is typed.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { boot, entry, plain } = require('./helpers');

test('the rivals offered: most played first, one per name, the round being written left out', () => {
  const app = boot({ arena: ['arena-logger'] });
  const S = app.State;
  S.load();
  const a = entry('2026-10-01', 'Burn', 9, '3-1-0');
  a.rounds = [{ r: 'W', vs: 'Elves' }, { r: 'L', vs: 'Affinity' }, { r: 'W', vs: 'elves' }, { r: 'B', vs: '' }];
  const b = entry('2026-10-08', 'Burn', 6, '2-2-0');
  b.rounds = [{ r: 'W', vs: 'Bogles' }, { r: 'L', vs: 'Affinity' }, { r: 'L', vs: 'Elves' }];
  S.historic.push(a, b);
  app.Arena._draft = { date: '2026-11-19', deck: 'Burn', rounds: [{ r: 'W', vs: 'Bogles' }, { r: 'L', vs: 'Faeries' }] };
  app.Arena._roundEdit = 1;
  assert.deepStrictEqual(plain(app.Arena.opponentPicks().map(p => [p.vs, p.n])), [['Elves', 3], ['Affinity', 2], ['Bogles', 2]]);
  assert.deepStrictEqual(plain(app.Arena.opponentPicks('aff').map(p => p.vs)), ['Affinity'], 'filtered by what is typed');
  assert.deepStrictEqual(plain(app.Arena.opponentPicks('zzz')), []);
});
