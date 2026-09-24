/* AnimeVault renderer — Library Hub: Import review, Activity, Downloads. */

if(S._impSel==null)S._impSel=0;
S._impDest=S._impDest||{};

// ------------------------------------------------------------ import review --
function impMatchCover(item){var m=selectedPendingMalMatch(item)||(item.malMatches&&item.malMatches[0]);return m&&m.main_picture?(m.main_picture.medium||m.main_picture.large):'';}
function impState(item){
  if(item.malLoading)return {cls:'',label:'Searching…',icon:'refresh'};
  if(item.selectedMalId)return {cls:'green',label:'Match picked',icon:'check'};
  if(item.malError)return {cls:'red',label:'Search failed',icon:'alert'};
  if(S.mal&&item.malMatches&&!item.malMatches.length)return {cls:'yellow',label:'No matches',icon:'alert'};
  return {cls:'yellow',label:S.mal?'Needs a match':'Ready to place',icon:S.mal?'link':'folder'};
}
function importDestinations(item){
  var folders=isManga()?(S.cfg.mangaFolders||[]):(S.cfg.folders||[]);
  if(item.fromLibrary){var seen={};return folders.filter(function(f){var k=f.type||f.label;if(seen[k])return false;seen[k]=1;return true;}).map(function(f){return {key:f.type||f.label||'custom',label:f.label||f.type,value:f.type||f.label||'custom'};});}
  return folders.map(function(f){return {key:f.path,label:f.label||f.type,value:f.path,sub:f.path};});
}
function renderImporter(inline){
  var list=S.pendingNewSeries||[];
  if(!list.length)return emptyState('inbox','You’re all caught up','New downloads and unlinked library folders will appear here for a quick review.',inline?'':'<button class="btn btn-primary" data-modal-close>Close</button>');
  if(S._impSel>=list.length)S._impSel=0;
  var h='<div class="importer'+(inline?' inline':'')+'"><div class="imp-list">';
  list.forEach(function(item,i){
    var cov=impMatchCover(item);var st=impState(item);
    h+='<button class="imp-item'+(i===S._impSel?' active':'')+'"'+A('impSelect',i)+'>'+(cov?'<img class="thumb" src="'+E(cov)+'" alt="" loading="lazy">':'<span class="thumb ph">'+ic(VM('film','book'))+'</span>')
      +'<span class="grow"><span class="row-title ellipsis">'+E(item.series)+'</span><span class="row-sub"><span class="tag '+st.cls+'">'+ic(st.icon)+E(st.label)+'</span></span></span></button>';
  });
  h+='</div><div class="imp-detail" id="impDetail">'+renderImportDetail(S._impSel)+'</div></div>';
  return h;
}
function renderImportDetail(idx){
  var item=(S.pendingNewSeries||[])[idx];if(!item)return '';
  var files=item.files||[];var first=files[0]||{};
  var h='<div class="imp-head"><div class="grow"><div class="eyebrow">'+(item.fromLibrary?'Library folder':'New download')+'</div><div class="imp-title">'+E(item.series)+'</div>'
    +'<div class="row wrap" style="margin-top:6px"><span class="tag">'+ic('folder')+(first.fileCount||files.length)+' '+(first.isFolder?'files':'file'+(files.length>1?'s':''))+'</span>'
    +(item.sourceFolder?'<span class="tag">From '+E(item.sourceFolder)+'</span>':'')+(item.addedAt?'<span class="tag">'+E(timeAgo(item.addedAt))+'</span>':'')+'</div>'
    +(first.name?'<div class="mono imp-file ellipsis"'+Tip(first.name)+'>'+E(first.name)+'</div>':'')+'</div></div>';
  // MAL match
  h+='<div class="imp-sec"><div class="imp-sec-head"><span class="imp-sec-title">'+ic('layers')+'MyAnimeList match</span>';
  if(S.mal)h+='<span class="spacer"></span><button class="btn btn-ghost btn-xs"'+A('refreshPendingMalMatches',idx)+'>'+ic('refresh')+'Search again</button>';
  h+='</div>';
  if(!S.mal){h+='<div class="callout">'+ic('info')+'<span>Connect MyAnimeList to link titles while importing. You can still place files now.</span><button class="btn btn-secondary btn-sm"'+A('go','mal')+'>Connect</button></div>';}
  else if(item.malLoading){h+='<div class="match-grid">'+[0,1,2].map(function(){return '<div class="skeleton" style="height:96px;border-radius:14px"></div>';}).join('')+'</div>';}
  else if(item.malError){h+='<div class="callout red">'+ic('alert')+'<span>'+E(item.malError)+'</span></div>';}
  else if(item.malMatches&&item.malMatches.length){
    h+='<div class="match-grid">';
    item.malMatches.forEach(function(n){
      var img=n.main_picture?(n.main_picture.medium||n.main_picture.large):'';var on=String(item.selectedMalId||'')===String(n.id);
      var conf=titleMatchConfidence(aliasFor(item.series,'mal'),n.title);
      h+='<button class="match-card'+(on?' selected':'')+'"'+A('selectPendingMalMatch',idx,on?null:n.id)+'>'+(img?'<img class="thumb lg" src="'+E(img)+'" alt="" loading="lazy">':'<span class="thumb lg"></span>')
        +'<span class="grow"><span class="row-title clamp-2">'+E(n.title)+'</span><span class="row-sub">'+E(pendingMalMeta(n))+'</span>'+confMeter(conf)+'</span><span class="match-check">'+ic('check')+'</span></button>';
    });
    h+='</div>';
    if(item.selectedMalId&&S.cfg.importAutoMatch!==false)h+='<div class="field-hint" style="margin-top:8px">'+ic('sparkles')+' Best match pre-selected — confirm it or pick another.</div>';
  }else h+='<div class="callout">'+ic('search')+'<span>No matches found. Paste the MAL ID below or import without a link.</span></div>';
  if(S.mal)h+='<div class="input-row imp-id"><input class="input sm" id="pendingMalId_'+idx+'" placeholder="MAL ID, e.g. #61126"'+On('enter','lookupPendingMalId',idx)+'><button class="btn btn-secondary btn-sm"'+A('lookupPendingMalId',idx)+'>Use ID</button>'
    +(item.selectedMalId?'<button class="btn btn-ghost btn-sm"'+A('selectPendingMalMatch',idx,null)+'>Don’t link</button>':'')+'</div>';
  h+='</div>';
  // Destination
  var dests=importDestinations(item);
  h+='<div class="imp-sec"><div class="imp-sec-head"><span class="imp-sec-title">'+ic('folder')+(item.fromLibrary?'Category':'Place in')+'</span></div>';
  if(!dests.length)h+='<div class="callout yellow">'+ic('alert')+'<span>No library folders configured yet.</span><button class="btn btn-secondary btn-sm"'+A('go','settings')+'>Add folders</button></div>';
  else{
    var cur=S._impDest[item.series];if(!dests.some(function(d){return d.value===cur;}))cur=item.fromLibrary?(dests.find(function(d){return d.value===item.category;})||dests[0]).value:dests[0].value;
    S._impDest[item.series]=cur;
    h+='<div class="dest-grid">';
    dests.forEach(function(d){h+='<button class="dest'+(d.value===cur?' selected':'')+'"'+A('impSetDest',item.series,d.value)+'>'+ic('folder')+'<span class="grow"><span class="row-title cap">'+E(d.label)+'</span>'+(d.sub?'<span class="row-sub mono ellipsis">'+E(d.sub)+'</span>':'')+'</span><span class="match-check">'+ic('check')+'</span></button>';});
    h+='</div>';
  }
  h+='</div>';
  if(!isManga())h+='<div class="imp-sec"><div class="lg-row" style="padding:0;min-height:0"><div class="lg-main"><div class="lg-title">Track new episodes</div><div class="lg-desc">Adds this series to Auto-Download. Tracking is only ever enabled by choices like this.</div></div>'+switchCtl(!!item.autoTrack,'setPendingAutoTrack',[idx])+'</div></div>';
  var sel=selectedPendingMalMatch(item);var destLabel=(dests.find(function(d){return d.value===S._impDest[item.series];})||{}).label||'';
  h+='<div class="imp-foot"><button class="btn btn-ghost"'+A('dismissNewSeries',idx)+'>Skip</button><span class="spacer"></span>'
    +'<button class="btn btn-primary btn-lg"'+(dests.length?'':' disabled')+A('impConfirm',idx)+'>'+ic(sel?'link':'check')+(item.fromLibrary?(sel?'Save & link':'Save'):(sel?'Place & link':'Place'))+(destLabel?' · <span class="cap">'+E(destLabel)+'</span>':'')+'</button></div>';
  return h;
}
act('impSelect',function(el,ev,i){S._impSel=i;refreshImportUI();});
act('impSetDest',function(el,ev,series,v){S._impDest[series]=v;refreshImportUI();});
act('impConfirm',function(el,ev,idx){
  var item=S.pendingNewSeries[idx];if(!item)return;var dest=S._impDest[item.series];
  var sel=selectedPendingMalMatch(item);
  el.disabled=true;el.innerHTML='<span class="spinner"></span>Working…';
  return item.fromLibrary?finalizeImportedSeries(idx,dest,sel?sel.id:null):placeNewSeries(idx,dest,sel?sel.id:null);
});
act('selectPendingMalMatch',function(el,ev,idx,id){selectPendingMalMatch(idx,id);});
act('refreshPendingMalMatches',function(el,ev,idx){refreshPendingMalMatches(idx);});
act('lookupPendingMalId',function(el,ev,idx){return lookupPendingMalId(idx);});
act('setPendingAutoTrack',function(el,ev,idx){setPendingAutoTrack(idx,el.checked);});
act('dismissNewSeries',function(el,ev,idx){dismissNewSeries(idx);});

function openImportReviewer(){
  hideImportNotice();
  if(!(S.pendingNewSeries||[]).length){toast('Import inbox is empty','i');return;}
  openModal({id:'importReviewer',title:'Review imports',sub:plural(S.pendingNewSeries.length,'title waits','titles wait')+' for a destination'+(S.mal?' and MyAnimeList match':''),icon:'inbox',width:1040,className:'flush-body',
    body:renderImporter(false)});
  queuePendingMalMatches();
}
expose('openImportReviewer');
function refreshImportUI(){
  var m=document.getElementById('importReviewer');
  if(m){if(!(S.pendingNewSeries||[]).length){m._modal.close();}else{var b=m.querySelector('.modal-body');var sc=b.querySelector('.imp-list');var st=sc?sc.scrollTop:0;b.innerHTML=renderImporter(false);var sc2=b.querySelector('.imp-list');if(sc2)sc2.scrollTop=st;var sub=m.querySelector('.modal-sub');if(sub)sub.textContent=plural(S.pendingNewSeries.length,'title waits','titles wait')+' for a destination'+(S.mal?' and MyAnimeList match':'');}}
  if(S.view==='hub'&&(S.hubTab||'inbox')==='inbox'){var host=document.getElementById('hubInbox');if(host){host.innerHTML=renderImporter(true);}else render();}
  updateNotice();updateNavBadges();
}
// Legacy hooks used by the data layer.
function refreshNewSeriesPlacementPopup(){refreshImportUI();}
function showNewSeriesPlacementPopup(){showImportNotice();}
function closeNewSeriesPlacementPopup(){closeModalById('importReviewer');}
function showPlacementToast(){showImportNotice();}

// Non-blocking "new series" notice (replaces the auto-opening modal).
var _noticeSnoozedAt=0;
function showImportNotice(force){
  var n=(S.pendingNewSeries||[]).length;if(!n){hideImportNotice();return;}
  if(!force&&_noticeSnoozedAt>=n)return;
  if(document.getElementById('importReviewer'))return;
  var el=document.getElementById('importNotice');
  if(!el){el=document.createElement('div');el.id='importNotice';el.className='notice';document.getElementById('tc').appendChild(el);
    el.addEventListener('click',function(e){var b=e.target.closest('[data-notice]');if(!b)return;var a=b.getAttribute('data-notice');if(a==='review')openImportReviewer();else{_noticeSnoozedAt=(S.pendingNewSeries||[]).length;hideImportNotice();}});}
  var covers=S.pendingNewSeries.map(impMatchCover).filter(Boolean).slice(0,3);
  el.innerHTML='<div class="notice-head">'+(covers.length?'<div class="notice-stack">'+covers.map(function(c){return '<img src="'+E(c)+'" alt="">';}).join('')+'</div>':'<div class="modal-icon">'+ic('inbox')+'</div>')
    +'<div class="grow"><div class="notice-title">'+plural(n,'new title','new titles')+' to review</div><div class="notice-text">'+E(S.pendingNewSeries.slice(0,2).map(function(i){return i.series;}).join(', ')+(n>2?' and '+(n-2)+' more':''))+'</div></div></div>'
    +'<div class="notice-actions"><button class="btn btn-ghost btn-sm" data-notice="later">Later</button><button class="btn btn-primary btn-sm" data-notice="review">'+ic('inbox')+'Review</button></div>';
}
function updateNotice(){if(document.getElementById('importNotice'))showImportNotice(true);}
function hideImportNotice(){var el=document.getElementById('importNotice');if(el){el.classList.add('leaving');setTimeout(function(){el.remove();},220);}}

// ---------------------------------------------------------------- Hub view --
function vHub(){
  var tab=S.hubTab||'inbox';
  var pending=(S.pendingNewSeries||[]).length;
  var acts=S.activities||[];var running=acts.filter(function(a){return a.status==='running';}).length;var errors=acts.filter(function(a){return a.status==='error';}).length;
  if(!S._downloadLog&&tab==='downloads')refreshDownloadLog();
  var dl=S._downloadLog||[];var tracked=(S._autoDownloadWatchlist||[]).length;
  var h='<div class="view">'+pageHead('Library Hub','Everything arriving in, and happening to, your library.');
  h+='<div class="hub-tabs">'
    +hubTab('inbox','inbox','Import inbox',pending?plural(pending,'title','titles')+' to review':'All caught up',pending,tab)
    +hubTab('activity','activity','Activity',running?running+' running':(errors?plural(errors,'error','errors'):'All quiet'),running,tab,errors&&!running?'red':'')
    +hubTab('downloads','download','Downloads',(isManga()?'':(tracked?plural(tracked,'tracked series','tracked series')+' · ':''))+plural(dl.length,'handoff','handoffs'),0,tab)
    +'</div>';
  if(tab==='inbox'){
    h+='<div class="hub-panel panel"><div class="panel-head"><div class="panel-title grow">Import inbox</div>'
      +(pending&&S.mal?'<button class="btn btn-ghost btn-sm"'+A('queuePendingMalMatchesForce')+'>'+ic('refresh')+'Refresh matches</button>':'')
      +'<button class="btn btn-ghost btn-sm"'+A('autoSyncAll')+Tip('Refresh linked MAL data and send unlinked series here')+'>'+ic('link')+'Find unlinked</button></div>'
      +'<div id="hubInbox">'+renderImporter(true)+'</div></div>';
  }else if(tab==='activity')h+=vActivity();
  else h+=vDownloadsInline();
  return h+'</div>';
}
function hubTab(v,icon,title,sub,badge,active,tone){
  return '<button class="hub-tab'+(active===v?' active':'')+'"'+A('setHubTab',v)+'><span class="hub-tab-ic">'+ic(icon)+(badge?'<span class="ni-badge">'+badge+'</span>':'')+'</span><span class="grow"><span class="hub-tab-title">'+E(title)+'</span><span class="hub-tab-sub'+(tone?' '+tone:'')+'">'+E(sub)+'</span></span></button>';
}
act('setHubTab',function(el,ev,v){S.hubTab=v;render();});
act('queuePendingMalMatchesForce',function(){queuePendingMalMatches(true);});
expose('autoSyncAll');

function vActivity(){
  var rows=S.activities||[];var f=S.actFilter||'all';
  var list=rows.filter(function(a){return f==='all'||(f==='running'&&a.status==='running')||(f==='error'&&a.status==='error');});
  var h='<div class="hub-panel panel"><div class="panel-head">'+seg('actFilter',[{v:'all',label:'All',count:rows.length},{v:'running',label:'Running',count:rows.filter(function(a){return a.status==='running';}).length},{v:'error',label:'Errors',count:rows.filter(function(a){return a.status==='error';}).length}],f,'setActFilter')
    +'<span class="spacer"></span><button class="btn btn-ghost btn-sm"'+A('clearFinishedActivities')+(rows.some(function(a){return a.status!=='running';})?'':' disabled')+'>'+ic('broom')+'Clear finished</button></div>';
  if(!list.length)return h+emptyState('activity',rows.length?'Nothing here':'No background activity yet','Scans, cover fetches, MAL syncs, imports and downloads are recorded here.','',true)+'</div>';
  h+='<div class="act-list">';
  var lastGroup='';
  list.forEach(function(a){
    var t=a.updatedAt||a.startedAt;var g=groupLabel(t);
    if(g!==lastGroup){h+='<div class="act-group">'+E(g)+'</div>';lastGroup=g;}
    var icon={scan:'refresh',covers:'image',sync:'layers',import:'inbox',download:'download',watcher:'eye',backup:'database',gap:'scan'}[a.kind]||'activity';
    h+='<div class="act-row '+E(a.status||'')+'"><span class="act-ic">'+(a.status==='running'?'<span class="spinner"></span>':ic(icon))+'</span>'
      +'<div class="grow"><div class="row-title">'+E(a.label)+'</div>'+(a.detail?'<div class="row-sub act-detail">'+E(a.detail)+'</div>':'')+'</div>'
      +'<div class="act-side"><span class="tag '+(a.status==='success'?'green':a.status==='error'?'red':'blue')+'">'+E(a.status==='success'?'Done':a.status==='error'?'Failed':'Running')+'</span><span class="muted act-time"'+Tip(formatActivityTime(t))+'>'+E(timeAgo(t))+'</span>'
      +(a.status==='error'?'<button class="btn btn-secondary btn-xs"'+A('retryActivity',a.id)+'>Retry</button>':'')+'</div></div>';
  });
  return h+'</div></div>';
}
function groupLabel(t){if(!t)return 'Earlier';var d=new Date(t),n=new Date();var a=new Date(n);a.setHours(0,0,0,0);if(d>=a)return 'Today';a.setDate(a.getDate()-1);if(d>=a)return 'Yesterday';return 'Earlier';}
function formatActivityTime(ts){if(!ts)return '';try{return new Date(ts).toLocaleString();}catch(e){return '';}}
act('setActFilter',function(el,ev,v){S.actFilter=v;render();});
expose('clearFinishedActivities','retryActivity');

async function refreshDownloadLog(){S._downloadLog=await api.downloadsGetHistory()||[];if(S.view==='hub'&&(S.hubTab||'inbox')==='downloads')render();}
function vDownloadsInline(){
  var log=S._downloadLog;var h='';
  if(!isManga()){
    var on=!!S.cfg.autoDownloadEnabled;var list=S._autoDownloadWatchlist||[];
    h+='<div class="hub-panel panel"><div class="panel-head"><div class="lg-icon" style="--ic:'+(on?'var(--green)':'var(--text-3)')+'">'+ic('download')+'</div><div class="grow"><div class="panel-title">Auto-download</div><div class="panel-sub">'+(on?'Checking Nyaa every '+(S.cfg.autoDownloadPollMinutes||30)+' minutes for '+plural(list.length,'tracked series','tracked series'):'Off — new episodes are not checked automatically')+'</div></div>'
      +switchCtl(on,'toggleAutoDownloadGlobalSw')+'</div>'
      +'<div class="panel-pad row wrap"><button class="btn btn-secondary btn-sm"'+A('adPollNow',false)+'>'+ic('refresh')+'Check now</button><button class="btn btn-ghost btn-sm"'+A('adPollNow',true)+Tip('Ignore the 1-hour duplicate window')+'>Force check</button><button class="btn btn-ghost btn-sm"'+A('catchupAllPendingEpisodes')+'>'+ic('zap')+'Catch up everything</button><span class="spacer"></span><button class="btn btn-ghost btn-sm"'+A('goSettingsSection','downloads')+'>Settings'+ic('chevronRight')+'</button></div>';
    if(list.length){
      h+='<div class="tracked-list">';
      list.forEach(function(w){var s=S.lib.find(function(x){return x.name===w.seriesName;});var c=s?S.covers[s.name]:'';
        h+='<div class="tracked">'+(c?'<img class="thumb" src="'+E(c)+'" alt="" loading="lazy">':'<span class="thumb"></span>')+'<div class="grow"><div class="row-title ellipsis">'+E(w.seriesName)+'</div><div class="row-sub">Last '+epLabel()+' '+(w.lastDownloadedEp||0)+' · verified '+(w.verifiedLatest||'—')+((w.episodeOffset||0)?' · offset '+(w.episodeOffset>0?'+':'')+w.episodeOffset:'')+'</div></div>'
          +'<button class="icon-btn sm"'+A('catchupSingleSeries',w.seriesName,w.malId||0)+Tip('Catch up missing episodes')+'>'+ic('zap')+'</button>'
          +'<button class="icon-btn sm"'+A('setEpisodeOffsetPrompt',w.seriesName,w.episodeOffset||0)+Tip('Numbering correction')+'>'+ic('hash')+'</button>'
          +'<button class="icon-btn sm danger"'+A('removeAutoDownloadTrack',w.seriesName)+Tip('Stop tracking')+'>'+ic('x')+'</button></div>';});
      h+='</div>';
    }
    h+='</div>';
  }
  h+='<div class="hub-panel panel"><div class="panel-head"><div class="panel-title grow">Handoff history</div>'+(log&&log.length?'<button class="btn btn-ghost btn-sm"'+A('clearDownloadHistory')+'>'+ic('trash')+'Clear</button>':'')+'</div>';
  if(!log)return h+loadingBlock()+'</div>';
  if(!log.length)return h+emptyState('download','No downloads yet','Torrents handed to your client appear here — retry any search or open it on Nyaa.','',true)+'</div>';
  h+='<div class="dl-list">';
  log.forEach(function(e,i){
    var mode=e.dlMode==='ep'?epLabel()+' '+e.episode:(e.dlMode==='batch'?'Batch':'Full series');
    h+='<div class="dl-row"><div class="dl-ic">'+ic(e.dlMode==='ep'?'download':'box')+'</div><div class="grow"><div class="row"><span class="row-title ellipsis">'+E(e.series)+'</span><span class="tag">'+E(mode)+'</span></div>'
      +'<div class="mono dl-release ellipsis"'+Tip(e.chosenTitle||'')+'>'+E(e.chosenTitle||'')+'</div>'
      +'<div class="row-sub">'+E(timeAgo(e.timestamp))+' · <span class="green-txt">'+(e.seeders||0)+' seeds</span>'+(e.size?' · '+E(e.size):'')+(e.method?' · via '+E(e.method):'')+'</div></div>'
      +'<button class="btn btn-secondary btn-xs"'+A('dlRetry',i)+'>'+ic('refresh')+'Retry</button><button class="icon-btn sm"'+A('dlBrowse',i)+Tip('Open on Nyaa')+'>'+ic('external')+'</button></div>';
  });
  return h+'</div></div>';
}
act('toggleAutoDownloadGlobalSw',function(el){return toggleAutoDownloadGlobal(el.checked);});
act('goSettingsSection',function(el,ev,sec){S.setSection=sec;S._scrollToSec=true;go('settings');});
act('dlRetry',function(el,ev,i){
  var e=(S._downloadLog||[])[i];if(!e)return;var quality=S.cfg.nyaaQuality||'1080p';var up=e.preferredUploader||S.cfg.nyaaUploader||'erai';
  toast('Retrying '+e.series+'…','i');
  return api.nyaaAutoDownload(e.series,quality,up,e.episode,e.dlMode).then(function(r){if(r.error)toast('Retry failed: '+r.error,'e');else{toast('Opened: '+r.chosen.title,'s');refreshDownloadLog();}});
});
act('dlBrowse',function(el,ev,i){var e=(S._downloadLog||[])[i];if(e)api.openExternal(buildNyaaUrl(e.series,e.episode||null));});
act('clearDownloadHistory',async function(){if(!await askConfirm({title:'Clear download history?',text:'The log of handed-off torrents is removed. Your files are not affected.',confirm:'Clear',danger:true}))return;await api.downloadsClearHistory();S._downloadLog=[];render();});
act('adPollNow',function(el,ev,force){
  toast(force?'Force-checking Nyaa (ignoring duplicates)…':'Checking Nyaa for new episodes…','i');
  return api.autoDownloadPollNow(!!force).then(function(res){
    var r=res&&res.results;
    if(r&&r.disabled){toast('Auto-download is off. Turn it on first.','i');return;}
    if(!r||!r.polled){toast('Nothing to check — no series are tracked','i');return;}
    var msgs=[];if(r.downloaded&&r.downloaded.length)msgs.push(r.downloaded.length+' handed off');if(r.skipped_local&&r.skipped_local.length)msgs.push(r.skipped_local.length+' up to date');if(r.dedup&&r.dedup.length)msgs.push(r.dedup.length+' recent duplicates');if(r.no_results&&r.no_results.length)msgs.push(r.no_results.length+' no results');if(r.no_exact_match&&r.no_exact_match.length)msgs.push(r.no_exact_match.length+' no exact match');if(r.error&&r.error.length)msgs.push(r.error.length+' errors');
    toast(msgs.length?'Check complete: '+msgs.join(', '):'Check complete — nothing new','s');
    refreshDownloadLog();
  });
});
expose('catchupAllPendingEpisodes','removeAutoDownloadTrack');
function openDownloadHistory(){S.hubTab='downloads';go('hub');}
function openActivityCenter(){S.hubTab='activity';go('hub');}
act('openActivityCenter',function(){openActivityCenter();});
