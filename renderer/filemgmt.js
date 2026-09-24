/* AnimeVault renderer — File Management, watcher, maintenance reports. */

function toolTile(o){
  // o:{icon,color,title,desc,actions:[html]}
  return '<div class="tool panel"><div class="tool-top"><div class="lg-icon" style="--ic:'+(o.color||'var(--accent)')+'">'+ic(o.icon)+'</div><div class="grow"><div class="tool-title">'+E(o.title)+'</div><div class="tool-desc">'+E(o.desc)+'</div></div></div><div class="tool-actions">'+o.actions.join('')+'</div></div>';
}
function vFileMgmt(){
  var tab=S.fmTab||'tools';var ws=S.watcherStatus||{};
  var h='<div class="view">'+pageHead('File Management','Rename, organize and maintain the files behind your library.',
    seg('fmTab',[{v:'tools',label:'Tools',icon:'wand'},{v:'watch',label:'Download watcher',icon:'eye'}],tab,'setFmTab'));
  if(tab==='watch')return h+vWatcher()+'</div>';
  var pending=(S.pendingNewSeries||[]).length;
  if(pending)h+='<div class="callout accent" style="margin-bottom:20px">'+ic('inbox')+'<span><b>'+plural(pending,'title','titles')+'</b> waiting in the Import Inbox.</span><button class="btn btn-primary btn-sm"'+A('openImportReviewer')+'>Review</button></div>';
  h+='<div class="sec-head"><div class="sec-title">Organize</div></div><div class="tool-grid">';
  if(isManga()){
    h+=toolTile({icon:'book',title:'Organize a manga folder',desc:'Renames .cbz/.cbr files using the folder name as the series title and parses chapter numbers.',actions:['<button class="btn btn-primary btn-sm"'+A('runFormatMangaFolder',false)+'>Choose folder…</button>','<button class="btn btn-ghost btn-sm"'+A('runFormatMangaFolder',true)+'>…and rename folder</button>']});
  }else{
    h+=toolTile({icon:'folderPlus',title:'Format loose files',desc:'Moves loose video files into tidy per-series folders with clean names.',actions:['<button class="btn btn-primary btn-sm"'+A('runFormat')+'>Choose folder…</button>']});
    h+=toolTile({icon:'pencil',title:'Rename inside a folder',desc:'Adds the series name to files like “S01E01-Title.mkv” using the folder name.',actions:['<button class="btn btn-primary btn-sm"'+A('runFormatFolder',false)+'>Choose folder…</button>','<button class="btn btn-ghost btn-sm"'+A('runFormatFolder',true)+'>…and rename folder</button>']});
    h+=toolTile({icon:'layers',color:'var(--blue)',title:'Batch process',desc:'Cleans folder names and renames files across many series folders at once.',actions:['<button class="btn btn-secondary btn-sm"'+A('runBatch',true)+'>Preview…</button>','<button class="btn btn-ghost btn-sm"'+A('runBatch',false)+'>Run…</button>']});
    h+=toolTile({icon:'folderOpen',color:'var(--purple)',title:'Ungroup a folder',desc:'Moves files from a series subfolder back up into its parent.',actions:['<button class="btn btn-secondary btn-sm"'+A('runUngroupFolder')+'>Choose folder…</button>']});
  }
  h+=toolTile({icon:'undo',color:'var(--text-3)',title:'Undo last operation',desc:'Restores the files renamed or moved by the last organize run.',actions:['<button class="btn btn-secondary btn-sm"'+A('runUndoFormat')+'>Undo</button>']});
  h+='</div>';
  h+='<div class="sec-head"><div class="sec-title">Maintenance</div></div><div class="tool-grid">'
    +toolTile({icon:'heartPulse',color:'var(--green)',title:'Library health check',desc:'Finds missing '+epLabelFull().toLowerCase()+', duplicates and files that can’t be parsed.',actions:['<button class="btn btn-secondary btn-sm"'+A('runHealthCheck')+'>Run check</button>']})
    +toolTile({icon:'scan',color:'var(--yellow)',title:'Episode gap detector',desc:'Lists only what’s missing, per series, with one-click searches.',actions:['<button class="btn btn-secondary btn-sm"'+A('runGapDetector')+'>Find gaps</button>']})
    +toolTile({icon:'refresh',color:'var(--blue)',title:'Rescan library',desc:'Refreshes the library to pick up new, moved or deleted files.',actions:['<button class="btn btn-secondary btn-sm"'+A('rescanLibrary')+'>Rescan</button>','<button class="btn btn-ghost btn-sm"'+A('rebuildLibraryIndex')+'>Full rebuild</button>']})
    +toolTile({icon:'image',color:'var(--purple)',title:'Cover art',desc:'Fetches missing covers from AniList or lets you pick one per series.',actions:['<button class="btn btn-secondary btn-sm"'+A('fetchAll')+'>Fetch missing</button>','<button class="btn btn-ghost btn-sm"'+A('openCoverManager')+'>Manage…</button>']})
    +'</div>';
  h+='<div class="sec-head"><div class="sec-title danger-txt">Danger zone</div></div><div class="tool-grid">'
    +toolTile({icon:'trash',color:'var(--red)',title:'Delete series',desc:'Permanently deletes whole series folders from disk. You choose exactly which.',actions:['<button class="btn btn-danger btn-sm"'+A('openBatchDelete')+'>Select series…</button>']})
    +'</div>';
  return h+'</div>';
}
act('setFmTab',function(el,ev,v){S.fmTab=v;render();});
act('rescanLibrary',function(){return loadLib().then(function(){toast('Library rescanned','s');});});
expose('runFormat','runFormatFolder','runFormatMangaFolder','runUndoFormat','runUngroupFolder','runBatch','runHealthCheck','runGapDetector','rebuildLibraryIndex','fetchAll','openCoverManager','openBatchDelete');

// ------------------------------------------------------------ result sheet --
function opSheet(title,sub){
  var m=openModal({id:'opResult',title:title,sub:sub?E(sub):'',icon:'wand',width:720,
    body:'<div class="op-summary" id="opSummary"><span class="spinner"></span><span>Working…</span></div><div class="op-list" id="opList"></div>',
    foot:'<button class="btn btn-primary" data-modal-close>Done</button>'});
  var list=m.el.querySelector('#opList'),sum=m.el.querySelector('#opSummary');var counts={ok:0,skip:0,err:0};var rows=[];
  return {
    add:function(kind,text,sub2){counts[kind]=(counts[kind]||0)+1;rows.push('<div class="op-row '+kind+'"><span class="op-ic">'+ic(kind==='ok'?'check':kind==='err'?'alert':'minus')+'</span><span class="grow"><span class="ellipsis mono">'+E(text)+'</span>'+(sub2?'<span class="op-sub mono ellipsis">'+E(sub2)+'</span>':'')+'</span></div>');},
    error:function(msg){counts.err++;sum.innerHTML='<span class="tag red">'+ic('alert')+'Failed</span><span>'+E(msg)+'</span>';list.innerHTML=rows.join('');},
    finish:function(label){sum.innerHTML='<span class="tag green">'+ic('check')+counts.ok+' '+(label||'done')+'</span>'+(counts.skip?'<span class="tag">'+counts.skip+' skipped</span>':'')+(counts.err?'<span class="tag red">'+counts.err+' errors</span>':'');list.innerHTML=rows.length?rows.join(''):emptyState('checkCircle','Nothing to change','Everything already looks tidy.','',true);}
  };
}
async function runFormat(){
  var src=await api.browseFolder();if(!src)return;
  var op=opSheet('Format loose files',src);var r=await api.managerFormat(src,src);
  if(r.error){op.error(r.error);return;}
  r.results.forEach(function(x){if(x.status==='formatted')op.add('ok',x.file,'→ '+x.series+'/'+x.newName);else op.add('skip',x.file,x.status);});
  op.finish('formatted');if(r.results.some(function(x){return x.status==='formatted';}))await loadLib();
}
async function runFormatFolder(alsoRename){
  var folder=await api.browseFolder();if(!folder)return;
  var folderName=folder.replace(/.*[\\/]/,'');var newName=folderName;
  if(alsoRename){
    newName=await askText({title:'Rename the folder too',label:'Clean series name',value:folderName.replace(/[\[\]]/g,'').replace(/\b\d{3,4}p\b.*/,'').replace(/\bBDRip\b.*/i,'').replace(/\bWEB[-.]?DL\b.*/i,'').replace(/\bx26[45]\b.*/i,'').trim(),confirm:'Rename',validate:function(v){return v.trim()&&!/[\\/:*?"<>|]/.test(v)?'':'Enter a valid folder name';}});
    if(!newName)return;newName=newName.trim();
  }
  var op=opSheet('Rename inside folder',folderName+(alsoRename&&newName!==folderName?' → '+newName:''));var r=await api.managerFormatFolder(folder,newName);
  if(r.error){op.error(r.error);return;}
  var ok=0;r.results.forEach(function(x){if(x.status==='renamed'){op.add('ok',x.file||x.old,'→ '+(x.newName||x.new||''));ok++;}else op.add('skip',x.file||x.old,x.status==='skip'?'already named':x.status);});
  op.finish('renamed');if(ok)await loadLib();
}
async function runFormatMangaFolder(alsoRename){
  var folder=await api.browseFolder();if(!folder)return;
  var folderName=folder.replace(/.*[\\/]/,'');var newName=folderName;
  if(alsoRename){newName=await askText({title:'Rename the folder too',label:'Clean series name',value:folderName.replace(/[\[\]]/g,'').replace(/\b\d{3,4}p\b.*/,'').trim(),confirm:'Rename',validate:function(v){return v.trim()&&!/[\\/:*?"<>|]/.test(v)?'':'Enter a valid folder name';}});if(!newName)return;newName=newName.trim();}
  var op=opSheet('Organize manga folder',folderName);var r=await api.managerFormatManga(folder,newName);
  if(r.error){op.error(r.error);return;}
  var ok=0;r.results.forEach(function(x){if(x.status==='renamed'){op.add('ok',x.file||x.old,'→ '+(x.newName||x.new||''));ok++;}else op.add('skip',x.file||x.old,x.status==='skip'?'already named':x.status);});
  op.finish('renamed');if(ok)await loadLib();
}
async function runUndoFormat(){
  var op=opSheet('Undo last operation');var r=await api.managerUndoFormat();
  if(r.error){op.error(r.error);return;}
  var ok=0;r.results.forEach(function(x){if(x.status==='restored'){op.add('ok',x.file,'→ '+x.restored);ok++;}else op.add('skip',x.file,x.status);});
  op.finish('restored');if(ok)await loadLib();
}
async function runUngroupFolder(){
  var folder=await api.browseFolder();if(!folder)return;
  var op=opSheet('Ungroup folder',folder);var parent=folder.replace(/[\\/][^\\/]+$/,'');
  var r=await api.managerUngroup(parent,folder,false);if(r.error){op.error(r.error);return;}
  var ok=0;r.results.forEach(function(x){if(x.status==='moved'){op.add('ok',x.file);ok++;}else op.add('skip',x.file,x.status);});
  op.finish('moved');if(ok)await loadLib();
}
async function runBatch(dry){
  var f=await api.browseFolder();if(!f)return;
  var op=opSheet(dry?'Batch process — preview':'Batch process',f);var r=await api.managerBatch(f,dry);
  if(r.error){op.error(r.error);return;}
  r.results.forEach(function(x){op.add(x.status==='error'?'err':(x.status==='renamed'||x.status==='preview')?'ok':'skip',(x.type?x.type+' · ':'')+(x.old||x.file),x.new?'→ '+x.new:x.status);});
  op.finish(dry?'would change':'changed');if(!dry)await loadLib();
}

// ---------------------------------------------------------------- watcher --
function vWatcher(){
  var ws=S.watcherStatus||{};var on=!!ws.enabled;
  var h='<div class="watch-hero panel'+(on?' on':'')+'"><div class="watch-orb"><span></span>'+ic('eye')+'</div><div class="grow"><div class="eyebrow">'+(on?'Watching':'Paused')+'</div><div class="watch-title">'+(on?E(ws.folder||''):'Download watcher is off')+'</div>'
    +'<div class="row-sub">'+(on?'Checks every 5 minutes. Files are moved only after they’ve been idle for a while and aren’t locked by your torrent client.':'Point it at your torrent client’s download folder and new episodes will be sorted into your library automatically.')+'</div></div>'
    +'<div class="row">'+(on?'<button class="btn btn-secondary btn-sm"'+A('pollNow')+'>'+ic('refresh')+'Check now</button><button class="btn btn-ghost btn-sm"'+A('stopWatcher')+'>Stop</button>':'')+'</div></div>';
  h+='<div class="list-group" style="margin-top:18px">'
    +'<div class="lg-row block"><div class="field"><label class="field-label">Watch folder</label><div class="input-row"><input class="input mono" id="watchFolder" placeholder="C:\\Users\\…\\Downloads\\Anime" value="'+E(ws.folder||S.cfg.watcherFolder||'')+'"><button class="btn btn-secondary btn-sm"'+A('brsWatch','watchFolder')+'>Browse…</button></div><div class="field-hint">Where your torrent client saves finished downloads.</div></div></div>'
    +'<div class="lg-row block"><div class="field"><label class="field-label">Fallback folder</label><div class="input-row"><input class="input mono" id="watchDest" placeholder="Same as the watch folder" value="'+E(ws.dest||S.cfg.watcherDest||'')+'"><button class="btn btn-secondary btn-sm"'+A('brsWatch','watchDest')+'>Browse…</button></div><div class="field-hint">Only used when a file doesn’t match any series already in your library. New series always go through the Import Inbox.</div></div></div>'
    +'<div class="lg-row"><div class="lg-main"></div><button class="btn btn-primary"'+A('startWatcher')+'>'+ic(on?'refresh':'eye')+(on?'Restart watcher':'Start watching')+'</button></div></div>';
  h+='<div class="sec-head"><div class="sec-title">Recently organized</div>'+(S.watcherLog&&S.watcherLog.length?'<span class="sec-count">'+S.watcherLog.length+'</span>':'')+'</div>';
  if(S.watcherLog&&S.watcherLog.length){
    h+='<div class="list-group">';
    S.watcherLog.forEach(function(e){h+='<div class="lg-row"><div class="lg-icon" style="--ic:var(--green)">'+ic('check')+'</div><div class="lg-main"><div class="lg-title ellipsis">'+E(e.series)+'</div><div class="lg-desc mono ellipsis">'+E(e.file)+' → '+E(e.newName)+'</div></div></div>';});
    h+='</div>';
  }else h+=emptyState('eye','Nothing yet this session','Files the watcher moves will be listed here.','',true);
  return h;
}
async function brsWatch(id){var f=await api.browseFolder();if(f){var el=document.getElementById(id);if(el)el.value=f;}}
async function startWatcher(){
  var folder=(document.getElementById('watchFolder')||{}).value;folder=(folder||'').trim();
  if(!folder){toast('Choose a watch folder first','e');return;}
  var dest=((document.getElementById('watchDest')||{}).value||'').trim()||folder;
  var r=await api.watcherStart(folder,dest);if(r&&r.error){toast(r.error,'e');return;}
  toast('Watching '+folder,'s');S.watcherStatus=await api.watcherStatus();render();
}
async function stopWatcher(){await api.watcherStop();toast('Watcher stopped','i');S.watcherStatus=await api.watcherStatus();render();}
async function pollNow(){toast('Checking the watch folder…','i');await api.watcherPollNow();S.watcherStatus=await api.watcherStatus();}
async function refreshWatcherStatus(){S.watcherStatus=await api.watcherStatus();}
expose('brsWatch','startWatcher','stopWatcher','pollNow');

// -------------------------------------------------------- reports (modals) --
function reportRow(o){
  // o:{key,title,chips,body,open,img}
  return '<details class="report-row"'+(o.open?' open':'')+'><summary>'+(o.img?'<img class="thumb" src="'+E(o.img)+'" alt="" loading="lazy">':'')+'<span class="grow ellipsis row-title">'+E(o.title)+'</span>'+o.chips+ic('chevronDown','report-caret')+'</summary><div class="report-body">'+o.body+'</div></details>';
}
async function runHealthCheck(){
  var all=librarySeries();if(!all.length){toast('Your library is empty','i');return;}
  var reports=[],miss=0,dup=0,orph=0,clean=0;
  all.forEach(function(s){var r=_hcAnalyzeSeries(s);var n=r.missing.length+r.duplicates.length+r.orphans.length;if(n){reports.push({s:s,r:r,n:n});miss+=r.missing.length;dup+=r.duplicates.length;orph+=r.orphans.length;}else clean++;});
  reports.sort(function(a,b){return b.n-a.n;});
  if(notifEnabled('healthCheck'))toast(reports.length?'Health check found '+miss+' missing, '+dup+' duplicates, '+orph+' unparseable':'Library is healthy',reports.length?'i':'s');
  var h='<div class="kpis compact">'+miniKpi('Scanned',all.length)+miniKpi('Clean',clean,'green')+miniKpi('Missing',miss,miss?'yellow':'')+miniKpi('Duplicates',dup,dup?'red':'')+miniKpi('Unparseable',orph,orph?'blue':'')+'</div>';
  if(!reports.length)h+=emptyState('checkCircle','Everything looks healthy','No gaps, duplicates or unparseable filenames were found.','',true);
  else{
    h+='<div class="report">';
    reports.forEach(function(x,i){
      var r=x.r,body='';
      if(r.missing.length)body+='<div class="report-label">Missing '+epLabelFull().toLowerCase()+'</div><div class="chips">'+r.missing.map(function(n){return '<span class="tag yellow">'+epLabel()+' '+n+'</span>';}).join('')+'</div>';
      if(r.duplicates.length)body+='<div class="report-label">Duplicates</div>'+r.duplicates.map(function(d){return '<div class="report-dup"><span class="tag red">'+epLabel()+' '+d.num+'</span><div class="mono">'+d.files.map(function(f){return E(f.name);}).join('<br>')+'</div></div>';}).join('');
      if(r.orphans.length)body+='<div class="report-label">Unparseable filenames</div><div class="mono report-files">'+r.orphans.map(function(f){return E(f.name);}).join('<br>')+'</div>';
      body+='<div class="row" style="margin-top:12px"><button class="btn btn-secondary btn-xs"'+A('openFolderPath',x.s.path)+'>'+ic('folderOpen')+'Open folder</button><button class="btn btn-ghost btn-xs"'+A('openSeries',x.s.name)+'>Details</button></div>';
      h+=reportRow({title:x.s.name,img:S.covers[x.s.name],open:i<2,body:body,chips:(r.missing.length?'<span class="tag yellow">'+r.missing.length+' missing</span>':'')+(r.duplicates.length?'<span class="tag red">'+r.duplicates.length+' dup</span>':'')+(r.orphans.length?'<span class="tag blue">'+r.orphans.length+' unparsed</span>':'')});
    });
    h+='</div>';
  }
  openModal({id:'hcOverlay',title:'Library health check',sub:plural(all.length,'series','series')+' scanned',icon:'heartPulse',width:760,body:h,foot:'<button class="btn btn-primary" data-modal-close>Done</button>'});
}
function miniKpi(label,val,tone){return '<div class="mini-kpi'+(tone?' '+tone:'')+'"><div class="mini-kpi-val">'+val+'</div><div class="mini-kpi-label">'+E(label)+'</div></div>';}
function _closeHealthCheck(){closeModalById('hcOverlay');}

function runGapDetector(){
  var all=librarySeries();if(!all.length){toast('Your library is empty','i');return;}
  var reports=[],total=0;
  all.forEach(function(s){var r=analyzeEpisodeGapsV2(s);if(r.missing.length){reports.push({s:s,r:r});total+=r.missing.length;}});
  reports.sort(function(a,b){return b.r.missing.length-a.r.missing.length||a.s.name.localeCompare(b.s.name);});
  var h='<div class="kpis compact">'+miniKpi('Scanned',all.length)+miniKpi('With gaps',reports.length,reports.length?'yellow':'green')+miniKpi('Missing '+epLabelFull().toLowerCase(),total,total?'yellow':'green')+'</div>';
  if(!reports.length)h+=emptyState('checkCircle','No gaps found','Every series has a continuous run of '+epLabelFull().toLowerCase()+'.','',true);
  else{
    h+='<div class="field-hint" style="margin:0 0 10px">Click '+epLabelFull().toLowerCase()+' to select them, then search for up to 20 at once.</div><div class="report" id="gapReport">';
    reports.forEach(function(x,i){
      var body='<div class="chips gap-chips">'+x.r.missing.map(function(n){return '<button class="chip" data-gap-name="'+E(x.s.name)+'" data-gap-ep="'+n+'">'+epLabel()+' '+n+'</button>';}).join('')+'</div>'
        +'<div class="row wrap" style="margin-top:12px"><span class="muted" style="font-size:12px">Expected '+x.r.start+'–'+x.r.end+'</span><span class="spacer"></span>'
        +'<button class="btn btn-ghost btn-xs"'+A('openFolderPath',x.s.path)+'>'+ic('folderOpen')+'Folder</button><button class="btn btn-ghost btn-xs"'+A('openNyaa',x.s.name)+'>'+ic('search')+'Search series</button><button class="btn btn-secondary btn-xs"'+A('configureGapRule',x.s.name)+'>'+ic('sliders')+'Adjust range</button></div>';
      h+=reportRow({title:x.s.name,img:S.covers[x.s.name],open:i<3,body:body,chips:'<span class="tag yellow">'+x.r.missing.length+' missing</span>'});
    });
    h+='</div>';
  }
  var m=openModal({id:'gapOverlay',title:'Episode gap detector',sub:'Numbering rules respect MAL totals, airing progress and your custom ranges.',icon:'scan',width:780,body:h,
    foot:reports.length?'<span class="muted" id="gapSelCount" style="margin-right:auto;font-size:12px">0 selected</span><button class="btn btn-ghost" data-modal-close>Close</button><button class="btn btn-primary"'+A('downloadSelectedGaps')+'>'+ic('download')+'Search selected</button>':'<button class="btn btn-primary" data-modal-close>Done</button>'});
  m.el.addEventListener('click',function(e){var b=e.target.closest('[data-gap-ep]');if(!b)return;b.classList.toggle('on');var n=m.el.querySelectorAll('[data-gap-ep].on').length;var c=m.el.querySelector('#gapSelCount');if(c)c.textContent=n+' selected';});
}
function _closeGapDetector(){closeModalById('gapOverlay');}
async function configureGapRule(name){
  var map=gapModeMap(),row=map[name]||{};
  var start=await askText({title:'Adjust expected range',text:name,label:'First expected '+epLabel().toLowerCase()+' number',value:String(row.start||1),confirm:'Next',validate:function(v){var n=parseInt(v,10);return isFinite(n)&&n>=1?'':'Enter a number ≥ 1';}});
  if(start===null)return;
  var ignored=await askText({title:'Ignore numbers',text:name,label:'Numbers or ranges to ignore (comma-separated)',value:(row.ignore||[]).join(', '),placeholder:'e.g. 0, 13-14',confirm:'Save'});
  if(ignored===null)return;
  map[name]={start:parseInt(start,10),ignore:parseGapNumberList(ignored)};api.setConfig('gapRules',S.cfg.gapRules);_closeGapDetector();runGapDetector();
}
async function downloadSelectedGaps(){
  var btns=Array.from(document.querySelectorAll('#gapOverlay [data-gap-ep].on'));
  if(!btns.length){toast('Select at least one missing '+epLabel().toLowerCase(),'i');return;}
  if(btns.length>20){toast('Select 20 or fewer at a time','e');return;}
  if(!await askConfirm({title:'Search '+plural(btns.length,epLabel().toLowerCase()+'.','items'),text:'Each selected '+epLabel().toLowerCase()+' is searched on Nyaa and the best match is handed to your torrent client.',confirm:'Search',icon:'download'}))return;
  var id=activityStart('gap','Download missing '+epLabelFull().toLowerCase(),btns.length+' selected');
  for(var i=0;i<btns.length;i++){var b=btns[i];activityUpdate(id,(i+1)+' / '+btns.length+' · '+b.dataset.gapName+' '+b.dataset.gapEp);await _downloadGap(b.dataset.gapName,parseFloat(b.dataset.gapEp));await sleep(250);}
  activityFinish(id,'success','Requested '+btns.length);
}
expose('configureGapRule','downloadSelectedGaps');

function runSyncHealth(){
  var r=_syncHealthAnalyze();
  var exp=S.cfg&&S.cfg.malTokenExpiry?new Date(S.cfg.malTokenExpiry):null;var expSoon=exp&&S.cfg.malTokenExpiry-Date.now()<24*3600000;
  var issues=r.unlinked.length+r.missingData.length+r.conflicts.length+r.invalid.length+r.suspicious.length+(!S.mal?1:0)+(S.cfg.syncPaused?1:0)+(expSoon?1:0);
  var h='<div class="kpis compact">'+miniKpi('Series',r.all.length)+miniKpi('Linked',r.linked.length,'green')+miniKpi('Unlinked',r.unlinked.length,r.unlinked.length?'yellow':'')+miniKpi('Suspicious',r.suspicious.length,r.suspicious.length?'red':'')+miniKpi('Conflicts',r.conflicts.length,r.conflicts.length?'red':'')+'</div>';
  h+='<div class="callout'+(S.mal&&!S.cfg.syncPaused&&!expSoon?' green':' yellow')+'">'+ic(S.mal?'layers':'alert')+'<span>'+(S.mal?(S.cfg.syncPaused?'Real-time sync is paused.':'Connected to MyAnimeList.'):'MyAnimeList is not connected.')+(exp?' Token valid until '+E(exp.toLocaleString())+'.':'')+'</span>'
    +(!S.mal?'<button class="btn btn-primary btn-sm"'+A('shGo','mal')+'>Connect</button>':S.cfg.syncPaused?'<button class="btn btn-secondary btn-sm"'+A('shResume')+'>Resume sync</button>':'')+'</div>';
  h+='<div class="report">';
  function sec(title,items,tone,renderBody,open){
    if(!items.length)return;var body='';items.slice(0,80).forEach(function(x){body+=renderBody(x);});if(items.length>80)body+='<div class="field-hint">Showing the first 80.</div>';
    h+=reportRow({title:title,open:open,chips:'<span class="tag '+tone+'">'+items.length+'</span>',body:body});
  }
  sec('Suspicious MAL links',r.suspicious,'red',function(x){var md=x.series.watchData.malData||{};var img=md.main_picture&&(md.main_picture.medium||md.main_picture.large);
    return '<div class="sh-row">'+(img?'<img class="thumb" src="'+E(img)+'" alt="">':'')+'<div class="grow"><div class="row-title ellipsis">'+E(x.series.name)+' <span class="muted">→</span> '+E(x.malTitle)+'</div><div class="row-sub red-txt">'+E(x.reasons.join(' · '))+'</div></div>'+confMeter(x.confidence)+'<button class="btn btn-secondary btn-xs"'+A('shFix',x.series.name)+'>Review</button></div>';},true);
  sec('Progress conflicts',r.conflicts,'red',function(x){return '<div class="sh-row"><div class="grow"><div class="row-title ellipsis">'+E(x.series.name)+'</div><div class="row-sub">This device '+x.local+' · MyAnimeList '+x.remote+'</div></div><button class="btn btn-secondary btn-xs"'+A('shOpen',x.series.name)+'>Open</button></div>';});
  sec('Unlinked series',r.unlinked,'yellow',function(s){return '<div class="sh-row"><div class="grow row-title ellipsis">'+E(s.name)+'</div><button class="btn btn-secondary btn-xs"'+A('shFix',s.name)+'>Link</button></div>';});
  sec('Linked without metadata',r.missingData,'blue',function(s){return '<div class="sh-row"><div class="grow row-title ellipsis">'+E(s.name)+'</div><button class="btn btn-secondary btn-xs"'+A('fetchMD',s.name,s.watchData.malId)+'>Refresh</button></div>';});
  sec('Invalid MAL IDs',r.invalid,'red',function(s){return '<div class="sh-row"><div class="grow row-title ellipsis">'+E(s.name)+' → '+E(s.watchData.malId)+'</div><button class="btn btn-secondary btn-xs"'+A('shFix',s.name)+'>Relink</button></div>';});
  h+='</div>';
  if(!issues)h+=emptyState('checkCircle','Sync looks healthy','Every series is linked with plausible metadata and matching progress.','',true);
  openModal({id:'syncHealthOverlay',title:'Sync health',sub:'MyAnimeList links, metadata and progress conflicts',icon:'heartPulse',width:820,body:h,
    foot:'<div class="left"><button class="btn btn-ghost"'+A('shGo','inbox')+'>'+ic('inbox')+'Import Inbox</button></div><button class="btn btn-secondary"'+A('verifySyncHealth')+'>'+ic('refresh')+'Re-verify all</button><button class="btn btn-primary" data-modal-close>Done</button>'});
}
function _closeSyncHealth(){closeModalById('syncHealthOverlay');}
act('shFix',function(el,ev,name){_closeSyncHealth();malRelink(name);});
act('shOpen',function(el,ev,name){_closeSyncHealth();odtl(name);});
act('shGo',function(el,ev,v){_closeSyncHealth();go(v);});
act('shResume',function(){toggleSync();_closeSyncHealth();runSyncHealth();});
async function verifySyncHealth(){_closeSyncHealth();await refreshLinkedMalData();runSyncHealth();}
expose('runSyncHealth','verifySyncHealth');

// ----------------------------------------------------------- cover manager --
function openCoverManager(){
  var all=librarySeries();var wo=all.filter(function(s){return !S.covers[s.name];});var wc=all.length-wo.length;
  var h='<div class="kpis compact">'+miniKpi('Series',all.length)+miniKpi('With covers',wc,'green')+miniKpi('Missing',wo.length,wo.length?'yellow':'green')+'</div>';
  if(!wo.length)h+=emptyState('checkCircle','Every series has a cover','Right-click any card and choose “Change cover” to swap one.','',true);
  else{h+='<div class="list-group">';wo.forEach(function(s){h+='<div class="lg-row"><span class="thumb ph">'+ic('image')+'</span><div class="lg-main"><div class="lg-title ellipsis">'+E(s.name)+'</div></div><div class="lg-ctrl"><button class="btn btn-ghost btn-xs"'+A('coverMgrAuto',s.name)+'>'+ic('wand')+'Auto</button><button class="btn btn-secondary btn-xs"'+A('coverMgrPick',s.name)+'>Choose…</button></div></div>';});h+='</div>';}
  openModal({id:'coverManagerOverlay',title:'Cover art',icon:'image',width:640,body:h,foot:(wo.length?'<div class="left"><button class="btn btn-secondary"'+A('coverMgrFetchAll')+'>'+ic('download')+'Fetch all missing</button></div>':'')+'<button class="btn btn-primary" data-modal-close>Done</button>'});
}
function closeCoverManager(){closeModalById('coverManagerOverlay');}
act('coverMgrAuto',function(el,ev,name){el.disabled=true;return fetch1(name).then(function(){closeCoverManager();openCoverManager();});});
act('coverMgrPick',function(el,ev,name){closeCoverManager();openCoverSearch(name);});
act('coverMgrFetchAll',function(){closeCoverManager();return fetchAll();});

// ------------------------------------------------------------ batch delete --
function openBatchDelete(){
  var all=librarySeries().sort(function(a,b){return a.name.localeCompare(b.name);});
  if(!all.length){toast('Your library is empty','i');return;}
  var h='<div class="row" style="margin-bottom:10px"><label class="check"><input type="checkbox" id="bdAll"> Select all</label><span class="spacer"></span><span class="muted" id="bdCount" style="font-size:12px">0 selected</span></div><div class="list-group bd-list">';
  all.forEach(function(s){h+='<label class="lg-row clickable"><span class="check"><input type="checkbox" class="bd-chk" data-path="'+E(s.path)+'" data-name="'+E(s.name)+'"></span>'+(S.covers[s.name]?'<img class="thumb" src="'+E(S.covers[s.name])+'" alt="" loading="lazy">':'<span class="thumb"></span>')+'<span class="lg-main"><span class="lg-title ellipsis" style="display:block">'+E(s.name)+'</span><span class="lg-desc mono ellipsis" style="display:block">'+E(s.path)+'</span></span><span class="muted" style="font-size:12px">'+plural(s.episodeCount,'file','files')+'</span></label>';});
  h+='</div>';
  var m=openModal({id:'batchDeleteOverlay',title:'Delete series',sub:'Permanently removes the selected folders and every file inside them.',icon:'trash',tone:'danger',width:720,body:h,
    foot:'<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-danger-solid" id="bdGo"'+A('executeBatchDelete')+' disabled>'+ic('trash')+'Delete selected</button>'});
  function upd(){var n=m.el.querySelectorAll('.bd-chk:checked').length;m.el.querySelector('#bdCount').textContent=n+' selected';m.el.querySelector('#bdGo').disabled=!n;}
  m.el.addEventListener('change',function(e){if(e.target.id==='bdAll'){m.el.querySelectorAll('.bd-chk').forEach(function(c){c.checked=e.target.checked;});}upd();});
}
function closeBatchDelete(){closeModalById('batchDeleteOverlay');}
async function executeBatchDelete(){
  var checks=document.querySelectorAll('#batchDeleteOverlay .bd-chk:checked');if(!checks.length)return;
  var paths=[],names=[];checks.forEach(function(c){paths.push(c.dataset.path);names.push(c.dataset.name);});
  if(!await askConfirm({title:'Delete '+plural(paths.length,'series','series')+'?',danger:true,confirm:'Delete permanently',text:'This cannot be undone.',body:'<div class="path-list">'+paths.map(function(p){return '<div class="mono">'+E(p)+'</div>';}).join('')+'</div>'}))return;
  closeBatchDelete();toast('Deleting '+plural(paths.length,'series','series')+'…','i');
  var r=await api.batchDeleteSeries(paths);
  if(!Array.isArray(r)){toast('Delete failed: '+((r&&r.error)||'unknown error'),'e');return;}
  var failed=r.filter(function(x){return !x.success;});failed.forEach(function(x){console.error('[BatchDelete]',x.path,x.error||'');});
  if(S.cfg.untrackOnDelete!==false)S._autoDownloadWatchlist=await api.autoDownloadGetWatchlist();
  toast(failed.length?'Deleted '+(r.length-failed.length)+', '+failed.length+' failed':'Deleted '+plural(r.length,'series','series'),failed.length?'e':'s');
  await loadLib();
}
expose('executeBatchDelete');
