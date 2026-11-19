// The record of which months of the store's table were read and published: what it may hold, and where it is kept.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { boot, plain } = require('./helpers');

test('the record keeps months that were read, and drops anything else', () => {
  const app = boot();
  const read = '2026-08-03T20:00:00.000Z';
  assert.deepStrictEqual(plain(app.cleanMonthsLog({
    '2026-07': { read, players: 20, pictures: 2, published: '2026-08-04T10:00:00.000Z' },
    '2026-08': { read, players: 'x', published: 'nunca' },
    '2026-13': { read },
    '2026-09': { players: 10 },
    julio: { read }
  })), {
    '2026-07': { read, players: 20, pictures: 2, published: '2026-08-04T10:00:00.000Z' },
    '2026-08': { read, players: 0, pictures: 0, published: null }
  });
  assert.strictEqual(app.cleanMonthsLog([]), null);
  assert.strictEqual(app.cleanMonthsLog('julio'), null);
});

test('the record is kept on the device, its own key in the test mode, and wiped with the rest', () => {
  const app = boot();
  const S = app.State;
  S.load();
  S.monthsLog = { '2026-07': { read: '2026-08-03T20:00:00.000Z', players: 20, pictures: 2, published: null } };
  S.saveMonthsLog();
  S.monthsLog = {};
  S.load();
  assert.deepStrictEqual(Object.keys(S.monthsLog), ['2026-07'], 'it comes back after a reload');
  app.CONFIG.isTestMode = true;
  S.loadDemo();
  assert.deepStrictEqual(plain(S.monthsLog), {}, 'the sample league starts with no months');
  assert.ok(app.store.has('pauper_test_arena_months_log') && app.store.has('pauper_arena_months_log'), 'the real record is not touched');
  S.clearTestData();
  assert.ok(!app.store.has('pauper_test_arena_months_log'));
  app.CONFIG.isTestMode = false;
  S.load();
  S.wipeAll();
  assert.deepStrictEqual(JSON.parse(app.store.get('pauper_arena_months_log')), {});
});
