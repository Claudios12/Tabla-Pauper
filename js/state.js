// What is saved on this device: history, deleted decks, season end dates, how many qualify in each season, and who the person is.
/* global CONFIG, Analytics, League, Demo, cleanSeasonEnds, cleanSeasonTop, cleanProfile, isIsoDate, isStoreNight */
/* exported State */

// ══════════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// Nothing ships with the app: a person who opens it starts with nothing, and everything below is theirs.
// ══════════════════════════════════════════════════════════════════
const State = {
  historic: [],
  decksList: [],
  deletedDecks: [],
  // Closing date of each season that has one: { "2027-1": "2027-06-24" }.
  seasonEnds: {},
  // How many places qualify in each season that has said: { "2026-2": 10 }. It differs from one season to the next.
  seasonTop: {},
  // Who the person is: the name they appear under on the standings screens (several spellings may be separated by commas)
  // and the weekday their league plays, 0 (Sunday) to 6, or null while they have not said.
  profile: { name: '', leagueDay: null },
  // True when the browser refused a write, so a change is never reported as saved when it was not.
  writeFailed: false,
  // Raw text of stored data that could not be read: kept aside so the next save does not wipe it.
  unreadable: null,

  historicKey() {
    return CONFIG.isTestMode ? 'pauper_test_arena_historic' : 'pauper_arena_historic';
  },

  // The nights made from the store's table are kept apart from the history (see save).
  storeNightsKey() {
    return CONFIG.isTestMode ? 'pauper_test_arena_store_nights' : 'pauper_arena_store_nights';
  },

  deletedKey() {
    return CONFIG.isTestMode ? 'pauper_test_arena_deleted_decks' : 'pauper_arena_deleted_decks';
  },

  seasonEndsKey() {
    return CONFIG.isTestMode ? 'pauper_test_arena_season_ends' : 'pauper_arena_season_ends';
  },

  seasonTopKey() {
    return CONFIG.isTestMode ? 'pauper_test_arena_season_top' : 'pauper_arena_season_top';
  },

  profileKey() {
    return CONFIG.isTestMode ? 'pauper_test_arena_profile' : 'pauper_arena_profile';
  },

  unreadableKey() {
    return `${this.historicKey()}_unreadable`;
  },

  saveSeasonTop() {
    try {
      localStorage.setItem(this.seasonTopKey(), JSON.stringify(this.seasonTop));
    } catch (e) {
      this.writeFailed = true;
      console.warn('Error guardando en localStorage:', e);
    }
  },

  loadSeasonTop() {
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(this.seasonTopKey()));
    } catch (e) {}
    this.seasonTop = cleanSeasonTop(stored) || {};
  },

  // The places that qualify in a season: what it said, or the usual number until it does.
  topFor(season) {
    return this.seasonTop[season] || CONFIG.LEAGUE.TOP_CUTOFF;
  },

  saveSeasonEnds() {
    try {
      localStorage.setItem(this.seasonEndsKey(), JSON.stringify(this.seasonEnds));
    } catch (e) {
      this.writeFailed = true;
      console.warn('Error guardando en localStorage:', e);
    }
  },

  // A season has a closing date only once the person has said so.
  loadSeasonEnds() {
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(this.seasonEndsKey()));
    } catch (e) {}
    this.seasonEnds = cleanSeasonEnds(stored) || {};
  },

  saveProfile() {
    try {
      localStorage.setItem(this.profileKey(), JSON.stringify(this.profile));
    } catch (e) {
      this.writeFailed = true;
      console.warn('Error guardando en localStorage:', e);
    }
  },

  // Reads who the person is and tells the league, which cannot find "your row" without it.
  loadProfile() {
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(this.profileKey()));
    } catch (e) {}
    this.profile = cleanProfile(stored) || { name: '', leagueDay: null };
    League.identify(this.profile.name);
  },

  // The weekday the league plays: the one the person chose, or else the one most of their tournaments fell on. Null until there
  // is either, because the nights left cannot be counted without it.
  leagueDay() {
    return Number.isInteger(this.profile.leagueDay) ? this.profile.leagueDay : this.inferredLeagueDay();
  },

  // The weekday most of the tournaments fell on (the latest wins a tie), or null when there are none.
  inferredLeagueDay() {
    const seen = Array.from({ length: 7 }, () => ({ count: 0, last: '' }));
    this.historic.forEach(item => {
      // Only the person's own tournaments say which day their league plays: a night made from the store's table could be on a proposed date.
      if (!item || isStoreNight(item) || !isIsoDate(item.isoDate)) return;
      const [y, m, d] = item.isoDate.split('-').map(Number);
      const slot = seen[new Date(y, m - 1, d).getDay()];
      slot.count++;
      if (item.isoDate > slot.last) slot.last = item.isoDate;
    });
    let best = null;
    seen.forEach((slot, day) => {
      if (!slot.count) return;
      if (best === null || slot.count > seen[best].count || (slot.count === seen[best].count && slot.last > seen[best].last)) best = day;
    });
    return best;
  },

  // The history of a person who has just opened the app, or whose saved history cannot be read: none. Nothing is written.
  resetHistory() {
    this.historic = [];
    this.syncDecksList();
  },

  // Every trace of the person's data on this device: tournaments, deleted decks, season dates and places, name and league day.
  wipeAll() {
    this.historic = [];
    this.deletedDecks = [];
    this.seasonEnds = {};
    this.seasonTop = {};
    this.profile = { name: '', leagueDay: null };
    League.identify('');
    this.saveDeletedDecks();
    this.saveSeasonEnds();
    this.saveSeasonTop();
    this.saveProfile();
    this.save();
    this.syncDecksList();
    // Nothing of the test mode stays behind either (a sample left under its own keys by a page closed in the middle of it).
    this.clearTestData();
  },

  // The invented league the test mode shows. Every write goes under the test keys, so the person's own data is not touched.
  loadDemo() {
    const demo = Demo.build();
    this.historic = demo.historic;
    this.deletedDecks = [];
    this.seasonEnds = demo.seasonEnds;
    this.seasonTop = demo.seasonTop;
    this.profile = demo.profile;
    League.identify(this.profile.name);
    this.saveDeletedDecks();
    this.saveSeasonEnds();
    this.saveSeasonTop();
    this.saveProfile();
    this.save();
    this.syncDecksList();
  },

  // What the test mode left under its own keys.
  clearTestData() {
    ['historic', 'store_nights', 'deleted_decks', 'season_ends', 'season_top', 'profile'].forEach(name => {
      try { localStorage.removeItem(`pauper_test_arena_${name}`); } catch (e) {}
    });
  },

  saveDeletedDecks() {
    try {
      localStorage.setItem(this.deletedKey(), JSON.stringify(this.deletedDecks));
    } catch (e) {
      this.writeFailed = true;
      console.warn('Error guardando en localStorage:', e);
    }
  },

  loadDeletedDecks() {
    try {
      const stored = localStorage.getItem(this.deletedKey());
      this.deletedDecks = stored ? JSON.parse(stored) : [];
    } catch(e) {
      this.deletedDecks = [];
    }
  },

  // The raw text goes under its own key before the app starts over from an empty history.
  keepUnreadable(raw) {
    if (!raw) return;
    this.unreadable = raw;
    try {
      if (localStorage.getItem(this.unreadableKey()) !== raw) localStorage.setItem(this.unreadableKey(), raw);
    } catch (e) {
      console.warn('No se pudo conservar una copia de los datos ilegibles:', e);
    }
  },

  // The set-aside copy, from this session or an earlier one.
  unreadableCopy() {
    try {
      return this.unreadable || localStorage.getItem(this.unreadableKey());
    } catch (e) {
      return this.unreadable;
    }
  },

  discardUnreadable() {
    this.unreadable = null;
    try { localStorage.removeItem(this.unreadableKey()); } catch (e) {}
  },

  // The decks are the ones the person has played, less the ones they deleted.
  syncDecksList() {
    this.loadDeletedDecks();
    const foundDecks = new Set();
    this.historic.forEach(item => {
      if (item.deck && item.deck !== "No participó") {
        foundDecks.add(item.deck.trim());
      }
    });
    // Filter out any explicitly deleted decks
    this.deletedDecks.forEach(del => foundDecks.delete(del));
    this.decksList = Array.from(foundDecks);
  },

  deleteDeck(deckName) {
    if (!deckName) return;
    const normalized = deckName.trim();
    if (!this.deletedDecks.includes(normalized)) {
      this.deletedDecks.push(normalized);
    }
    this.saveDeletedDecks();

    // Remove all tournaments with this deck from historic
    this.historic = this.historic.filter(item => {
      return !item.deck || item.deck.trim().toLowerCase() !== normalized.toLowerCase();
    });

    this.syncDecksList();
    this.save();
  },

  // The nights made from the store's table are not tournaments, so they are saved under a key of their own while the rest of the
  // app still sees them in `historic`. An older release of the app (the page rolled back to it) reads only the history key: it never
  // shows them as nights the person missed, and they are all still here when the page comes back.
  readStoreNights() {
    try {
      const stored = JSON.parse(localStorage.getItem(this.storeNightsKey()));
      return Array.isArray(stored) ? this.fillIsoDates(stored.filter(item => item && typeof item === 'object')) : [];
    } catch (e) {
      return [];
    }
  },

  save() {
    try {
      const nights = this.historic.filter(isStoreNight);
      localStorage.setItem(this.historicKey(), JSON.stringify(this.historic.filter(item => !isStoreNight(item))));
      if (nights.length) localStorage.setItem(this.storeNightsKey(), JSON.stringify(nights));
      else localStorage.removeItem(this.storeNightsKey());
      localStorage.setItem('pauper_arena_version', CONFIG.DATA_VERSION);
      localStorage.setItem('pauper_arena_last_update', new Date().toISOString());
    } catch (e) {
      this.writeFailed = true;
      console.warn('Error guardando en localStorage:', e);
    }
  },

  // Gives every entry a real date: where it is missing, from the date as it was written and the season it belongs to. Entries come
  // from storage or from a backup, and a day is told apart by its date, so none may lack one.
  fillIsoDates(list) {
    list.forEach(item => {
      if (!item || isIsoDate(item.isoDate)) return;
      // Only a date that can really be read is turned into one (the parser falls back to today for the rest, and a made-up day
      // could hide or duplicate a real one).
      const written = typeof item.date === 'string' ? item.date.trim() : '';
      const named = written.match(/(\d{1,2})\s*(?:de\s*)?([a-záéíóúñ]{3})/i);
      const month = named ? CONFIG.MONTHS_MAP[named[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').substring(0, 3)] : undefined;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(written) && month === undefined) return;
      const d = Analytics.parseDate(item.date, item.season);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      item.isoDate = `${y}-${m}-${day}`;
    });
    return list;
  },

  load() {
    let stored = null;
    // Read before the history, so a history that cannot be read does not take the nights made from the store's table with it.
    const nights = this.readStoreNights();
    try {
      this.loadDeletedDecks();
      this.loadSeasonEnds();
      this.loadSeasonTop();
      this.loadProfile();
      stored = localStorage.getItem(this.historicKey());

      if (stored) {
        this.historic = JSON.parse(stored);
        this.fillIsoDates(this.historic);
      } else {
        // Also check legacy key if transitioning
        const legacyKey = localStorage.getItem('pauper_historic');
        if (legacyKey) {
          try {
            this.historic = JSON.parse(legacyKey);
          } catch(e) {
            this.resetHistory();
          }
        } else {
          this.resetHistory();
        }
      }

      // Filter out any entries belonging to deleted decks
      if (this.deletedDecks.length > 0) {
        this.historic = this.historic.filter(item => {
          return !item.deck || !this.deletedDecks.some(d => d.toLowerCase() === item.deck.trim().toLowerCase());
        });
      }

      this.syncDecksList();
    } catch (e) {
      console.error('Error cargando datos:', e);
      this.keepUnreadable(stored);
      this.resetHistory();
    }
    // A night an earlier save left in the history itself is not taken twice.
    const held = new Set(this.historic.filter(isStoreNight).map(item => JSON.stringify(item)));
    this.historic = this.historic.concat(nights.filter(item => !held.has(JSON.stringify(item))));
    // Starting from an empty history writes nothing the person made, so a refused write here is not news.
    this.writeFailed = false;
  }
};
