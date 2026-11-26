// Every ⓘ in the app opens a written meaning: no mark points at a figure that has no words.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT, boot } = require('./helpers');

test('every info mark and every explained figure has its meaning and its how', () => {
  const app = boot({ arena: ['arena-info'] });
  const info = app.Arena.STAT_INFO;
  Object.entries(info).forEach(([key, item]) => {
    assert.ok(item.title && item.what.length > 20 && item.how.length > 20, `${key} is written out`);
  });
  const sources = [path.join(ROOT, 'index.html'), ...fs.readdirSync(path.join(ROOT, 'js')).map(name => path.join(ROOT, 'js', name))]
    .map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const used = new Set();
  for (const m of sources.matchAll(/(?:infoButton|showInfo)\('(\w+)'/g)) used.add(m[1]);
  for (const m of sources.matchAll(/explainFigure\('(\w+)'/g)) used.add(m[1]);
  for (const m of sources.matchAll(/info: '(\w+)'/g)) used.add(m[1]);
  // The figures explainFigure works out take their meaning from the same words, and so do the General tab's own figures.
  ['winrate', 'mp', 'ppt', 'count', 'avgRank', 'bestRank', 'myRank', 'myPts', 'cut'].forEach(kind => used.add(kind));
  assert.ok(used.size >= 20, 'the marks were found');
  [...used].forEach(key => assert.ok(info[key], `«${key}» has words in STAT_INFO`));
});
