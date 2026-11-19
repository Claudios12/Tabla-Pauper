// Starting a season again, and which deck the Comparador names as the one that struggles.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { boot, entry, plain } = require('./helpers');

test('a season begun again loses only its own tournaments, nights and months', () => {
  const app = boot();
  const S = app.State;
  S.load();
  S.profile = { name: 'Ana Prueba', leagueDay: 4 };
  S.saveProfile();
  S.nameLinks = { same: [['tomas vera', 'tomas elias vera']], apart: [] };
  S.saveNameLinks();
  S.seasonEnds = { '2026-2': '2026-12-10' };
  S.seasonTop = { '2026-2': 10 };
  S.saveSeasonEnds();
  S.saveSeasonTop();
  S.historic.push(
    entry('2026-03-05', 'Burn', 9, '3-1-0', { season: '2026-1' }),
    entry('2026-09-03', 'Burn', 6, '2-2-0'),
    entry('2026-10-01', 'Elves', 3, '1-3-0'),
    { date: '8 Oct', isoDate: '2026-10-08', season: '2026-2', deck: 'No participó', source: 'store', type: 'none', rank: '—', pts: '—', wl: '—', playerResults: [{ name: 'Ana Prueba', pts: 6 }] }
  );
  S.monthsLog = { '2026-03': { read: '2026-04-02T10:00:00.000Z', players: 10, pictures: 1, published: null }, '2026-09': { read: '2026-10-02T10:00:00.000Z', players: 12, pictures: 2, published: '2026-10-03T10:00:00.000Z' } };
  S.saveDraft({ date: '2026-11-19', deck: 'Elves', rounds: [{ r: 'W', vs: '' }] });
  S.save();
  const gone = S.restartSeason('2026-2');
  assert.deepStrictEqual(plain(gone), { tournaments: 2, nights: 1, months: 1 });
  S.load();
  assert.deepStrictEqual(plain(S.historic.map(e => e.isoDate)), ['2026-03-05'], 'the other season stays');
  assert.deepStrictEqual(Object.keys(S.monthsLog), ['2026-03']);
  assert.strictEqual(S.profile.name, 'Ana Prueba');
  assert.strictEqual(S.nameLinks.same.length, 1, 'the names joined stay');
  assert.deepStrictEqual(plain([S.seasonEnds, S.seasonTop]), [{ '2026-2': '2026-12-10' }, { '2026-2': 10 }], 'the closing date and places stay');
  assert.strictEqual(S.loadDraft(), null, "that season's night in progress goes");
  assert.deepStrictEqual(plain(S.decksList), ['Burn'], 'a deck only played that season is gone from the list');
});

test('only a deck below 50 % is named as the one that struggles', () => {
  const app = boot();
  const stats = (deck, winRate, count = 3) => ({ deck, winRate, count, totalMatches: count * 4, ppg: 5 });
  const { lead, weak } = app.deckExtremes([stats('Faeries', 62.5), stats('Burn', 50)]);
  assert.deepStrictEqual([lead.deck, weak], ['Faeries', null], 'Burn at 50 % is doing well');
  assert.strictEqual(app.deckExtremes([stats('Faeries', 62.5), stats('Burn', 50), stats('Elves', 41.7)]).weak.deck, 'Elves');
});
