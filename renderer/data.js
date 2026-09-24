/* AnimeVault renderer — data & sync layer (ported from 4.x; UI hooks rewired to the new components). */
var _persistInboxTimer=null,_activitySaveTimer=null,_pendingMalQueueRunning=false,_coverRenderTimer=null,_lastCoverRenderAt=0,_malBackfillTimer=null,_startupMaintenanceTimer=null;


function persistImportInbox(){
  clearTimeout(_persistInboxTimer);
  _persistInboxTimer=setTimeout(function(){
    var key=importInboxKey();var rows=(S.pendingNewSeries||[]).map(pendingForStorage);
    S.cfg[key]=rows;api.setConfig(key,rows);
  },80);
}
function restoreImportInbox(){
  var rows=S.cfg[importInboxKey()];
  S.pendingNewSeries=Array.isArray(rows)?rows.filter(function(x){return x&&x.series;}).map(function(x){x.files=Array.isArray(x.files)?x.files:[];x.malLoading=false;x.malError='';return x;}):[];
}
function persistActivities(){
  clearTimeout(_activitySaveTimer);
  _activitySaveTimer=setTimeout(function(){S.cfg.activityLog=(S.activities||[]).slice(0,100);api.setConfig('activityLog',S.cfg.activityLog);},120);
}
function activityStart(kind,label,detail){
  var a={id:'a'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),kind:kind||'task',label:label||'Background task',detail:detail||'',status:'running',mode:S.vaultMode,startedAt:Date.now(),updatedAt:Date.now()};
  S.activities.unshift(a);S.activities=S.activities.slice(0,100);persistActivities();if(S.view==='hub'&&(S.hubTab||'inbox')==='activity')render();return a.id;
}
function activityUpdate(id,detail){var a=(S.activities||[]).find(function(x){return x.id===id});if(!a)return;if(detail!==undefined)a.detail=detail;a.updatedAt=Date.now();persistActivities();if(S.view==='hub'&&(S.hubTab||'inbox')==='activity')render();}
function activityFinish(id,status,detail){var a=(S.activities||[]).find(function(x){return x.id===id});if(!a)return;a.status=status||'success';if(detail!==undefined)a.detail=detail;a.updatedAt=Date.now();a.finishedAt=Date.now();persistActivities();if(S.view==='hub'&&(S.hubTab||'inbox')==='activity')render();}
function activityRecord(kind,label,status,detail){var id=activityStart(kind,label,detail);activityFinish(id,status,detail);return id;}

function clearFinishedActivities(){S.activities=(S.activities||[]).filter(function(a){return a.status==='running'});persistActivities();render();}
function retryActivity(id){
  var a=(S.activities||[]).find(function(x){return x.id===id});if(!a)return;
  if(a.kind==='scan'){loadLib(false,true);return;}if(a.kind==='covers'){fetchAll();return;}if(a.kind==='sync'){refreshLinkedMalData();return;}
  if(a.kind==='import'){S.hubTab='inbox';go('hub');return;}toast('This activity cannot be retried automatically','i');
}
async function rebuildLibraryIndex(){
  var id=activityStart('scan','Rebuild library index','Clearing cached file fingerprints');
  await api.clearLibraryScanCache();await loadLib(true,true);activityFinish(id,'success','Library index rebuilt');toast('Library index rebuilt','s');
}
async function setCoverFromPath(name,path,deferRender){
  if(!name||!path)return false;
  // cover:// streams from disk; a unique URL string busts the image cache.
  S.covers[name]='cover://'+encodeURIComponent(path)+'#'+Date.now();
  if(S.cur&&S.cur.name===name){
    var s=S.lib.find(function(x){return x.name===name});
    if(s)S.cur=s;
  }
  if(!deferRender){render();if(S.cur&&S.cur.name===name)odtl(name);}
  return true;
}
async function loadPendingMalMatchesForItem(item,force){
  if(!S.mal||!item||!item.series)return;
  if(item.malLoading||(!force&&item.malMatches))return;
  item.malLoading=true;item.malError='';
  refreshNewSeriesPlacementPopup();
  if(S.view==='filemgmt'||S.view==='inbox'||S.view==='hub')render();
  try{
    var r=await api.malSearch(aliasFor(item.series,'mal'));
    if(!S.pendingNewSeries||S.pendingNewSeries.indexOf(item)<0)return;
    if(r&&r.error){item.malError=r.error;item.malMatches=[];}
    else{
      item.malMatches=normalizeMalSearchResults(r).slice(0,5);
      if(item.malMatches.length&&S.cfg.importAutoMatch!==false&&!item.selectedMalId){
        // Auto-select the best match when auto-matching is enabled; the user
        // still confirms placement manually on the card.
        var best=item.malMatches[0];
        var confidence=titleMatchConfidence(aliasFor(item.series,'mal'),best.title);
        if(confidence>=45)item.selectedMalId=best.id;
      }
    }
  }catch(e){
    if(S.pendingNewSeries&&S.pendingNewSeries.indexOf(item)>=0){item.malError=e.message||String(e);item.malMatches=[];}
  }finally{
    if(S.pendingNewSeries&&S.pendingNewSeries.indexOf(item)>=0){item.malLoading=false;persistImportInbox();refreshNewSeriesPlacementPopup();if(S.view==='filemgmt'||S.view==='inbox'||S.view==='hub')render();}
  }
}
async function queuePendingMalMatches(force){
  if(!S.mal||!S.pendingNewSeries||_pendingMalQueueRunning)return;
  var items=S.pendingNewSeries.filter(function(item){return item&&!item.malLoading&&(force||!Array.isArray(item.malMatches));});
  if(!items.length)return;
  _pendingMalQueueRunning=true;
  try{
    for(var i=0;i<items.length;i++){
      if(!S.pendingNewSeries||S.pendingNewSeries.indexOf(items[i])<0)continue;
      await loadPendingMalMatchesForItem(items[i],!!force);
      if(i<items.length-1)await new Promise(function(resolve){setTimeout(resolve,150);});
    }
  }finally{
    _pendingMalQueueRunning=false;
    if(S.pendingNewSeries&&S.pendingNewSeries.some(function(item){return item&&!item.malLoading&&!Array.isArray(item.malMatches);}))setTimeout(function(){queuePendingMalMatches(false);},250);
  }
}
function selectPendingMalMatch(idx,malId){
  var item=S.pendingNewSeries&&S.pendingNewSeries[idx];
  if(!item)return;
  item.selectedMalId=malId||null;
  persistImportInbox();
  refreshNewSeriesPlacementPopup();
  if(S.view==='filemgmt'||S.view==='inbox'||S.view==='hub')render();
}
function refreshPendingMalMatches(idx){
  var item=S.pendingNewSeries&&S.pendingNewSeries[idx];
  if(item)loadPendingMalMatchesForItem(item,true);
}
function setPendingAutoTrack(idx,enabled){var item=S.pendingNewSeries&&S.pendingNewSeries[idx];if(!item)return;item.autoTrack=!!enabled;persistImportInbox();}
function addPendingNewSeriesItem(item){
  if(!item||!item.series)return false;
  if(!S.pendingNewSeries)S.pendingNewSeries=[];
  var key=pendingSeriesKey(item);
  var existing=S.pendingNewSeries.find(function(p){return pendingSeriesKey(p)===key;});
  if(existing){
    if(item.files&&item.files.length)existing.files=item.files;
    if(item.fromLibrary)existing.fromLibrary=true;
    persistImportInbox();
    return false;
  }
  item.addedAt=item.addedAt||Date.now();
  S.pendingNewSeries.push(item);
  persistImportInbox();
  return true;
}
function removePendingSeries(name){var before=(S.pendingNewSeries||[]).length;S.pendingNewSeries=(S.pendingNewSeries||[]).filter(function(item){return item.series!==name;});if(S.pendingNewSeries.length!==before)persistImportInbox();}
async function lookupPendingMalId(idx){
  var item=S.pendingNewSeries&&S.pendingNewSeries[idx];
  if(!item)return;
  var inp=document.getElementById('pendingMalId_'+idx);
  var raw=inp?inp.value.trim():'';
  var m=raw.match(/^#?\s*(\d+)$/);
  if(!m){toast('Enter a MAL ID like #61126','e');return;}
  var malId=parseInt(m[1],10);
  item.malLoading=true;item.malError='';
  refreshNewSeriesPlacementPopup();
  if(S.view==='filemgmt'||S.view==='inbox'||S.view==='hub')render();
  try{
    var details=await api.malGetAnimeDetails(malId);
    if(!details||details.error){item.malError='MAL entry not found for #'+malId;return;}
    var list=item.malMatches||[];
    list=list.filter(function(n){return String(n.id)!==String(malId);});
    item.malMatches=[details].concat(list).slice(0,5);
    item.selectedMalId=malId;
  }catch(e){
    item.malError=e.message||String(e);
  }finally{
    item.malLoading=false;persistImportInbox();
    refreshNewSeriesPlacementPopup();
    if(S.view==='filemgmt')render();
  }
}
function _scheduleCoverRender(){
  if(_coverRenderTimer)return;
  var wait=Math.max(0,1000-(Date.now()-_lastCoverRenderAt));
  _coverRenderTimer=setTimeout(function(){
    _coverRenderTimer=null;_lastCoverRenderAt=Date.now();
    if(S.view==='library'||S.view==='continue'||S.view==='completed')render();
  },wait);
}
function fetchMissingLibraryCovers(){
  var missing=S.lib.filter(function(s){return !s.name.startsWith('__unsorted')&&!S.covers[s.name]});
  if(!missing.length)return;
  var coverActivity=activityStart('covers','Fetch missing covers',missing.length+' title'+(missing.length===1?'':'s'));
  api.anilistFetchAllCovers(missing.map(function(s){return {name:s.name}})).then(function(results){
    var withPath=results.filter(function(x){return x.path});
    if(!withPath.length){activityFinish(coverActivity,'success','No new covers were available');return;}
    var fetched=0;
    withPath.forEach(function(r){
      S.covers[r.name]='cover://'+encodeURIComponent(r.path);
      fetched++;
      if(fetched===withPath.length){activityFinish(coverActivity,'success','Fetched '+withPath.length+' cover'+(withPath.length===1?'':'s'));render();}
      else _scheduleCoverRender();
    });
  }).catch(function(e){activityFinish(coverActivity,'error',e.message||String(e));});
}
async function loadLib(skipAutoSync,forceScan){
  var activityId=activityStart('scan','Scan '+VM('anime','manga')+' library',forceScan?'Rebuilding the library index':'Checking configured folders');
  S.loading=true;render();
  try{
    S.lib=await api.scanLibrary(!!forceScan);
    var linkedNames={};S.lib.forEach(function(s){if(s.watchData&&s.watchData.malId)linkedNames[s.name]=true;});
    S.pendingNewSeries=(S.pendingNewSeries||[]).filter(function(item){return !linkedNames[item.series];});
    // Covers stream from disk via the cover:// protocol: no per-cover IPC and
    // no base64 copies retained in the JS heap.
    S.lib.forEach(function(s){var cp=s.coverLocal||s.coverCached;if(cp)S.covers[s.name]='cover://'+encodeURIComponent(cp);});
    var scannedNames=S.lib.filter(function(s){return !s.name.startsWith('__unsorted')}).map(function(s){return s.name;});
    if(S.mal){
      var addedPrompt=false;
      S.lib.forEach(function(s){
        if(s.name.startsWith('__unsorted'))return;
        if(s.watchData&&s.watchData.malId)return;
        if(isImportReviewDismissed(s.name))return;
        var first=s.episodes&&s.episodes[0]?s.episodes[0]:{};
        var item={
          series:s.name,
          fromLibrary:true,
          category:s.category||'custom',
          files:[{name:first.name||s.name,newName:s.name,originalPath:s.path,isFolder:true,fileCount:s.episodeCount||0}]
        };
        if(addPendingNewSeriesItem(item))addedPrompt=true;
      });
      if(S.pendingNewSeries.length&&!skipAutoSync){queuePendingMalMatches();setTimeout(function(){showNewSeriesPlacementPopup();},0);}
    }
    else if(S.pendingNewSeries.length&&!skipAutoSync){setTimeout(function(){showNewSeriesPlacementPopup();},0);}
    S.cfg[knownSeriesKey()]=scannedNames;
    api.setConfig(knownSeriesKey(),scannedNames);
    // Auto-fetch missing covers in background
    var missing=S.lib.filter(function(s){return !s.name.startsWith('__unsorted')&&!S.covers[s.name]});
    if(missing.length>0&&!skipAutoSync)fetchMissingLibraryCovers();
    var scanStats=await api.getLibraryScanStats();
    activityFinish(activityId,'success',S.lib.length+' series · '+(scanStats.cacheHits||0)+' cached · '+(scanStats.durationMs||0)+' ms');
    persistImportInbox();
  }catch(e){activityFinish(activityId,'error',e.message||String(e));if(notifEnabled('rescan'))toast('Scan failed','e',{label:'Retry',onClick:function(){loadLib()}});}
  S.loading=false;render();
}
async function autoSyncAll(){
  var unlinked=S.lib.filter(function(s){return !s.name.startsWith('__unsorted')&&!(s.watchData&&s.watchData.malId)&&!isImportReviewDismissed(s.name)});
  unlinked.forEach(function(s){var first=s.episodes&&s.episodes[0]||{};addPendingNewSeriesItem({series:s.name,fromLibrary:true,category:s.category||'custom',files:[{name:first.name||s.name,newName:s.name,originalPath:s.path,isFolder:true,fileCount:s.episodeCount||0}]});});
  if(unlinked.length){queuePendingMalMatches();toast(unlinked.length+' unlinked series added to the Import Inbox','i',{label:'Review',onClick:function(){S.hubTab='inbox';go('hub')}});}
  await refreshLinkedMalData();
}
async function refreshLinkedMalData(){
  var linked=S.lib.filter(function(s){return !s.name.startsWith('__unsorted')&&s.watchData&&s.watchData.malId});
  var activityId=activityStart('sync','Refresh linked MAL data',linked.length+' linked series');
  if(linked.length){
    if(notifEnabled('malSync'))toast('Refreshing MAL data for '+linked.length+' series...','i');
    var refreshed=0;
    for(var i=0;i<linked.length;i++){
      try{await fetchMDQuiet(linked[i].name,linked[i].watchData.malId);refreshed++;activityUpdate(activityId,(i+1)+' / '+linked.length+' refreshed');}catch(e){console.error('[Bulk refresh]',e.message);}
      if(i<linked.length-1)await new Promise(function(resolve){setTimeout(resolve,350)});
    }
    // fetchMDQuiet already patched each series locally; no rescan needed.
    if(refreshed>0&&notifEnabled('malSync'))toast('Refreshed '+refreshed+' series from MAL','s');
    activityFinish(activityId,'success','Refreshed '+refreshed+' of '+linked.length+' linked series');
  }else{
    activityFinish(activityId,'success','No linked series to refresh');
  }
  render();
}
function scheduleMalBackfill(delay){
  clearTimeout(_malBackfillTimer);
  _malBackfillTimer=setTimeout(function(){runMalBackfill();},delay||1500);
}
function scheduleStartupLibraryMaintenance(){
  clearTimeout(_startupMaintenanceTimer);
  _startupMaintenanceTimer=setTimeout(function(){
    var run=function(){
      queuePendingMalMatches(false);
      fetchMissingLibraryCovers();
      scheduleMalBackfill(500);
    };
    if(typeof requestIdleCallback==='function')requestIdleCallback(run,{timeout:4000});
    else setTimeout(run,0);
  },6000);
}
async function runMalBackfill(){
  if(!S.mal||!S.lib||!S.lib.length)return;
  var candidates=S.lib.filter(function(s){
    if(s.name.startsWith('__unsorted'))return false;
    var wd=s.watchData||{};
    if(!wd.malId)return false;
    return !malListStatusUsable(wd.malData&&wd.malData.my_list_status);
  });
  if(!candidates.length)return;
  var activityId=activityStart('sync','Restore missing MAL list status','Refreshing '+candidates.length+' linked series');
  try{
    var res=await api.malBackfillMissing(candidates.map(function(s){return s.name;}));
    if(res&&res.refreshed>0){
      S.lib=await api.scanLibrary();
      render();
      activityFinish(activityId,'success','Restored MAL status for '+res.refreshed+' series');
      if(notifEnabled('malSync'))toast('Restored MAL status for '+res.refreshed+' series','s');
    }else{
      activityFinish(activityId,'success','No missing MAL status data to restore');
    }
  }catch(e){
    activityFinish(activityId,'error',e.message||String(e));
  }
}
async function pEp(name,fpath,num){
  if(isManga()){
    // Manga mode: open with reader
    var r=await api.openMangaFile(fpath);
    if(r.error){toast(r.error,'e');return;}
    if(num!==null){
      // Show mark-as-read toast
      toast('Opened Ch '+num+'. Mark as read?','i');
      // Auto-mark chapter as read
      var s=S.lib.find(function(x){return x.name===name});
      var allNums=s?s.episodes.filter(function(e){return e.episodeNum!==null}).map(function(e){return e.episodeNum}).sort(function(a,b){return a-b}):[];
      var wd=await api.markUpTo(name,num,allNums);_patchLibWatchData(name,wd);
      toast('Marked Ch '+num+' as read','s');await autoSyncSeries(name);if(S.cur&&S.cur.name===name)odtl(name);
    }
    return;
  }
  var r=await api.play(fpath,name,num);if(r.error){toast(r.error,'e');return;}
  if(r.warning){toast(r.warning,'i');}
  if(num!==null){
    if(S.cfg.autoMarkEnabled===false){
      // Auto-mark disabled: mark immediately on play (old behavior)
      var s=S.lib.find(function(x){return x.name===name});
      var allEpNums=s?s.episodes.filter(function(e){return e.episodeNum!==null}).map(function(e){return e.episodeNum}).sort(function(a,b){return a-b}):[];
      var wd=await api.markUpTo(name,num,allEpNums);_patchLibWatchData(name,wd);
      toast('Playing Ep '+num,'s');await autoSyncSeries(name);if(S.cur&&S.cur.name===name)odtl(name);
    } else {
      // Auto-mark enabled: just show toast, the 80% poll will mark it
      toast('Playing Ep '+num+' (auto-marks at '+(S.cfg.autoMarkPercent||80)+'%)','s');
    }
  }}
async function pNxt(name){var s=S.lib.find(function(x){return x.name===name});if(!s)return;var n=nxtUn(s);
  if(n)await pEp(name,n.path,n.episodeNum);else if(s.episodes.length)await pEp(name,s.episodes[0].path,s.episodes[0].episodeNum);}
function _patchLibWatchData(name,wd){
  if(!wd)return;
  var s=S.lib.find(function(x){return x.name===name});
  if(s){s.watchData=s.watchData||{};s.watchData.episodesWatched=wd.episodesWatched||[];s.watchData.lastWatched=wd.lastWatched||null;s.watchData.malId=wd.malId||null;}
}
function _patchLibMal(name,fields){
  if(!fields)return;
  var s=S.lib.find(function(x){return x.name===name});
  if(!s)return;
  s.watchData=s.watchData||{};
  if('malId' in fields)s.watchData.malId=fields.malId;
  if('malData' in fields)s.watchData.malData=fields.malData;
}
async function tw(name,num,wasWatched){
  var s=S.lib.find(function(x){return x.name===name});if(!s)return;
  var allEpNums=s.episodes.filter(function(e){return e.episodeNum!==null}).map(function(e){return e.episodeNum}).sort(function(a,b){return a-b});
  if(!wasWatched){
    var wd=await api.markUpTo(name,num,allEpNums);_patchLibWatchData(name,wd);
  } else {
    var wd=await api.unmarkFrom(name,num);_patchLibWatchData(name,wd);
  }
  await autoSyncSeries(name, wasWatched ? num : null);
  if(S.cur&&S.cur.name===name)odtl(name);}
async function toggleAutoDownloadTrack(name,malId){
  if(malId===0)malId=null;
  var isTracked=S._autoDownloadWatchlist&&S._autoDownloadWatchlist.some(function(w){return w.seriesName===name});
  await setSeriesAutoTracking(name,malId,!isTracked);
  toast(isTracked?'Removed from auto-download':'Tracking: '+name,isTracked?'i':'s');
  S._autoDownloadWatchlist=await api.autoDownloadGetWatchlist();
  if(S.cur&&S.cur.name===name)odtl(name);
}
async function setSeriesAutoTracking(name,malId,enabled){
  if(!enabled){await api.autoDownloadRemoveSeries(name);return;}
  var s=S.lib.find(function(x){return x.name===name});
  var nums=s&&s.episodes?s.episodes.filter(function(e){return e.episodeNum!==null}).map(function(e){return e.episodeNum}):[];
  var localHighest=nums.length?Math.max.apply(null,nums):0;
  var md=s&&s.watchData?s.watchData.malData:null;
  var identityKey=String(malId||'')+'|'+String(s&&s.path||name);
  await api.autoDownloadAddSeries({seriesName:name,seriesPath:s&&s.path||'',searchTitle:aliasFor(name,'nyaa')||((md&&md.title)||name),malId:malId||null,airingStartDate:md&&md.start_date||'',lastLocalEp:localHighest,lastDownloadedEp:localHighest,trackingBaselineEp:localHighest,trackingIdentityKey:identityKey,totalEps:md?(md.num_episodes||0):0,estimatedLatest:md&&md.status==='currently_airing'?estimateAired(md.start_date,md.num_episodes||0):0,episodeOffset:0});
  S._autoDownloadWatchlist=await api.autoDownloadGetWatchlist();
}
async function removeAutoDownloadTrack(name){
  await api.autoDownloadRemoveSeries(name);
  S._autoDownloadWatchlist=await api.autoDownloadGetWatchlist();
  toast('Removed: '+name,'i');render();
}
async function toggleAutoDownloadGlobal(enabled){
  S.cfg.autoDownloadEnabled=enabled;
  await api.autoDownloadToggle(enabled);
  toast(enabled?'Auto-Download enabled':'Auto-Download disabled','i');
  render();
}
async function toggleMinimizeToTray(enabled){
  S.cfg.minimizeToTray=enabled;
  await api.setMinimizeToTray(enabled);
  toast(enabled?'Minimize to tray enabled':'Minimize to tray disabled','i');
}
async function autoSyncSeries(name, uncheckedEp){
  var s=S.lib.find(function(x){return x.name===name});if(!s)return;
  if(!S.mal)return;
  // Check if real-time sync is paused
  if(S.cfg.syncPaused){console.log('[Sync] Paused, skipping '+name);return;}
  var w=s.watchData;if(!w||!w.malId)return;
  var watched=w.episodesWatched||[];
  var highestEp=watched.length?Math.max.apply(null,watched):0;
  // If we just unchecked an episode and local list is empty or highest is below unchecked-1,
  // use uncheckedEp-1 as the true progress (episodes before our local files were already watched)
  if(uncheckedEp&&uncheckedEp>0){
    var trueProgress=uncheckedEp-1;
    if(trueProgress>highestEp)highestEp=trueProgress;
  }
  var totalEps=w.malData&&(w.malData.num_episodes||w.malData.num_chapters)?(w.malData.num_episodes||w.malData.num_chapters):0;
  // 3.2: Smart conflict detection. If MAL has MORE progress than local, don't
  // silently overwrite — ask the user. This protects progress made on another
  // device (mobile MAL app, web, another machine). Only triggers for real
  // regressions; identical values pass through silently.
  var mls=getMyListStatus(w.malData);
  var malHighest=mls?epWatchedField(mls):0;
  if(malHighest>highestEp&&malHighest>0){
    var resolution=await promptSyncConflict(name,highestEp,malHighest);
    if(resolution==='cancel')return;
    if(resolution==='mal'){
      // Adopt MAL's count locally — expand watched list to include 1..malHighest.
      var allEpNums=s.episodes.filter(function(e){return e.episodeNum!==null}).map(function(e){return e.episodeNum}).sort(function(a,b){return a-b});
      var newList=allEpNums.filter(function(n){return n<=malHighest});
      var wd=await api.setEpisodesWatched(name,newList);_patchLibWatchData(name,wd);
      toast('Adopted MAL progress: '+malHighest,'s');
      return;
    }
    if(resolution==='merge')highestEp=Math.max(highestEp,malHighest);
    // 'local' falls through and overwrites with local count, per user choice.
  }
  var st;
  if(highestEp>0&&totalEps>0&&highestEp>=totalEps)st='completed';
  else if(highestEp>0)st=isManga()?'reading':'watching';
  else st=isManga()?'plan_to_read':'plan_to_watch';
  console.log('[Sync] '+name+': highest '+watchedLabel()+' '+highestEp+' ('+st+') to MAL');
  var syncFields={status:st};
  if(isManga())syncFields.num_chapters_read=highestEp;
  else syncFields.num_watched_episodes=highestEp;
  var r=await api.malEditStatus(w.malId,syncFields,name);
  if(r&&!r.error){await fetchMD(name,w.malId);toast('Synced '+highestEp+' '+watchedLabel()+' to MAL','s');}
  else{console.error('[Sync] Failed:',r);toast('Sync error','e');}
}
async function markAll(name){var s=S.lib.find(function(x){return x.name===name});if(!s)return;
  var allEpNums=s.episodes.filter(function(e){return e.episodeNum!==null}).map(function(e){return e.episodeNum});
  var maxEp=allEpNums.length?Math.max.apply(null,allEpNums):0;
  var wd=await api.markUpTo(name,maxEp,allEpNums);_patchLibWatchData(name,wd);await autoSyncSeries(name);odtl(name);toast('All marked','s');}

async function fetchMD(name,malId){
  try{
    var det=await api.malGetAnimeDetails(malId);
    if(det&&!det.error){
      // setMalData returns the server-merged object; patch locally instead of
      // rescanning the whole library.
      var merged=await api.setMalData(name,det);
      _patchLibMal(name,{malId:malId,malData:merged});
      if(S.cur&&S.cur.name===name)odtl(name);
      render();
    }
  }catch(e){console.error('[fetchMD]',name,e);}
}
async function fetchMDQuiet(name,malId){
  var det=await api.malGetAnimeDetails(malId);
  if(det&&!det.error){var merged=await api.setMalData(name,det);_patchLibMal(name,{malId:malId,malData:merged});}
}
async function syncMal(name){var s=S.lib.find(function(x){return x.name===name});if(!s)return;var w=await api.getWatchHistory(name);
  if(!w.malId){toast('Link MAL first','e',{label:'Link',onClick:function(){malRelink(name)}});return;}
  var localCount=w.episodesWatched?w.episodesWatched.length:0;
  var totalEps=w.malData?totalField(w.malData):s.episodeCount;
  var st;if(localCount>0&&totalEps>0&&localCount>=totalEps)st='completed';else if(localCount>0)st=isManga()?'reading':'watching';else st=isManga()?'plan_to_read':'plan_to_watch';
  toast('Syncing '+localCount+' '+epLabel().toLowerCase()+'...','i');
  var syncF={status:st};if(isManga())syncF.num_chapters_read=localCount;else syncF.num_watched_episodes=localCount;
  var r=await api.malEditStatus(w.malId,syncF,name);
  if(r&&!r.error){toast('Synced: '+localCount+' '+epLabel().toLowerCase()+' ('+st.replace(/_/g,' ')+')','s');await fetchMD(name,w.malId);}
  else{toast('Sync failed: '+(r?r.error:'Unknown'),'e');}}
async function saveMyListEdit(malId){
  var status=document.getElementById('mleStatus').value;
  var score=parseInt(document.getElementById('mleScore').value)||0;
  var eps=parseInt(document.getElementById('mleEps').value)||0;
  closeMyListEdit();toast('Saving...','i');
  var editFields={status:status,score:score};
  if(isManga())editFields.num_chapters_read=eps;else editFields.num_watched_episodes=eps;
  var r=await api.malEditStatus(malId,editFields);
  if(r&&!r.error){
    // Also update local watch history if series is in library
    var local=S.lib.find(function(s){return s.watchData&&s.watchData.malId===malId});
    if(local){
      var allEpNums=local.episodes.filter(function(e){return e.episodeNum!==null}).map(function(e){return e.episodeNum}).sort(function(a,b){return a-b});
      var epList=allEpNums.slice(0,eps);
      var wd2=await api.setEpisodesWatched(local.name,epList);_patchLibWatchData(local.name,wd2);
    }
    toast('Updated on MAL','s');
    // Reload the list and refresh the detail overlay if it's open
    await loadMyList(false);
    if(document.getElementById('dov').classList.contains('open')){
      openExploreDetail(malId);
    }
  } else {toast('Failed: '+(r?r.error:'Unknown'),'e');}
}
async function malRemoveFromMyList(malId){
  toast('Removing from MAL...','i');
  var r=await api.malDeleteEntry(malId);
  if(r&&!r.error){
    toast('Removed from MAL list','s');
    await loadMyList(false);
  } else {toast('Failed: '+(r?r.error:'Unknown'),'e');}
}
async function saveMalEdit(name,malId){
  try{
    var status=document.getElementById('meStatus').value;
    var score=parseInt(document.getElementById('meScore').value)||0;
    var eps=parseInt(document.getElementById('meEps').value)||0;
    closeMalEdit();toast('Saving...','i');
    var editFields={status:status,score:score};
    if(isManga())editFields.num_chapters_read=eps;else editFields.num_watched_episodes=eps;
    var r=await api.malEditStatus(malId,editFields,name);
    if(r&&!r.error){
      var s=S.lib.find(function(x){return x.name===name});
      if(s){
        var allEpNums=s.episodes.filter(function(e){return e.episodeNum!==null}).map(function(e){return e.episodeNum}).sort(function(a,b){return a-b});
        var epList=allEpNums.slice(0,eps);
        var wd=await api.setEpisodesWatched(name,epList);_patchLibWatchData(name,wd);
      }
      await fetchMD(name,malId);
      toast('Updated on MAL','s');
    }
    else{toast('Failed: '+(r?r.error:'Unknown'),'e');}
  }catch(e){console.error('[saveMalEdit]',e);toast('Error: '+e.message,'e');}
}
async function malSetStatus(name,malId,status){
  toast('Updating status...','i');
  var r=await api.malEditStatus(malId,{status:status},name);
  if(r&&!r.error){await fetchMD(name,malId);toast('Status: '+status.replace(/_/g,' '),'s');if(S.cur&&S.cur.name===name)odtl(name);}
  else{toast('Failed','e');}
}
async function malRemoveFromList(name,malId){
  toast('Removing from MAL...','i');
  var r=await api.malDeleteEntry(malId);
  if(r&&!r.error){await fetchMD(name,malId);toast('Removed from MAL list','s');if(S.cur&&S.cur.name===name)odtl(name);}
  else{toast('Failed: '+(r?r.error:'Unknown'),'e');}
}
async function malRelinkPick(name,malId,malTitle){
  var activityId=activityStart('sync','Link '+name,'Selected '+malTitle+' · MAL #'+malId);
  closeMalRelink();
  try{await api.setMalId(name,malId);await fetchMD(name,malId);_patchLibMal(name,{malId:malId});removePendingSeries(name);toast('Linked "'+name+'" → "'+malTitle+'"','s');activityFinish(activityId,'success','Linked to MAL #'+malId);render();}
  catch(e){activityFinish(activityId,'error',e.message||String(e));toast('Link failed: '+(e.message||e),'e');}
}
async function malUnlink(name){
  await api.malUnlinkSeries(name);
  _patchLibMal(name,{malId:null,malData:null});
  toast('Unlinked: '+name,'i');
  render();
}
async function malManualIdConfirm(seriesName,malId,title){
  closeMalManualId();
  await api.setMalId(seriesName,malId);
  await fetchMD(seriesName,malId);
  _patchLibMal(seriesName,{malId:malId});
  removePendingSeries(seriesName);
  toast('Linked "'+seriesName+'" → "'+title+'" (ID: '+malId+')','s');
  render();
}
async function startMal(){var cid=document.getElementById('malCid');var csec=document.getElementById('malCsec');
  if(!cid||!cid.value.trim()){toast('Enter Client ID','e');return;}
  try{
    var url=await api.malGetAuthUrl(cid.value.trim(),csec?csec.value.trim():'');
    var serverP=api.malStartAuthServer();
    setTimeout(function(){api.openExternal(url);},150);
    toast('Complete login in browser - use the newest tab','i');
    var code=await serverP;
    if(!code){toast('Authorization cancelled or timed out','e');return;}
    var r=await api.malExchangeToken(code);
    if(!r||!r.success){toast('MAL token exchange failed: '+((r&&r.error)||'unknown error'),'e');return;}
    S.mal=true;S.cfg=await api.getConfig();uMal();toast('Connected!','s');queuePendingMalMatches();await loadLib(true);render();scheduleMalBackfill(800);
  }catch(e){toast('Connect error: '+(e.message||e),'e');}
}
async function disconnMal(){await api.setAllConfig(Object.assign({},S.cfg,{malAccessToken:'',malRefreshToken:'',malTokenExpiry:0}));S.mal=false;S.cfg=await api.getConfig();uMal();toast('Disconnected','i');render();}
async function placeNewSeries(idx,destFolder,malId){
  if(!S.pendingNewSeries||!S.pendingNewSeries[idx])return;
  var item=S.pendingNewSeries[idx];
  malId=malId||item.selectedMalId||null;
  var malMatch=selectedPendingMalMatch(item);
  // Build the backend payload from the grouped item:
  // originalPath and isFolder are stored on the first file entry
  var firstFile=item.files&&item.files[0]?item.files[0]:{};
  var payload={
    series:item.series,
    newName:firstFile.newName||item.series,
    originalPath:firstFile.originalPath||'',
    isFolder:!!firstFile.isFolder,
    isNewSeries:true
  };
  var activityId=activityStart('import','Place '+item.series,'Moving files into the library');
  toast('Moving "'+item.series+'" to selected folder...','i');
  var r=await api.watcherPlaceNewSeries(payload,destFolder);
  if(r.error){activityFinish(activityId,'error',r.error);toast('Failed: '+r.error,'e');return;}
  if(malId&&S.mal){
    try{
      await api.setMalId(item.series,malId);
      await fetchMDQuiet(item.series,malId);
    }catch(e){
      toast('Moved, but MAL link failed: '+(e.message||e),'e');
    }
  }
  if(item.autoTrack&&!isManga())await setSeriesAutoTracking(item.series,malId,true);
  S.pendingNewSeries.splice(idx,1);
  persistImportInbox();
  if(!malId)markImportReviewDismissed(item.series);
  var logName=firstFile.file||firstFile.name||item.series;
  S.watcherLog.unshift({file:logName,newName:firstFile.newName||item.series,series:item.series});
  if(S.watcherLog.length>20)S.watcherLog=S.watcherLog.slice(0,20);
  toast(malId?'Moved and linked: '+item.series+(malMatch?' → '+malMatch.title:''):'Moved: '+item.series,'s');
  activityFinish(activityId,'success',malId?'Placed and linked to MAL #'+malId:'Placed without a MAL link');
  await loadLib();
  refreshNewSeriesPlacementPopup();
  if(S.view==='filemgmt'||S.view==='inbox'||S.view==='hub')render();
}
async function finalizeImportedSeries(idx,category,malId){
  if(!S.pendingNewSeries||!S.pendingNewSeries[idx])return;
  var item=S.pendingNewSeries[idx];
  malId=malId||item.selectedMalId||null;
  var malMatch=selectedPendingMalMatch(item);
  var activityId=activityStart('import','Import '+item.series,'Saving category and sync choice');
  try{
    if(category&&typeof api.setCategory==='function')await api.setCategory(item.series,category);
    if(malId&&S.mal){
      await api.setMalId(item.series,malId);
      await fetchMDQuiet(item.series,malId);
    }
    if(item.autoTrack&&!isManga())await setSeriesAutoTracking(item.series,malId,true);
    markImportReviewDismissed(item.series);
    S.pendingNewSeries.splice(idx,1);
    persistImportInbox();
    toast(malId?'Imported and linked: '+item.series+(malMatch?' → '+malMatch.title:''):'Imported: '+item.series,'s');
    activityFinish(activityId,'success',malId?'Linked to MAL #'+malId:'Saved without a MAL link');
    await loadLib(true);
    refreshNewSeriesPlacementPopup();
    if(S.view==='filemgmt'||S.view==='inbox'||S.view==='hub')render();
  }catch(e){
    activityFinish(activityId,'error',e.message||String(e));
    toast('Import save failed: '+(e.message||e),'e');
  }
}
function dismissNewSeries(idx){
  if(!S.pendingNewSeries||!S.pendingNewSeries[idx])return;
  var item=S.pendingNewSeries[idx];
  if(item.fromLibrary)markImportReviewDismissed(item.series);
  S.pendingNewSeries.splice(idx,1);
  persistImportInbox();
  toast('Skipped: '+item.series,'i');
  refreshNewSeriesPlacementPopup();
  if(S.view==='filemgmt')render();
}
async function autoDownloadLatest(title,isAiring,nextEp){
  if(isAiring) await downloadLatestEpisode(title,null);
  else await autoDownloadFull(title,false);
}
async function autoDownloadFull(title,isAiring){
  if(!title){toast('No series title found','e');return;}
  var quality=S.cfg.nyaaQuality||'1080p';
  var uploader=isAiring?(S.cfg.nyaaUploader||'erai'):null;
  toast('Searching Nyaa for "'+title+'"...','i');
  var r=await api.nyaaAutoDownload(title,quality,uploader,null,'full');
  if(r.error){toast('Download failed: '+r.error,'e');return;}
  toast('Opened: '+r.chosen.title+' ('+r.chosen.seeders+' seeds)','s');
}
async function autoDownloadSeries(title,isAiring){
  await autoDownloadFull(title,!!isAiring);
}
async function autoDownloadEpisode(title,epNum){
  if(!title){toast('No series title found','e');return;}
  var quality=S.cfg.nyaaQuality||'1080p';
  var uploader=S.cfg.nyaaUploader||'erai';
  toast('Searching Nyaa for Ep '+epNum+'...','i');
  var r=await api.nyaaAutoDownload(title,quality,uploader,epNum,'ep');
  if(r.error){toast('Download failed: '+r.error,'e');return;}
  toast('Opened: '+r.chosen.title+' ('+r.chosen.seeders+' seeds)','s');
}
async function downloadLatestEpisode(seriesName,malId){
  if(!seriesName){toast('No series name provided','e');return;}
  toast('Searching Nyaa for latest episode of '+seriesName+'...','i');
  var r=await api.autoDownloadLatestEpisode(seriesName,malId);
  if(r&&r.error){toast('Latest episode: '+r.error,'e');return;}
  if(r&&r.success){toast('Queued download: '+seriesName+' E'+r.episode+' — '+r.chosen.title+' ('+r.chosen.seeders+' seeds)','s');}
  else {toast('Latest episode download failed for '+seriesName,'e');}
}
async function catchupAllPendingEpisodes(){
  toast('⚡ Polling and downloading all pending episodes...','i');
  try {
    var res=await api.autoDownloadPollNow(true);
    var downloaded=(res&&res.results&&res.results.downloaded)?res.results.downloaded:[];
    if(downloaded.length>0){
      toast('⚡ Queued '+downloaded.length+' pending episode(s)!','s');
    } else {
      toast('Library is up to date! No missing episodes found.','s');
    }
    S._autoDownloadWatchlist=await api.autoDownloadGetWatchlist();
    if(S.view==='settings'||S.view==='hub')render();
  } catch(e){
    toast('Catch-up failed: '+(e.message||e),'e');
  }
}
async function catchupSingleSeries(name,malId){
  if(!name)return;
  toast('Checking missing episodes for "'+name+'"...','i');
  try {
    var res=await api.autoDownloadCatchupSeries(name,malId);
    if(res&&res.success&&res.downloaded&&res.downloaded.length){
      toast('⚡ Queued '+res.downloaded.length+' missing episode(s) for '+name+'!','s');
    } else if(res&&res.error){
      toast(res.error,'i');
    } else {
      toast('No missing episodes found for '+name,'i');
    }
    S._autoDownloadWatchlist=await api.autoDownloadGetWatchlist();
    if(S.cur&&S.cur.name===name)odtl(name);
    if(S.view==='settings'||S.view==='hub')render();
  } catch(e){
    toast('Catch-up error: '+(e.message||e),'e');
  }
}
async function verifySeriesLatest(name,malId){
  var w=(S._autoDownloadWatchlist||[]).find(function(x){return x.seriesName===name});
  var r=await api.autoDownloadVerifyLatest(name,malId,w?w.episodeOffset||0:0);
  S._autoDownloadWatchlist=await api.autoDownloadGetWatchlist();
  if(r.success)toast('Verified available: '+epLabel()+' '+r.episode,'s');else toast('No confident release match found','i');
  if(S.cur&&S.cur.name===name)odtl(name);
}
async function deleteSeries(name,seriesPath){
  toast('Deleting...','i');var r=await api.deleteSeries(seriesPath);
  if(r.error){toast('Failed: '+r.error,'e');return;}
  if(S.cfg.untrackOnDelete!==false)S._autoDownloadWatchlist=await api.autoDownloadGetWatchlist();
  toast('Deleted: '+name,'s');cdtl();await loadLib();render();
}
async function fetchAll(){var m=S.lib.filter(function(s){return !s.name.startsWith('__unsorted')&&!S.covers[s.name]});
  if(!m.length){if(notifEnabled('rescan'))toast('All covers fetched!','s');return;}if(notifEnabled('rescan'))toast('Fetching '+m.length+' covers...','i');
  var activityId=activityStart('covers','Fetch missing covers',m.length+' titles');
  var r=await api.anilistFetchAllCovers(m);var n=0;
  for(var i=0;i<r.length;i++){if(r[i].path){var ok=await setCoverFromPath(r[i].name,r[i].path,true);if(ok)n++;}activityUpdate(activityId,(i+1)+' / '+r.length+' processed');}
  activityFinish(activityId,'success',n+' covers fetched');toast(n+' covers fetched','s');render();}
async function fetch1(name){toast('Searching...','i');var r=await api.anilistSearch(aliasFor(name,'anilist'),1);
  if(!r.length){toast('Not found - use manual search','e');return;}var url=r[0].coverImage?r[0].coverImage.extraLarge||r[0].coverImage.large:null;
  if(!url){toast('No cover','e');return;}var p=await api.anilistFetchCover(name,url,true);
  var ok=await setCoverFromPath(name,p);if(ok)toast('Done','s');else toast('Failed','e');}
async function coverPick(name,url){
  if(!url){toast('No cover URL','e');return;}
  toast('Downloading...','i');var p=await api.anilistFetchCover(name,url,true);
  var ok=await setCoverFromPath(name,p);if(ok){toast('Cover saved','s');}else{toast('Failed','e');}
}

function _downloadGap(name,num){
  if(isManga())return api.openExternal(buildNyaaUrl(name,num));
  return autoDownloadEpisode(name,num);
}
async function bulkSetTracking(enabled){
  for(var i=0;i<S.selectedSeries.length;i++){
    var s=S.lib.find(function(x){return x.name===S.selectedSeries[i]});
    if(s)await setSeriesAutoTracking(s.name,s.watchData&&s.watchData.malId,enabled);
  }
  S.selectedSeries=[];S.selectMode=false;toast(enabled?'Auto-tracking enabled':'Auto-tracking disabled','s');render();
}
async function bulkDelete(){
  var targets=S.selectedSeries.map(function(n){return S.lib.find(function(x){return x.name===n})}).filter(Boolean);
  if(!targets.length)return;
  var ok=await askConfirm({title:'Delete '+plural(targets.length,'series','series')+'?',danger:true,confirm:'Delete permanently',text:'These folders and every file inside them will be removed from disk. This cannot be undone.',body:'<div class="path-list">'+targets.map(function(s){return '<div class="mono">'+E(s.path)+'</div>';}).join('')+'</div>'});
  if(!ok)return;
  var failed=[];
  for(var i=0;i<S.selectedSeries.length;i++){
    var s=S.lib.find(function(x){return x.name===S.selectedSeries[i]});
    if(!s)continue;
    try{var r=await api.deleteSeries(s.path);if(!r||!r.success)failed.push({name:s.name,error:(r&&r.error)||'unknown'});}
    catch(e){failed.push({name:s.name,error:e.message});}
  }
  failed.forEach(function(f){console.error('[BulkDelete] Failed:',f.name,f.error)});
  if(S.cfg.untrackOnDelete!==false)S._autoDownloadWatchlist=await api.autoDownloadGetWatchlist();
  S.selectedSeries=[];S.selectMode=false;loadLib().then(function(){
    if(failed.length)toast('Deleted '+(targets.length-failed.length)+', failed '+failed.length+' (see console)','e');
    else toast('Series deleted','s');
  });
}
function toggleSelectMode(){
  S.selectMode=!S.selectMode;
  if(!S.selectMode)S.selectedSeries=[];
  render();
}
function toggleSelectSeries(name){
  if(!S.selectedSeries)S.selectedSeries=[];
  var idx=S.selectedSeries.indexOf(name);
  if(idx>=0)S.selectedSeries.splice(idx,1);else S.selectedSeries.push(name);
  render();
}
async function myListBatchTracking(enabled){
  var items=selectedMyListItems(),changed=0;
  for(var i=0;i<items.length;i++){var local=S.lib.find(function(s){return s.watchData&&Number(s.watchData.malId)===Number(items[i].node.id)});if(local){await setSeriesAutoTracking(local.name,items[i].node.id,enabled);changed++;}}
  toast((enabled?'Tracking enabled for ':'Tracking disabled for ')+changed+' local series','s');S.selectedMalIds=[];S.myListSelectMode=false;renderMyList();
}
function selectedMyListItems(){return((S.myListData&&S.myListData.data)||[]).filter(function(x){return S.selectedMalIds.indexOf(x.node.id)>=0});}
function toggleMyListSeries(id){var i=S.selectedMalIds.indexOf(id);if(i>=0)S.selectedMalIds.splice(i,1);else S.selectedMalIds.push(id);renderMyList();}