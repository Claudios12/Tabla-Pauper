// Reading with Gemini, against a fake Google: moving on from a model that is busy, retired or silent, and saying why it stopped.
// No real call is made and no key is used.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { boot, plain } = require('./helpers');

const LIST = { models: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-pro', 'gemini-3.8-flash-image']
  .map(name => ({ name: `models/${name}`, supportedGenerationMethods: ['generateContent'] })) };
const ok = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '[1]' }] } }] }) });
const error = (status, message) => Promise.resolve({ ok: false, status, json: async () => ({ error: { message } }) });
const silent = (options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
  const err = new Error('aborted');
  err.name = 'AbortError';
  reject(err);
}));

// An app whose Gemini answers as `answer(model, options)` says; returns it with the log of the models called.
function app(answer, { online = true } = {}) {
  class FileReader { readAsDataURL() { this.result = 'data:image/png;base64,AAAA'; setImmediate(() => this.onload()); } }
  const log = [];
  const fetch = (url, options = {}) => {
    if (!url.includes(':generateContent')) return Promise.resolve({ ok: true, status: 200, json: async () => LIST });
    const model = /models\/(.+?):/.exec(url)[1];
    log.push(model);
    return answer(model, options);
  };
  const sandbox = boot({ extra: { fetch, FileReader, navigator: { onLine: online } } });
  sandbox.localStorage.setItem('gemini_api_key', 'test-key');
  Object.assign(sandbox.Gemini, { CALL_TIMEOUT_MS: 30, PASS_DELAYS_MS: [1, 1] });
  return { G: sandbox.Gemini, log, store: sandbox.store };
}
const picture = { name: 'tabla.png', type: 'image/png' };

test('a silent full model gives way to a lite one, which is remembered', async () => {
  const { G, log, store } = app((model, options) => (model.includes('lite') ? ok() : silent(options)));
  assert.deepStrictEqual(plain(await G.read([picture], 'p')), [1]);
  assert.deepStrictEqual(log, ['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  assert.strictEqual(JSON.parse(store.get('gemini_model_ok')).model, 'gemini-3.5-flash-lite');
});

test('a call the phone drops is not "no connection" while it is online', async () => {
  const { G, log } = app((model) => (model === 'gemini-3.8-flash' ? Promise.reject(new TypeError('Failed to fetch')) : ok()));
  assert.deepStrictEqual(plain(await G.read([picture], 'p')), [1]);
  assert.strictEqual(log.length, 2);
});

test('offline says so at once', async () => {
  const { G, log } = app(() => Promise.reject(new TypeError('Failed to fetch')), { online: false });
  await assert.rejects(G.read([picture], 'p'), /No hay conexión a internet/);
  assert.strictEqual(log.length, 1);
});

test('busy everywhere says it was demand; never a pro, image or embedding model', async () => {
  const { G, log } = app(() => error(503, 'high demand'));
  await assert.rejects(G.read([picture], 'p'), /no respondió a tiempo/);
  assert.ok(!log.some(model => /pro|image|embedding/.test(model)));
});

test('out of free quota says so', async () => {
  const { G } = app(() => error(429, 'quota exceeded'));
  await assert.rejects(G.read([picture], 'p'), /cuota gratuita/);
});

test('a wrong key stops at once', async () => {
  const { G, log } = app(() => error(400, 'API key not valid. Please pass a valid API key.'));
  await assert.rejects(G.read([picture], 'p'), /clave de Gemini no es válida/);
  assert.strictEqual(log.length, 1);
});

test('a retired model is skipped and the next one answers', async () => {
  const { G, log } = app((model) => (model === 'gemini-3.8-flash' ? error(404, 'This model is no longer available to new users') : ok()));
  assert.deepStrictEqual(plain(await G.read([picture], 'p')), [1]);
  assert.deepStrictEqual(log, ['gemini-3.8-flash', 'gemini-3.7-flash']);
});
