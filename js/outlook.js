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
    let out = 0;
    const runs = this.simulate(players, { nightsLeft, captured, seed: 0x9E3779B9 ^ (players.length * 7919) ^ (me.pts * 104729) ^ nightsLeft }, totals => {
      let above = 0;
      for (let i = 0; i < players.length; i++) if (totals[i] > totals[mine]) above++;
      if (above >= top) out++;
    });
    return out / runs;
  },

  // Where the line of the top ends the season: the points of the last place inside it, played out the same way as risk().
  // { likely, safe }: the median of the runs, and a mark beaten in 8 runs of 10 (reaching it leaves a margin). An estimate;
  // with nothing left to play it is today's line. Null while the table has fewer players than places.
  finalCut(players, { top, nightsLeft, captured }) {
    if (players.length < top) return null;
    if (nightsLeft <= 0 || captured <= 0) return { likely: players[top - 1].pts, safe: players[top - 1].pts };
    const cuts = [];
    const sorted = new Array(players.length);
    this.simulate(players, { nightsLeft, captured, seed: 0x85EBCA6B ^ (players.length * 7919) ^ (top * 31) ^ nightsLeft }, totals => {
      for (let i = 0; i < totals.length; i++) sorted[i] = totals[i];
      sorted.sort((a, b) => b - a);
      cuts.push(sorted[top - 1]);
    });
    cuts.sort((a, b) => a - b);
    return { likely: cuts[Math.floor(cuts.length / 2)], safe: cuts[Math.min(cuts.length - 1, Math.floor(cuts.length * 0.8))] };
  },

  // Plays the rest of the season out many times and hands each run's final points (in the players' order) to `each`. Each
  // player is on a night as often as they have been so far, and takes the points they have taken: from their own nights, and
  // from the league's as a whole when they have few. The draws are seeded, so the same table gives the same figures. Returns
  // how many runs were played.
  simulate(players, { nightsLeft, captured, seed }, each) {
    const pool = players.flatMap(player => player.nightPts);
    const attends = players.map(player => (player.nights + 0.5) / (captured + 1));
    const own = players.map(player => player.nights / (player.nights + 3));
    const next = this.random(seed);
    const pick = (list) => list[Math.floor(next() * list.length)];
    // A long season with a big league gets fewer runs (never fewer than 500, which still keeps the error within a couple of
    // points), so the screen never waits on it: the work is about the same for every league.
    const runs = Math.max(500, Math.min(CONFIG.LEAGUE.RISK_RUNS, Math.floor(8e5 / (players.length * nightsLeft))));
    const totals = new Array(players.length);
    for (let run = 0; run < runs; run++) {
      for (let i = 0; i < players.length; i++) totals[i] = players[i].pts;
      for (let night = 0; night < nightsLeft; night++) {
        for (let i = 0; i < players.length; i++) {
          if (next() >= attends[i]) continue;
          totals[i] += next() < own[i] ? pick(players[i].nightPts) : pick(pool);
        }
      }
      each(totals);
    }
    return runs;
  }
};
