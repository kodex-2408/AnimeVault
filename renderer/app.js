/* AnimeVault renderer — shell: navigation, rendering, sidebar, keyboard, palette. */

var _VIEW_LABELS={library:'Collection',explore:'Explore',mylist:'My List',continue:'Continue',completed:'Completed',filemgmt:'File Management',hub:'Library Hub',mal:'MyAnimeList',appearance:'Appearance',settings:'Settings',schedule:'Schedule',stats:'Stats'};
var NAV=[
  {sec:'Browse'},
  {v:'library',label:'Collection',icon:'grid'},
  {v:'explore',label:'Explore',icon:'compass'},
  {v:'mylist',label:'My List',icon:'listCheck'},
  {v:'continue',label:function(){return VM('Continue Watching','Continue Reading');},icon:'playCircle'},
  {v:'completed',label:'Completed',icon:'checkCircle'},
  {sec:'Tools'},
  {v:'schedule',label:'Schedule',icon:'calendarClock'},
  {v:'hub',label:'Library Hub',icon:'inbox',badge:function(){return (S.pendingNewSeries||[]).length;}},
  {v:'filemgmt',label:'File Management',icon:'folder'},
  {v:'stats',label:'Stats',icon:'chart'},
  {sec:'Account'},
  {v:'mal',label:'MyAnimeList',icon:'layers'},
  {v:'appearance',label:'Appearance',icon:'palette'},
  {v:'settings',label:'Settings',icon:'gear'}
];

function renderSidebar(){
  var nav=document.getElementById('nav');if(!nav)return;
  var h='<span class="nav-indicator" id="navIndicator"></span>';
  NAV.forEach(function(n){
    if(n.sec){h+='<div class="nav-sec">'+E(n.sec)+'</div>';return;}
    var label=typeof n.label==='function'?n.label():n.label;
    var badge=n.badge?n.badge():0;
    h+='<div class="ni'+(S.view===n.v?' active':'')+'" data-view="'+n.v+'"'+A('go',n.v)+' tabindex="0" role="link" data-tip-pos="right"'+(document.querySelector('.app.sidebar-collapsed')?Tip(label):'')+'>'+ic(n.icon)+'<span class="ni-label">'+E(label)+'</span>'+(badge?'<span class="ni-badge">'+badge+'</span>':'')+'</div>';
  });
  nav.innerHTML=h;
  positionNavIndicator(true);
}
function updateNavBadges(){
  NAV.forEach(function(n){
    if(!n.badge)return;var el=document.querySelector('.ni[data-view="'+n.v+'"]');if(!el)return;
    var b=n.badge(),badge=el.querySelector('.ni-badge');
    if(b&&!badge){badge=document.createElement('span');badge.className='ni-badge';el.appendChild(badge);}
    if(badge){if(b)badge.textContent=b;else badge.remove();}
  });
  var act=document.getElementById('tbActivity');
  if(act)act.classList.toggle('has-dot',(S.activities||[]).some(function(a){return a.status==='running';}));
}
function positionNavIndicator(instant){
  var ind=document.getElementById('navIndicator');if(!ind)return;
  var active=document.querySelector('.ni.active');
  if(!active){ind.style.opacity='0';return;}
  ind.style.opacity='1';
  if(instant){ind.style.transition='none';}
  // The lens stretches while it travels, then springs back into shape.
  var prevY=parseFloat(ind.style.getPropertyValue('--y'))||0;
  if(!instant&&Math.abs(prevY-active.offsetTop)>4){ind.classList.add('moving');clearTimeout(ind._mv);ind._mv=setTimeout(function(){ind.classList.remove('moving');},170);}
  ind.style.setProperty('--y',active.offsetTop+'px');
  ind.style.height=active.offsetHeight+'px';
  if(instant){void ind.offsetWidth;ind.style.transition='';}
}
function toggleSidebar(){
  var app=document.querySelector('.app');app.classList.toggle('sidebar-collapsed');
  S.cfg.sidebarCollapsed=app.classList.contains('sidebar-collapsed');api.setConfig('sidebarCollapsed',S.cfg.sidebarCollapsed);
  renderSidebar();
  setTimeout(function(){positionNavIndicator(true);updateSegThumbs();},400);
}

// --------------------------------------------------------------- navigation --
var _navHistory=['library'],_navIdx=0;
function navPush(v){if(_navHistory[_navIdx]===v)return;_navHistory=_navHistory.slice(0,_navIdx+1);_navHistory.push(v);_navIdx=_navHistory.length-1;}
function navBack(){if(_navIdx>0){_navIdx--;_show(_navHistory[_navIdx]);}}
function navForward(){if(_navIdx<_navHistory.length-1){_navIdx++;_show(_navHistory[_navIdx]);}}

function go(v){
  if(v==='inbox'){S.hubTab='inbox';v='hub';}
  else if(v==='activity'){S.hubTab='activity';v='hub';}
  else if(v==='downloads'){S.hubTab='downloads';v='hub';}
  if(v==='assistant'||v==='ai'){openLumaAssistant();return;}
  if(!_VIEW_LABELS[v])v='library';
  closeMenu(true);
  navPush(v);_show(v);
}
// Programmatic jumps must bypass the container's smooth scrolling, otherwise a
// re-render reads a mid-animation offset and restores it.
function setScrollInstant(el,top){if(!el)return;if(el.scrollTo){try{el.scrollTo({top:top,behavior:'instant'});return;}catch(e){}}el.scrollTop=top;}
function _show(v){
  var changed=S.view!==v;
  S.view=v;S.tab=v;
  document.querySelectorAll('.ni').forEach(function(e){e.classList.toggle('active',e.getAttribute('data-view')===v);});
  positionNavIndicator(false);
  document.title=(_VIEW_LABELS[v]||'')+' · '+VM('AnimeVault','MangaVault');
  var mc=document.getElementById('mc');
  if(changed&&mc){setScrollInstant(mc,0);mc.classList.remove('is-entering');void mc.offsetWidth;mc.classList.add('is-entering');clearTimeout(window._enterT);window._enterT=setTimeout(function(){mc.classList.remove('is-entering');},900);}
  render();
}

// ------------------------------------------------------------------ render --
// Views that need network data keep their own cache; render() re-uses it so
// background repaints (scans, cover fetches, activity) never refetch.
function render(){
  var mc=document.getElementById('mc');if(!mc)return;
  if(S.view!=='library')heroStopRotation();
  try{
    var v=S.view;
    if(v==='library'){var st=mc.scrollTop;mc.innerHTML=vLib();setScrollInstant(mc,st);afterLibraryRender();}
    else if(v==='explore'){if(S.exploreTop.length||S.exploreSeasonal.length)renderExplore();else loadExplore();}
    else if(v==='mylist'){if(S.myListData)renderMyList();else loadMyList();}
    else if(v==='continue')mc.innerHTML=vCont();
    else if(v==='completed')mc.innerHTML=vComp();
    else if(v==='filemgmt')mc.innerHTML=vFileMgmt();
    else if(v==='hub')mc.innerHTML=vHub();
    else if(v==='schedule'){var src=S.schedSource||'watching';if(S._schedDataCache[src])renderSchedule();else loadSchedule();}
    else if(v==='stats'){renderStats();}
    else if(v==='mal')mc.innerHTML=vMal();
    else if(v==='appearance')mc.innerHTML=vAppearance();
    else if(v==='settings'){var st2=mc.scrollTop;mc.innerHTML=vSet();setScrollInstant(mc,st2);afterSettingsRender();}
  }catch(e){console.error('[render]',e);mc.innerHTML=emptyState('alert','This view hit an error',E(e.message||String(e)),'<button class="btn btn-secondary"'+A('go','library')+'>Back to Collection</button>');}
  updateSegThumbs(mc);
  updateNavBadges();
}
function loadingBlock(label){return '<div class="loading-block"><div class="spinner"></div>'+(label?'<div>'+E(label)+'</div>':'')+'</div>';}
function skeletonGrid(n){var h='<div class="skel-grid">';for(var i=0;i<(n||12);i++)h+='<div class="skel-card"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';return h+'</div>';}
function emptyState(icon,title,text,actions,compact){return '<div class="empty'+(compact?' compact':'')+'"><div class="empty-icon">'+ic(icon)+'</div><div class="empty-title">'+title+'</div>'+(text?'<div class="empty-text">'+text+'</div>':'')+(actions?'<div class="empty-actions">'+actions+'</div>':'')+'</div>';}
function pageHead(title,sub,actions){return '<div class="page-head"><div><div class="page-title">'+title+'</div>'+(sub?'<div class="page-sub">'+sub+'</div>':'')+'</div>'+(actions?'<div class="page-actions">'+actions+'</div>':'')+'</div>';}
function searchField(o){
  // o: {id, value, placeholder, input (action), clear (action), extra}
  return '<div class="search'+(o.value?' has-value':'')+(o.size?' '+o.size:'')+'"'+(o.wrapId?' id="'+o.wrapId+'"':'')+'>'+ic('search')
    +'<input'+(o.id?' id="'+o.id+'"':'')+' type="text" autocomplete="off" spellcheck="false" placeholder="'+E(o.placeholder||'Search…')+'" value="'+E(o.value||'')+'"'+(o.input?On('input',o.input):'')+(o.enter?On('enter',o.enter):'')+(o.extra||'')+'>'
    +'<div class="spinner"></div><button class="search-clear" aria-label="Clear"'+A(o.clear||'clearSearch')+'>'+ic('x')+'</button></div>';
}
function seg(id,options,active,action,cls){
  // options: [{v,label,icon,count}]
  var h='<div class="seg'+(cls?' '+cls:'')+'" data-seg="'+E(id)+'" role="tablist">';
  options.forEach(function(o){h+='<button role="tab" class="'+(String(o.v)===String(active)?'active':'')+'"'+A(action,o.v)+(o.tip?Tip(o.tip):'')+'>'+(o.icon?ic(o.icon):'')+(o.label?'<span>'+E(o.label)+'</span>':'')+(o.count!=null?'<span class="seg-count">'+o.count+'</span>':'')+'</button>';});
  return h+'</div>';
}
function switchCtl(checked,action,args){
  return '<label class="switch"><input type="checkbox"'+(checked?' checked':'')+On.apply(null,['change',action].concat(args||[]))+'><span class="track"></span><span class="thumb"></span></label>';
}

// ------------------------------------------------------------- vault mode --
function updateModeUI(){
  var m=document.getElementById('modeSeg');
  if(m){m.querySelectorAll('button').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-mode')===S.vaultMode);});updateSegThumbs(m.parentElement);}
  var t=document.getElementById('appTitle');if(t)t.textContent=isManga()?'MangaVault':'AnimeVault';
  renderSidebar();
}
async function switchMode(mode){
  if(mode===S.vaultMode)return;
  persistImportInbox();
  S.vaultMode=mode;S.cfg.vaultMode=mode;
  await api.setVaultMode(mode);
  updateModeUI();
  S.lib=[];S.covers={};S.cur=null;S.q='';S.filter='all';S.catFilter='all';
  S.exploreTop=[];S.exploreSeasonal=[];S.exploreTopOffset=0;S.exploreLoading=false;
  S.myListData=null;S._myListOffset=0;S.myListFilter='all';S._schedDataCache={};
  S.exFilter={genres:[],types:[],minScore:0,status:''};
  S.cfg=await api.getConfig();
  restoreImportInbox();
  applyPerformanceMode(S.cfg.performanceMode);
  if((S.cfg.folders&&S.cfg.folders.length)||(S.cfg.mangaFolders&&S.cfg.mangaFolders.length)){await loadLib(true);}
  scheduleStartupLibraryMaintenance();
  go(S.view||'library');
  toast('Switched to '+VM('AnimeVault','MangaVault'),'s');
}

// ----------------------------------------------------------------- MAL chip --
function uMal(){
  var chip=document.getElementById('syncToggle'),t=document.getElementById('malTxt');if(!chip||!t)return;
  if(S.mal){
    if(S.cfg.syncPaused){chip.dataset.state='paused';t.textContent='Sync paused';chip.setAttribute('data-tip','MyAnimeList sync paused — click to resume');}
    else{chip.dataset.state='on';t.textContent='MAL synced';chip.setAttribute('data-tip','Real-time MyAnimeList sync on — click to pause');}
  }else{chip.dataset.state='off';t.textContent='Connect MAL';chip.setAttribute('data-tip','MyAnimeList isn’t connected — click to set it up');}
}
function uSyncBadge(){uMal();}
function toggleSync(){
  if(!S.mal){go('mal');return;}
  S.cfg.syncPaused=!S.cfg.syncPaused;api.setConfig('syncPaused',S.cfg.syncPaused);uMal();
  toast(S.cfg.syncPaused?'MAL sync paused':'MAL sync resumed','i');
  if(S.view==='mal')render();
}

// ------------------------------------------------------------ keyboard map --
function _isTypingTarget(e){var t=e.target;if(!t)return false;var tag=(t.tagName||'').toLowerCase();return tag==='input'||tag==='textarea'||tag==='select'||t.isContentEditable;}
function _focusActiveSearch(){var mc=document.getElementById('mc');if(!mc)return false;var inp=mc.querySelector('.search input');if(inp){inp.focus();inp.select&&inp.select();return true;}return false;}
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    if(closeMenu())return;
    if(_closePalette())return;
    if(closeTopModal())return;
    if(document.getElementById('dov').classList.contains('open')){cdtl();return;}
    return;
  }
  if(e.altKey&&e.key==='ArrowLeft'){navBack();e.preventDefault();return;}
  if(e.altKey&&e.key==='ArrowRight'){navForward();e.preventDefault();return;}
  var mod=e.ctrlKey||e.metaKey;
  if(mod&&!e.shiftKey&&!e.altKey&&(e.key==='k'||e.key==='K')){openPalette();e.preventDefault();return;}
  if(mod&&!e.shiftKey&&!e.altKey&&(e.key==='f'||e.key==='F')){if(_palState.open){e.preventDefault();return;}if(_focusActiveSearch()){e.preventDefault();return;}}
  if(mod&&!e.shiftKey&&!e.altKey&&e.key===','){go('settings');e.preventDefault();return;}
  if(mod&&!e.shiftKey&&!e.altKey&&(e.key==='e'||e.key==='E')){go('explore');e.preventDefault();return;}
  if(mod&&!e.shiftKey&&!e.altKey&&(e.key==='l'||e.key==='L')){go('mylist');e.preventDefault();return;}
  if(mod&&!e.shiftKey&&!e.altKey&&(e.key==='b'||e.key==='B')){toggleSidebar();e.preventDefault();return;}
  if(mod&&e.shiftKey&&!e.altKey&&(e.key==='m'||e.key==='M')){switchMode(isManga()?'anime':'manga');e.preventDefault();return;}
  if(e.shiftKey&&!mod&&!e.altKey&&e.key==='?'){showKeyboardHelp();e.preventDefault();return;}
  if(_isTypingTarget(e)||_modalStack.length)return;
  var dov=document.getElementById('dov');
  if(dov&&dov.classList.contains('open')){
    if(e.key==='Enter'&&S.cur&&S.cur.name){pNxt(S.cur.name);e.preventDefault();return;}
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){var pn=document.getElementById('dpn');if(pn){pn.scrollBy({top:e.key==='ArrowDown'?90:-90,behavior:'smooth'});e.preventDefault();}return;}
    return;
  }
  if(e.key==='/'&&!mod&&!e.altKey){if(_focusActiveSearch()){e.preventDefault();return;}}
  if(!mod&&!e.altKey&&!e.shiftKey){
    var tabMap={'1':'library','2':'explore','3':'mylist','4':'continue','5':'completed','6':'schedule','7':'hub','8':'filemgmt','9':'stats'};
    if(tabMap[e.key]){go(tabMap[e.key]);e.preventDefault();}
  }
});
document.addEventListener('mouseup',function(e){if(e.button===3){navBack();e.preventDefault();}if(e.button===4){navForward();e.preventDefault();}});

function showKeyboardHelp(){
  var groups=[
    {cat:'Navigate',items:[['Ctrl K','Command palette'],['/ or Ctrl F','Focus search'],['Alt ← / Alt →','Back / forward'],['Ctrl B','Collapse sidebar'],['Esc','Close menu, dialog or panel']]},
    {cat:'Jump to',items:[['1','Collection'],['2','Explore'],['3','My List'],['4','Continue'],['5','Completed'],['6','Schedule'],['7','Library Hub'],['8','File Management'],['9','Stats']]},
    {cat:'Chords',items:[['Ctrl E','Explore'],['Ctrl L','My List'],['Ctrl ,','Settings'],['Ctrl Shift M','Anime / Manga'],['Shift ?','This sheet']]},
    {cat:'Series panel',items:[['Enter','Play next episode'],['↑ / ↓','Scroll'],['Esc','Close']]}
  ];
  var h='<div class="kbd-grid">';
  groups.forEach(function(g){h+='<div><div class="menu-label" style="padding-left:0">'+E(g.cat)+'</div>';g.items.forEach(function(it){h+='<div class="kbd-row"><span>'+E(it[1])+'</span><span>'+it[0].split(' ').map(function(k){return k==='/'||k==='or'?'<span class="muted">'+E(k)+'</span>':'<kbd>'+E(k)+'</kbd>';}).join(' ')+'</span></div>';});h+='</div>';});
  h+='</div><div class="field-hint" style="margin-top:14px">Number keys and “/” are ignored while you type in a field. Mouse back/forward buttons also navigate.</div>';
  openModal({id:'kbdHelp',title:'Keyboard shortcuts',icon:'keyboard',width:640,body:h,foot:'<button class="btn btn-primary" data-modal-close>Done</button>'});
}

// ---------------------------------------------------------- command palette --
var _palState={open:false,sel:0,items:[],query:'',filtered:[]};
function _palBuildIndex(){
  var items=[];
  NAV.forEach(function(n){if(n.sec)return;var label=typeof n.label==='function'?n.label():n.label;items.push({kind:'Go to',title:label,sub:'',icon:n.icon,run:function(){go(n.v);}});});
  [
    ['Rescan library','Pick up new files on disk','refresh',function(){loadLib().then(function(){toast('Library rescanned','s');});}],
    ['Review Import Inbox','New and unlinked titles','inbox',function(){openImportReviewer();}],
    ['Refresh MAL links','Refresh linked metadata; send unlinked series to the inbox','link',function(){autoSyncAll();}],
    ['Sync Health','Review MAL links, metadata and conflicts','heartPulse',function(){runSyncHealth();}],
    ['Switch to '+VM('Manga','Anime')+' mode','Toggle MangaVault / AnimeVault',VM('manga','anime'),function(){switchMode(isManga()?'anime':'manga');}],
    [(S.cfg&&S.cfg.syncPaused?'Resume':'Pause')+' MAL sync','Real-time progress sync','pause',function(){toggleSync();}],
    ['Toggle light / dark','Quick theme switch','sun',function(){toggleQuickTheme();}],
    ['Fetch missing covers','AniList cover lookup','image',function(){fetchAll();}],
    ['Library Health Check','Missing, duplicate and unparseable files','heartPulse',function(){runHealthCheck();}],
    ['Episode Gap Detector','Find missing '+epLabelFull().toLowerCase(),'scan',function(){runGapDetector();}],
    ['Open app data folder','Config, cache and covers','folderOpen',function(){api.openFolder(S.cfg&&S.cfg._userDataPath||'');}],
    ['Ask Luma','Open the companion chat','sparkles',function(){openLumaAssistant();}],
    ['Keyboard shortcuts','Every shortcut and chord','keyboard',function(){showKeyboardHelp();}]
  ].forEach(function(a){items.push({kind:'Action',title:a[0],sub:a[1],icon:a[2],run:a[3]});});
  (S.lib||[]).filter(function(s){return !s.name.startsWith('__unsorted');}).forEach(function(s){
    items.push({kind:'Library',title:s.name,sub:s.episodeCount+' '+epLabel().toLowerCase(),cover:S.covers[s.name]||'',icon:VM('film','book'),run:function(){odtl(s.name);}});
  });
  if(S.myListData&&S.myListData.data){
    S.myListData.data.slice(0,300).forEach(function(x){var n=x.node,ls=x.list_status||{};items.push({kind:'My List',title:n.title,sub:(ls.status||'').replace(/_/g,' ')+(ls.score?' · ★ '+ls.score:''),cover:n.main_picture?n.main_picture.medium:'',icon:'listCheck',run:function(){openExploreDetail(n.id);}});});
  }
  return items;
}
function _palFilter(items,q){
  if(!q){return items.filter(function(i){return i.kind!=='My List';}).slice(0,60);}
  var scored=[];
  items.forEach(function(it){var s=_palFuzzy(q,it.title),s2=_palFuzzy(q,it.sub||'')*.3,b=Math.max(s,s2);if(b>-Infinity)scored.push({it:it,score:b});});
  scored.sort(function(a,b){return b.score-a.score;});
  return scored.slice(0,60).map(function(x){return x.it;});
}
function _palRender(){
  var raw=_palFilter(_palState.items,_palState.query);
  // Group results; with a query, groups follow their best match so the top hit is always first on screen.
  var order=['Go to','Action','Library','My List'],byKind={};
  if(_palState.query){order=[];raw.forEach(function(it){if(order.indexOf(it.kind)<0)order.push(it.kind);});}
  raw.forEach(function(it){(byKind[it.kind]=byKind[it.kind]||[]).push(it);});
  var filtered=[];order.forEach(function(k){(byKind[k]||[]).forEach(function(it){filtered.push(it);});});
  _palState.filtered=filtered;
  if(_palState.sel>=filtered.length)_palState.sel=Math.max(0,filtered.length-1);
  var res=document.getElementById('palResults');if(!res)return;
  if(!filtered.length){res.innerHTML='<div class="pal-empty">No matches for “'+E(_palState.query)+'”</div>';return;}
  var groups={};
  filtered.forEach(function(it,i){(groups[it.kind]=groups[it.kind]||[]).push({it:it,i:i});});
  var h='';
  order.forEach(function(k){var g=groups[k];if(!g)return;h+='<div class="pal-group"><div class="menu-label">'+E(k)+'</div>';
    g.forEach(function(x){h+='<div class="pal-item'+(x.i===_palState.sel?' active':'')+'" data-idx="'+x.i+'">'
      +(x.it.cover?'<img class="pal-thumb" src="'+E(x.it.cover)+'" alt="" loading="lazy">':'<span class="pal-ic">'+ic(x.it.icon||'arrowRight')+'</span>')
      +'<span class="pal-text"><span class="pal-title">'+E(x.it.title)+'</span>'+(x.it.sub?'<span class="pal-sub">'+E(x.it.sub)+'</span>':'')+'</span>'
      +(x.i===_palState.sel?'<kbd>↵</kbd>':'')+'</div>';});
    h+='</div>';});
  res.innerHTML=h;
  var a=res.querySelector('.pal-item.active');if(a&&a.scrollIntoView)a.scrollIntoView({block:'nearest'});
}
function _palRun(item){if(!item)return;_closePalette();try{item.run&&item.run();}catch(err){console.error('[Palette]',err);toast('Action failed','e');}}
function openPalette(){
  if(_palState.open)return;
  _palState={open:true,sel:0,items:_palBuildIndex(),query:'',filtered:[]};
  var el=document.createElement('div');el.id='palOverlay';el.className='pal-layer';
  el.innerHTML='<div class="pal-backdrop"></div><div class="pal-panel" role="dialog" aria-label="Command palette"><div class="pal-search">'+ic('search')
    +'<input id="palInput" placeholder="Search your library, views and actions…" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>'
    +'<div class="pal-results" id="palResults"></div><div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span class="spacer"></span><span>'+_palState.items.length+' items</span></div></div>';
  el.addEventListener('mousedown',function(e){if(e.target.classList.contains('pal-backdrop'))_closePalette();});
  document.body.appendChild(el);
  var input=document.getElementById('palInput');
  input.addEventListener('input',function(){_palState.query=input.value;_palState.sel=0;_palRender();});
  input.addEventListener('keydown',function(e){
    var f=_palState.filtered||[];
    if(e.key==='ArrowDown'){_palState.sel=Math.min(f.length-1,_palState.sel+1);_palRender();e.preventDefault();e.stopPropagation();}
    else if(e.key==='ArrowUp'){_palState.sel=Math.max(0,_palState.sel-1);_palRender();e.preventDefault();e.stopPropagation();}
    else if(e.key==='Enter'){_palRun(f[_palState.sel]);e.preventDefault();e.stopPropagation();}
    else if(e.key==='Escape'){_closePalette();e.preventDefault();e.stopPropagation();}
  });
  document.getElementById('palResults').addEventListener('click',function(e){var row=e.target.closest('.pal-item');if(!row)return;var i=+row.getAttribute('data-idx');var f=_palState.filtered||[];if(f[i])_palRun(f[i]);});
  document.getElementById('palResults').addEventListener('mousemove',function(e){var row=e.target.closest('.pal-item');if(!row)return;var i=+row.getAttribute('data-idx');if(i!==_palState.sel){_palState.sel=i;res2();}});
  function res2(){document.querySelectorAll('#palResults .pal-item').forEach(function(r){r.classList.toggle('active',+r.getAttribute('data-idx')===_palState.sel);});}
  _palRender();
  setTimeout(function(){input.focus();},10);
}
function _closePalette(){if(!_palState.open)return false;_palState.open=false;var el=document.getElementById('palOverlay');if(el){el.classList.add('closing');setTimeout(function(){el.remove();},160);}return true;}

expose('go','toggleSidebar','switchMode','toggleSync','toggleQuickTheme','showKeyboardHelp','openPalette','navBack','navForward');
act('winMin',function(){api.minimize();});
act('winMax',function(){api.maximize();});
act('winClose',function(){api.close();});
