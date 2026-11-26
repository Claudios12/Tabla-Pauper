// "¿De dónde sale?": the tournaments behind a figure add up to the very figure the cards show.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { boot, entry, plain } = require('./helpers');

test('the rows behind a deck add up to its stats', () => {
  const app = boot();
  const A = app.Analytics;
  const entries = [
    entry('2026-10-01', 'Burn', 9, '3-1-0'),
    entry('2026-10-08', 'burn', '', '2-1-1'),
    entry('2026-10-15', 'Burn', '', ''),
    entry('2026-10-22', 'Elves', 6, '2-2-0'),
    entry('2026-10-29', 'No participó', '', '')
  ];
  entries[0].rank = '2°';
  entries[1].rank = '5';
  const rows = A.explainRows(entries, 'Burn');
  assert.deepStrictEqual(plain(rows.map(r => [r.entry.isoDate || r.entry.date, r.ptsFrom, r.pts])).map(r => r.slice(1)), [['none', 0], ['record', 7], ['typed', 9]], 'newest first, how each point was got');
  const t = A.explainTotals(rows);
  const stat = A.computeDeckStats('Burn', entries);
  assert.deepStrictEqual([t.count, t.w, t.l, t.d, t.pts], [stat.count, stat.totalWins, stat.totalLosses, stat.totalDraws, stat.totalPts]);
  assert.strictEqual(t.ranks.reduce((a, b) => a + b, 0) / t.ranks.length, stat.avgRank);
  assert.strictEqual(Math.min(...t.ranks), stat.bestRank);
});

test('every deck together, without the nights not played, is the global figure', () => {
  const app = boot();
  const A = app.Analytics;
  const entries = [entry('2026-10-01', 'Burn', 9, '3-1-0'), entry('2026-10-08', 'Elves', 6, '2-2-0'), entry('2026-10-15', 'No participó', '', '')];
  const t = A.explainTotals(A.explainRows(entries));
  const all = A.getAllDeckStats(entries).filter(d => d.count > 0);
  const sum = (f) => all.reduce((s, d) => s + d[f], 0);
  assert.deepStrictEqual([t.count, t.w, t.l, t.d, t.pts], [sum('count'), sum('totalWins'), sum('totalLosses'), sum('totalDraws'), sum('totalPts')]);
});
