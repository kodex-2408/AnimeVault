/* AnimeVault renderer — core framework.
 * CSP: script-src 'self'. There are NO inline event handlers anywhere; markup
 * declares intent with data-act / data-change / data-input / data-enter /
 * data-ctx attributes, and one delegated listener per event type dispatches to
 * the explicit ACT allowlist below. Arguments travel as JSON in data-arg, so
 * titles, paths and user text never become executable code.
 */
'use strict';

var S = {
  lib: [], view: 'library', q: '', filter: 'all', catFilter: 'all', cur: null, cfg: {}, mal: false, covers: {}, loading: false,
  exFilter: { genres: [], types: [], minScore: 0, status: '' }, vaultMode: 'anime', pendingNewSeries: [], activities: [],
  selectMode: false, selectedSeries: [], myListSelectMode: false, selectedMalIds: [], librarySort: 'name',
  searchFilters: { status: 'all', type: 'all', minScore: 0, maxScore: 10, genres: [], yearMin: 0, yearMax: 9999, season: '' },
  exploreTop: [], exploreSeasonal: [], exploreTopOffset: 0, exploreLoading: false,
  myListFilter: 'all', myListData: null, myListView: 'grid', myListSort: 'title', myListGenre: 'all',
  _myListOffset: 0, _myListHasMore: false, _myListPageSize: 1000, _myListLoadMoreSize: 100,
  schedDay: 'week', schedSource: 'watching', schedQ: '', _schedDataCache: {},
  hubTab: 'inbox', fmTab: 'tools', setSection: 'library', heroIdx: 0,
  ai: { msgs: [], busy: false, webSearch: true, dockOpen: false, dockMinimized: false, dockExpanded: false },
  watcherLog: [], _autoDownloadWatchlist: []
};

// ---------------------------------------------------------------- escaping --
// E(): text nodes and double-quoted attribute values.
function E(s){if(s===null||s===undefined)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}

// A(): declares a click action with JSON-encoded arguments.
//   '<button'+A('playEpisode', name, path, 3)+'>'
function A(name){var args=Array.prototype.slice.call(arguments,1);return ' data-act="'+E(name)+'"'+(args.length?' data-arg="'+E(JSON.stringify(args))+'"':'');}
// On(): declares a non-click action (change / input / enter / ctx) + arguments.
function On(evt,name){var args=Array.prototype.slice.call(arguments,2);return ' data-'+evt+'="'+E(name)+'"'+(args.length?' data-arg="'+E(JSON.stringify(args))+'"':'');}
// Tip(): hover tooltip text.
function Tip(text){return ' data-tip="'+E(text)+'"';}

// ------------------------------------------------------------ action registry --
var ACT = Object.create(null);
function act(name, fn){ACT[name]=fn;}
// expose(): allow a named global function to be invoked from markup with its
// data-arg arguments. This IS the allowlist — nothing else is callable.
function expose(){for(var i=0;i<arguments.length;i++){(function(n){ACT[n]=function(el,ev){var f=window[n];if(typeof f!=='function'){console.warn('[act] missing function',n);return;}return f.apply(null,Array.prototype.slice.call(arguments,2));};})(arguments[i]);}}

function _argsOf(el){var a=el.getAttribute('data-arg');if(!a)return [];try{var v=JSON.parse(a);return Array.isArray(v)?v:[v];}catch(e){console.warn('[act] bad args',a);return [];}}
function _runAction(name,el,ev){
  var fn=ACT[name];
  if(!fn){console.warn('[act] unknown action:',name);return;}
  try{
    var r=fn.apply(el,[el,ev].concat(_argsOf(el)));
    if(r&&typeof r.then==='function')r.catch(function(err){console.error('[act] '+name,err);toast('Something went wrong: '+(err&&err.message||err),'e');});
  }catch(err){console.error('[act] '+name,err);toast('Something went wrong: '+(err&&err.message||err),'e');}
}
function _dispatch(attr,ev){
  var t=ev.target;if(!t||!t.closest)return;
  var el=t.closest('['+attr+']');if(!el)return;
  if(el.disabled||el.getAttribute('aria-disabled')==='true')return;
  _runAction(el.getAttribute(attr),el,ev);
}
document.addEventListener('click',function(e){if(e.button!==0)return;_dispatch('data-act',e);});
document.addEventListener('change',function(e){_dispatch('data-change',e);});
document.addEventListener('input',function(e){_dispatch('data-input',e);});
document.addEventListener('keydown',function(e){
  if(e.key==='Enter'&&!e.isComposing){var t=e.target;if(t&&t.closest&&t.closest('[data-enter]')){e.preventDefault();_dispatch('data-enter',e);}}
});
document.addEventListener('contextmenu',function(e){var t=e.target;if(t&&t.closest&&t.closest('[data-ctx]')){e.preventDefault();_dispatch('data-ctx',e);}});
// Keyboard activation for non-button elements that carry an action.
document.addEventListener('keydown',function(e){
  if((e.key==='Enter'||e.key===' ')&&e.target&&e.target.matches&&e.target.matches('[data-act][tabindex]:not(button):not(input):not(select):not(textarea)')){e.preventDefault();_runAction(e.target.getAttribute('data-act'),e.target,e);}
});

// ------------------------------------------------------------------- icons --
var ICONS={
  grid:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  compass:'<circle cx="12" cy="12" r="9.5"/><path d="M15.8 8.2l-2.2 5.4-5.4 2.2 2.2-5.4z"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  listCheck:'<path d="M11 6h10M11 12h10M11 18h10"/><path d="M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>',
  play:'<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.4-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" fill="currentColor" stroke="none"/>',
  playCircle:'<circle cx="12" cy="12" r="9.5"/><path d="M10 8.5v7l5.5-3.5z" fill="currentColor"/>',
  check:'<path d="M20 6L9 17l-5-5"/>',
  checkCircle:'<circle cx="12" cy="12" r="9.5"/><path d="M8 12.5l2.7 2.7L16 9.8"/>',
  folder:'<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  folderOpen:'<path d="M3 17V7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h6A2.5 2.5 0 0 1 19.5 10v1"/><path d="M3 17l2.4-5.2A2 2 0 0 1 7.2 10.6H21l-2.7 7.1a2 2 0 0 1-1.9 1.3H5a2 2 0 0 1-2-2z"/>',
  folderPlus:'<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><path d="M12 11v6M9 14h6"/>',
  inbox:'<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"/>',
  calendar:'<rect x="3" y="4.5" width="18" height="17" rx="3"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
  calendarClock:'<path d="M21 10V7.5A3 3 0 0 0 18 4.5H6A3 3 0 0 0 3 7.5v11a3 3 0 0 0 3 3h5"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/><circle cx="17.5" cy="17.5" r="4"/><path d="M17.5 16v1.6l1 1"/>',
  chart:'<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M8 17v-5M13 17V8M18 17v-9"/>',
  pie:'<path d="M21.2 15.9A10 10 0 1 1 8 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  layers:'<path d="M12 2.5l9.5 5-9.5 5-9.5-5z"/><path d="M2.5 12.5l9.5 5 9.5-5M2.5 17l9.5 5 9.5-5"/>',
  palette:'<circle cx="13.5" cy="6.5" r="1.2" fill="currentColor"/><circle cx="17.5" cy="10.5" r="1.2" fill="currentColor"/><circle cx="8.5" cy="7.5" r="1.2" fill="currentColor"/><circle cx="6.5" cy="12.5" r="1.2" fill="currentColor"/><path d="M12 2a10 10 0 0 0 0 20c1 0 1.7-.8 1.7-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.8-1.7 1.7-1.7h2A5.5 5.5 0 0 0 22 11c0-5-4.5-9-10-9z"/>',
  gear:'<path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  sliders:'<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  sidebar:'<rect x="3" y="3.5" width="18" height="17" rx="3.5"/><path d="M9.5 3.5v17"/>',
  search:'<circle cx="11" cy="11" r="7.5"/><path d="M21 21l-4.6-4.6"/>',
  x:'<path d="M18 6L6 18M6 6l12 12"/>',
  chevronDown:'<path d="M6 9l6 6 6-6"/>', chevronUp:'<path d="M18 15l-6-6-6 6"/>', chevronLeft:'<path d="M15 18l-6-6 6-6"/>', chevronRight:'<path d="M9 18l6-6-6-6"/>',
  star:'<path d="M12 2.8l2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3L2.8 9.5l6.4-.9z" fill="currentColor" stroke="none"/>',
  starLine:'<path d="M12 2.8l2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3L2.8 9.5l6.4-.9z"/>',
  download:'<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v1.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V17"/>',
  refresh:'<path d="M3 12a9 9 0 0 1 15.3-6.4L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.3 6.4L3 16"/><path d="M8 16H3v5"/>',
  link:'<path d="M10 13.5a4.5 4.5 0 0 0 6.4.4l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.7 1.7"/><path d="M14 10.5a4.5 4.5 0 0 0-6.4-.4l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.7-1.7"/>',
  unlink:'<path d="M18.8 13.2l1.4-1.4a4.5 4.5 0 0 0-6.4-6.4l-1.4 1.4M5.2 10.8l-1.4 1.4a4.5 4.5 0 0 0 6.4 6.4l1.4-1.4M8 2v3M2 8h3M16 22v-3M22 16h-3"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15.5l-4.6-4.6a1.5 1.5 0 0 0-2.1 0L5 20.5"/>',
  trash:'<path d="M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6M19 6l-.9 13.1A2 2 0 0 1 16.1 21H7.9a2 2 0 0 1-2-1.9L5 6M10 11v5M14 11v5"/>',
  pencil:'<path d="M17 3.5a2.1 2.1 0 0 1 3 3L8 18.5 3.5 20l1.5-4.5z"/><path d="M15 5.5l3 3"/>',
  info:'<circle cx="12" cy="12" r="9.5"/><path d="M12 16v-4.5M12 8h.01"/>',
  alert:'<path d="M10.3 3.9L2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4.5M12 17h.01"/>',
  clock:'<circle cx="12" cy="12" r="9.5"/><path d="M12 7v5l3.2 2"/>',
  tv:'<rect x="2.5" y="6.5" width="19" height="13.5" rx="3"/><path d="M8 2.5l4 4 4-4"/>',
  sun:'<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:'<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>',
  keyboard:'<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M10 13h4M7 16h10"/>',
  sparkles:'<path d="M9.9 3.6l1.3 3.7a3 3 0 0 0 1.8 1.8l3.7 1.3-3.7 1.3a3 3 0 0 0-1.8 1.8l-1.3 3.7-1.3-3.7a3 3 0 0 0-1.8-1.8L3.1 10.4l3.7-1.3a3 3 0 0 0 1.8-1.8z"/><path d="M18.5 14.5l.6 1.6a1.5 1.5 0 0 0 .9.9l1.6.6-1.6.6a1.5 1.5 0 0 0-.9.9l-.6 1.6-.6-1.6a1.5 1.5 0 0 0-.9-.9l-1.6-.6 1.6-.6a1.5 1.5 0 0 0 .9-.9z"/>',
  activity:'<path d="M22 12h-4l-3 8.5L9 3.5 6 12H2"/>',
  filter:'<path d="M3 5.5h18M6.5 12h11M10 18.5h4"/>',
  sort:'<path d="M3 7l3.5-3.5L10 7M6.5 3.5v17M21 17l-3.5 3.5L14 17M17.5 20.5v-17"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', minus:'<path d="M5 12h14"/>',
  external:'<path d="M14 3h7v7M21 3l-9 9"/><path d="M19 14v4.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 3 18.5v-11A2.5 2.5 0 0 1 5.5 5H10"/>',
  eye:'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  zap:'<path d="M13 2.5L4 13.5h7l-1 8 9-11h-7z"/>',
  wand:'<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8l1.4 1.4M17.8 6.2l1.4-1.4M12.2 6.2l-1.4-1.4"/><path d="M15 9L3 21"/>',
  undo:'<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5.5 5.5 0 0 1 0 11h-3"/>',
  heartPulse:'<path d="M19.4 13.2c1.5-1.5 2.6-3.2 2.6-5.4A5.3 5.3 0 0 0 16.7 2.5c-1.9 0-3.3.5-4.7 2-1.4-1.5-2.8-2-4.7-2A5.3 5.3 0 0 0 2 7.8c0 2.2 1.1 3.9 2.6 5.4L12 21z"/><path d="M3.2 12h5.3l1.5-3 2.5 6 1.6-3h6.7"/>',
  scan:'<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="11.5" cy="11.5" r="3.5"/><path d="M16 16l-2-2"/>',
  hardDrive:'<rect x="2.5" y="12.5" width="19" height="8" rx="2.5"/><path d="M5.5 12.5L8 4.5h8l2.5 8M6.5 16.5h.01M10 16.5h.01"/>',
  film:'<rect x="2.5" y="2.5" width="19" height="19" rx="3"/><path d="M7 2.5v19M17 2.5v19M2.5 12h19M2.5 7H7M2.5 17H7M17 17h4.5M17 7h4.5"/>',
  book:'<path d="M4 19.5V4.5A2 2 0 0 1 6 2.5h14v17H6.5a2.5 2.5 0 0 0 0 5H20"/>',
  bell:'<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  shield:'<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z"/>',
  database:'<ellipse cx="12" cy="5" rx="8.5" ry="3"/><path d="M3.5 5v14c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3V5"/><path d="M3.5 12c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3"/>',
  cpu:'<rect x="4.5" y="4.5" width="15" height="15" rx="2.5"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 1.5v3M15 1.5v3M9 19.5v3M15 19.5v3M19.5 9h3M19.5 14h3M1.5 9h3M1.5 14h3"/>',
  window:'<rect x="2.5" y="3.5" width="19" height="17" rx="3"/><path d="M2.5 8.5h19M6 6h.01M9 6h.01"/>',
  tag:'<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2.5 12.5V2.5h10l8.1 8.1a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.3" fill="currentColor"/>',
  globe:'<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5a14.5 14.5 0 0 1 0 19M12 2.5a14.5 14.5 0 0 0 0 19"/>',
  logOut:'<path d="M9 21H5.5A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3H9M16 17l5-5-5-5M21 12H9"/>',
  pause:'<rect x="6" y="4.5" width="4" height="15" rx="1.2"/><rect x="14" y="4.5" width="4" height="15" rx="1.2"/>',
  type:'<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
  monitor:'<rect x="2.5" y="3.5" width="19" height="13" rx="2.5"/><path d="M8 21h8M12 16.5V21"/>',
  arrowUp:'<path d="M12 19V5M5 12l7-7 7 7"/>', arrowDown:'<path d="M12 5v14M19 12l-7 7-7-7"/>',
  arrowRight:'<path d="M5 12h14M12 5l7 7-7 7"/>',
  copy:'<rect x="8.5" y="8.5" width="13" height="13" rx="2.5"/><path d="M15.5 8.5V5A2.5 2.5 0 0 0 13 2.5H5A2.5 2.5 0 0 0 2.5 5v8A2.5 2.5 0 0 0 5 15.5h3.5"/>',
  command:'<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
  box:'<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  hash:'<path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/>',
  trending:'<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  library:'<path d="M4 3.5v17M9 3.5v17M14 4l5.5 16"/>',
  send:'<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
  stop:'<rect x="5.5" y="5.5" width="13" height="13" rx="2.5" fill="currentColor" stroke="none"/>',
  minimize:'<path d="M5 12h14"/>', maximize:'<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
  magnet:'<path d="M6 15l-4-4 5.5-5.5a8 8 0 0 1 11 11L13 22l-4-4 5.5-5.5a2.3 2.3 0 0 0-3.3-3.2z"/><path d="M5 8l4 4M12 15l4 4"/>',
  grip:'<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  mouse:'<rect x="5.5" y="2.5" width="13" height="19" rx="6.5"/><path d="M12 6.5v4"/>',
  volume:'<path d="M11 5L6 9H2.5v6H6l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  subtitles:'<rect x="2.5" y="4.5" width="19" height="15" rx="3"/><path d="M7 15h4M14 15h3M7 11h2M12 11h5"/>',
  expand:'<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  history:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3.5 2"/>',
  user:'<circle cx="12" cy="8" r="4.5"/><path d="M3.5 21a8.5 8.5 0 0 1 17 0"/>',
  lock:'<rect x="4" y="10.5" width="16" height="11" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  anime:'<rect x="2.5" y="4.5" width="19" height="15" rx="3"/><path d="M10 9v6l5-3z" fill="currentColor"/>',
  manga:'<path d="M2.5 5.5c3-1.5 6.2-1.5 9.5 1 3.3-2.5 6.5-2.5 9.5-1v14c-3-1.5-6.2-1.5-9.5 1-3.3-2.5-6.5-2.5-9.5-1z"/><path d="M12 6.5v14"/>',
  broom:'<path d="M19.4 2.6l-7.7 7.7"/><path d="M13.6 12.2l-1.8-1.8a2 2 0 0 0-2.8 0l-.8.8a8 8 0 0 0-2.3 5.6V21h4.2a8 8 0 0 0 5.6-2.3l.8-.8a2 2 0 0 0 0-2.8z"/>'
};
function ic(name,cls){var p=ICONS[name]||ICONS.info;return '<svg'+(cls?' class="'+cls+'"':'')+' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+p+'</svg>';}

// ------------------------------------------------------------------ toasts --
var _toastCallbacks=Object.create(null),_toastSeq=0;
function toast(msg,type,actionOrActions){
  var c=document.getElementById('tc');if(!c)return;
  var kind=type==='s'?'s':type==='e'?'e':'i';
  var dur=kind==='e'?8000:4200;
  var el=document.createElement('div');el.className='toast toast-'+kind;el.setAttribute('role',kind==='e'?'alert':'status');
  var icon=kind==='s'?'check':kind==='e'?'alert':'info';
  var h='<div class="toast-ic">'+ic(icon)+'</div><div class="toast-msg">'+E(msg)+'</div>';
  var actions=Array.isArray(actionOrActions)?actionOrActions:(actionOrActions?[actionOrActions]:[]);
  var ids=[];
  if(actions.length){h+='<div class="toast-actions">';actions.forEach(function(a){if(!a||!a.label)return;var id='t'+(++_toastSeq);_toastCallbacks[id]=a.onClick;ids.push(id);h+='<button class="btn btn-xs btn-tinted" data-toast-cb="'+id+'">'+E(a.label)+'</button>';});h+='</div>';}
  h+='<button class="toast-close" aria-label="Dismiss">'+ic('x')+'</button><div class="toast-timer" style="animation-duration:'+dur+'ms"></div>';
  el.innerHTML=h;
  var removed=false,timer=null,remaining=dur,started=Date.now();
  function remove(){if(removed)return;removed=true;clearTimeout(timer);ids.forEach(function(i){delete _toastCallbacks[i];});el.classList.add('leaving');setTimeout(function(){el.remove();},260);}
  function arm(){started=Date.now();timer=setTimeout(remove,remaining);}
  el.addEventListener('mouseenter',function(){clearTimeout(timer);remaining-=Date.now()-started;});
  el.addEventListener('mouseleave',function(){if(!removed)arm();});
  el.addEventListener('click',function(e){
    var cb=e.target.closest('[data-toast-cb]');
    if(cb){var fn=_toastCallbacks[cb.getAttribute('data-toast-cb')];remove();if(typeof fn==='function'){try{fn();}catch(err){console.error(err);}}return;}
    if(e.target.closest('.toast-close'))remove();
  });
  c.appendChild(el);
  var toasts=c.querySelectorAll('.toast:not(.leaving)');if(toasts.length>5)toasts[0].remove();
  arm();
  return remove;
}

// ------------------------------------------------------------------ modals --
var _modalStack=[];
/* openModal({id,title,sub,icon,tone,body,foot,width,className,onClose,dismissable})
   body/foot are HTML strings (use A() for actions). Returns a handle. */
function openModal(o){
  o=o||{};
  if(o.id){var prev=document.getElementById(o.id);if(prev&&prev._modal)prev._modal.close(true);}
  var layer=document.createElement('div');layer.className='modal-layer';if(o.id)layer.id=o.id;
  var h='<div class="modal-backdrop"></div><div class="modal'+(o.className?' '+o.className:'')+'" role="dialog" aria-modal="true" style="--mw:'+(o.width||520)+'px">';
  if(o.title||o.icon){
    h+='<div class="modal-head">'+(o.icon?'<div class="modal-icon'+(o.tone?' '+o.tone:'')+'">'+ic(o.icon)+'</div>':'')
      +'<div class="modal-titles"><div class="modal-title">'+E(o.title||'')+'</div>'+(o.sub?'<div class="modal-sub">'+o.sub+'</div>':'')+'</div>'
      +(o.dismissable===false?'':'<button class="icon-btn sm plain" data-modal-close aria-label="Close">'+ic('x')+'</button>')+'</div>';
  }
  h+='<div class="modal-body">'+(o.body||'')+'</div>';
  if(o.foot)h+='<div class="modal-foot">'+o.foot+'</div>';
  h+='</div>';
  layer.innerHTML=h;
  var handle={el:layer,closed:false,
    body:function(){return layer.querySelector('.modal-body');},
    setBody:function(html){var b=layer.querySelector('.modal-body');if(b){b.innerHTML=html;updateSegThumbs(b);}},
    setFoot:function(html){var f=layer.querySelector('.modal-foot');if(f)f.innerHTML=html;},
    close:function(immediate){
      if(handle.closed)return;handle.closed=true;
      var i=_modalStack.indexOf(handle);if(i>=0)_modalStack.splice(i,1);
      if(typeof o.onClose==='function'){try{o.onClose();}catch(e){console.error(e);}}
      if(immediate){layer.remove();return;}
      layer.classList.add('closing');setTimeout(function(){layer.remove();},200);
    }};
  layer._modal=handle;
  layer.addEventListener('click',function(e){
    if(e.target.closest('[data-modal-close]')){handle.close();return;}
    if(e.target.classList.contains('modal-backdrop')&&o.dismissable!==false)handle.close();
  });
  (document.getElementById('modalRoot')||document.body).appendChild(layer);
  _modalStack.push(handle);
  updateSegThumbs(layer);
  var focusEl=layer.querySelector('[autofocus]')||layer.querySelector('.modal-body input,.modal-body select');
  if(focusEl)setTimeout(function(){try{focusEl.focus();if(focusEl.select)focusEl.select();}catch(e){}},60);
  return handle;
}
function closeTopModal(){var m=_modalStack[_modalStack.length-1];if(m){m.close();return true;}return false;}
function closeModalById(id){var el=document.getElementById(id);if(el&&el._modal){el._modal.close();return true;}if(el)el.remove();return false;}
act('closeModal',function(el){var layer=el.closest('.modal-layer');if(layer&&layer._modal)layer._modal.close();});

// Promise-based replacements for confirm and prompt dialogs. The native prompt dialog is not
// implemented in Electron, which silently broke every rename/offset prompt.
function askConfirm(o){
  o=o||{};
  return new Promise(function(resolve){
    var done=false;
    var m=openModal({title:o.title||'Are you sure?',sub:o.text?E(o.text):'',icon:o.icon||(o.danger?'trash':'info'),tone:o.danger?'danger':(o.tone||''),width:o.width||440,
      body:o.body||'',
      foot:'<button class="btn btn-ghost" data-ask="0">'+E(o.cancel||'Cancel')+'</button><button class="btn '+(o.danger?'btn-danger-solid':'btn-primary')+'" data-ask="1" autofocus>'+E(o.confirm||'Confirm')+'</button>',
      onClose:function(){if(!done){done=true;resolve(false);}}});
    m.el.addEventListener('click',function(e){var b=e.target.closest('[data-ask]');if(!b)return;done=true;resolve(b.getAttribute('data-ask')==='1');m.close();});
    setTimeout(function(){var b=m.el.querySelector('[data-ask="1"]');if(b)b.focus();},60);
  });
}
function askText(o){
  o=o||{};
  return new Promise(function(resolve){
    var done=false;
    var m=openModal({title:o.title||'Enter a value',sub:o.text?E(o.text):'',icon:o.icon||'pencil',width:o.width||460,
      body:'<div class="field">'+(o.label?'<label class="field-label">'+E(o.label)+'</label>':'')+'<input class="input'+(o.mono?' mono':'')+'" id="askTextInput" autocomplete="off" spellcheck="false" value="'+E(o.value==null?'':o.value)+'" placeholder="'+E(o.placeholder||'')+'" autofocus>'+(o.hint?'<div class="field-hint">'+E(o.hint)+'</div>':'')+'<div class="field-hint" id="askTextErr" style="color:var(--red)"></div></div>',
      foot:'<button class="btn btn-ghost" data-ask="0">Cancel</button><button class="btn btn-primary" data-ask="1">'+E(o.confirm||'Save')+'</button>',
      onClose:function(){if(!done){done=true;resolve(null);}}});
    function submit(){
      var inp=m.el.querySelector('#askTextInput');var v=inp?inp.value:'';
      if(typeof o.validate==='function'){var err=o.validate(v);if(err){var e2=m.el.querySelector('#askTextErr');if(e2)e2.textContent=err;return;}}
      done=true;resolve(v);m.close();
    }
    m.el.addEventListener('click',function(e){var b=e.target.closest('[data-ask]');if(!b)return;if(b.getAttribute('data-ask')==='1')submit();else{done=true;resolve(null);m.close();}});
    m.el.addEventListener('keydown',function(e){if(e.key==='Enter'&&e.target.id==='askTextInput'){e.preventDefault();submit();}});
  });
}
function askChoice(o){
  o=o||{};
  return new Promise(function(resolve){
    var done=false;
    var h='<div class="col" style="gap:8px">';
    (o.choices||[]).forEach(function(c,i){h+='<button class="row-card" data-choice="'+i+'" style="text-align:left;cursor:pointer;width:100%">'+(c.icon?'<div class="lg-icon" style="--ic:'+(c.color||'var(--accent)')+'">'+ic(c.icon)+'</div>':'')+'<div class="grow"><div class="row-title">'+E(c.label)+'</div>'+(c.desc?'<div class="row-sub">'+E(c.desc)+'</div>':'')+'</div>'+ic('chevronRight')+'</button>';});
    h+='</div>';
    var m=openModal({title:o.title,sub:o.text?E(o.text):'',icon:o.icon||'list',tone:o.tone,width:o.width||460,body:h,foot:'<button class="btn btn-ghost" data-modal-close>Cancel</button>',onClose:function(){if(!done){done=true;resolve(null);}}});
    m.el.addEventListener('click',function(e){var b=e.target.closest('[data-choice]');if(!b)return;done=true;var c=o.choices[+b.getAttribute('data-choice')];resolve(c?c.value:null);m.close();});
  });
}

// ---------------------------------------------------------- menus/popovers --
var _openMenu=null;
/* openMenu(anchor|event, items, opts) — items: {label, icon, run, danger, checked, sub, sep, header, chips:[{label,on,run}]} */
function openMenu(anchor,items,opts){
  opts=opts||{};
  closeMenu(true);
  var menu=document.createElement('div');menu.className='menu'+(opts.wide?' wide':'');menu.setAttribute('role','menu');
  var runs=[];
  var h='';
  if(opts.title)h+='<div class="menu-label">'+E(opts.title)+'</div>';
  var inner='';
  items.forEach(function(it){
    if(!it)return;
    if(it.sep){inner+='<div class="menu-sep"></div>';return;}
    if(it.header){inner+='<div class="menu-label">'+E(it.header)+'</div>';return;}
    if(it.chips){inner+='<div class="menu-chips">';it.chips.forEach(function(c){runs.push(c.run);inner+='<button class="chip'+(c.on?' on':'')+'" data-mi="'+(runs.length-1)+'">'+E(c.label)+'</button>';});inner+='</div>';return;}
    runs.push(it.run);
    inner+='<button class="menu-item'+(it.danger?' danger':'')+(it.checked?' checked':'')+'" role="menuitem" data-mi="'+(runs.length-1)+'">'+(it.icon?ic(it.icon):'')+'<span>'+E(it.label)+'</span>'+(it.sub?'<span class="menu-sub">'+E(it.sub)+'</span>':'')+'</button>';
  });
  h+=opts.scroll?'<div class="menu-scroll">'+inner+'</div>':inner;
  menu.innerHTML=h;
  document.body.appendChild(menu);
  var x,y,ox='top left';
  var r={width:menu.offsetWidth,height:menu.offsetHeight};
  if(anchor&&anchor.clientX!==undefined&&!(anchor instanceof Element)){x=anchor.clientX;y=anchor.clientY;}
  else if(anchor&&anchor.getBoundingClientRect){var ar=anchor.getBoundingClientRect();x=opts.alignRight?ar.right-r.width:ar.left;y=ar.bottom+6;if(opts.alignRight)ox='top right';anchor.classList.add('open');menu._anchor=anchor;}
  else{x=window.innerWidth/2-r.width/2;y=window.innerHeight/3;}
  if(x+r.width>window.innerWidth-8){x=window.innerWidth-r.width-8;ox='top right';}
  if(y+r.height>window.innerHeight-8){y=Math.max(8,(anchor&&anchor.getBoundingClientRect&&!(anchor.clientX!==undefined&&!(anchor instanceof Element))?anchor.getBoundingClientRect().top-r.height-6:window.innerHeight-r.height-8));ox=ox.replace('top','bottom');}
  if(x<8)x=8;
  menu.style.left=x+'px';menu.style.top=y+'px';menu.style.setProperty('--ox',ox);
  menu.addEventListener('click',function(e){
    var b=e.target.closest('[data-mi]');if(!b)return;e.stopPropagation();
    var fn=runs[+b.getAttribute('data-mi')];
    if(!opts.keepOpen||!b.classList.contains('chip'))closeMenu();
    if(typeof fn==='function'){try{var r2=fn();if(r2&&r2.catch)r2.catch(function(err){console.error(err);});}catch(err){console.error(err);}}
  });
  _openMenu=menu;
  return menu;
}
function closeMenu(immediate){
  var m=_openMenu;if(!m)return false;_openMenu=null;
  if(m._anchor)m._anchor.classList.remove('open');
  if(immediate){m.remove();return true;}
  m.classList.add('closing');setTimeout(function(){m.remove();},140);return true;
}
document.addEventListener('mousedown',function(e){if(_openMenu&&!e.target.closest('.menu')&&!(_openMenu._anchor&&_openMenu._anchor.contains(e.target)))closeMenu();},true);
window.addEventListener('blur',function(){closeMenu(true);});
window.addEventListener('resize',function(){closeMenu(true);});
document.addEventListener('scroll',function(e){if(_openMenu&&!(e.target&&e.target.closest&&e.target.closest('.menu')))closeMenu(true);},true);
// A menu anchored to its trigger toggles closed on a second click.
function toggleMenu(anchor,items,opts){if(_openMenu&&_openMenu._anchor===anchor){closeMenu();return null;}return openMenu(anchor,items,opts);}

// ---------------------------------------------------------------- tooltips --
var _tipEl=null,_tipTimer=null,_tipFor=null;
document.addEventListener('mouseover',function(e){
  var t=e.target&&e.target.closest?e.target.closest('[data-tip]'):null;
  if(t===_tipFor)return;
  hideTip();
  if(!t)return;
  _tipFor=t;
  _tipTimer=setTimeout(function(){
    if(!document.body.contains(t))return;
    if(!_tipEl){_tipEl=document.createElement('div');_tipEl.className='tip';document.body.appendChild(_tipEl);}
    _tipEl.textContent=t.getAttribute('data-tip');
    var r=t.getBoundingClientRect();var tr=_tipEl.getBoundingClientRect();
    var x=r.left+r.width/2-tr.width/2,y=r.top-tr.height-8;
    if(t.getAttribute('data-tip-pos')==='right'||(t.closest('.sidebar')&&document.querySelector('.app.sidebar-collapsed'))){x=r.right+10;y=r.top+r.height/2-tr.height/2;}
    if(y<6)y=r.bottom+8;
    x=Math.max(6,Math.min(window.innerWidth-tr.width-6,x));
    _tipEl.style.left=x+'px';_tipEl.style.top=y+'px';
    _tipEl.classList.add('show');
  },420);
});
function hideTip(){clearTimeout(_tipTimer);_tipFor=null;if(_tipEl)_tipEl.classList.remove('show');}
document.addEventListener('mousedown',hideTip,true);

// ------------------------------------------------ segmented control thumbs --
// Each .seg has a .seg-thumb that glides to the active button. Positions are
// remembered per data-seg id so a full re-render still animates the slide.
var _segPos=Object.create(null);
function updateSegThumbs(root){
  (root||document).querySelectorAll('.seg').forEach(function(seg){
    var thumb=seg.querySelector(':scope > .seg-thumb');
    if(!thumb){thumb=document.createElement('span');thumb.className='seg-thumb';seg.insertBefore(thumb,seg.firstChild);}
    var active=seg.querySelector(':scope > button.active');
    if(!active||!seg.offsetParent){thumb.style.opacity='0';return;}
    thumb.style.opacity='1';
    var x=active.offsetLeft,w=active.offsetWidth,id=seg.getAttribute('data-seg');
    var prev=id?_segPos[id]:null;
    if(prev&&!seg._segInit&&(prev.x!==x||prev.w!==w)){
      thumb.style.transition='none';thumb.style.transform='translateX('+prev.x+'px)';thumb.style.width=prev.w+'px';
      void thumb.offsetWidth;thumb.style.transition='';
    }
    var from=prev?prev.x:x;
    seg._segInit=true;
    if(Math.abs(from-x)>4){thumb.classList.add('moving');clearTimeout(thumb._mv);thumb._mv=setTimeout(function(){thumb.classList.remove('moving');},150);}
    thumb.style.transform='translateX('+x+'px)';thumb.style.width=w+'px';
    if(id)_segPos[id]={x:x,w:w};
  });
}
window.addEventListener('resize',function(){clearTimeout(window._segRz);window._segRz=setTimeout(function(){updateSegThumbs();},120);});
// Instant local feedback: move the thumb as soon as a seg button is clicked.
document.addEventListener('click',function(e){
  var b=e.target.closest&&e.target.closest('.seg > button');if(!b||b.disabled)return;
  var seg=b.parentElement;if(seg.hasAttribute('data-no-auto'))return;
  seg.querySelectorAll(':scope > button').forEach(function(x){x.classList.toggle('active',x===b);});
  updateSegThumbs(seg.parentElement);
},true);

// ------------------------------------------------------ specular pointer --
// Glass catches light where the pointer is: interactive surfaces receive the
// pointer position as --gx/--gy, which the rim and glare gradients use. One
// passive listener, at most one style write per frame.
var SPECULAR_SEL='.pc-art,.rc,.hub-tab,.kpi.clickable,.tool,.panel.interactive,.upnext-card,.btn-primary,.tb-search,.stat-tile.editable';
(function(){
  var raf=0,ev=null;
  document.addEventListener('pointermove',function(e){
    ev=e;if(raf)return;
    raf=requestAnimationFrame(function(){
      raf=0;if(document.documentElement.classList.contains('performance-mode'))return;
      var t=ev.target&&ev.target.closest?ev.target.closest(SPECULAR_SEL):null;if(!t)return;
      var r=t.getBoundingClientRect();
      t.style.setProperty('--gx',Math.round(ev.clientX-r.left)+'px');t.style.setProperty('--gy',Math.round(ev.clientY-r.top)+'px');
    });
  },{passive:true});
})();
// The title bar's blurred scroll edge only appears once content is under it.
document.addEventListener('scroll',function(e){
  if(e.target&&e.target.id==='mc')document.body.classList.toggle('mc-scrolled',e.target.scrollTop>4);
},true);

// ------------------------------------------------------------- misc utils --
// Height of the floating title bar that content scrolls beneath.
function chromeTop(){var t=document.querySelector('.titlebar');return t?t.offsetHeight:0;}
function debounce(fn,ms){var t=null;return function(){var a=arguments,self=this;clearTimeout(t);t=setTimeout(function(){fn.apply(self,a);},ms);};}
function fmtBytes(b){if(!b)return '0 B';var k=1024,s=['B','KB','MB','GB','TB'];var i=Math.min(s.length-1,Math.floor(Math.log(b)/Math.log(k)));return (b/Math.pow(k,i)).toFixed(i>0?1:0)+' '+s[i];}
function timeAgo(ts){
  if(!ts)return '';var d=typeof ts==='number'?ts:new Date(ts).getTime();if(!isFinite(d))return '';
  var s=Math.round((Date.now()-d)/1000);if(s<45)return 'just now';var m=Math.round(s/60);if(m<60)return m+'m ago';var h=Math.round(m/60);if(h<24)return h+'h ago';var dd=Math.round(h/24);if(dd<7)return dd+'d ago';
  try{return new Date(d).toLocaleDateString(undefined,{month:'short',day:'numeric'});}catch(e){return '';}
}
function plural(n,word,pl){return n+' '+(n===1?word:(pl||word+'s'));}
function nodeKey(s){return btoa(unescape(encodeURIComponent(String(s)))).replace(/[=+/]/g,'_');}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function coverSrc(p){return p?'cover://'+encodeURIComponent(p):'';}
function cssUrl(u){return String(u||'').replace(/["\\\n\r()]/g,function(c){return '\\'+c;});}

// ------------------------------------------------------- symmetric grids --
// Tile grids pick a column count that divides their item count evenly
// (4 → 2×2, 8 → 4×2, 6 → 3×2) so narrow windows never leave a lonely tile.
// When no even split fits (5, 7…), rows are balanced and the last row's
// tiles widen to fill it. Each grid declares its minimum tile width through
// the --sym-min custom property in CSS.
var SYM_GRIDS='.tool-grid,.kpis,.theme-grid,.hub-tabs,.upnext,.dest-grid,.match-grid';
var _symRO=typeof ResizeObserver==='function'?new ResizeObserver(function(entries){entries.forEach(function(e){layoutSymGrid(e.target);});}):null;
var _symSeen=typeof WeakSet==='function'?new WeakSet():null;
function _gcd(a,b){return b?_gcd(b,a%b):a;}
function layoutSymGrid(g){
  if(!g||!g.isConnected)return;
  var items=Array.prototype.filter.call(g.children,function(c){return !c.classList.contains('span-all')&&!c.classList.contains('sym-skip')&&getComputedStyle(c).display!=='none';});
  var n=items.length,cs=getComputedStyle(g);
  var min=parseFloat(cs.getPropertyValue('--sym-min'))||220,gap=parseFloat(cs.columnGap)||12,w=g.clientWidth;
  if(!n||!w)return;
  var maxFit=Math.max(1,Math.floor((w+gap)/(min+gap)));
  var cap=parseInt(cs.getPropertyValue('--sym-max'),10);if(cap>0)maxFit=Math.min(maxFit,cap);
  var cols,spanA=1,spanB=1,lastStart=n;
  if(n<=maxFit){cols=n;}
  else{
    var d=1;for(var c=maxFit;c>=2;c--){if(n%c===0){d=c;break;}}
    if(d>=2&&d>=maxFit/2){cols=d;}
    else{
      var rows=Math.ceil(n/maxFit),per=Math.ceil(n/rows),last=n-per*(rows-1);
      if(last===per){cols=per;}
      else{cols=per*last/_gcd(per,last);spanA=cols/per;spanB=cols/last;lastStart=n-last;}
    }
  }
  g.classList.add('sym-on');g.style.setProperty('--sym-cols',cols);
  items.forEach(function(it,i){it.style.setProperty('--sym-span',i>=lastStart?spanB:spanA);});
}
function layoutSymGrids(root){
  (root||document).querySelectorAll(SYM_GRIDS).forEach(function(g){
    if(_symRO&&_symSeen&&!_symSeen.has(g)){_symSeen.add(g);_symRO.observe(g);}
    layoutSymGrid(g);
  });
}
var _symQueued=false;
if(typeof MutationObserver==='function'){
  new MutationObserver(function(){if(_symQueued)return;_symQueued=true;requestAnimationFrame(function(){_symQueued=false;layoutSymGrids();});})
    .observe(document.documentElement,{childList:true,subtree:true});
}
