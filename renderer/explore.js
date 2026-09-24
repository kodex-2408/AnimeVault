/* AnimeVault renderer — Explore (MAL discovery) and My List. */

function mediaCard(a,i,opts){
  opts=opts||{};
  var img=a.main_picture?a.main_picture.large||a.main_picture.medium:'';
  var bc=a.broadcast&&a.broadcast.day_of_the_week&&a.status==='currently_airing'?calcNextBroadcast(a.broadcast):'';
  var ls=opts.listStatus||a.my_list_status||null;
  var total=totalField(a),watched=ls?epWatchedField(ls):0;
  var pct=total>0?Math.min(100,watched/total*100):0;
  var aired=a.status==='currently_airing'?estimateAired(a.start_date,total):total;
  var airedPct=total>0?Math.min(100,aired/total*100):0;
  var local=S.lib.find(function(s){return s.watchData&&Number(s.watchData.malId)===Number(a.id);});
  var h='<div class="pc" style="--i:'+(i||0)+'"'+A('openExploreDetail',a.id)+On('ctx','malCtx',a.id,a.title||'',opts.ctx||'explore')+' tabindex="0" role="button" aria-label="'+E(a.title)+'">'
    +'<div class="pc-art">'+(img?'<img src="'+E(img)+'" alt="" loading="lazy" decoding="async">':'<div class="ph">'+ic(VM('film','book'))+'</div>')
    +'<div class="pc-badges">'+(bc?'<span class="media-badge">'+ic('tv')+E(bc)+'</span>':(local?'<span class="media-badge">'+ic('folder')+'Local</span>':''))
    +'<span class="right">'+(opts.showProgress&&(watched||total)?'<span class="media-badge'+(pct>=100?' accent':'')+'">'+watched+'/'+(total||'?')+'</span>':(a.mean?'<span class="media-badge">★ '+a.mean+'</span>':''))+'</span></div>'
    +(opts.showProgress&&(pct>0||airedPct>0)&&ls&&ls.status!=='completed'?'<div class="pc-bottom"><div class="pc-prog" style="--p:'+pct.toFixed(1)+'%;--a:'+airedPct.toFixed(1)+'%"><b></b><i></i></div></div>':'')
    +'</div><div class="pc-body"><div class="pc-title">'+E(a.title)+'</div><div class="pc-meta">'
    +(opts.showProgress&&ls&&ls.status?'<span class="status st-'+ls.status+'">'+E(statusLabel(ls.status))+'</span>'+(ls.score?'<span class="sep"></span><span class="star">★ '+ls.score+'</span>':'')
      :'<span>'+(a.media_type?E(String(a.media_type).toUpperCase())+' · ':'')+(total||'?')+' '+epLabel().toLowerCase()+'</span>'+(a.mean&&opts.showProgress?'<span class="sep"></span><span class="star">★ '+a.mean+'</span>':''))
    +'</div></div></div>';
  return h;
}
function malCtx(el,ev,malId,title,tab){
  var local=S.lib.find(function(s){return s.watchData&&Number(s.watchData.malId)===Number(malId);});
  var items=[{label:'View details',icon:'info',run:function(){openExploreDetail(malId);}},{label:'Open on MyAnimeList',icon:'external',run:function(){api.openExternal('https://myanimelist.net/'+VM('anime','manga')+'/'+malId);}}];
  if(local){
    items.push({sep:true},{label:'Open local series',icon:'folder',run:function(){odtl(local.name);}});
    if(!isManga()){var tracked=(S._autoDownloadWatchlist||[]).some(function(w){return w.seriesName===local.name||Number(w.malId)===Number(malId);});
      items.push({label:tracked?'Stop auto-download':'Track new episodes',icon:'download',run:function(){toggleAutoDownloadTrack(local.name,malId);}});}
    items.push({label:'Change cover',icon:'image',run:function(){openCoverSearch(local.name);}});
  }
  items.push({sep:true},{header:'Set status'});
  malStatusOptions().forEach(function(st){items.push({label:st[1],run:function(){api.malEditStatus(malId,{status:st[0]}).then(function(){toast(title+' → '+st[1],'s');if(S.view==='mylist')loadMyList(false);});}});});
  items.push({sep:true},{label:'Download series',icon:'download',run:function(){autoDownloadSeries(title,false);}},{label:'Browse on Nyaa',icon:'search',run:function(){api.openExternal(buildNyaaUrl(title));}});
  openMenu(ev,items);
}
ACT.malCtx=function(el,ev,malId,title,tab){malCtx(el,ev,malId,title,tab);};

// ------------------------------------------------------------------ Explore --
async function loadExplore(){
  var mc=document.getElementById('mc');
  if(!S.mal){mc.innerHTML='<div class="view">'+emptyState('compass','Connect MyAnimeList to explore','Browse top '+VM('anime','manga')+', this season’s lineup and search the whole MAL catalog.','<button class="btn btn-primary"'+A('go','mal')+'>Connect MyAnimeList</button>')+'</div>';return;}
  var seq=S._exSeq=(S._exSeq||0)+1;
  mc.innerHTML='<div class="view">'+pageHead('Explore','Loading…')+skeletonGrid(18)+'</div>';
  var cur=getCurrentSeason();
  try{
    if(isManga()){
      var top=await api.malGetTopAnime(30,0);
      S.exploreTop=_filterDonghua((top&&top.data?top.data:[]).map(function(x){return x.node;}));S.exploreTopOffset=30;S.exploreSeasonal=[];
    }else{
      var r=await Promise.all([api.malGetTopAnime(30,0),api.malGetSeasonal(cur.year,cur.season)]);
      S.exploreTop=_filterDonghua((r[0]&&r[0].data?r[0].data:[]).map(function(x){return x.node;}));S.exploreTopOffset=30;
      S.exploreSeasonal=_filterDonghua((r[1]&&r[1].data?r[1].data:[]).map(function(x){return x.node;}).sort(function(a,b){return(b.mean||0)-(a.mean||0);}));
    }
    if(S.view!=='explore'||seq!==S._exSeq)return;
    renderExplore();
  }catch(err){if(S.view!=='explore'||seq!==S._exSeq)return;mc.innerHTML='<div class="view">'+emptyState('alert','Couldn’t load Explore',E(err.message||'Unknown error'),'<button class="btn btn-secondary"'+A('reloadExplore')+'>Try again</button>')+'</div>';}
}
act('reloadExplore',function(){S.exploreTop=[];S.exploreSeasonal=[];loadExplore();});

function exploreFilterChips(){
  var ef=S.exFilter;var total=ef.genres.length+ef.types.length+(ef.minScore>0?1:0)+(ef.status?1:0);
  var statuses=isManga()?EXF_STATUSES_MANGA:EXF_STATUSES_ANIME;var st=statuses.find(function(s){return s.v===ef.status;});
  var h='<div class="chips">'
    +'<button class="chip'+(ef.genres.length?' on':'')+'"'+A('exfMenu','genre')+'>'+ic('tag')+'Genre'+(ef.genres.length?'<span class="chip-count">'+ef.genres.length+'</span>':'')+ic('chevronDown','caret')+'</button>'
    +'<button class="chip'+(ef.types.length?' on':'')+'"'+A('exfMenu','type')+'>'+ic('monitor')+'Type'+(ef.types.length?'<span class="chip-count">'+ef.types.length+'</span>':'')+ic('chevronDown','caret')+'</button>'
    +'<button class="chip'+(ef.minScore?' on':'')+'"'+A('exfMenu','score')+'>'+ic('starLine')+(ef.minScore?'Score ≥ '+ef.minScore:'Score')+ic('chevronDown','caret')+'</button>'
    +'<button class="chip'+(ef.status?' on':'')+'"'+A('exfMenu','status')+'>'+ic('clock')+(st?E(st.l):'Status')+ic('chevronDown','caret')+'</button>';
  if(total)h+='<button class="chip dashed"'+A('exfClearAll')+'>'+ic('x')+'Clear '+total+'</button>';
  return h+'</div>';
}
function renderExplore(){
  var mc=document.getElementById('mc');if(!mc||S.view!=='explore')return;
  var cur=getCurrentSeason();
  var ef=S.exFilter;var active=ef.genres.length+ef.types.length+(ef.minScore>0?1:0)+(ef.status?1:0);
  var h='<div class="view">'+pageHead('Explore','Discover what everyone is '+VM('watching','reading')+' — and what to try next.');
  h+='<div class="explore-search" id="exsWrap">'+searchField({id:'exsInput',placeholder:'Search every '+VM('anime','manga')+' on MyAnimeList',input:'exploreSearchInput',clear:'clearExsSearch',wrapId:'exsBar',extra:' data-keys="exs"'})
    +'<div class="menu exs-dropdown" id="exsDropdown"></div></div>';
  h+='<div class="toolbar-lite">'+exploreFilterChips()+'</div>';
  if(active){
    var filtered=exfFilterResults(S.exploreTop.concat(S.exploreSeasonal)).filter(function(a,i,arr){return arr.findIndex(function(b){return b.id===a.id;})===i;});
    h+='<div class="sec-head"><div class="sec-title">Filtered</div><span class="sec-count">'+filtered.length+'</span></div>';
    h+=filtered.length?'<div class="card-grid">'+filtered.map(function(a,i){return mediaCard(a,i);}).join('')+'</div>'
      :emptyState('filter','Nothing matches these filters','Filters apply to the seasonal and top lists loaded below.','<button class="btn btn-secondary"'+A('exfClearAll')+'>Clear filters</button>',true);
  }else{
    if(!isManga()&&S.exploreSeasonal.length){
      var label=cur.season.charAt(0).toUpperCase()+cur.season.slice(1)+' '+cur.year;
      var feat=S.exploreSeasonal[0];var fimg=feat.main_picture?feat.main_picture.large||feat.main_picture.medium:'';
      h+='<div class="sec-head"><div class="sec-title">'+E(label)+'</div><span class="tag accent">This season</span><span class="sec-count">'+S.exploreSeasonal.length+'</span></div>';
      h+='<div class="feature"'+A('openExploreDetail',feat.id)+' role="button" tabindex="0">'+(fimg?'<img class="feature-bg" src="'+E(fimg)+'" alt="">':'')+'<div class="feature-scrim"></div>'
        +(fimg?'<img class="feature-poster" src="'+E(fimg)+'" alt="">':'')
        +'<div class="feature-text"><div class="eyebrow">Top rated this season</div><div class="feature-title">'+E(feat.title)+'</div>'
        +'<div class="hero-meta">'+(feat.mean?'<span class="star">★ '+feat.mean+'</span>':'')+'<span>'+(feat.num_episodes||'?')+' eps</span>'+((feat.genres||[]).slice(0,2).map(function(g){return '<span>'+E(g.name)+'</span>';}).join(''))+(feat.broadcast?'<span>'+ic('tv')+E(calcNextBroadcast(feat.broadcast))+'</span>':'')+'</div>'
        +(feat.synopsis?'<div class="hero-syn clamp-2">'+E(feat.synopsis)+'</div>':'')
        +'<div class="hero-actions"><button class="btn btn-primary"'+A('openExploreDetail',feat.id)+'>'+ic('info')+'View details</button></div></div></div>';
      h+='<div class="card-grid">'+S.exploreSeasonal.slice(1).map(function(a,i){return mediaCard(a,i);}).join('')+'</div>';
    }
    h+='<div class="sec-head"><div class="sec-title">'+VM('Top anime','Top manga')+'</div><span class="sec-count">'+S.exploreTop.length+'</span></div>';
    h+='<div class="card-grid">'+S.exploreTop.map(function(a,i){return mediaCard(a,i);}).join('')+'</div>';
    h+='<div class="load-more"><button class="btn btn-secondary" id="loadMoreBtn"'+A('loadMoreTop')+(S.exploreLoading?' disabled':'')+'>'+(S.exploreLoading?'<span class="spinner"></span>Loading…':ic('chevronDown')+'Load more')+'</button></div>';
  }
  h+='</div>';
  mc.innerHTML=h;
  updateSegThumbs(mc);
}
async function loadMoreTop(){
  if(S.exploreLoading)return;S.exploreLoading=true;renderExplore();
  try{
    var r=await api.malGetTopAnime(30,S.exploreTopOffset);
    var items=_filterDonghua((r&&r.data?r.data:[]).map(function(x){return x.node;}));
    S.exploreTop=S.exploreTop.concat(items);S.exploreTopOffset+=30;
  }catch(e){toast('Couldn’t load more','e');}
  S.exploreLoading=false;
  var mc=document.getElementById('mc');var st=mc.scrollTop;renderExplore();setScrollInstant(mc,st);
}
function exfMenu(el,type){
  var ef=S.exFilter;var items=[];
  if(type==='genre')items=[{chips:EXF_GENRES.map(function(g){return {label:g,on:ef.genres.indexOf(g)>=0,run:function(){var i=ef.genres.indexOf(g);if(i>=0)ef.genres.splice(i,1);else ef.genres.push(g);renderExplore();reopenExf(type);}};})}];
  else if(type==='type')items=[{chips:(isManga()?EXF_TYPES_MANGA:EXF_TYPES_ANIME).map(function(t){return {label:t.l,on:ef.types.indexOf(t.v)>=0,run:function(){var i=ef.types.indexOf(t.v);if(i>=0)ef.types.splice(i,1);else ef.types.push(t.v);renderExplore();reopenExf(type);}};})}];
  else if(type==='score')items=[{label:'Any score',checked:!ef.minScore,run:function(){ef.minScore=0;renderExplore();}}].concat(EXF_SCORES.map(function(s){return {label:s.l,checked:ef.minScore===s.v,run:function(){ef.minScore=s.v;renderExplore();}};}));
  else items=[{label:'Any',checked:!ef.status,run:function(){ef.status='';renderExplore();}}].concat((isManga()?EXF_STATUSES_MANGA:EXF_STATUSES_ANIME).map(function(s){return {label:s.l,checked:ef.status===s.v,run:function(){ef.status=s.v;renderExplore();}};}));
  toggleMenu(el,items,{title:{genre:'Genres',type:'Media type',score:'Minimum score',status:isManga()?'Publication':'Airing status'}[type],wide:type==='genre',keepOpen:type==='genre'||type==='type'});
}
function reopenExf(type){var b=document.querySelector('[data-act="exfMenu"][data-arg*="'+type+'"]');if(b)exfMenu(b,type);}
act('exfMenu',function(el,ev,type){exfMenu(el,type);});
act('exfClearAll',function(){S.exFilter={genres:[],types:[],minScore:0,status:''};closeMenu(true);renderExplore();});
expose('loadMoreTop');

// Live MAL search dropdown
var exsTimer=null,exsResults=[],exsSelIdx=-1;
act('exploreSearchInput',function(el){
  var v=el.value;var wrap=el.closest('.search');wrap.classList.toggle('has-value',!!v);
  clearTimeout(exsTimer);
  if(!v.trim()){hideExsDropdown();wrap.classList.remove('loading');return;}
  wrap.classList.add('loading');
  exsTimer=setTimeout(function(){doExploreSearch(v.trim());},320);
});
async function doExploreSearch(q){
  var wrap=document.getElementById('exsBar');
  try{var r=await api.malSearch(q);exsResults=normalizeMalSearchResults(r);exsSelIdx=-1;renderExsResults(exsResults);}
  catch(e){console.error('[Explore search]',e);}
  finally{if(wrap)wrap.classList.remove('loading');}
}
function renderExsResults(items){
  var dd=document.getElementById('exsDropdown');if(!dd)return;
  if(!items.length){dd.innerHTML='<div class="exs-empty">No results on MyAnimeList</div>';dd.classList.add('open');return;}
  dd.innerHTML=items.slice(0,8).map(function(a,i){
    var img=a.main_picture?a.main_picture.medium:'';var genres=(a.genres||[]).slice(0,2).map(function(g){return g.name;}).join(' · ');
    return '<button class="exs-item'+(i===exsSelIdx?' kbd-active':'')+'" data-exs="'+i+'"'+A('exsPick',a.id)+'>'+(img?'<img src="'+E(img)+'" alt="" loading="lazy">':'<span class="thumb"></span>')
      +'<span class="grow"><span class="row-title ellipsis">'+E(a.title)+'</span><span class="row-sub">'+(a.media_type?E(a.media_type.toUpperCase())+' · ':'')+(a.num_episodes||a.num_chapters||'?')+' '+epLabel().toLowerCase()+(a.mean?' · ★ '+a.mean:'')+(genres?' · '+E(genres):'')+'</span></span>'+ic('chevronRight')+'</button>';
  }).join('');
  dd.classList.add('open');
}
function hideExsDropdown(){var dd=document.getElementById('exsDropdown');if(dd)dd.classList.remove('open');}
function clearExsSearch(){var i=document.getElementById('exsInput');if(i){i.value='';i.focus();i.closest('.search').classList.remove('has-value','loading');}exsResults=[];hideExsDropdown();}
act('clearExsSearch',clearExsSearch);
act('exsPick',function(el,ev,id){hideExsDropdown();openExploreDetail(id);});
document.addEventListener('keydown',function(e){
  if(!e.target||e.target.id!=='exsInput')return;
  if(e.key==='Escape'){clearExsSearch();e.stopPropagation();return;}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();exsSelIdx=clamp(exsSelIdx+(e.key==='ArrowDown'?1:-1),0,Math.min(exsResults.length,8)-1);
    document.querySelectorAll('#exsDropdown .exs-item').forEach(function(x,i){x.classList.toggle('kbd-active',i===exsSelIdx);if(i===exsSelIdx)x.scrollIntoView({block:'nearest'});});return;}
  if(e.key==='Enter'&&exsSelIdx>=0&&exsResults[exsSelIdx]){e.preventDefault();hideExsDropdown();openExploreDetail(exsResults[exsSelIdx].id);}
});
document.addEventListener('focusin',function(e){if(e.target&&e.target.id==='exsInput'&&exsResults.length&&e.target.value.trim()){var dd=document.getElementById('exsDropdown');if(dd)dd.classList.add('open');}});
document.addEventListener('mousedown',function(e){var w=document.getElementById('exsWrap');if(w&&!w.contains(e.target))hideExsDropdown();});

// ------------------------------------------------------------------ My List --
function myListStatusKey(k){if(!isManga())return k;return k==='watching'?'reading':k==='plan_to_watch'?'plan_to_read':k;}
async function loadMyList(resetPagination){
  var mc=document.getElementById('mc');
  if(!S.mal){mc.innerHTML='<div class="view">'+emptyState('listCheck','Connect MyAnimeList to see your list','Your full '+VM('anime','manga')+' list, with progress bars that know what has aired.','<button class="btn btn-primary"'+A('go','mal')+'>Connect MyAnimeList</button>')+'</div>';return;}
  var seq=S._mlSeq=(S._mlSeq||0)+1;
  if(S.view==='mylist'&&!S.myListData)mc.innerHTML='<div class="view">'+pageHead(VM('My List','My Manga List'),'Loading your list…')+skeletonGrid(18)+'</div>';
  var fetchSize=S._myListPageSize;
  if(resetPagination===false&&S._myListOffset>S._myListPageSize)fetchSize=S._myListOffset;
  else{S._myListOffset=0;}
  try{
    var st=S.myListFilter==='all'?null:myListStatusKey(S.myListFilter);
    var r=await api.malGetUserList(st,fetchSize,0);
    if(seq!==S._mlSeq)return;
    S.myListData=r||{data:[]};S._myListOffset=(r&&r.data?r.data.length:0);S._myListHasMore=!!(r&&r.paging&&r.paging.next);
    if(S.view==='mylist')renderMyList();
  }catch(err){if(seq!==S._mlSeq||S.view!=='mylist')return;mc.innerHTML='<div class="view">'+emptyState('alert','Couldn’t load your list',E(err.message||''),'<button class="btn btn-secondary"'+A('reloadMyList')+'>Try again</button>')+'</div>';}
}
act('reloadMyList',function(){S.myListData=null;loadMyList();});
async function loadMoreMyList(){
  if(!S._myListHasMore)return;var seq=S._mlSeq;
  var btn=document.getElementById('mlLoadMoreBtn');if(btn){btn.disabled=true;btn.innerHTML='<span class="spinner"></span>Loading…';}
  try{
    var st=S.myListFilter==='all'?null:myListStatusKey(S.myListFilter);
    var r=await api.malGetUserList(st,S._myListLoadMoreSize,S._myListOffset);
    if(seq!==S._mlSeq)return;
    if(r&&r.data&&r.data.length){S.myListData.data=S.myListData.data.concat(r.data);S._myListOffset+=r.data.length;S._myListHasMore=!!(r.paging&&r.paging.next);}else S._myListHasMore=false;
    var mc=document.getElementById('mc');var sc=mc.scrollTop;renderMyList();setScrollInstant(mc,sc);
  }catch(e){toast('Couldn’t load more','e');if(btn){btn.disabled=false;btn.textContent='Load more';}}
}
expose('loadMoreMyList');

function renderMyList(){
  var mc=document.getElementById('mc');if(!mc||S.view!=='mylist')return;
  var r=S.myListData;if(!r){loadMyList();return;}
  var items=(r.data||[]).slice();
  var watchedSum=0,scored=0,scoreSum=0;
  items.forEach(function(x){var ls=x.list_status||{};watchedSum+=epWatchedField(ls);if(ls.score){scored++;scoreSum+=ls.score;}});
  var genres={};items.forEach(function(x){(x.node.genres||[]).forEach(function(g){genres[g.name]=1;});});
  var genreList=Object.keys(genres).sort();
  if(S.myListGenre!=='all')items=items.filter(function(x){return (x.node.genres||[]).some(function(g){return g.name===S.myListGenre;});});
  var q=(S.myListQ||'').toLowerCase();if(q)items=items.filter(function(x){return (x.node.title||'').toLowerCase().indexOf(q)>=0;});
  items.sort(function(a,b){
    var la=a.list_status||{},lb=b.list_status||{};
    switch(S.myListSort){
      case 'score_desc':return (lb.score||0)-(la.score||0);
      case 'score_asc':return (la.score||0)-(lb.score||0);
      case 'mal_score':return (b.node.mean||0)-(a.node.mean||0);
      case 'progress':var pa=totalField(a.node)?epWatchedField(la)/totalField(a.node):0,pb=totalField(b.node)?epWatchedField(lb)/totalField(b.node):0;return pb-pa;
      case 'updated':return new Date(lb.updated_at||0)-new Date(la.updated_at||0);
      case 'title_desc':return (b.node.title||'').localeCompare(a.node.title||'');
      default:return (a.node.title||'').localeCompare(b.node.title||'');
    }
  });
  var sortLabels={title:'Title A–Z',title_desc:'Title Z–A',score_desc:'My score ↓',score_asc:'My score ↑',mal_score:'MAL score',progress:'Progress',updated:'Recently updated'};
  var h='<div class="view">'+pageHead(VM('My List','My Manga List'),plural((r.data||[]).length,'entry','entries')+' · '+watchedSum.toLocaleString()+' '+VM('episodes watched','chapters read')+(scored?' · mean score '+(scoreSum/scored).toFixed(2):''),
    seg('mlView',[{v:'grid',icon:'grid',tip:'Grid'},{v:'list',icon:'list',tip:'List'}],S.myListView,'setMyListView'));
  var filters=[{v:'all',label:'All'},{v:'watching',label:watchingLabel()},{v:'completed',label:'Completed'},{v:'on_hold',label:'On hold'},{v:'dropped',label:'Dropped'},{v:'plan_to_watch',label:planLabel()}];
  h+='<div class="toolbar-lite">'+seg('mlStatus',filters,S.myListFilter,'setMyListFilter')
    +'<span class="spacer"></span>'+searchField({value:S.myListQ||'',placeholder:'Filter list',input:'myListQInput',clear:'myListQClear',size:'sm'}).replace('class="search','class="search toolbar-search')
    +'<button class="chip'+(S.myListSort!=='title'?' on':'')+'"'+A('mlSortMenu')+'>'+ic('sort')+E(sortLabels[S.myListSort]||'Sort')+ic('chevronDown','caret')+'</button>'
    +(genreList.length>1?'<button class="chip'+(S.myListGenre!=='all'?' on':'')+'"'+A('mlGenreMenu')+'>'+ic('tag')+(S.myListGenre!=='all'?E(S.myListGenre):'Genre')+ic('chevronDown','caret')+'</button>':'')
    +'</div>';
  if(!items.length){h+=emptyState('listCheck','No entries here',q?'Nothing matches “'+E(S.myListQ)+'”.':'This part of your list is empty.','',true);mc.innerHTML=h+'</div>';updateSegThumbs(mc);return;}
  if(S.myListView==='grid'){
    h+='<div class="card-grid">'+items.map(function(item,i){return mediaCard(item.node,i,{listStatus:item.list_status||{},showProgress:true,ctx:'mylist'});}).join('')+'</div>';
  }else{
    h+='<div class="list-group ml-list">';
    items.forEach(function(item){
      var a=item.node,ls=item.list_status||{};var img=a.main_picture?a.main_picture.medium:'';
      var total=totalField(a),watched=epWatchedField(ls);var pct=total>0?Math.min(100,watched/total*100):0;
      var aired=a.status==='currently_airing'?estimateAired(a.start_date,total):total;var airedPct=total>0?Math.min(100,aired/total*100):0;
      var bc=a.broadcast&&a.status==='currently_airing'?calcNextBroadcast(a.broadcast):'';
      var local=S.lib.find(function(s){return s.watchData&&Number(s.watchData.malId)===Number(a.id);});
      h+='<div class="lg-row clickable ml-row"'+A('openExploreDetail',a.id)+On('ctx','malCtx',a.id,a.title||'','mylist')+'>'
        +(img?'<img class="thumb" src="'+E(img)+'" alt="" loading="lazy">':'<span class="thumb"></span>')
        +'<div class="lg-main"><div class="lg-title ellipsis">'+E(a.title)+'</div>'
        +'<div class="ml-meta"><span class="status st-'+(ls.status||'')+'">'+E(statusLabel(ls.status))+'</span>'+(ls.score?'<span class="star">★ '+ls.score+'</span>':'')+(local?'<span class="tag green">'+ic('folder')+local.episodeCount+' local</span>':'')+(bc?'<span class="tag accent">'+ic('tv')+E(bc)+'</span>':'')+'</div>'
        +'<div class="ml-prog"><div class="progress" style="--p:'+pct.toFixed(1)+'%"><b style="width:'+airedPct.toFixed(1)+'%"></b><i></i></div><span class="num">'+watched+' / '+(total||'?')+'</span></div></div>'
        +'<div class="lg-ctrl">'+(isManga()?'':'<button class="icon-btn sm"'+A('downloadSeriesBtn',a.title,a.status==='currently_airing')+Tip('Download')+'>'+ic('download')+'</button>')
        +'<button class="icon-btn sm"'+A('openNyaa',a.title)+Tip('Browse on Nyaa')+'>'+ic('search')+'</button>'
        +(local?'<button class="icon-btn sm"'+A('openSeries',local.name)+Tip('Open local series')+'>'+ic('folder')+'</button>':'')+'</div></div>';
    });
    h+='</div>';
  }
  if(S._myListHasMore)h+='<div class="load-more"><button class="btn btn-secondary" id="mlLoadMoreBtn"'+A('loadMoreMyList')+'>'+ic('chevronDown')+'Load '+S._myListLoadMoreSize+' more</button></div>';
  h+='</div>';
  mc.innerHTML=h;updateSegThumbs(mc);
}
act('setMyListView',function(el,ev,v){S.myListView=v;renderMyList();});
act('setMyListFilter',function(el,ev,v){S.myListFilter=v;S._myListOffset=0;S.myListData=null;loadMyList(false);});
act('myListQInput',function(el){S.myListQ=el.value;var sel=el.selectionStart;renderMyListDebounced(sel);});
act('myListQClear',function(){S.myListQ='';renderMyList();});
act('downloadSeriesBtn',function(el,ev,title,airing){return autoDownloadSeries(title,airing);});
var renderMyListDebounced=debounce(function(sel){renderMyList();var i=document.querySelector('.toolbar-search input');if(i){i.focus();try{i.setSelectionRange(sel,sel);}catch(e){}}},160);
act('mlSortMenu',function(el){
  var sorts=[['title','Title A–Z'],['title_desc','Title Z–A'],['updated','Recently updated'],['score_desc','My score, high → low'],['score_asc','My score, low → high'],['mal_score','MAL score'],['progress','Progress']];
  toggleMenu(el,sorts.map(function(s){return {label:s[1],checked:S.myListSort===s[0],run:function(){S.myListSort=s[0];renderMyList();}};}),{title:'Sort by'});
});
act('mlGenreMenu',function(el){
  var g={};((S.myListData&&S.myListData.data)||[]).forEach(function(x){(x.node.genres||[]).forEach(function(k){g[k.name]=1;});});
  var list=Object.keys(g).sort();
  toggleMenu(el,[{chips:[{label:'All',on:S.myListGenre==='all',run:function(){S.myListGenre='all';renderMyList();}}].concat(list.map(function(n){return {label:n,on:S.myListGenre===n,run:function(){S.myListGenre=n;renderMyList();}};}))}],{title:'Genre',wide:true});
});
