// The day a picture was taken against the tournament's: that night or the next morning is fine, any other day asks first.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { boot } = require('./helpers');

test('a picture of the night, or of after midnight, is of that tournament', () => {
  const { pictureDayOff } = boot();
  const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime();
  assert.strictEqual(pictureDayOff(at(2026, 11, 19, 22, 30), '2026-11-19'), '', 'the same night');
  assert.strictEqual(pictureDayOff(at(2026, 11, 20, 0, 40), '2026-11-19'), '', 'after midnight');
  assert.strictEqual(pictureDayOff(at(2026, 11, 20, 18), '2026-11-19'), '', 'the next day still counts');
  assert.strictEqual(pictureDayOff(at(2026, 12, 1, 1), '2026-11-30'), '', 'across the end of a month');
  assert.strictEqual(pictureDayOff(at(2027, 1, 1, 1), '2026-12-31'), '', 'across the end of a year');
});

test('a picture of another day is named, and nothing is guessed without a date', () => {
  const { pictureDayOff } = boot();
  const at = (y, m, d, h) => new Date(y, m - 1, d, h).getTime();
  assert.strictEqual(pictureDayOff(at(2026, 11, 12, 22), '2026-11-19'), '2026-11-12', 'the week before');
  assert.strictEqual(pictureDayOff(at(2026, 11, 21, 10), '2026-11-19'), '2026-11-21', 'two days later');
  assert.strictEqual(pictureDayOff(at(2026, 11, 18, 23), '2026-11-19'), '2026-11-18', 'the day before');
  assert.strictEqual(pictureDayOff(0, '2026-11-19'), '', 'a file with no time');
  assert.strictEqual(pictureDayOff(undefined, '2026-11-19'), '');
  assert.strictEqual(pictureDayOff(at(2026, 11, 12, 22), ''), '', 'a tournament with no date');
});
