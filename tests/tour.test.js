'use strict';
// Guided tour (5.11): every chapter has steps with a title and text, Try it
// steps carry a wait condition, and the setup guide and Settings can start it.
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { html, js } = require('./renderer-source');

assert(/<script src="renderer\/tour\.js"><\/script>/.test(html), 'index.html must load renderer/tour.js');
const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'tour.js'), 'utf8');
const ctx = vm.createContext({ S: { vaultMode: 'anime' }, document: { querySelector: () => null }, act() {}, expose() {}, isManga: () => false });
vm.runInContext(src + ';this.tourSteps=tourSteps;this.TOUR_CHAPTERS=TOUR_CHAPTERS;', ctx);
let total = 0;
for (const c of ctx.TOUR_CHAPTERS) {
  const steps = ctx.tourSteps(c.id);
  assert(steps.length >= 4, c.id + ' has at least four steps');
  for (const s of steps) {
    assert(typeof s.title === 'string' && s.title && typeof s.text === 'string' && s.text.length > 20, c.id + ': every step has a title and text');
    if (/^Try it/.test(s.title)) assert.strictEqual(typeof s.wait, 'function', s.title + ' waits for the action');
  }
  total += steps.length;
}
assert.strictEqual(ctx.tourSteps(null).length, total, 'the whole tour is every chapter in order');
assert(/setupStartTour/.test(js) && /Take the tour/.test(js), 'the setup guide offers the tour');
assert(/A\('startTour',c\.id\)/.test(js), 'Settings can replay each chapter');
console.log('tour checks passed: ' + total + ' steps in ' + ctx.TOUR_CHAPTERS.length + ' chapters');
