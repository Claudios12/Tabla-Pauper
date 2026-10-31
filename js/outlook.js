// What is already decided in a season, and the chance of the rest: from the points so far and the nights that are left.
/* global CONFIG */
/* exported Outlook */

// ══════════════════════════════════════════════════════════════════
// OUTLOOK
// Both parts read the league table (League.standings) and know nothing of the screen.
// ══════════════════════════════════════════════════════════════════
const Outlook = {
  // Whether each player's place in the top is already settled, whatever happens in the nights that are left. 'in': nobody
  // can put them outside. 'out': they cannot get in even by taking every point still on offer. '': still open. It is
  // arithmetic, not a guess: the players are the table (best first), top the places that qualify, nightsLeft the nights
  // still to play and maxNight the most points one night gives.
  decided(players, top, nightsLeft, maxNight) {
    const reach = nightsLeft * maxNight;
    return players.map(player => {
      // Others who already have more points than this player can finish with.
      const surelyAbove = players.filter(other => other !== player && other.pts > player.pts + reach).length;
      if (surelyAbove >= top) return 'out';
      // Others who could finish level or ahead, taking every point on offer while this player takes none. Someone not on
      // the table yet could also turn up and take every night, so unless what is left cannot reach this player, nobody is safe.
      const couldPass = players.filter(other => other !== player && other.pts + reach >= player.pts).length;
      return couldPass < top && player.pts > reach ? 'in' : '';
    });
  },

  // A small seeded generator (mulberry32): the same table always gives the same estimate, so the figure on screen never jumps.
  random(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  // The chance, from 0 to 1, that `me` ends outside the top, by playing the rest of the season out many times. Each player
  // is on a night as often as they have been so far, and takes the points they have taken: from their own nights, and from
  // the league's as a whole when they have few (a player seen once says little). captured: the nights with a table so far.
  // Ties at the cut count for the player, as in the table.
  risk(players, me, { top, nightsLeft, captured }) {
    const mine = players.indexOf(me);
    if (mine < 0) return null;
    if (nightsLeft <= 0 || captured <= 0) return me.rank > top ? 1 : 0;
    const pool = players.flatMap(player => player.nightPts);
    const attends = players.map(player => (player.nights + 0.5) / (captured + 1));
    const own = players.map(player => player.nights / (player.nights + 3));
    const next = this.random(0x9E3779B9 ^ (players.length * 7919) ^ (me.pts * 104729) ^ nightsLeft);
    const pick = (list) => list[Math.floor(next() * list.length)];
    // A long season with a big league gets fewer runs (never fewer than 500, which still keeps the error within a couple of
    // points), so the screen never waits on it: the work is about the same for every league.
    const runs = Math.max(500, Math.min(CONFIG.LEAGUE.RISK_RUNS, Math.floor(8e5 / (players.length * nightsLeft))));
    const totals = new Array(players.length);
    let out = 0;
    for (let run = 0; run < runs; run++) {
      for (let i = 0; i < players.length; i++) totals[i] = players[i].pts;
      for (let night = 0; night < nightsLeft; night++) {
        for (let i = 0; i < players.length; i++) {
          if (next() >= attends[i]) continue;
          totals[i] += next() < own[i] ? pick(players[i].nightPts) : pick(pool);
        }
      }
      let above = 0;
      for (let i = 0; i < players.length; i++) if (totals[i] > totals[mine]) above++;
      if (above >= top) out++;
    }
    return out / runs;
  }
};
