'use strict';
// Explore / Schedule donghua filter (5.11): studio, native-title and pinyin signals.
const assert = require('assert');
const vm = require('vm');
const { js } = require('./renderer-source');

const start = js.indexOf('var _CN_SIMPLIFIED');
const end = js.indexOf('function _filterDonghua');
const studios = js.match(/var _cnStudios=\[[^\]]*\];/)[0];
assert(start > 0 && end > start, 'donghua helpers not found');
const ctx = vm.createContext({});
vm.runInContext(studios + js.slice(start, end) + ';this._isDonghua=_isDonghua;', ctx);

const chinese = [
  ['Xian Ni'], ['Douluo Dalu'], ['Tian Guan Ci Fu', { ja: '天官赐福' }], ['Mo Dao Zu Shi', { ja: '魔道祖师' }],
  ['Quanzhi Fashi'], ['Wan Jie Du Zun'], ['Shi Guang Dai Li Ren', { ja: '时光代理人' }], ['Bai Yao Pu'],
  ['Link Click', { ja: '时光代理人', en: 'Link Click' }], ['Some Title', {}, [{ name: 'Bilibili' }]],
];
const japanese = [
  ['Ore dake Level Up na Ken', { ja: '俺だけレベルアップな件' }], ['Jujutsu Kaisen', { ja: '呪術廻戦' }], ['Ao no Hako', { ja: 'アオのハコ' }],
  ['Shingeki no Kyojin'], ['Kingdom', { ja: 'キングダム' }], ['Gintama', { ja: '銀魂' }], ['Mushishi', { ja: '蟲師' }],
  ['Ping Pong the Animation', { ja: 'ピンポン' }], ['Hunter x Hunter (2011)'], ['Seitokai ni mo Ana wa Aru!'], ['Tensei shitara Ken deshita II'],
];
for (const [title, alt, st] of chinese) assert.strictEqual(ctx._isDonghua({ title, alternative_titles: alt || {}, studios: st || [] }), true, title + ' is donghua');
for (const [title, alt] of japanese) assert.strictEqual(ctx._isDonghua({ title, alternative_titles: alt || {} }), false, title + ' is Japanese');

const mal = require('fs').readFileSync(require('path').join(__dirname, '..', 'main', 'services', 'mal.js'), 'utf8');
assert(/ranking\?[^`]*studios/.test(mal) && /season\/\$\{y\}[^`]*studios/.test(mal), 'Explore and Schedule requests must ask MAL for studios');
console.log('donghua filter tests passed');
