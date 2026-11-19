// Round by round: what a saved round may hold, the matchups it gives, the draft kept on the device, and the sample league.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { boot, plain } = require('./helpers');

test('a round holds a result and an opponent deck, a bye never an opponent', () => {
  const app = boot();
  assert.deepStrictEqual(plain(app.cleanRounds([{ r: 'W', vs: '  Affinity  ' }, { r: 'X' }, null, 'W', { r: 'L', vs: 7 }, { r: 'D', vs: 'a'.repeat(60) }, { r: 'B', vs: 'Elves' }])),
    [{ r: 'W', vs: 'Affinity' }, { r: 'L', vs: '' }, { r: 'D', vs: 'a'.repeat(40) }, { r: 'B', vs: '' }]);
  assert.deepStrictEqual(plain(app.cleanRounds({ r: 'W' })), []);
  assert.strictEqual(app.cleanRounds(Array(12).fill({ r: 'W', vs: '' })).length, 9);
});

test('matchups group opponents whatever their capitals and leave byes out', () => {
  const app = boot();
  const night = (deck, rounds) => ({ deck, season: '2026-2', isoDate: '2026-10-01', rounds });
  const rows = app.Analytics.matchups([
    night('Burn', [{ r: 'W', vs: 'Affinity' }, { r: 'L', vs: 'affinity' }, { r: 'W', vs: 'Elves' }, { r: 'D', vs: '' }, { r: 'B', vs: '' }]),
    night('burn', [{ r: 'W', vs: 'Affinity' }]),
    night('Elves', [{ r: 'L', vs: 'Affinity' }])
  ], 'Burn');
  assert.deepStrictEqual(plain(rows.map(r => [r.vs, r.w, r.l, r.d, Math.round(r.winRate)])), [['Affinity', 2, 1, 0, 67], ['Elves', 1, 0, 0, 100], ['', 0, 0, 1, 0]]);
});

test('the draft is kept, cleaned, and gone with a wipe or the end of the test mode', () => {
  const app = boot();
  const S = app.State;
  S.saveDraft({ date: '2026-11-19', deck: 'Burn', rounds: [{ r: 'W', vs: 'Elves' }, { r: 'bad' }], done: true });
  assert.deepStrictEqual(plain(S.loadDraft()), { date: '2026-11-19', deck: 'Burn', rounds: [{ r: 'W', vs: 'Elves' }], done: true });
  S.saveDraft({ date: '2026-11-19', deck: 'Burn', rounds: [] });
  assert.strictEqual(app.store.has('pauper_arena_draft'), false, 'no rounds, no draft');
  S.saveDraft({ date: '2026-11-19', deck: 'Burn', rounds: [{ r: 'W', vs: '' }] });
  S.load();
  S.wipeAll();
  assert.strictEqual(app.store.has('pauper_arena_draft'), false, 'a wipe takes it');
  app.CONFIG.isTestMode = true;
  S.saveDraft({ date: '2026-11-19', deck: 'x', rounds: [{ r: 'L', vs: '' }] });
  assert.deepStrictEqual([app.store.has('pauper_test_arena_draft'), app.store.has('pauper_arena_draft')], [true, false]);
  S.clearTestData();
  assert.strictEqual(app.store.has('pauper_test_arena_draft'), false);
});

test("the sample league's rounds match each night's record", () => {
  const app = boot();
  const demo = app.Demo.build(new Date(2026, 10, 14));
  demo.historic.filter(night => night.deck !== 'No participó').forEach(night => {
    const rounds = app.cleanRounds(night.rounds);
    const count = (r) => rounds.filter(round => round.r === r).length;
    assert.strictEqual(`${count('W') + count('B')}-${count('L')}-${count('D')}`, night.wl, night.date);
  });
});
