/* AnimeVault renderer — Collection, Continue, Completed. */

function seriesProgress(s){
  var watched=s.watchData&&s.watchData.episodesWatched?s.watchData.episodesWatched:[];
  var high=watched.length?Math.max.apply(null,watched):0;
  var mls=getMyListStatus(s.watchData&&s.watchData.malData);
  var malEp=mls?epWatchedField(mls):0;if(malEp>high)high=malEp;
  var total=s.watchData&&s.watchData.malData?totalField(s.watchData.malData):s.episodeCount;
  var pct=total>0?Math.min(100,high/total*100):0;
  return {high:high,total:total,pct:pct,mls:mls};
}
function seriesBroadcast(s){var md=s.watchData&&s.watchData.malData;return md&&md.broadcast&&md.broadcast.day_of_the_week&&md.status==='currently_airing'?calcNextBroadcast(md.broadcast):'';}
function isInProgress(s){
  var ms=getMalStatus(s);
  if(ms==='watching'||ms==='reading'||ms==='on_hold')return true;
  if(!ms){var w=s.watchData;return !!(w&&w.episodesWatched&&w.episodesWatched.length>0&&w.episodesWatched.length<s.episodeCount);}
  return false;
}
function isCompleted(s){
  var ms=getMalStatus(s);if(ms==='completed')return true;
  if(!ms){var d=s.watchData;return !!(d&&d.episodesWatched&&s.episodeCount>0&&d.episodesWatched.length>=s.episodeCount);}
  return false;
}
function librarySeries(){return S.lib.filter(function(s){return !s.name.startsWith('__unsorted');});}
function byRecent(a,b){return new Date(b.watchData&&b.watchData.lastWatched||0)-new Date(a.watchData&&a.watchData.lastWatched||0);}

// ------------------------------------------------------------- poster card --
function sCard(s,i,ctx){
  var c=S.covers[s.name]||'';
  var p=seriesProgress(s);
  var hasSync=s.watchData&&s.watchData.malId;
  var bc=seriesBroadcast(s);
  var selected=S.selectMode&&S.selectedSeries.indexOf(s.name)>=0;
  var status=p.mls&&p.mls.status?p.mls.status:'';
  var score=p.mls&&p.mls.score?p.mls.score:0;
  var h='<div class="pc'+(selected?' selected':'')+'" style="--i:'+(i||0)+'" data-name="'+E(s.name.toLowerCase())+'" data-cat="'+E(s.category||'')+'"'
    +(S.selectMode?A('toggleSelectSeries',s.name):A('openSeries',s.name))+On('ctx','seriesCtx',s.name,ctx||'collection')+' tabindex="0" role="button" aria-label="'+E(s.name)+'">';
  h+='<div class="pc-art">'+(c?'<img src="'+E(c)+'" alt="" loading="lazy" decoding="async">':'<div class="ph">'+ic(VM('film','book'))+'</div>');
  h+='<div class="pc-badges">';
  if(S.selectMode)h+='<span class="pc-check">'+ic('check')+'</span>';
  else if(!hasSync)h+='<span class="media-badge warn"'+A('malRelink',s.name)+Tip('Not linked to MyAnimeList — click to link')+'>'+ic('link')+'Link</span>';
  else if(bc)h+='<span class="media-badge">'+ic('tv')+E(bc)+'</span>';
  h+='<span class="right">'+(p.high>0?'<span class="media-badge'+(p.pct>=100?' accent':'')+'">'+p.high+'/'+(p.total||'?')+'</span>':'')+'</span></div>';
  if(!S.selectMode)h+='<button class="pc-play"'+A('pNxt',s.name)+' aria-label="Play next">'+ic('play')+'</button>';
  if(p.pct>0)h+='<div class="pc-bottom"><div class="pc-prog" style="--p:'+p.pct.toFixed(1)+'%"><i></i></div></div>';
  h+='</div><div class="pc-body"><div class="pc-title">'+E(s.name)+'</div><div class="pc-meta">'
    +(status?'<span class="status st-'+status+'">'+E(statusLabel(status))+'</span>':'<span>'+(p.total||s.episodeCount||'?')+' '+epLabel().toLowerCase()+'</span>')
    +(score?'<span class="sep"></span><span class="star">★ '+score+'</span>':'')
    +'</div></div></div>';
  return h;
}
function statusLabel(st){
  return ({watching:'Watching',reading:'Reading',completed:'Completed',on_hold:'On hold',dropped:'Dropped',plan_to_watch:'Plan to watch',plan_to_read:'Plan to read'})[st]||String(st||'').replace(/_/g,' ');
}

// -------------------------------------------------------------- resume card --
function resumeCard(s){
  var c=S.covers[s.name]||'';var n=nxtUn(s);var p=seriesProgress(s);var bc=seriesBroadcast(s);
  var nextLabel=n?(epLabel()+' '+(n.episodeNum!=null?n.episodeNum:'?')):(p.total&&p.high>=p.total?'Finished':'Up to date');
  return '<div class="rc"'+A('openSeries',s.name)+On('ctx','seriesCtx',s.name,'continue')+' tabindex="0" role="button">'
    +(c?'<img class="rc-bg" src="'+E(c)+'" alt="" loading="lazy" decoding="async">':'')
    +'<div class="rc-inner">'+(c?'<img class="rc-poster" src="'+E(c)+'" alt="" loading="lazy" decoding="async">':'<div class="rc-poster"></div>')
    +'<div class="rc-info"><div class="rc-kicker">'+(bc?ic('tv')+E(bc):E(nextLabel)+(p.total?' · of '+p.total:''))+'</div>'
    +'<div class="rc-title clamp-2">'+E(s.name)+'</div>'
    +'<div class="rc-sub">'+p.high+' of '+(p.total||'?')+' '+watchedLabel()+(s.watchData&&s.watchData.lastWatched?' · '+timeAgo(s.watchData.lastWatched):'')+'</div>'
    +'<div class="rc-foot"><div class="progress thin" style="--p:'+p.pct.toFixed(1)+'%"><i></i></div>'
    +'<div class="rc-actions"><button class="btn btn-primary btn-sm"'+A('pNxt',s.name)+'>'+ic('play')+(n?VM('Play ','Read ')+E(nextLabel):VM('Rewatch','Reread'))+'</button>'
    +'<button class="btn btn-on-media btn-sm btn-icon"'+A('openSeries',s.name)+Tip('Details')+'>'+ic('info')+'</button></div></div></div></div></div>';
}

// ------------------------------------------------------------------- hero --
function heroSlides(list,cw){
  return list.map(function(feat,i){
    var fc=S.covers[feat.name]||'';var md=feat.watchData&&feat.watchData.malData||null;
    var p=seriesProgress(feat);var inProg=cw.indexOf(feat)>=0;var bc=seriesBroadcast(feat);
    var syn=md&&md.synopsis?md.synopsis:'';var genres=md&&md.genres?md.genres.slice(0,3):[];
    return '<div class="hero-slide'+(i===S.heroIdx?' active':'')+'" data-hero-idx="'+i+'">'
      +(fc?'<img class="hero-bg" src="'+E(fc)+'" alt="" decoding="async">':'')
      +'<div class="hero-scrim"></div>'
      +'<div class="hero-content">'
      +(fc?'<img class="hero-poster" src="'+E(fc)+'" alt="" decoding="async"'+A('openSeries',feat.name)+'>':'<div class="hero-poster"></div>')
      +'<div class="hero-text"><div class="eyebrow">'+(inProg?VM('Continue watching','Continue reading'):'From your library')+'</div>'
      +'<div class="hero-title">'+E(feat.name)+'</div>'
      +'<div class="hero-meta">'
      +(p.pct>0?'<span class="hero-prog"><span class="progress" style="--p:'+p.pct.toFixed(1)+'%"><i></i></span><b>'+Math.round(p.pct)+'%</b></span>':'')
      +'<span>'+(p.total||feat.episodeCount)+' '+epLabel().toLowerCase()+'</span>'
      +(md&&md.mean?'<span class="star">★ '+md.mean+'</span>':'')
      +(bc?'<span>'+ic('tv')+E(bc)+'</span>':'')
      +(feat.category?'<span class="cap">'+E(feat.category)+'</span>':'')+'</div>'
      +(syn?'<div class="hero-syn clamp-2">'+E(syn)+'</div>':'')
      +(genres.length?'<div class="hero-tags">'+genres.map(function(g){return '<span class="media-badge">'+E(g.name||g)+'</span>';}).join('')+'</div>':'')
      +'<div class="hero-actions"><button class="btn btn-primary btn-lg"'+A('pNxt',feat.name)+'>'+ic('play')+(inProg?VM('Resume','Continue'):VM('Play','Read'))+'</button>'
      +'<button class="btn btn-on-media btn-lg"'+A('openSeries',feat.name)+'>'+ic('info')+'Details</button></div>'
      +'</div></div></div>';
  }).join('');
}

var _heroTimer=null;
function heroStartRotation(ms){heroStopRotation();if(S.cfg.animSpeed==='none')return;_heroTimer=setInterval(function(){if(document.hidden)return;heroAdvance(1);},ms||8000);}
function heroStopRotation(){if(_heroTimer){clearInterval(_heroTimer);_heroTimer=null;}}
function heroPause(){heroStopRotation();var h=document.getElementById('heroCarousel');if(h)h.classList.add('paused');}
function heroResume(){var h=document.getElementById('heroCarousel');if(h){h.classList.remove('paused');if(h.querySelectorAll('.hero-slide').length>1)heroStartRotation(8000);}}
function heroGoTo(idx){
  var hero=document.getElementById('heroCarousel');if(!hero)return;
  var slides=hero.querySelectorAll('.hero-slide'),dots=hero.querySelectorAll('.hero-dot');if(!slides.length)return;
  S.heroIdx=((idx%slides.length)+slides.length)%slides.length;
  slides.forEach(function(el,i){el.classList.toggle('active',i===S.heroIdx);});
  dots.forEach(function(el,i){el.classList.toggle('active',i===S.heroIdx);if(i===S.heroIdx){el.style.animation='none';void el.offsetWidth;el.style.animation='';}});
  if(!hero.classList.contains('paused'))heroStartRotation(8000);
}
function heroAdvance(dir){heroGoTo((S.heroIdx||0)+dir);}

// ------------------------------------------------------------- collection --
function libraryToolbar(cats){
  var filterLabels={all:'All statuses',watching:watchingLabel(),completed:'Completed',plan_to_watch:planLabel(),on_hold:'On hold',dropped:'Dropped'};
  var h='<div class="toolbar" id="libToolbar"><div class="toolbar-inner">'
    +searchField({id:'libSearch',value:S.q,placeholder:'Search your collection',input:'libSearchInput',clear:'libSearchClear'})
    +'<button class="chip'+(S.filter!=='all'?' on':'')+'"'+A('libStatusMenu')+'>'+ic('filter')+E(filterLabels[S.filter]||'Status')+ic('chevronDown','caret')+'</button>'
    +'<button class="chip'+(S.librarySort!=='name'?' on':'')+'"'+A('libSortMenu')+'>'+ic('sort')+(S.librarySort==='name'?'Sort':E(_LIB_SORT_LABELS[S.librarySort]||'Sort'))+ic('chevronDown','caret')+'</button>';
  if(cats.length>1){
    h+='<span class="toolbar-sep"></span><div class="chips">';
    h+='<button class="chip'+(S.catFilter==='all'?' on':'')+'"'+A('setCatFilter','all')+'>All</button>';
    cats.forEach(function(c){h+='<button class="chip cap'+(S.catFilter===c?' on':'')+'"'+A('setCatFilter',c)+'>'+E(c)+'</button>';});
    h+='</div>';
  }
  h+='<span class="spacer"></span><button class="btn btn-sm '+(S.selectMode?'btn-tinted':'btn-ghost')+'"'+A('toggleSelectMode')+'>'+ic(S.selectMode?'x':'listCheck')+(S.selectMode?'Done':'Select')+'</button>';
  return h+'</div></div>';
}

function vLib(){
  if(S.loading&&!S.lib.length)return '<div class="view">'+'<div class="skeleton" style="height:340px;border-radius:var(--r-xl);margin-bottom:28px"></div>'+skeletonGrid(12)+'</div>';
  var all=librarySeries();
  if(!all.length){
    return '<div class="view">'+emptyState(VM('film','book'),'Welcome to '+VM('AnimeVault','MangaVault'),
      VM('Your library is empty. Add the folders where your anime lives and AnimeVault will organize it, fetch artwork and keep your MyAnimeList progress in sync.','Your manga library is empty. Add your manga folders and MangaVault will track your reading progress with MyAnimeList.'),
      '<button class="btn btn-primary"'+A('go','settings')+'>'+ic('folderPlus')+'Add library folders</button>'
      +((S.pendingNewSeries||[]).length?'<button class="btn btn-secondary"'+A('openImportReviewer')+'>'+ic('inbox')+'Review imports</button>':'')
      +(S.mal?'':'<button class="btn btn-secondary"'+A('go','mal')+'>'+ic('link')+'Connect MyAnimeList</button>'))+'</div>';
  }
  var cw=all.filter(isInProgress).sort(byRecent);
  var heroList=(cw.length?cw:all.slice().sort(byRecent)).slice(0,8);
  if(!S.heroIdx||S.heroIdx>=heroList.length)S.heroIdx=0;
  var fil=filt(all);var cats=getCats();
  var h='<div class="view lib-view'+(S.selectMode?' selecting':'')+'">';
  if(heroList.length){
    h+='<section class="hero" id="heroCarousel">'+heroSlides(heroList,cw);
    if(heroList.length>1){
      h+='<div class="hero-nav"><button class="icon-btn btn-on-media"'+A('heroAdvance',-1)+' aria-label="Previous">'+ic('chevronLeft')+'</button>'
        +'<div class="hero-dots">'+heroList.map(function(s,i){return '<button class="hero-dot'+(i===S.heroIdx?' active':'')+'"'+A('heroGoTo',i)+Tip(s.name)+'></button>';}).join('')+'</div>'
        +'<button class="icon-btn btn-on-media"'+A('heroAdvance',1)+' aria-label="Next">'+ic('chevronRight')+'</button></div>';
    }
    h+='</section>';
  }
  h+=libraryToolbar(cats);
  if(cw.length&&!S.q&&S.filter==='all'&&S.catFilter==='all'){
    h+='<div class="sec-head"><div class="sec-title">'+VM('Continue watching','Continue reading')+'</div><span class="sec-count">'+cw.length+'</span><span class="spacer"></span>'
      +(cw.length>3?'<button class="btn btn-ghost btn-sm"'+A('go','continue')+'>See all'+ic('chevronRight')+'</button>':'')+'</div>'
      +'<div class="shelf" id="cwShelf"><button class="icon-btn btn-glass shelf-nav prev"'+A('shelfScroll','cwShelf',-1)+' aria-label="Scroll left">'+ic('chevronLeft')+'</button>'
      +'<div class="shelf-track">'+cw.slice(0,20).map(resumeCard).join('')+'</div>'
      +'<button class="icon-btn btn-glass shelf-nav next"'+A('shelfScroll','cwShelf',1)+' aria-label="Scroll right">'+ic('chevronRight')+'</button></div>';
  }
  h+='<div class="sec-head"><div class="sec-title">'+(S.q?'Results':'All series')+'</div><span class="sec-count" id="libCount">'+fil.length+'</span></div>';
  if(!fil.length){
    h+=emptyState('search','Nothing matches','Try a different search or clear the filters.','<button class="btn btn-secondary"'+A('clearLibFilters')+'>Clear filters</button>',true);
  }else if(S.catFilter==='all'&&!S.q&&cats.length>1){
    var idx=0;
    cats.forEach(function(cat){
      var items=fil.filter(function(s){return s.category===cat;});if(!items.length)return;
      h+='<div class="cat-group" data-cat-group="'+E(cat)+'"><div class="cat-head"><span class="cap">'+E(cat)+'</span><span class="muted">'+items.length+'</span></div><div class="card-grid">'+items.map(function(s){return sCard(s,idx++);}).join('')+'</div></div>';
    });
    var uncat=fil.filter(function(s){return !s.category;});
    if(uncat.length)h+='<div class="cat-group" data-cat-group=""><div class="cat-head"><span>Other</span><span class="muted">'+uncat.length+'</span></div><div class="card-grid">'+uncat.map(function(s){return sCard(s,idx++);}).join('')+'</div></div>';
  }else{
    h+='<div class="card-grid">'+fil.map(function(s,i){return sCard(s,i);}).join('')+'</div>';
  }
  h+='</div>';
  h+=selectionBar();
  return h;
}
function afterLibraryRender(){
  var hero=document.getElementById('heroCarousel');
  if(hero){
    hero.addEventListener('mouseenter',heroPause);hero.addEventListener('mouseleave',heroResume);
    if(hero.querySelectorAll('.hero-slide').length>1)heroStartRotation(8000);
  }
  var shelf=document.querySelector('#cwShelf .shelf-track');
  if(shelf){updateShelfNav('cwShelf');shelf.addEventListener('scroll',debounce(function(){updateShelfNav('cwShelf');},60),{passive:true});}
  observeStickyToolbar();
}
function updateShelfNav(id){
  var sh=document.getElementById(id);if(!sh)return;var t=sh.querySelector('.shelf-track');if(!t)return;
  var p=sh.querySelector('.shelf-nav.prev'),n=sh.querySelector('.shelf-nav.next');
  if(p)p.disabled=t.scrollLeft<8;if(n)n.disabled=t.scrollLeft+t.clientWidth>=t.scrollWidth-8;
}
function shelfScroll(id,dir){var sh=document.getElementById(id);if(!sh)return;var t=sh.querySelector('.shelf-track');t.scrollBy({left:dir*Math.max(300,t.clientWidth*.8),behavior:'smooth'});}
function observeStickyToolbar(){
  var tb=document.getElementById('libToolbar');var mc=document.getElementById('mc');if(!tb||!mc)return;
  var onScroll=function(){tb.classList.toggle('stuck',tb.getBoundingClientRect().top<=mc.getBoundingClientRect().top+1);};
  if(mc._stickyHandler)mc.removeEventListener('scroll',mc._stickyHandler);
  mc._stickyHandler=onScroll;mc.addEventListener('scroll',onScroll,{passive:true});onScroll();
}

// Selection (bulk actions)
function selectionBar(){
  if(!S.selectMode)return '';
  var n=S.selectedSeries.length;
  return '<div class="float-bar" id="selBar"><span class="float-count">'+(n?plural(n,'selected','selected'):'Select series')+'</span>'
    +'<button class="btn btn-sm btn-ghost"'+A('selectAllVisible')+'>Select all</button>'
    +'<span class="float-sep"></span>'
    +'<button class="btn btn-sm btn-ghost"'+(n?'':' disabled')+A('bulkSetCategory')+'>'+ic('tag')+'Category</button>'
    +'<button class="btn btn-sm btn-ghost"'+(n?'':' disabled')+A('bulkSetStatus')+'>'+ic('listCheck')+'Status</button>'
    +(isManga()?'':'<button class="btn btn-sm btn-ghost"'+(n?'':' disabled')+A('bulkTrackMenu')+'>'+ic('download')+'Auto-download</button>')
    +'<button class="btn btn-sm btn-danger"'+(n?'':' disabled')+A('bulkDelete')+'>'+ic('trash')+'Delete</button>'
    +'<button class="btn btn-sm btn-primary"'+A('toggleSelectMode')+'>Done</button></div>';
}
function selectAllVisible(){
  var cards=document.querySelectorAll('.lib-view .pc');var names=[];
  cards.forEach(function(c){if(c.style.display==='none')return;var s=S.lib.find(function(x){return x.name.toLowerCase()===c.getAttribute('data-name');});if(s)names.push(s.name);});
  S.selectedSeries=names.length===S.selectedSeries.length?[]:names;render();
}
async function bulkSetCategory(){
  var cats=getCats();var choices=cats.map(function(c){return {label:c.charAt(0).toUpperCase()+c.slice(1),value:c,icon:'tag'};});
  choices.push({label:'New category…',value:'__new',icon:'plus'});
  var cat=await askChoice({title:'Move '+plural(S.selectedSeries.length,'series','series'),text:'Choose the category these series belong to.',icon:'tag',choices:choices});
  if(cat==='__new')cat=await askText({title:'New category',label:'Category name',placeholder:'e.g. Favorites',validate:function(v){return v.trim()?'':'Enter a name';}});
  if(!cat)return;cat=cat.trim();
  for(var i=0;i<S.selectedSeries.length;i++){var s=S.lib.find(function(x){return x.name===S.selectedSeries[i];});if(s)await api.setCategory(s.name,cat);}
  S.selectedSeries=[];S.selectMode=false;await loadLib(true);toast('Category updated','s');
}
async function bulkSetStatus(){
  if(!S.mal){toast('Connect MyAnimeList first','e');return;}
  var st=await askChoice({title:'Change status',text:'Updates the MyAnimeList status of '+plural(S.selectedSeries.length,'linked series','linked series')+'.',icon:'listCheck',
    choices:malStatusOptions().map(function(o){return {label:o[1],value:o[0],icon:'checkCircle',color:'var(--st-'+(o[0].indexOf('plan')===0?'plan':o[0]==='on_hold'?'hold':o[0]==='reading'?'watching':o[0])+')'};})});
  if(!st)return;
  var n=0;for(var i=0;i<S.selectedSeries.length;i++){var s=S.lib.find(function(x){return x.name===S.selectedSeries[i];});if(s&&s.watchData&&s.watchData.malId){await api.malEditStatus(s.watchData.malId,{status:st},s.name);n++;}}
  S.selectedSeries=[];S.selectMode=false;toast('Status updated for '+plural(n,'series','series'),'s');await loadLib(true);
}
function bulkTrackMenu(el){
  toggleMenu(el,[{label:'Track new episodes',icon:'download',run:function(){bulkSetTracking(true);}},{label:'Stop tracking',icon:'x',run:function(){bulkSetTracking(false);}}]);
}
function clearLibFilters(){S.q='';S.filter='all';S.catFilter='all';S.librarySort='name';render();}

function libStatusMenu(el){
  var labels=[['all','All statuses'],['watching',watchingLabel()],['completed','Completed'],['plan_to_watch',planLabel()],['on_hold','On hold'],['dropped','Dropped']];
  toggleMenu(el,labels.map(function(l){return {label:l[1],checked:S.filter===l[0],run:function(){S.filter=l[0];render();}};}),{title:'Status'});
}
function libSortMenu(el){
  var sorts=[['name','Name'],['lastWatched','Last watched'],['episodeCount','Episodes'],['score','Score'],['progress','Progress']];
  toggleMenu(el,sorts.map(function(l){return {label:l[1],checked:S.librarySort===l[0],run:function(){S.librarySort=l[0];render();}};}),{title:'Sort by'});
}

// Instant client-side filtering without a full repaint.
function _filterCardGrid(q){
  var root=document.getElementById('mc');if(!root)return;
  var cards=root.querySelectorAll('.card-grid .pc');var vis=0;
  cards.forEach(function(c){var n=c.getAttribute('data-name')||'';var show=!q||n.indexOf(q)>=0;c.style.display=show?'':'none';if(show)vis++;});
  root.querySelectorAll('.cat-group').forEach(function(g){g.style.display=g.querySelector('.pc:not([style*="none"])')?'':'none';});
  var cnt=document.getElementById('libCount')||root.querySelector('.sec-count');if(cnt)cnt.textContent=vis;
}
var _srTimer=null;
function searchRender(){
  clearTimeout(_srTimer);
  _srTimer=setTimeout(function(){
    if(S.view==='library'){
      // Switching between "search" and "browse" layouts needs a real render.
      var grouped=!!document.querySelector('.cat-group');var wantGrouped=!S.q&&S.catFilter==='all'&&getCats().length>1;
      if(grouped!==wantGrouped||(!S.q&&!document.getElementById('cwShelf')&&librarySeries().some(isInProgress))){render();var i=document.getElementById('libSearch');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}return;}
      _filterCardGrid((S.q||'').toLowerCase());
    }
    else if(S.view==='continue')_filterCardGrid((S.contQ||'').toLowerCase());
    else if(S.view==='completed')_filterCardGrid((S.compQ||'').toLowerCase());
  },70);
}
act('libSearchInput',function(el){S.q=el.value;el.closest('.search').classList.toggle('has-value',!!el.value);searchRender();});
act('libSearchClear',function(){S.q='';render();});
act('setCatFilter',function(el,ev,c){S.catFilter=S.catFilter===c&&c!=='all'?'all':c;render();});

// -------------------------------------------------------- continue/completed --
function listPage(title,sub,items,qKey,ctx,emptyHtml){
  var q=S[qKey]||'';
  var filtered=q?items.filter(function(s){return s.name.toLowerCase().indexOf(q.toLowerCase())>=0;}):items;
  var h='<div class="view">'+pageHead(title,sub,searchField({value:q,placeholder:'Search',input:'pageSearchInput',clear:'pageSearchClear',size:'sm',extra:' data-qkey="'+qKey+'"'}).replace('class="search','class="search page-search'));
  if(!items.length)return h+emptyHtml+'</div>';
  h+='<div class="card-grid">'+filtered.map(function(s,i){return sCard(s,i,ctx);}).join('')+'</div></div>';
  return h;
}
act('pageSearchInput',function(el){var k=el.getAttribute('data-qkey');S[k]=el.value;el.closest('.search').classList.toggle('has-value',!!el.value);searchRender();});
act('pageSearchClear',function(el){var i=el.closest('.search').querySelector('input');var k=i&&i.getAttribute('data-qkey');if(k)S[k]='';render();});
function vCont(){
  var w=librarySeries().filter(isInProgress).sort(byRecent);
  return listPage(VM('Continue Watching','Continue Reading'),plural(w.length,'series','series')+' in progress',w,'contQ','continue',
    emptyState('playCircle','Nothing in progress',VM('Start an episode from your collection and it will show up here.','Start a chapter from your collection and it will show up here.'),'<button class="btn btn-secondary"'+A('go','library')+'>Browse collection</button>'));
}
function vComp(){
  var c=librarySeries().filter(isCompleted).sort(function(a,b){return a.name.localeCompare(b.name);});
  return listPage('Completed',plural(c.length,'series','series')+' finished',c,'compQ','completed',
    emptyState('checkCircle','No completed series yet',VM('Finish every episode of a series and it lands here.','Finish every chapter of a series and it lands here.'),'<button class="btn btn-secondary"'+A('go','library')+'>Browse collection</button>'));
}

// ------------------------------------------------------------ context menus --
function seriesCtx(el,ev,name,tab){
  var s=S.lib.find(function(x){return x.name===name;});if(!s)return;
  var hasLocal=s.episodeCount>0,hasMal=s.watchData&&s.watchData.malId;
  var isTracked=(S._autoDownloadWatchlist||[]).some(function(w){return w.seriesName===name||(hasMal&&Number(w.malId)===Number(s.watchData.malId));});
  var mls=getMyListStatus(s.watchData&&s.watchData.malData);var cur=mls?mls.status:null;
  var items=[
    {label:VM('Play next episode','Read next chapter'),icon:'play',run:function(){pNxt(name);}},
    {label:'Open details',icon:'info',run:function(){odtl(name);}},
    {sep:true}
  ];
  if(!isManga())items.push({label:isTracked?'Stop auto-download':'Track new episodes',icon:'download',run:function(){toggleAutoDownloadTrack(name,hasMal?s.watchData.malId:0);}});
  if(!isManga())items.push({label:'Download latest episode',icon:'zap',run:function(){downloadLatestEpisode(name,hasMal?s.watchData.malId:null);}});
  items.push({label:hasMal?'Change MAL link':'Link to MyAnimeList',icon:'link',run:function(){malRelink(name);}});
  if(hasMal)items.push({label:'Refresh metadata',icon:'refresh',run:function(){fetchMD(name,s.watchData.malId);}});
  items.push({label:'Change cover',icon:'image',run:function(){openCoverSearch(name);}});
  if(hasLocal)items.push({label:'Rename folder & files',icon:'pencil',run:function(){renameSeriesPrompt(name);}});
  if(hasLocal)items.push({label:'Show in folder',icon:'folderOpen',run:function(){api.openFolder(s.path);}});
  if(hasMal)items.push({label:'Open on MyAnimeList',icon:'external',run:function(){api.openExternal('https://myanimelist.net/'+VM('anime','manga')+'/'+s.watchData.malId);}});
  if(hasMal){
    items.push({sep:true},{header:'Set status'});
    malStatusOptions().forEach(function(st){items.push({label:st[1],checked:cur===st[0],run:function(){if(cur!==st[0])malSetStatus(name,s.watchData.malId,st[0]);}});});
  }
  if(tab==='collection'||tab==='continue'||tab==='completed'){
    items.push({sep:true},{label:'Delete files…',icon:'trash',danger:true,run:function(){confirmDeleteSeries(name);}});
  }
  openMenu(ev,items);
}
async function confirmDeleteSeries(name){
  var s=S.lib.find(function(x){return x.name===name;});if(!s)return;
  var ok=await askConfirm({title:'Delete “'+name+'”?',danger:true,confirm:'Delete files',text:plural(s.episodeCount,'file','files')+' will be permanently removed from disk. This cannot be undone.',body:'<div class="path-list"><div class="mono">'+E(s.path)+'</div></div>'});
  if(ok)deleteSeries(name,s.path);
}
async function renameSeriesPrompt(name){
  var s=S.lib.find(function(x){return x.name===name;});if(!s)return;
  var next=await askText({title:'Rename series',text:'Renames the folder and episode files. The MyAnimeList link is kept.',label:'New name',value:name,confirm:'Rename',validate:function(v){v=v.trim();if(!v)return 'Enter a name';if(/[\\/:*?"<>|]/.test(v))return 'Names cannot contain \\ / : * ? " < > |';return '';}});
  if(next===null||!next.trim()||next.trim()===name)return;
  var r=await api.managerRenameSeries(s.path,name,next.trim());
  if(!r||!r.success){toast('Rename failed: '+((r&&r.error)||'Unknown error'),'e');return;}
  toast('Renamed '+plural(r.filesRenamed,'file','files')+' and the folder','s');cdtl();await loadLib(true);
}

act('openSeries',function(el,ev,name){odtl(name);});
act('selectAllVisible',function(){selectAllVisible();});
expose('pNxt','toggleSelectSeries','toggleSelectMode','malRelink','heroAdvance','heroGoTo','shelfScroll','libStatusMenu','libSortMenu','bulkSetCategory','bulkSetStatus','bulkDelete','bulkTrackMenu','clearLibFilters','seriesCtx');
// Menu helpers receive the clicked element as their first argument.
ACT.libStatusMenu=function(el){libStatusMenu(el);};ACT.libSortMenu=function(el){libSortMenu(el);};ACT.bulkTrackMenu=function(el){bulkTrackMenu(el);};
ACT.seriesCtx=function(el,ev,name,tab){seriesCtx(el,ev,name,tab);};
