// Decks: deleting one and playing it again, one deck whatever its capitals, and how a night's points are called.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { boot, entry, plain } = require('./helpers');

test('a deck deleted and played again keeps its new tournament', () => {
  const app = boot();
  const S = app.State;
  S.load();
  S.historic.push(entry('2026-10-01', 'Burn', 9, '3-1-0'), entry('2026-10-02', 'Elves', 6, '2-2-0'));
  S.syncDecksList();
  S.save();
  S.deleteDeck('Burn');
  assert.deepStrictEqual(plain([S.historic.length, S.decksList, S.deletedDecks]), [1, ['Elves'], ['Burn']]);
  S.load();
  assert.deepStrictEqual(plain([S.historic.length, S.deletedDecks]), [1, ['Burn']], 'still deleted after a reload');
  S.historic.push(entry('2026-11-05', 'burn', 12, '4-0-0'));
  S.syncDecksList();
  S.save();
  assert.deepStrictEqual(plain([S.decksList, S.deletedDecks]), [['Elves', 'burn'], []], 'listed again, off the deleted list');
  assert.deepStrictEqual(JSON.parse(app.store.get('pauper_arena_deleted_decks')), []);
  S.load();
  assert.strictEqual(S.historic.length, 2, 'kept after a reload');
});

test('an old save that lists a deck it still has drops nothing and is repaired', () => {
  const app = boot();
  const S = app.State;
  S.load();
  S.historic.push(entry('2026-10-01', 'Burn', 9, '3-1-0'), entry('2026-10-02', 'Elves', 6, '2-2-0'));
  S.save();
  app.store.set('pauper_arena_deleted_decks', JSON.stringify(['Elves', 7, null]));
  S.load();
  assert.deepStrictEqual(plain([S.historic.length, S.deletedDecks]), [2, []]);
});

test('one deck whatever its capitals', () => {
  const app = boot();
  const S = app.State;
  S.load();
  S.historic.push(entry('2026-10-01', 'Burn', 9, '3-1-0'), entry('2026-10-08', 'burn', 3, '1-3-0'));
  S.syncDecksList();
  const stats = app.Analytics.getAllDeckStats(S.historic).filter(deck => deck.count > 0);
  assert.deepStrictEqual(plain(stats.map(deck => [deck.deck, deck.count, deck.totalPts])), [['Burn', 2, 12]]);
});

test('points, win rate and match points of a deck', () => {
  const app = boot();
  const stats = app.Analytics.computeDeckStats('Burn', [entry('2026-10-01', 'Burn', 9, '3-1-0'), entry('2026-10-08', 'Burn', '', '2-1-1'), entry('2026-10-15', 'Burn', '—', '1-3-0')]);
  assert.deepStrictEqual([stats.totalPts, stats.totalWins, stats.totalLosses, stats.totalDraws], [19, 6, 5, 1]);
  assert.strictEqual(stats.winRate.toFixed(2), '50.00');
  assert.strictEqual(stats.matchPointRate.toFixed(2), '52.78');
});

test('a night is good, normal or bad by its points, everywhere', () => {
  const app = boot();
  assert.deepStrictEqual(plain([0, 3, 4, 5, 6, 12].map(app.tournamentType)), ['bad', 'bad', 'normal', 'normal', 'good', 'good']);
  const demo = app.Demo.build(new Date(2026, 10, 14));
  assert.ok(demo.historic.filter(night => night.deck !== 'No participó').every(night => night.type === app.tournamentType(night.pts)));
});

test('renaming a deck rewrites every tournament of it, and the night being marked', () => {
  const app = boot();
  const S = app.State;
  S.load();
  S.historic.push(entry('2026-10-01', 'Elfoss', 9, '3-1-0'), entry('2026-10-08', 'elfoss', 3, '1-3-0'), entry('2026-10-15', 'Burn', 6, '2-2-0'));
  S.syncDecksList();
  S.saveDraft({ date: '2026-11-19', deck: 'Elfoss', rounds: [{ r: 'W', vs: '' }] });
  assert.strictEqual(S.renameDeck('Elfoss', '🟢 Elfos'), 2, 'both spellings change');
  assert.deepStrictEqual(plain(S.decksList), ['🟢 Elfos', 'Burn']);
  assert.strictEqual(S.loadDraft().deck, '🟢 Elfos');
  S.load();
  assert.deepStrictEqual(plain(S.historic.map(e => e.deck)), ['🟢 Elfos', '🟢 Elfos', 'Burn'], 'saved');
  const stats = app.Analytics.getAllDeckStats(S.historic).filter(d => d.count > 0);
  assert.deepStrictEqual(plain(stats.map(d => [d.deck, d.count])), [['🟢 Elfos', 2], ['Burn', 1]]);
});

test('renaming a deck to another one joins them', () => {
  const app = boot();
  const S = app.State;
  S.load();
  S.historic.push(entry('2026-10-01', 'Burn', 9, '3-1-0'), entry('2026-10-08', 'Burnn', 3, '1-3-0'));
  S.syncDecksList();
  S.renameDeck('Burnn', 'Burn');
  const stats = app.Analytics.getAllDeckStats(S.historic).filter(d => d.count > 0);
  assert.deepStrictEqual(plain(stats.map(d => [d.deck, d.count, d.totalPts])), [['Burn', 2, 12]]);
});
