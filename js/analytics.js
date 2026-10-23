// Win rates, points, streaks and the other numbers shown on screen.
/* global CONFIG, State */
/* exported Analytics */

// ══════════════════════════════════════════════════════════════════
// MATHEMATICAL & ANALYTICAL ENGINE (AUDITED & ACCURATE)
// ══════════════════════════════════════════════════════════════════
const Analytics = {
  parseWLD(wldStr) {
    if (!wldStr || typeof wldStr !== 'string') return null;
    const match = wldStr.match(/(\d+)\s*[-–—:/]\s*(\d+)\s*[-–—:/]\s*(\d+)/);
    if (!match) return null;
    return {
      w: parseInt(match[1], 10),
      l: parseInt(match[2], 10),
      d: parseInt(match[3], 10)
    };
  },

  calculatePoints(w, d) {
    const wn = Math.max(0, Number(w) || 0);
    const dn = Math.max(0, Number(d) || 0);
    return wn * 3 + dn;
  },

  // Rounds a percentage to 1 decimal place, used for display AND comparisons
  // so the displayed "50.0%" and the status threshold check always agree.
  roundPct(x) {
    return Math.round(x * 10) / 10;
  },

  // Escapes HTML special characters so user-provided strings are safe in innerHTML
  escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  parseRankNumber(rankStr) {
    if (!rankStr) return null;
    const num = Number(String(rankStr).replace(/[^\d]/g, ''));
    return (!isNaN(num) && num > 0) ? num : null;
  },

  // Thursdays after today (or baseDate) up to and including endIso, a YYYY-MM-DD date.
  getRemainingDates(endIso, baseDate = new Date()) {
    const endDate = this.parseDate(endIso);
    let nextThursday = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
    nextThursday.setDate(nextThursday.getDate() + 1);
    let safety = 0;
    while (nextThursday.getDay() !== 4 && safety < 7) {
      nextThursday.setDate(nextThursday.getDate() + 1);
      safety++;
    }
    let count = 0;
    while (nextThursday <= endDate && count < 52) {
      count++;
      nextThursday.setDate(nextThursday.getDate() + 7);
    }
    return Math.max(0, count);
  },

  parseDate(dateStr, seasonStr, item) {
    if (item && item.isoDate) {
      const d = new Date(item.isoDate);
      if (!isNaN(d.getTime())) return d;
    }
    if (!dateStr || typeof dateStr !== 'string') return new Date();
    const trimmed = dateStr.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [y, m, d] = trimmed.split('-').map(Number);
      return new Date(y, m - 1, d);
    }

    const match = trimmed.match(/(\d{1,2})\s*(?:de\s*)?([a-záéíóúñ]{3})/i);
    if (match) {
      const day = parseInt(match[1], 10);
      const monthKey = match[2].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").substring(0, 3);
      const month = CONFIG.MONTHS_MAP[monthKey] !== undefined ? CONFIG.MONTHS_MAP[monthKey] : 0;
      
      let year = 2026;
      if (seasonStr) {
        const seasonYearMatch = String(seasonStr).match(/^(\d{4})/);
        if (seasonYearMatch) year = parseInt(seasonYearMatch[1], 10);
      }
      return new Date(year, month, day);
    }

    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? new Date() : d;
  },

  // Comprehensive Deck Statistics Calculation
  computeDeckStats(deckName, entries) {
    const deckEntries = entries.filter(e => {
      if (!e.deck || e.deck === "No participó") return false;
      return e.deck.trim().toLowerCase() === deckName.trim().toLowerCase();
    });

    const count = deckEntries.length;
    let totalWins = 0;
    let totalLosses = 0;
    let totalDraws = 0;
    let totalPts = 0;
    const rankList = [];
    let top4Count = 0;
    let top8Count = 0;

    deckEntries.forEach(item => {
      // Points: Use recorded pts when genuinely set; fall back to WLD calc
      // Note: Number("") === 0 and Number(null) === 0 (both pass !isNaN) — guard explicitly
      const hasExplicitPts = item.pts !== null && item.pts !== undefined && item.pts !== "" && !isNaN(Number(item.pts));
      const parsed = this.parseWLD(item.wl);

      if (hasExplicitPts) {
        totalPts += Number(item.pts);
      } else if (parsed) {
        totalPts += this.calculatePoints(parsed.w, parsed.d);
      }
      if (parsed) {
        totalWins += parsed.w;
        totalLosses += parsed.l;
        totalDraws += parsed.d;
      }

      // Ranks
      const r = this.parseRankNumber(item.rank);
      if (r !== null) {
        rankList.push(r);
        if (r <= 4) top4Count++;
        if (r <= 8) top8Count++;
      }
    });

    const totalMatches = totalWins + totalLosses + totalDraws;
    
    // Exact Match Win Rate %: W / Total Matches
    const winRate = totalMatches > 0 ? (totalWins / totalMatches) * 100 : 0;
    
    // Match Point Percentage: (3*W + 1*D) / (3*Total Matches)
    const matchPointRate = totalMatches > 0 ? (((totalWins * 3) + (totalDraws * 1)) / (totalMatches * 3)) * 100 : 0;
    
    // Points Per Tournament (PPG)
    const ppg = count > 0 ? (totalPts / count) : 0;
    
    // Average and Best Rank
    const avgRank = rankList.length > 0 ? (rankList.reduce((a, b) => a + b, 0) / rankList.length) : null;
    const bestRank = rankList.length > 0 ? Math.min(...rankList) : null;

    // Form (Recent 5 tourneys chronologically)
    const sortedDeckEntries = [...deckEntries].sort((a, b) => {
      return Analytics.parseDate(a.date, a.season, a) - Analytics.parseDate(b.date, b.season, b);
    });
    const recentForm = sortedDeckEntries.slice(-5);

    // Benchmark Classification — compare rounded value so display and badge always agree
    const winRateRounded = this.roundPct(winRate);
    let status = { key: 'insufficient', label: 'Muestra insuficiente', icon: '', class: 'insufficient', desc: 'Menos de 3 torneos: todavía no hay muestra suficiente' };
    if (count >= CONFIG.BENCHMARKS.MIN_SAMPLE_SIZE) {
      if (winRateRounded >= CONFIG.BENCHMARKS.GOOD_WIN_RATE) {
        status = { key: 'good', label: 'Buen rendimiento', icon: '', class: 'good', desc: 'Gana más partidas de las que pierde (50 % o más)' };
      } else if (winRateRounded >= CONFIG.BENCHMARKS.AVG_WIN_RATE) {
        status = { key: 'average', label: 'Promedio / viable', icon: '', class: 'average', desc: 'Cerca del 50 %: competitivo (de 45 % a 49,9 %)' };
      } else {
        status = { key: 'bad', label: 'Bajo rendimiento', icon: '', class: 'bad', desc: 'Pierde más partidas de las que gana (menos de 45 %)' };
      }
    }

    return {
      deck: deckName,
      count,
      totalWins,
      totalLosses,
      totalDraws,
      totalMatches,
      winRate,
      matchPointRate,
      totalPts,
      ppg,
      avgRank,
      bestRank,
      top4Count,
      top8Count,
      recentForm,
      status,
      entries: sortedDeckEntries
    };
  },

  getAllDeckStats(entries) {
    // Collect all unique decks that are active in State.decksList
    const deckNames = new Set(State.decksList);
    entries.forEach(e => {
      if (e.deck && e.deck !== "No participó" && !State.deletedDecks.some(d => d.toLowerCase() === e.deck.trim().toLowerCase())) {
        deckNames.add(e.deck.trim());
      }
    });

    const results = [];
    deckNames.forEach(name => {
      const stats = this.computeDeckStats(name, entries);
      results.push(stats);
    });

    return results;
  }
};
