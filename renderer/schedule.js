/* AnimeVault renderer — Schedule (TV guide). */

if(!S.schedView)S.schedView='week';
var _schedTick=null;

function findSchedLibMatch(anime){
  if(!anime||!S.lib)return null;var title=anime.title?anime.title.toLowerCase().trim():'';
  return S.lib.find(function(s){return (s.watchData&&Number(s.watchData.malId)===Number(anime.id))||(title&&s.name.toLowerCase().trim()===title);})||null;
}
function isSchedAutoDlTracked(anime){
  if(!anime)return false;var title=anime.title?anime.title.toLowerCase().trim():'';
  return (S._autoDownloadWatchlist||[]).some(function(w){return (w.malId&&Number(w.malId)===Number(anime.id))||(w.seriesName&&w.seriesName.toLowerCase().trim()===title);});
}
function nextAirDate(local,from){
  from=from||new Date();
  var hm=local.time24.split(':');var d=new Date(from);d.setHours(+hm[0],+hm[1],0,0);
  var diff=(local.localDayIdx-from.getDay()+7)%7;d.setDate(d.getDate()+diff);
  if(d.getTime()<from.getTime()-30*60000)d.setDate(d.getDate()+7);
  return d;
}
function fmtCountdown(ms){
  if(ms<=0)return 'Airing now';var m=Math.round(ms/60000);if(m<60)return 'in '+m+' min';var h=Math.floor(m/60),mm=m%60;
  if(h<24)return 'in '+h+'h'+(mm?' '+mm+'m':'');var d=Math.floor(h/24);return 'in '+d+'d '+(h%24)+'h';
}
function fmtTime(d){try{return d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});}catch(e){return '';}}

async function loadSchedule(force){
  var mc=document.getElementById('mc');
  if(!S.mal){mc.innerHTML='<div class="view">'+emptyState('calendarClock','Connect MyAnimeList to see the schedule','See when every show on your list airs in your time zone, with countdowns and a weekly TV guide.','<button class="btn btn-primary"'+A('go','mal')+'>Connect MyAnimeList</button>')+'</div>';return;}
  var src=S.schedSource||'watching';
  if(!force&&S._schedDataCache[src]){renderSchedule();return;}
  mc.innerHTML='<div class="view">'+pageHead('Schedule','Loading broadcasts…')+'<div class="skeleton" style="height:120px;border-radius:var(--r-lg);margin-bottom:20px"></div><div class="week-board">'+[0,1,2,3,4,5,6].map(function(){return '<div class="skeleton" style="height:420px;border-radius:var(--r-lg)"></div>';}).join('')+'</div></div>';
  var seq=S._schSeq=(S._schSeq||0)+1;
  try{
    var raw=[];
    if(src==='watching'||src==='watching_plan'){
      var calls=[api.malGetUserList(isManga()?'reading':'watching',1000,0)];
      if(src==='watching_plan')calls.push(api.malGetUserList(isManga()?'plan_to_read':'plan_to_watch',1000,0));
      var results=await Promise.all(calls);var seen={};
      results.forEach(function(r,i){(r&&r.data?r.data:[]).forEach(function(x){if(seen[x.node.id])return;seen[x.node.id]=1;raw.push(Object.assign({},x.node,{user_status:i===0?'watching':'plan_to_watch'}));});});
    }else{
      var cur=getCurrentSeason();var sea=await api.malGetSeasonal(cur.year,cur.season);
      raw=_filterDonghua((sea&&sea.data?sea.data:[]).map(function(x){return x.node;}));
    }
    if(seq!==S._schSeq)return;
    S._schedDataCache[src]=raw;
    if(S.view==='schedule')renderSchedule();
  }catch(err){if(seq!==S._schSeq||S.view!=='schedule')return;mc.innerHTML='<div class="view">'+emptyState('alert','Couldn’t load the schedule',E(err.message||'Unknown error'),'<button class="btn btn-secondary"'+A('schedReload')+'>Try again</button>')+'</div>';}
}
act('schedReload',function(){loadSchedule(true);});

function schedItems(){
  var src=S.schedSource||'watching';var all=S._schedDataCache[src]||[];var q=(S.schedQ||'').toLowerCase().trim();var now=new Date();
  var out=[];
  all.forEach(function(a){
    if(!a.broadcast||!a.broadcast.day_of_the_week||a.status!=='currently_airing')return;
    var local=getLocalBroadcast(a.broadcast);if(!local)return;
    if(q){var t=(a.title||'').toLowerCase(),g=(a.genres||[]).map(function(x){return (x.name||x).toLowerCase();}).join(' ');if(t.indexOf(q)<0&&g.indexOf(q)<0)return;}
    out.push({a:a,local:local,next:nextAirDate(local,now),lib:findSchedLibMatch(a),tracked:isSchedAutoDlTracked(a)});
  });
  return out;
}
function schedThumb(a,cls){var img=a.main_picture?(a.main_picture.medium||a.main_picture.large):'';return img?'<img class="'+(cls||'thumb')+'" src="'+E(img)+'" alt="" loading="lazy" decoding="async">':'<span class="'+(cls||'thumb')+'"></span>';}
function schedTags(it){
  var h='';
  if(it.lib){var cnt=it.lib.episodeCount||(it.lib.episodes?it.lib.episodes.length:0);h+='<span class="tag green"'+Tip('In your library')+'>'+ic('folder')+cnt+'</span>';}
  if(it.tracked)h+='<span class="tag accent"'+Tip('Auto-download on')+'>'+ic('download')+'</span>';
  if(it.a.user_status==='plan_to_watch')h+='<span class="tag">Planned</span>';
  return h;
}

function renderSchedule(){
  var mc=document.getElementById('mc');if(!mc||S.view!=='schedule')return;
  var src=S.schedSource||'watching';
  var items=schedItems();var now=new Date();
  var tz='';try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'';}catch(e){}
  var h='<div class="view sched">';
  h+=pageHead('Schedule',plural(items.length,'show','shows')+' airing this week'+(tz?' · times in '+E(tz.replace(/_/g,' ')):''),
    seg('schedView',[{v:'week',label:'Week',icon:'grid'},{v:'agenda',label:'Agenda',icon:'list'}],S.schedView,'setSchedView'));
  h+='<div class="toolbar-lite">'+seg('schedSrc',[{v:'watching',label:watchingLabel()},{v:'watching_plan',label:'+ Planned'},{v:'seasonal',label:'Whole season'}],src,'setSchedSource')
    +'<span class="spacer"></span>'+searchField({id:'schedSearchInput',value:S.schedQ||'',placeholder:'Filter by title or genre',input:'schedSearch',clear:'clearSchedSearch',size:'sm'}).replace('class="search','class="search toolbar-search')
    +'<button class="icon-btn"'+A('schedReload')+Tip('Refresh from MyAnimeList')+'>'+ic('refresh')+'</button></div>';

  var allRaw=(S._schedDataCache[src]||[]);
  if(!items.length){
    if(S.schedQ)h+=emptyState('search','No shows match “'+E(S.schedQ)+'”','Try a different title or genre.','<button class="btn btn-secondary"'+A('clearSchedSearch')+'>Clear filter</button>');
    else h+=emptyState('tv','Nothing airing on this list',allRaw.length?'None of the '+allRaw.length+' titles here are currently airing with a known broadcast slot.':'Your list is empty.',
      src!=='seasonal'?'<button class="btn btn-primary"'+A('setSchedSource','seasonal')+'>Browse the whole season</button>':'');
    mc.innerHTML=h+'</div>';updateSegThumbs(mc);startSchedTick(false);return;
  }

  // Up next
  var upcoming=items.slice().sort(function(x,y){return x.next-y.next;}).slice(0,4);
  h+='<div class="upnext">';
  upcoming.forEach(function(it,i){
    var ms=it.next-now;var live=ms<=0;
    h+='<div class="upnext-card'+(i===0?' first':'')+(live?' live':'')+'"'+A('openExploreDetail',it.a.id)+' role="button" tabindex="0">'
      +schedThumb(it.a,'upnext-bg')+'<div class="upnext-inner">'+schedThumb(it.a,'thumb lg')
      +'<div class="grow"><div class="upnext-when" data-countdown="'+it.next.getTime()+'">'+(live?'<span class="live-dot"></span>':'')+E(fmtCountdown(ms))+'</div>'
      +'<div class="upnext-title clamp-2">'+E(it.a.title)+'</div><div class="upnext-sub">'+E(dayName(it.next,now))+' · '+E(fmtTime(it.next))+'</div></div></div></div>';
  });
  h+='</div>';

  if(S.schedView==='agenda')h+=renderAgenda(items,now);
  else h+=renderWeekBoard(items,now);
  h+='</div>';
  mc.innerHTML=h;updateSegThumbs(mc);
  startSchedTick(true);
  if(S.schedView==='week'){var nowLine=mc.querySelector('.now-line');if(nowLine){var col=nowLine.closest('.day-body');if(col&&col.scrollHeight>col.clientHeight)col.scrollTop=Math.max(0,nowLine.offsetTop-80);}}
}
function dayName(d,now){
  var a=new Date(now);a.setHours(0,0,0,0);var b=new Date(d);b.setHours(0,0,0,0);var diff=Math.round((b-a)/864e5);
  if(diff===0)return 'Today';if(diff===1)return 'Tomorrow';
  try{return d.toLocaleDateString(undefined,{weekday:'long'});}catch(e){return '';}
}
function dayBuckets(items,now){
  var out=[];
  for(var i=0;i<7;i++){
    var d=new Date(now);d.setHours(0,0,0,0);d.setDate(d.getDate()+i);
    var list=items.filter(function(it){return it.local.localDayIdx===d.getDay();}).sort(function(x,y){return x.local.time24.localeCompare(y.local.time24)||(x.a.title||'').localeCompare(y.a.title||'');});
    out.push({date:d,list:list,today:i===0});
  }
  return out;
}
function renderWeekBoard(items,now){
  var buckets=dayBuckets(items,now);var nowMins=now.getHours()*60+now.getMinutes();
  var h='<div class="week-board">';
  buckets.forEach(function(b,bi){
    var label=bi===0?'Today':bi===1?'Tomorrow':b.date.toLocaleDateString(undefined,{weekday:'short'});
    h+='<div class="day-col'+(b.today?' today':'')+'"><div class="day-head"><div><div class="day-name">'+E(label)+'</div><div class="day-date">'+E(b.date.toLocaleDateString(undefined,{month:'short',day:'numeric'}))+'</div></div><span class="day-count">'+b.list.length+'</span></div><div class="day-body">';
    if(!b.list.length)h+='<div class="day-empty">'+ic('moon')+'<span>Nothing airing</span></div>';
    var placedNow=false;
    b.list.forEach(function(it){
      var hm=it.local.time24.split(':');var mins=+hm[0]*60+ +hm[1];
      var aired=b.today&&mins+24<=nowMins;
      if(b.today&&!placedNow&&mins>nowMins){h+='<div class="now-line"><span>Now · '+E(fmtTime(now))+'</span></div>';placedNow=true;}
      h+='<div class="slot'+(aired?' aired':'')+'"'+A('openExploreDetail',it.a.id)+On('ctx','schedCtx',it.a.id,it.a.title||'')+' role="button" tabindex="0">'
        +'<div class="slot-time">'+E(it.local.time12)+(aired?'<span class="slot-aired">Aired</span>':'')+'</div>'
        +'<div class="slot-card">'+schedThumb(it.a)+'<div class="grow"><div class="slot-title clamp-2">'+E(it.a.title)+'</div><div class="slot-tags">'+(it.a.mean?'<span class="star">★ '+Number(it.a.mean).toFixed(2)+'</span>':'')+schedTags(it)+'</div></div></div></div>';
    });
    if(b.today&&!placedNow&&b.list.length)h+='<div class="now-line"><span>Now · '+E(fmtTime(now))+'</span></div>';
    h+='</div></div>';
  });
  return h+'</div>';
}
function renderAgenda(items,now){
  var buckets=dayBuckets(items,now);
  var sel=S.schedAgendaDay==null?0:S.schedAgendaDay;if(sel>6)sel=0;
  var h='<div class="agenda-days">';
  buckets.forEach(function(b,i){
    var label=i===0?'Today':i===1?'Tomorrow':b.date.toLocaleDateString(undefined,{weekday:'short'});
    h+='<button class="agenda-day'+(i===sel?' active':'')+(b.list.length?'':' empty')+'"'+A('setAgendaDay',i)+'><span class="ad-name">'+E(label)+'</span><span class="ad-date">'+b.date.getDate()+'</span><span class="ad-count">'+(b.list.length||'–')+'</span></button>';
  });
  h+='</div>';
  var b=buckets[sel];var nowMins=now.getHours()*60+now.getMinutes();
  if(!b.list.length)return h+emptyState('moon','A quiet day','Nothing on this list airs '+(sel===0?'today':'on '+b.date.toLocaleDateString(undefined,{weekday:'long'}))+'.','',true);
  h+='<div class="timeline">';
  var placedNow=false;
  b.list.forEach(function(it){
    var a=it.a;var hm=it.local.time24.split(':');var mins=+hm[0]*60+ +hm[1];var aired=b.today&&mins+24<=nowMins;
    if(b.today&&!placedNow&&mins>nowMins){h+='<div class="tl-now"><span>Now</span></div>';placedNow=true;}
    var syn=(a.synopsis||'').replace(/\s+/g,' ');var genres=(a.genres||[]).slice(0,3).map(function(g){return g.name||g;}).join(' · ');
    h+='<div class="tl-item'+(aired?' aired':'')+'"><div class="tl-time">'+E(it.local.time12)+'</div><div class="tl-dot"></div>'
      +'<div class="tl-card panel"'+A('openExploreDetail',a.id)+' role="button" tabindex="0">'+schedThumb(a,'thumb lg')
      +'<div class="grow"><div class="row"><div class="row-title grow">'+E(a.title)+'</div>'+(aired?'<span class="tag">Aired</span>':'<span class="tag accent">'+E(fmtCountdown(it.next-now))+'</span>')+'</div>'
      +'<div class="row wrap" style="margin:6px 0">'+(a.mean?'<span class="tag star">★ '+Number(a.mean).toFixed(2)+'</span>':'')+(genres?'<span class="muted" style="font-size:12px">'+E(genres)+'</span>':'')+schedTags(it)+'</div>'
      +(syn?'<div class="tl-syn clamp-2">'+E(syn)+'</div>':'')
      +'<div class="row" style="margin-top:10px"><button class="btn btn-secondary btn-sm"'+A('openExploreDetail',a.id)+'>'+ic('info')+'Details</button>'
      +'<button class="btn btn-ghost btn-sm"'+A('openNyaa',a.title)+'>'+ic('search')+'Nyaa</button>'
      +(it.lib&&!isManga()?'<button class="btn btn-ghost btn-sm"'+A('schedTrack',it.lib.name,a.id)+'>'+ic('download')+(it.tracked?'Tracking':'Track')+'</button>':'')+'</div></div></div></div>';
  });
  if(b.today&&!placedNow)h+='<div class="tl-now"><span>Now</span></div>';
  return h+'</div>';
}
function schedCtx(el,ev,id,title){
  var a=((S._schedDataCache[S.schedSource||'watching'])||[]).find(function(x){return x.id===id;});var lib=a?findSchedLibMatch(a):null;
  var items=[{label:'View details',icon:'info',run:function(){openExploreDetail(id);}},{label:'Browse on Nyaa',icon:'search',run:function(){api.openExternal(buildNyaaUrl(title));}}];
  if(lib)items.push({label:'Open local series',icon:'folder',run:function(){odtl(lib.name);}});
  if(lib&&!isManga())items.push({label:isSchedAutoDlTracked(a)?'Stop auto-download':'Track new episodes',icon:'download',run:function(){toggleAutoDownloadTrack(lib.name,id).then(function(){renderSchedule();});}});
  items.push({label:'Open on MyAnimeList',icon:'external',run:function(){api.openExternal('https://myanimelist.net/anime/'+id);}});
  openMenu(ev,items);
}
ACT.schedCtx=function(el,ev,id,title){schedCtx(el,ev,id,title);};
act('schedTrack',function(el,ev,name,id){return toggleAutoDownloadTrack(name,id).then(function(){renderSchedule();});});
act('setAgendaDay',function(el,ev,i){S.schedAgendaDay=i;renderSchedule();});
function setSchedView(v){S.schedView=v;api.setConfig('schedView',v);renderSchedule();}
function setSchedSource(src){S.schedSource=src;if(S._schedDataCache[src])renderSchedule();else loadSchedule(true);}
function clearSchedSearch(){S.schedQ='';renderSchedule();}
act('schedSearch',function(el){S.schedQ=el.value;var pos=el.selectionStart;schedSearchRender(pos);});
var schedSearchRender=debounce(function(pos){renderSchedule();var i=document.getElementById('schedSearchInput');if(i){i.focus();try{i.setSelectionRange(pos,pos);}catch(e){}}},180);
expose('setSchedView','setSchedSource','clearSchedSearch');
function quickNyaaSearch(title){if(title)api.openExternal(buildNyaaUrl(title));}

// Live countdowns while the schedule is visible.
function startSchedTick(on){
  clearInterval(_schedTick);_schedTick=null;
  if(!on)return;
  _schedTick=setInterval(function(){
    if(S.view!=='schedule'||document.hidden){if(S.view!=='schedule'){clearInterval(_schedTick);_schedTick=null;}return;}
    var now=Date.now();
    document.querySelectorAll('[data-countdown]').forEach(function(el){var t=+el.getAttribute('data-countdown');var ms=t-now;el.innerHTML=(ms<=0?'<span class="live-dot"></span>':'')+E(fmtCountdown(ms));});
  },30000);
}
