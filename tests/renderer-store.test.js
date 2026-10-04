'use strict';

// renderer-store.test.js
//
// Runs the real Store / S definitions from renderer/core.js in a vm sandbox.
// Locks in: plain S reads/writes keep working, top-level assignments notify
// subscribers once per microtask with the changed keys, unchanged values and
// in-place mutations stay silent until Store.notify(), one failing subscriber
// does not block the others, and unsubscribe works.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const core = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'core.js'), 'utf8');
const start = core.indexOf('var Store = (function(){');
const end = core.indexOf('\n});\n', core.indexOf('var S = Store.create({', start)) + 4;
assert(start > -1 && end > start, 'Store / S definitions not found in renderer/core.js');

const errors = [];
const ctx = vm.createContext({ queueMicrotask, console: { error: (...a) => errors.push(a.join(' ')) } });
vm.runInContext(core.slice(start, end) + '\nthis.S = S; this.Store = Store;', ctx, { filename: 'renderer/core.js (extracted)' });
const { S, Store } = ctx;
const tick = () => new Promise(r => setImmediate(r));
let checks = 0;

(async () => {
  // S still behaves like the plain object every renderer script expects.
  assert.strictEqual(S.view, 'library'); checks++;
  assert(Array.isArray(S.lib) && S.ai && S.ai.msgs, 'initial shape preserved'); checks++;
  S.q = 'frieren';
  assert.strictEqual(S.q, 'frieren', 'writes are visible synchronously'); checks++;
  await tick();

  const calls = [];
  const off = Store.subscribe(['mal', 'cfg'], (keys) => calls.push([...keys].sort().join(',')));
  const all = [];
  Store.subscribe('*', (keys) => all.push(keys.length));
  S.mal = true; S.mal = false; S.mal = true; S.cfg = { a: 1 }; S.view = 'stats';
  assert.strictEqual(calls.length, 0, 'notifications are deferred to a microtask'); checks++;
  await tick();
  assert.deepStrictEqual(calls, ['cfg,mal'], 'one batched call with the changed keys'); checks++;
  assert.deepStrictEqual(all, [3], 'wildcard subscribers see every key'); checks++;

  S.mal = true; await tick();
  assert.strictEqual(calls.length, 1, 'assigning an identical value is silent'); checks++;
  S.cfg.syncPaused = true; await tick();
  assert.strictEqual(calls.length, 1, 'in-place mutation is invisible to the proxy'); checks++;
  Store.notify('cfg'); await tick();
  assert.deepStrictEqual(calls.slice(1), ['cfg'], 'Store.notify publishes in-place changes'); checks++;

  Store.subscribe('mal', () => { throw new Error('boom'); });
  Store.set({ mal: false, q: '' }); await tick();
  assert.strictEqual(calls[calls.length - 1], 'mal', 'later subscribers still run after one throws'); checks++;
  assert(errors.some(e => /boom/.test(e)), 'subscriber errors are reported'); checks++;

  off();
  S.mal = true; await tick();
  assert.strictEqual(calls[calls.length - 1], 'mal', 'unsubscribed listeners stop receiving'); checks++;
  assert.strictEqual(calls.length, 3); checks++;

  delete S.q; await tick();
  assert.strictEqual(S.q, undefined); checks++;

  console.log('renderer-store checks passed: ' + checks + ' assertions (reads/writes, batching, notify, isolation, unsubscribe)');
})().catch((e) => { console.error(e); process.exit(1); });
