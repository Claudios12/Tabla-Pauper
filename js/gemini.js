// Gemini: the person's own API key (device-local, never part of State) and the one call that sends pictures to it and
// expects structured JSON back. Everything downstream (League.extend, Monthly.fromRows) cross-checks what comes back the
// same way it checked the local OCR engine: nothing here is trusted blindly.
/* global CONFIG */
/* exported Gemini */

const Gemini = {
  // The key is a secret the person pastes in, not league data: it is never read into State, never backed up, never
  // cleared by wipeAll, and the same in test mode as outside it.
  STORAGE_KEY: 'gemini_api_key',

  key() {
    return (localStorage.getItem(this.STORAGE_KEY) || '').trim();
  },

  setKey(value) {
    const key = String(value ?? '').trim();
    if (key) localStorage.setItem(this.STORAGE_KEY, key);
    else localStorage.removeItem(this.STORAGE_KEY);
    return key;
  },

  clearKey() {
    localStorage.removeItem(this.STORAGE_KEY);
  },

  // A file as the base64 the API wants: no "data:image/...;base64," prefix.
  toBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '');
      reader.onerror = () => reject(new Error(`No se pudo leer el archivo «${file.name}».`));
      reader.readAsDataURL(file);
    });
  },

  // Which model reads. Google retires models and some days one is overloaded or out of free quota, and the person has
  // nobody to change the code, so the page moves on by itself. It only ever tries the free-tier families, "flash" and
  // "flash-lite" (never "pro", which is not free), and it learns which ones exist from the person's own key
  // (ListModels), so a model Google adds later is found without a release. The order is: the one that last worked (on
  // this device, for a week), the one in CONFIG, then the rest (flash newest first, then flash-lite, then the "-latest"
  // aliases), with the ones that did not answer in this visit last.
  _working: null,
  _found: null,
  _dead: new Set(),
  _slow: new Set(),
  // The model that last answered, kept on this device like the key (a setting, not league data: never in State or a backup).
  WORKING_KEY: 'gemini_model_ok',
  WORKING_DAYS: 7,

  // 502/503/504: the server is busy for a moment. 429: the free quota of that model is used up (per minute or per day).
  // Both are worth trying on another model, and again after a pause. 404 (or the API saying the model is gone) is a model
  // that no longer answers: it is dropped for this visit.
  RETRY_STATUSES: [502, 503, 504],
  PASS_DELAYS_MS: [4000, 8000],
  // A busy model may also take the request and never answer (seen 2026-11-19: every full flash model silent for minutes
  // while flash-lite answered in 2 s). A phone then drops the call, which looks like no connection, so each call has a
  // time limit and a model that runs out of it is passed over like a busy one; and no new call starts once the whole
  // reading has taken READ_BUDGET_MS.
  CALL_TIMEOUT_MS: 30000,
  LIST_TIMEOUT_MS: 10000,
  READ_BUDGET_MS: 150000,
  NO_ANSWER: 0,

  remembered() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.WORKING_KEY));
      if (saved && typeof saved.model === 'string' && Date.now() - saved.at < this.WORKING_DAYS * 86400000) return saved.model;
    } catch (err) { /* nothing remembered */ }
    return null;
  },

  remember(model) {
    this._working = model;
    try { localStorage.setItem(this.WORKING_KEY, JSON.stringify({ model, at: Date.now() })); } catch (err) { /* only a help */ }
  },

  forget(model) {
    if (this._working === model) this._working = null;
    try { if (this.remembered() === model) localStorage.removeItem(this.WORKING_KEY); } catch (err) { /* only a help */ }
  },

  candidates() {
    const all = [this._working || this.remembered(), CONFIG.GEMINI.model, ...(this._found || [])]
      .filter((model, i, list) => model && !this._dead.has(model) && list.indexOf(model) === i);
    return all.filter(model => !this._slow.has(model)).concat(all.filter(model => this._slow.has(model)));
  },

  // A fetch with a time limit: resolves with the response, or with null when nothing came back in time.
  async timed(url, options, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      if (err && err.name === 'AbortError') return null;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  },

  // The free-tier models a key can call, best first: full flash (newest version first), then flash-lite, with the
  // "-latest" aliases after the numbered ones of their kind.
  rankFree(models) {
    const found = [];
    for (const entry of Array.isArray(models) ? models : []) {
      if (!(entry && Array.isArray(entry.supportedGenerationMethods) && entry.supportedGenerationMethods.includes('generateContent'))) continue;
      const name = String(entry.name || '').replace(/^models\//, '');
      const numbered = /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/.exec(name);
      if (numbered) {
        found.push({ name, version: numbered[1].split('.').map(Number), lite: Boolean(numbered[2]) });
      } else if (name === 'gemini-flash-latest' || name === 'gemini-flash-lite-latest') {
        found.push({ name, version: [0], lite: name.includes('lite') });
      }
    }
    const newer = (a, b) => {
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const diff = (b[i] || 0) - (a[i] || 0);
        if (diff) return diff;
      }
      return 0;
    };
    return found.sort((a, b) => (a.lite - b.lite) || newer(a.version, b.version)).map(model => model.name);
  },

  // Asks the key which models exist. It is only a help: if it fails, reading goes on with the models already known and
  // the question is asked again next time.
  async discover(key) {
    try {
      const response = await this.timed(`${CONFIG.GEMINI.endpoint}?pageSize=1000&key=${encodeURIComponent(key)}`, {}, this.LIST_TIMEOUT_MS);
      if (!response || !response.ok) return;
      const data = await response.json();
      this._found = this.rankFree(data && data.models);
    } catch (err) {
      // No connection or no list: nothing to add.
    }
  },

  // Sends one or more pictures with a prompt, and expects back a JSON value (never markdown, never prose): the request
  // asks for application/json, and a response that is not valid JSON is an error, not a guess at what it meant.
  // `onNote(text)` lets the caller say in its status line that another model is being tried or that it is waiting.
  async read(files, prompt, onNote) {
    const key = this.key();
    if (!key) throw new Error('Falta tu clave de Gemini: agrégala en «Clave de Gemini» antes de leer una captura.');
    const parts = [{ text: prompt }];
    for (const file of files) {
      parts.push({ inline_data: { mime_type: file.type || 'image/jpeg', data: await this.toBase64(file) } });
    }
    const request = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    };
    const say = text => { if (typeof onNote === 'function') onNote(text); };
    const started = Date.now();
    const late = () => Date.now() - started >= this.READ_BUDGET_MS;
    let statuses = [];
    let lastDetail = '';
    for (let pass = 0; ; pass++) {
      const tried = new Set();
      statuses = [];
      // After a model gave no answer, a lighter one goes next: when the full models are swamped the lite ones still answer.
      let preferLite = false;
      for (;;) {
        if (late()) break;
        const pick = () => {
          const open = this.candidates().filter(name => !tried.has(name));
          return (preferLite && open.find(name => name.includes('-lite'))) || open[0];
        };
        let model = pick();
        if (!model && !this._found) {
          await this.discover(key);
          model = pick();
        }
        if (!model) break;
        if (tried.size) say(`${statuses[statuses.length - 1] === this.NO_ANSWER ? 'Gemini tarda en responder' : 'Gemini está ocupado'}: probando con otro modelo (${model})…`);
        tried.add(model);
        let response;
        try {
          response = await this.timed(`${CONFIG.GEMINI.endpoint}/${model}:generateContent?key=${encodeURIComponent(key)}`, request, this.CALL_TIMEOUT_MS);
        } catch (err) {
          // Truly offline: nothing to try. Otherwise the call was dropped on the way (a phone does this to a call that hangs):
          // that model is passed over like one that did not answer.
          if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            throw new Error('No hay conexión a internet: conéctate y vuelve a subir la captura.');
          }
          response = null;
        }
        if (!response) {
          this._slow.add(model);
          if (this._working === model) this._working = null;
          statuses.push(this.NO_ANSWER);
          preferLite = true;
          continue;
        }
        if (response.ok) {
          this._slow.delete(model);
          this.remember(model);
          return this.parse(response);
        }
        const body = await response.json().catch(() => null);
        const detail = (body && body.error && body.error.message) || '';
        if (response.status === 400 && /API key/i.test(detail)) {
          throw new Error('Tu clave de Gemini no es válida: revísala en «Clave de Gemini».');
        }
        const gone = response.status === 404 || /no longer available|not found|is not supported/i.test(detail);
        const busy = response.status === 429 || this.RETRY_STATUSES.includes(response.status);
        if (!gone && !busy) {
          throw new Error(`Gemini respondió con un error${detail ? `: ${detail}` : ` (${response.status})`}.`);
        }
        if (gone) { this._dead.add(model); this.forget(model); }
        statuses.push(response.status);
        lastDetail = detail;
      }
      const waitable = statuses.some(status => status === 429 || this.RETRY_STATUSES.includes(status));
      if (!waitable || late() || pass >= this.PASS_DELAYS_MS.length) break;
      say('Gemini está ocupado: reintentando en unos segundos…');
      await new Promise(resolve => setTimeout(resolve, this.PASS_DELAYS_MS[pass]));
    }
    if (statuses.some(status => status === this.NO_ANSWER || this.RETRY_STATUSES.includes(status))) {
      throw new Error('Gemini no respondió a tiempo: sus modelos gratuitos están saturados ahora mismo. Tu conexión está bien; espera unos minutos y vuelve a subir la captura.');
    }
    if (statuses.includes(429)) {
      throw new Error('Se acabó la cuota gratuita de Gemini por ahora (por minuto o por día). Espera un rato o inténtalo mañana.');
    }
    throw new Error(`Ningún modelo gratuito de Gemini respondió con tu clave${lastDetail ? `: ${lastDetail}` : ''}.`);
  },

  async parse(response) {
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error('Gemini no devolvió una tabla legible: prueba con una captura más nítida.');
    }
  }
};
