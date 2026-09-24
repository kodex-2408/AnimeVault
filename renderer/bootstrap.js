/* AnimeVault renderer — startup, IPC event wiring, duplicate-file prompt. */

// ------------------------------------------------------- duplicate prompt --
var _dupQueue=[],_dupCurrent=null,_dupTimer=null;
function showDuplicatePopup(dup){
  if(_dupCurrent){_dupQueue.push(dup);return;}
  _dupCurrent=dup;var files=dup.files||[];var series=dup.series||'Unknown';var ep=dup.episode!=null?dup.episode:'?';
  var el=document.createElement('div');el.id='dupPopup';el.className='notice dup-notice';
  var hevc=files.some(function(f){return f.codec==='HEVC';});
  var h='<div class="notice-head"><div class="modal-icon warn">'+ic('copy')+'</div><div class="grow"><div class="notice-title">Duplicate '+epLabel().toLowerCase()+' found</div><div class="notice-text ellipsis">'+E(series)+' · '+epLabel()+' '+E(ep)+' · '+files.length+' files</div></div>'
    +'<button class="icon-btn sm plain" data-dup="mute"'+Tip('Don’t warn about this series again')+'>'+ic('bell')+'</button><button class="icon-btn sm plain" data-dup="close">'+ic('x')+'</button></div><div class="dup-files">';
  files.forEach(function(f,i){h+='<button class="dup-file'+(i===0?' on':'')+'" data-dup-idx="'+i+'"><span class="dup-radio"></span><span class="grow"><span class="ellipsis mono" style="display:block;font-size:11.5px">'+E(f.name)+'</span><span class="row" style="gap:5px;margin-top:5px"><span class="tag">'+E(f.codec||'Unknown')+'</span><span class="tag">'+E(f.resolution||'?')+'</span><span class="tag">'+E(f.sizeFormatted||fmtBytes(f.size||0))+'</span></span></span></button>';});
  h+='</div><div class="notice-actions">'+(hevc?'<button class="btn btn-ghost btn-sm" data-dup="hevc">Keep HEVC</button>':'')+'<button class="btn btn-ghost btn-sm" data-dup="size">Keep larger</button><button class="btn btn-primary btn-sm" data-dup="keep">Keep selected</button></div>';
  el.innerHTML=h;document.getElementById('tc').appendChild(el);
  el.addEventListener('click',function(e){
    var row=e.target.closest('[data-dup-idx]');if(row){el.querySelectorAll('.dup-file').forEach(function(r){r.classList.toggle('on',r===row);});return;}
    var b=e.target.closest('[data-dup]');if(!b)return;var a=b.getAttribute('data-dup');
    if(a==='close')closeDuplicatePopup();else if(a==='mute')muteDupSeries(series);else if(a==='hevc')resolveDupByCodec('HEVC');else if(a==='size')resolveDupBySize();else resolveDupManual();
  });
  el.addEventListener('mouseenter',function(){clearTimeout(_dupTimer);});
  _dupTimer=setTimeout(closeDuplicatePopup,45000);
}
function closeDuplicatePopup(){var p=document.getElementById('dupPopup');if(p){p.classList.add('leaving');setTimeout(function(){p.remove();},220);}clearTimeout(_dupTimer);_dupCurrent=null;if(_dupQueue.length)setTimeout(function(){showDuplicatePopup(_dupQueue.shift());},260);}
function dismissDuplicatePopup(){closeDuplicatePopup();}
function muteDupSeries(series){if(!Array.isArray(S.cfg.mutedDupSeries))S.cfg.mutedDupSeries=[];if(S.cfg.mutedDupSeries.indexOf(series)<0)S.cfg.mutedDupSeries.push(series);api.setConfig('mutedDupSeries',S.cfg.mutedDupSeries);_dupQueue=_dupQueue.filter(function(d){return d&&d.series!==series;});toast('Duplicate alerts muted for '+series,'i');closeDuplicatePopup();}
function resolveDupByCodec(c){if(!_dupCurrent)return;var keep=_dupCurrent.files.find(function(f){return f.codec===c;})||_dupCurrent.files[0];doResolveDup(keep.path,_dupCurrent.files.filter(function(f){return f.path!==keep.path;}).map(function(f){return f.path;}));}
function resolveDupBySize(){if(!_dupCurrent)return;var keep=_dupCurrent.files.reduce(function(b,f){return (f.size||0)>(b.size||0)?f:b;},_dupCurrent.files[0]);doResolveDup(keep.path,_dupCurrent.files.filter(function(f){return f.path!==keep.path;}).map(function(f){return f.path;}));}
function resolveDupManual(){if(!_dupCurrent)return;var row=document.querySelector('#dupPopup .dup-file.on');var idx=row?+row.getAttribute('data-dup-idx'):0;var keep=_dupCurrent.files[idx];doResolveDup(keep.path,_dupCurrent.files.filter(function(f,i){return i!==idx;}).map(function(f){return f.path;}));}
function doResolveDup(keep,dels){api.duplicateResolve({keep:keep,delete:Array.isArray(dels)?dels:(dels?[dels]:[])});closeDuplicatePopup();}

// ------------------------------------------------------------------- init --
async function init(){
  var startup=await Promise.all([api.getConfig(),api.malIsAuthenticated(),api.watcherStatus(),api.autoDownloadGetWatchlist()]);
  S.cfg=startup[0]||{};S.mal=!!startup[1];S.watcherStatus=startup[2];S._autoDownloadWatchlist=startup[3]||[];
  S.activities=Array.isArray(S.cfg.activityLog)?S.cfg.activityLog:[];
  S.activities.forEach(function(a){if(a.status==='running'){a.status='error';a.detail=(a.detail?a.detail+' · ':'')+'Interrupted when the app closed';a.finishedAt=Date.now();}});
  if(S.cfg.autoMarkEnabled===undefined||S.cfg.autoMarkEnabled===null){S.cfg.autoMarkEnabled=true;api.setConfig('autoMarkEnabled',true);}
  S.vaultMode=S.cfg.vaultMode||'anime';
  if(S.cfg.schedView)S.schedView=S.cfg.schedView;
  if(S.cfg.sidebarCollapsed)document.querySelector('.app').classList.add('sidebar-collapsed');
  restoreImportInbox();persistActivities();
  applyTheme();applyPerformanceMode(S.cfg.performanceMode);applyAnimSpeed(S.cfg.animSpeed||'default');
  updateModeUI();uMal();initLuma();
  wireIpcEvents();
  if(!S.cfg.setupDone){showSetupWizard();if(!S.cfg.folders||!S.cfg.folders.length)go('settings');else{go('library');await loadLib(true);}}
  else if(isManga()?!(S.cfg.mangaFolders&&S.cfg.mangaFolders.length):!(S.cfg.folders&&S.cfg.folders.length)){go('settings');toast('Add your '+VM('anime','manga')+' folders to get started','i');}
  else{S.loading=true;go('library');await loadLib(true);}
  scheduleStartupLibraryMaintenance();
  if((S.pendingNewSeries||[]).length)setTimeout(function(){showImportNotice();},1500);
  document.documentElement.classList.add('ready');
}

function wireIpcEvents(){
  api.onNewFiles(function(files){
    files=files||[];
    var moved=files.filter(function(f){return !f.isNewSeries;}),fresh=files.filter(function(f){return f.isNewSeries;});
    if(moved.length){
      moved.forEach(function(f){S.watcherLog.unshift(f);});S.watcherLog=S.watcherLog.slice(0,20);
      if(notifEnabled('watcher'))toast(plural(moved.length,'file','files')+' organized into your library','s');
      activityRecord('watcher','Organized incoming files','success',plural(moved.length,'file','files')+' moved into existing series');
      loadLib();
    }
    if(fresh.length){
      var grouped={};fresh.forEach(function(f){if(!grouped[f.series])grouped[f.series]={series:f.series,files:[]};grouped[f.series].files.push(f);});
      Object.keys(grouped).forEach(function(k){addPendingNewSeriesItem(grouped[k]);});
      activityRecord('import','New series detected','success',plural(Object.keys(grouped).length,'title','titles')+' added to the Import Inbox');
      queuePendingMalMatches();showImportNotice(true);updateNavBadges();
      if(S.view==='hub'||S.view==='filemgmt')render();
    }
  });
  if(typeof api.onAutoDownloadPollComplete==='function')api.onAutoDownloadPollComplete(function(r){
    if(!r)return;
    var total=['downloaded','no_results','no_exact_match','dedup','skipped_local','error'].reduce(function(a,k){return a+((r[k]||[]).length);},0);if(!total)return;
    activityRecord('download','Auto-download check',(r.error&&r.error.length)?'error':'success',(r.downloaded||[]).length+' handed off · '+(r.skipped_local||[]).length+' up to date · '+(r.error||[]).length+' errors');
    if(!notifEnabled('autoDownload'))return;
    (r.downloaded||[]).forEach(function(d){toast('Handed off '+d.series+' '+epLabel()+' '+d.episode+' ('+d.seeders+' seeds)','s');});
    if((r.no_results||[]).length)toast(r.no_results.length===1?'No Nyaa results for '+r.no_results[0].series+' '+epLabel()+' '+r.no_results[0].episode:'No Nyaa results for '+r.no_results.length+' series','i');
    if((r.no_exact_match||[]).length)toast(r.no_exact_match.length===1?'No exact match for '+r.no_exact_match[0].series+' '+epLabel()+' '+r.no_exact_match[0].episode:'No exact matches for '+r.no_exact_match.length+' series','i');
    (r.error||[]).forEach(function(e){toast('Auto-download error — '+e.series+': '+e.error,'e');});
    if(S.view==='hub')refreshDownloadLog();
  });
  if(typeof api.onAutoDownloadToast==='function')api.onAutoDownloadToast(function(d){if(d&&d.message)toast(d.message,'i');else if(d&&d.series&&d.episode)toast('Handed off '+epLabel()+' '+d.episode+' of '+d.series,'s');});
  api.onDuplicateShowModal(function(data){
    if(!data||!data.length)return;var muted=(S.cfg.mutedDupSeries||[]).filter(Boolean);
    data=data.filter(function(d){return muted.indexOf(d.series)<0;});if(!data.length)return;
    if(!notifEnabled('duplicates'))return;
    showDuplicatePopup(data[0]);for(var i=1;i<data.length;i++)_dupQueue.push(data[i]);
  });
  api.onDuplicateResolved(function(d){closeDuplicatePopup();if(d&&d.keep)toast('Kept '+d.keep.replace(/.*[\/\\]/,''),'s');setTimeout(function(){loadLib();},500);});
  api.onAiChunk(function(d){
    S._aiPartial=(S._aiPartial||'')+(d&&d.text||'');
    var live=document.getElementById('lumaDockLive');
    if(live)live.innerHTML=parseLumaBubbleHtml(S._aiPartial);else if(S.ai.dockOpen)renderLumaDockMsgs();
    scrollAiBottom();
  });
  api.onAiDone(function(){if(S._aiPartial||S.ai.busy)finishAiTurn();});
  api.onAiError(function(d){handleAiError((d&&d.message)||'Stream error');});
  api.onAutoMark(async function(data){
    var name=data&&data.seriesName,num=data&&data.episodeNum;
    if(!name||num===null||num===undefined||isNaN(num))return;
    var s=S.lib.find(function(x){return x.name===name;});if(!s)return;
    toast('Marked '+epLabel()+' '+num+' as '+watchedLabel(),'s');
    var all=s.episodes.filter(function(e){return e.episodeNum!==null;}).map(function(e){return e.episodeNum;}).sort(function(a,b){return a-b;});
    var wd=await api.markUpTo(name,num,all);_patchLibWatchData(name,wd);
    if(S.cfg.watchAndDelete){var ep=s.episodes.find(function(e){return e.episodeNum===num;});if(ep)setTimeout(async function(){var r=await api.deleteEpisodeFile(ep.path);if(r&&r.success)toast('Deleted '+epLabel()+' '+num+' (watch & delete)','i');},5000);}
    await autoSyncSeries(name);
    if(S.cur&&S.cur.name===name)odtl(name);
    if(S.view==='library'||S.view==='continue'||S.view==='completed')render();
  });
}

document.addEventListener('DOMContentLoaded',function(){
  renderSidebar();
  init().catch(function(e){console.error('[init]',e);var mc=document.getElementById('mc');if(mc)mc.innerHTML='<div class="view">'+emptyState('alert','AnimeVault couldn’t start',E(e&&e.message||String(e)),'<button class="btn btn-primary"'+A('reloadApp')+'>Reload</button>')+'</div>';});
  setTimeout(initBackgroundEffects,120);
});
act('reloadApp',function(){location.reload();});
window.addEventListener('resize',debounce(function(){positionNavIndicator(true);},100));
