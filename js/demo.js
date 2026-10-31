// The invented league the test mode shows, so a newcomer can look around before typing anything.
/* global CONFIG, localIsoDate, seasonOf, seasonEndBounds */
/* exported Demo */

// ══════════════════════════════════════════════════════════════════
// SAMPLE LEAGUE
// Every name, deck and result here is made up; none of it is anyone's. The nights are the last eight league nights before
// today, so the sample always looks current. The same call always draws the same results (a seeded generator).
// ══════════════════════════════════════════════════════════════════
const Demo = {
  NAME: 'Alex Prueba',
  // The weekday of the sample league (Thursday): it goes in the sample profile like any other person's would.
  DAY: 4,
  NIGHTS: 8,
  QUALIFY: 8,
  DECKS: ['🔴 Burn', '🔵⚫ Faeries', '⚪🔴 Boros Synergy'],
  PLAYERS: ['Ana Torres', 'Beto Ríos', 'Carla Mena', 'Diego Salas', 'Elena Vega', 'Fabio Luna', 'Gina Prado', 'Hugo Cano',
    'Irene Soto', 'Javi Marín', 'Karla Peña', 'Leo Ibarra', 'Marta Gil', 'Nico Rojas', 'Olga Bravo'],
  // Four rounds a night: the records that come up, and the ones the sample person gets, night after night.
  RECORDS: ['4-0-0', '3-1-0', '3-0-1', '2-2-0', '2-1-1', '1-3-0', '1-2-1', '0-4-0'],
  MINE: ['2-2-0', '3-1-0', '1-3-0', '2-1-1', '2-2-0', '3-1-0', '1-3-0', '2-2-0'],
  SKIPPED: 4,

  // A small deterministic generator (mulberry32).
  random(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  points(record) {
    const [w, , d] = record.split('-').map(Number);
    return w * 3 + d;
  },

  // { historic, seasonEnds, seasonTop, profile } for a person who plays on DAY and has been at it for NIGHTS weeks.
  build(today = new Date()) {
    const rand = this.random(2026);
    // The last league night before today, then the ones before it.
    const last = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    while (last.getDay() !== this.DAY) last.setDate(last.getDate() - 1);
    const nights = Array.from({ length: this.NIGHTS }, (_, i) => new Date(last.getFullYear(), last.getMonth(), last.getDate() - 7 * (this.NIGHTS - 1 - i)));

    const historic = nights.map((day, night) => {
      const season = seasonOf(day.getFullYear(), day.getMonth() + 1);
      const base = { date: `${day.getDate()} ${CONFIG.MONTHS_ABBR[day.getMonth()]}`, isoDate: localIsoDate(day), season };
      if (night === this.SKIPPED) return { ...base, deck: 'No participó', rank: '—', pts: '—', wl: '—', type: 'none', notes: 'No participó' };

      const mine = this.MINE[night % this.MINE.length];
      const rows = [{ name: this.NAME, wl: mine, pts: this.points(mine) }];
      this.PLAYERS.forEach(name => {
        // Most come every week, a few miss one.
        if (rand() < 0.2) return;
        const wl = this.RECORDS[Math.floor(rand() * this.RECORDS.length)];
        rows.push({ name, wl, pts: this.points(wl) });
      });
      rows.sort((a, b) => b.pts - a.pts);
      const pts = this.points(mine);
      // Ties share a place, as they do on a real standings screen.
      const place = 1 + rows.filter(row => row.pts > pts).length;
      return {
        ...base,
        deck: this.DECKS[Math.min(this.DECKS.length - 1, Math.floor(night / 3))],
        rank: `${place}°`,
        pts,
        wl: mine,
        type: pts >= CONFIG.BENCHMARKS.TYPE_GOOD_PTS ? 'good' : (pts <= CONFIG.BENCHMARKS.TYPE_BAD_PTS ? 'bad' : 'normal'),
        notes: place <= 3 ? 'Podio' : '',
        playerResults: rows
      };
    });

    // The season that is on closes in six weeks, or at the latest date it can.
    const current = seasonOf(today.getFullYear(), today.getMonth() + 1);
    const [min, max] = seasonEndBounds(current);
    const close = localIsoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 42));
    const seasons = new Set([current, ...historic.map(item => item.season)]);
    return {
      historic,
      seasonEnds: { [current]: close < min ? min : (close > max ? max : close) },
      seasonTop: Object.fromEntries([...seasons].map(season => [season, this.QUALIFY])),
      profile: { name: this.NAME, leagueDay: this.DAY }
    };
  }
};
