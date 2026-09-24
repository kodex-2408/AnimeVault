/* AnimeVault renderer — Settings (two-pane, searchable, grouped rows). */

var SETTINGS_SECTIONS=[
  {id:'library',label:'Library',icon:'folder',color:'var(--accent)'},
  {id:'manga',label:'Manga',icon:'book',color:'#ff6b35'},
  {id:'playback',label:'Playback',icon:'playCircle',color:'#30d158'},
  {id:'downloads',label:'Downloads',icon:'download',color:'#0a84ff'},
  {id:'import',label:'Import & matching',icon:'inbox',color:'#bf5af2'},
  {id:'aliases',label:'Titles & parser',icon:'tag',color:'#64d2ff'},
  {id:'notifications',label:'Notifications',icon:'bell',color:'#ff375f'},
  {id:'companion',label:'Luma',icon:'sparkles',color:'#ffcc4d'},
  {id:'system',label:'Performance & window',icon:'cpu',color:'#8e8e93'},
  {id:'data',label:'Data & backup',icon:'database',color:'#5e5ce6'}
];
function setRow(o){
  // o:{icon,color,title,desc,ctrl,kw,block,cls}
  var kw=((o.title||'')+' '+(o.desc||'')+' '+(o.kw||'')).toLowerCase();
  if(o.block)return '<div class="lg-row block set-row'+(o.cls?' '+o.cls:'')+'" data-kw="'+E(kw)+'">'+o.block+'</div>';
  return '<div class="lg-row set-row'+(o.icon?' has-icon':'')+(o.cls?' '+o.cls:'')+'" data-kw="'+E(kw)+'">'+(o.icon?'<div class="lg-icon" style="--ic:'+(o.color||'var(--accent)')+'">'+ic(o.icon)+'</div>':'')
    +'<div class="lg-main"><div class="lg-title">'+o.title+'</div>'+(o.desc?'<div class="lg-desc">'+o.desc+'</div>':'')+'</div>'+(o.ctrl?'<div class="lg-ctrl">'+o.ctrl+'</div>':'')+'</div>';
}
function cfgSwitch(key,defTrue,action){var v=defTrue?S.cfg[key]!==false:!!S.cfg[key];return switchCtl(v,action||'cfgToggle',action?[]:[key]);}
function cfgSelect(key,opts,def,action,numeric){
  var cur=S.cfg[key]==null?def:S.cfg[key];
  return '<select class="select sm"'+On('change',action||'cfgSelect',key,!!numeric)+'>'+opts.map(function(o){return '<option value="'+E(o[0])+'"'+(String(cur)===String(o[0])?' selected':'')+'>'+E(o[1])+'</option>';}).join('')+'</select>';
}
act('cfgToggle',function(el,ev,key){S.cfg[key]=el.checked;api.setConfig(key,el.checked);afterCfgChange(key);});
act('cfgSelect',function(el,ev,key,numeric){var v=numeric?parseInt(el.value,10):el.value;S.cfg[key]=v;api.setConfig(key,v);afterCfgChange(key);});
act('cfgText',function(el,ev,key){var v=el.value.trim();S.cfg[key]=v;api.setConfig(key,v);toast('Saved','s');});
function afterCfgChange(key){
  if(key==='hideDonghua'){S.exploreTop=[];S.exploreSeasonal=[];}
  if(key==='lumaMascot'||key==='lumaSparkles')initLuma();
  if(key==='playerType'&&S.view==='settings')render();
}

function sectionHtml(id){
  var h='';
  if(id==='library'){
    h+=folderRows('folders',[['seasonal','Seasonal'],['series','Series'],['movies','Movies'],['custom','Custom']]);
  }else if(id==='manga'){
    h+=folderRows('mangaFolders',[['series','Series'],['oneshot','Oneshot'],['custom','Custom']]);
    h+=setRow({block:'<div class="field"><label class="field-label">Reader application</label><div class="input-row"><input class="input mono" id="sReaderPath" value="'+E(S.cfg.readerPath||'')+'" placeholder="Leave empty to use the system default"'+On('change','cfgText','readerPath')+'><button class="btn btn-secondary btn-sm"'+A('brsReader')+'>Browse…</button><button class="btn btn-ghost btn-sm"'+A('detectReader')+'>'+ic('search')+'Detect</button></div><div class="field-hint" id="readerDetectHint">Opens .cbz / .cbr / .pdf files in MangaVault mode — OpenComic, CDisplayEx, SumatraPDF and Honeyview are detected automatically.</div></div>',kw:'reader cbz cbr opencomic sumatra'});
  }else if(id==='playback'){
    var pt=S.cfg.playerType||'vlc';
    h+=setRow({icon:'playCircle',color:'#30d158',title:'Video player',desc:pt==='bundled-mpv'?'Bundled MPV needs no setup and supports auto-mark.':pt==='system-default'?'Uses your default video app. Auto-mark is not available.':'Set the executable path below.',ctrl:cfgSelect('playerType',[['bundled-mpv','Bundled MPV (recommended)'],['mpv','MPV — custom path'],['vlc','VLC — custom path'],['system-default','System default']],'vlc'),kw:'vlc mpv bundled player'});
    if(pt==='vlc')h+=pathRow('VLC executable','sVlc','vlcPath','C:\\Program Files\\VideoLAN\\VLC\\vlc.exe');
    if(pt==='mpv')h+=pathRow('MPV executable','sMpv','mpvPath','C:\\Tools\\mpv\\mpv.exe');
    h+=setRow({icon:'checkCircle',color:'#30d158',title:'Auto-mark as '+watchedLabel(),desc:'Marks the episode when playback passes a percentage (VLC and MPV).',ctrl:'<input class="input sm pct-input" type="number" min="10" max="100" value="'+(S.cfg.autoMarkPercent||80)+'"'+On('change','setAutoMarkPct')+'><span class="muted">%</span>'+cfgSwitch('autoMarkEnabled',true),kw:'auto mark percent'});
    h+=setRow({icon:'volume',color:'#64d2ff',title:'Bluetooth audio delay fix',desc:'Shifts audio by −300 ms to compensate for wireless headphone latency (MPV).',ctrl:cfgSwitch('audioDelay'),kw:'audio delay headphones wireless bluetooth'});
    var langs=[['','Off'],['en','English'],['es','Spanish'],['pt','Portuguese'],['fr','French'],['de','German'],['it','Italian'],['ru','Russian'],['ar','Arabic'],['ja','Japanese']];
    h+=setRow({icon:'subtitles',color:'#ffcc4d',title:'Subtitles',desc:'Preferred and fallback subtitle tracks passed to the player.',ctrl:cfgSelect('subLangPrimary',langs,'')+cfgSelect('subLangFallback',langs,''),kw:'subtitle language slang'});
  }else if(id==='downloads'){
    var ups=[['erai','Erai-raws — multi-sub CR WEB-DL'],['subsplease','SubsPlease — fastest, single sub'],['judas','Judas — HEVC, smaller files'],['varyg','VARYG — dual audio']];
    h+=setRow({icon:'magnet',color:'#0a84ff',title:'Preferred release group',desc:'Used for latest-episode and auto-download searches.',ctrl:cfgSelect('nyaaUploader',ups,'erai'),kw:'nyaa uploader erai subsplease judas varyg'});
    h+=setRow({icon:'monitor',color:'#0a84ff',title:'Quality',ctrl:seg('nyaaQ',[{v:'1080p',label:'1080p'},{v:'720p',label:'720p'},{v:'480p',label:'480p'}],S.cfg.nyaaQuality||'1080p','setNyaaQuality'),kw:'quality resolution'});
    h+=setRow({icon:'box',color:'#0a84ff',title:'Prefer HEVC (x265)',desc:'Strongly favors HEVC releases even with fewer seeders.',ctrl:cfgSwitch('forceHevc',true),kw:'hevc x265 codec'});
    h+=setRow({icon:'hardDrive',color:'#0a84ff',title:'Avoid oversized HEVC',desc:'When HEVC is over twice the size of the best H.264 release, let the smaller one win.',ctrl:cfgSwitch('avoidOversizedHevc'),kw:'size hevc'});
    if(!isManga()){
      h+=setRow({icon:'zap',color:'#ff9f0a',title:'Auto-download',desc:'Checks Nyaa for new episodes of series you explicitly track and hands torrents to your client.',ctrl:switchCtl(!!S.cfg.autoDownloadEnabled,'setAutoDownloadEnabled'),kw:'auto download airing'});
      h+=setRow({icon:'clock',color:'#ff9f0a',title:'Check every',ctrl:cfgSelect('autoDownloadPollMinutes',[[15,'15 minutes'],[30,'30 minutes'],[60,'1 hour']],30,'setPollMinutes',true),kw:'poll interval'});
      h+=setRow({icon:'layers',color:'#ff9f0a',title:'Catch-up batch size',desc:'How many missed episodes to fetch per check.',ctrl:cfgSelect('autoDownloadBatchLimit',[[0,'All pending'],[5,'5 per check'],[3,'3 per check'],[1,'1 per check']],0,'setBatchLimit',true),kw:'catch up batch missing'});
      h+=setRow({icon:'bell',color:'#ff9f0a',title:'Desktop notifications for downloads',ctrl:cfgSwitch('autoDownloadNotify'),kw:'notify'});
      h+=setRow({icon:'trash',color:'#ff9f0a',title:'Stop tracking deleted series',desc:'Removing a series folder also removes it from auto-download.',ctrl:cfgSwitch('untrackOnDelete',true),kw:'untrack delete'});
      h+=setRow({block:'<div class="row wrap"><button class="btn btn-secondary btn-sm"'+A('adPollNow',false)+'>'+ic('refresh')+'Check now</button><button class="btn btn-ghost btn-sm"'+A('catchupAllPendingEpisodes')+'>'+ic('zap')+'Catch up everything</button><span class="spacer"></span><button class="btn btn-ghost btn-sm"'+A('go','downloads')+'>Tracked series & history'+ic('chevronRight')+'</button></div>',kw:'history tracked poll'});
    }
  }else if(id==='import'){
    h+=setRow({icon:'wand',color:'#bf5af2',title:'Pre-select the best MAL match',desc:'Picks matches with 45%+ title confidence in the Import Inbox. You still confirm every import.',ctrl:cfgSwitch('importAutoMatch',true),kw:'auto match import inbox mal'});
    h+=setRow({icon:'trash',color:'#ff453a',title:'Watch & delete',desc:'Deletes episode files five seconds after they’re auto-marked as '+watchedLabel()+'.',ctrl:cfgSwitch('watchAndDelete'),kw:'watch delete library mode'});
    h+=setRow({icon:'globe',color:'#bf5af2',title:'Hide donghua in Explore',desc:'Filters Chinese-produced animation from Explore using studio and title detection.',ctrl:cfgSwitch('hideDonghua',true),kw:'donghua chinese explore filter'});
    h+=setRow({block:'<div class="field"><label class="field-label">Watcher ignore patterns</label><div class="input-row"><input class="input mono" id="watcherIgnoreInput" value="'+E((S.cfg.watcherIgnorePatterns||[]).join(', '))+'" placeholder="sample, trailer, \\.nfo$, extras"><button class="btn btn-secondary btn-sm"'+A('saveWatcherIgnore')+'>Save</button></div><div class="field-hint">Comma-separated regular expressions. Matching files are ignored by the download watcher.</div></div>',kw:'watcher ignore regex patterns exclude'});
  }else if(id==='aliases'){
    h+=setRow({block:'<div class="field"><label class="field-label">Filename preview</label><div class="fields cols-2"><input class="input mono" id="parserPreviewFile" placeholder="[Group] Series - 03 [1080p].mkv"><input class="input" id="parserPreviewFolder" placeholder="Parent folder (optional)"></div><div class="row" style="margin-top:8px"><button class="btn btn-secondary btn-sm"'+A('previewFilenameParse')+'>'+ic('eye')+'Preview</button><div id="parserPreviewResult" class="grow"></div></div></div>',kw:'parser preview filename'});
    var aliases=aliasModeMap();var names=Object.keys(aliases).sort();
    var ab='<div class="field"><label class="field-label">Title aliases</label><div class="field-hint" style="margin-bottom:8px">Map a local folder name to the titles used when searching MyAnimeList, AniList covers and Nyaa releases.</div>'
      +'<div class="fields cols-4"><input class="input sm" id="aliasLocal" placeholder="Local folder title"><input class="input sm" id="aliasMal" placeholder="MAL search"><input class="input sm" id="aliasAniList" placeholder="AniList search"><input class="input sm" id="aliasNyaa" placeholder="Nyaa search"></div>'
      +'<div class="row" style="margin-top:8px"><button class="btn btn-primary btn-sm"'+A('saveTitleAlias')+'>'+ic('plus')+'Save alias</button></div>';
    if(names.length){ab+='<div class="alias-list">';names.forEach(function(n){var r=aliases[n]||{};ab+='<div class="alias-row"><div class="grow"><div class="row-title ellipsis">'+E(n)+'</div><div class="row-sub ellipsis">MAL: '+E(r.mal||n)+' · AniList: '+E(r.anilist||n)+' · Nyaa: '+E(r.nyaa||n)+'</div></div><button class="icon-btn sm"'+A('editTitleAlias',n)+Tip('Edit')+'>'+ic('pencil')+'</button><button class="icon-btn sm danger"'+A('deleteTitleAlias',n)+Tip('Remove')+'>'+ic('trash')+'</button></div>';});ab+='</div>';}
    h+=setRow({block:ab+'</div>',kw:'alias title mal anilist nyaa canonical'});
  }else if(id==='notifications'){
    [['watcher','File watcher','Files organized or new series detected.'],['healthCheck','Library health check','Results of the health scanner.'],['rescan','Library rescan','When a rescan or cover fetch finishes.'],['autoDownload','Auto-download','Torrents handed off, skipped or failed.'],['malSync','MyAnimeList sync','Progress synced and sync errors.'],['duplicates','Duplicate files','When duplicate episode files are found.']].forEach(function(n){
      h+=setRow({title:n[1],desc:n[2],ctrl:switchCtl(notifEnabled(n[0]),'setNotifPrefSw',[n[0]]),kw:'notification toast '+n[0]});
    });
    h+=setRow({block:'<div class="row"><button class="btn btn-ghost btn-sm"'+A('resetNotifPrefs')+'>Reset to defaults</button></div>',kw:'reset notifications'});
  }else if(id==='companion'){
    h+=setRow({icon:'sparkles',color:'#ffcc4d',title:'Luma on screen',desc:'A little star spirit that floats around the window. He never blocks your clicks — click him to chat.',ctrl:cfgSwitch('lumaMascot'),kw:'luma mascot companion star'});
    h+=setRow({icon:'sparkles',color:'#ffcc4d',title:'Sparkle trail',ctrl:cfgSwitch('lumaSparkles',true),kw:'sparkle trail'});
    h+=setRow({icon:'expand',color:'#ffcc4d',title:'Size & style',ctrl:seg('lumaSize',[{v:'small',label:'Small'},{v:'medium',label:'Medium'},{v:'big',label:'Big'},{v:'rainbow',label:'Rainbow'}],S.cfg.lumaSize||'medium','setLumaSize'),kw:'size rainbow'});
    h+=setRow({icon:'activity',color:'#ffcc4d',title:'Speed',ctrl:seg('lumaSpeed',[{v:'slow',label:'Slow'},{v:'normal',label:'Normal'},{v:'fast',label:'Fast'}],S.cfg.lumaSpeed||'normal','setLumaSpeed'),kw:'speed'});
    h+=setRow({icon:'lock',color:'#ffcc4d',title:'OpenRouter key',desc:S.cfg.hasOpenrouterApiKey?'Stored encrypted with your Windows account and only used by the main process.':'Add a key from openrouter.ai/keys to chat with Luma.',ctrl:S.cfg.hasOpenrouterApiKey?'<span class="tag green">'+ic('check')+'Saved</span><button class="btn btn-ghost btn-sm"'+A('clearAiKey')+'>Remove</button>':'<button class="btn btn-secondary btn-sm"'+A('openLumaAssistant')+'>Add key</button>',kw:'openrouter api key ai assistant chat'});
  }else if(id==='system'){
    h+=setRow({icon:'cpu',color:'#8e8e93',title:'Performance mode',desc:'Turns off blur, glass and ambient effects and shortens motion — ideal for large libraries or older GPUs.',ctrl:switchCtl(!!S.cfg.performanceMode,'setPerformanceModeSw'),kw:'performance speed gpu blur'});
    h+=setRow({icon:'database',color:'#8e8e93',title:'Incremental library index',desc:'Only re-reads folders that changed since the last scan.',ctrl:'<button class="btn btn-ghost btn-sm"'+A('rebuildLibraryIndex')+'>Rebuild</button>'+cfgSwitch('incrementalScan',true),kw:'index cache scan incremental'});
    h+=setRow({icon:'window',color:'#8e8e93',title:'Minimize to tray',desc:'Closing or minimizing hides AnimeVault in the system tray.',ctrl:switchCtl(!!S.cfg.minimizeToTray,'setTraySw'),kw:'tray minimize close window'});
  }else if(id==='data'){
    h+=setRow({icon:'download',color:'#5e5ce6',title:'Export library',desc:'Metadata as JSON, or a spreadsheet-friendly CSV.',ctrl:'<button class="btn btn-secondary btn-sm"'+A('exportLibraryJSON')+'>JSON</button><button class="btn btn-secondary btn-sm"'+A('exportLibraryCSV')+'>CSV</button>',kw:'export json csv'});
    h+=setRow({icon:'database',color:'#5e5ce6',title:'Backup & restore',desc:'Saves settings, watch history and cached covers to a .zip in Downloads.',ctrl:'<button class="btn btn-secondary btn-sm"'+A('backupAppData')+'>Back up</button><button class="btn btn-ghost btn-sm"'+A('restoreAppData')+'>Restore…</button>',kw:'backup restore zip'});
    h+=setRow({icon:'globe',color:'#5e5ce6',title:'Import from AniList',desc:'Adds every entry of an AniList user to MyAnimeList as Plan to Watch.',ctrl:'<input class="input sm" id="anilistUser" placeholder="AniList username" style="min-width:150px"'+On('enter','importAniList')+'><button class="btn btn-secondary btn-sm"'+A('importAniList')+'>Import</button>',kw:'anilist import'});
    h+=setRow({icon:'folderOpen',color:'#5e5ce6',title:'App data folder',desc:'Config, caches, cover art and logs.',ctrl:'<button class="btn btn-secondary btn-sm"'+A('openFolderPath',S.cfg._userDataPath||'')+'>Open</button>',kw:'data folder appdata logs'});
    h+=setRow({icon:'alert',color:'#ff453a',title:'Reset everything',desc:'Clears preferences, folders, MAL connection and watch history. Cover art on disk is kept.',ctrl:'<button class="btn btn-danger btn-sm"'+A('resetAllConfirm')+'>Reset…</button>',kw:'reset factory clear',cls:'danger'});
  }
  return h;
}
function pathRow(label,id,key,ph){return setRow({block:'<div class="field"><label class="field-label">'+E(label)+'</label><div class="input-row"><input class="input mono" id="'+id+'" value="'+E(S.cfg[key]||'')+'" placeholder="'+E(ph)+'"'+On('change','cfgText',key)+'><button class="btn btn-secondary btn-sm"'+A('brsPlayer',id,key)+'>Browse…</button></div></div>',kw:'path executable '+key});}
function folderRows(key,types){
  var list=S.cfg[key]||[];var h='';
  list.forEach(function(f,i){
    h+=setRow({block:'<div class="folder-row"><span class="tag accent cap">'+E(f.type)+'</span><div class="grow"><div class="row-title">'+E(f.label||f.type)+'</div><div class="row-sub mono ellipsis"'+Tip(f.path)+'>'+E(f.path)+'</div></div>'
      +'<button class="icon-btn sm plain"'+A('moveFolder',i,-1,key==='mangaFolders')+(i===0?' disabled':'')+Tip('Move up')+'>'+ic('arrowUp')+'</button><button class="icon-btn sm plain"'+A('moveFolder',i,1,key==='mangaFolders')+(i===list.length-1?' disabled':'')+Tip('Move down')+'>'+ic('arrowDown')+'</button>'
      +'<button class="icon-btn sm plain"'+A('openFolderPath',f.path)+Tip('Open')+'>'+ic('folderOpen')+'</button><button class="icon-btn sm danger"'+A('removeFolder',key,i)+Tip('Remove')+'>'+ic('trash')+'</button></div>',kw:'folder path library '+f.label+' '+f.path});
  });
  if(!list.length)h+=setRow({block:'<div class="row muted" style="font-size:12.5px">'+ic('info')+'No '+(key==='mangaFolders'?'manga ':'')+'folders yet — add one below.</div>',kw:'folder'});
  var p=key==='mangaFolders'?'nmf':'nf';
  h+=setRow({block:'<div class="add-folder"><input class="input sm" id="'+p+'Label" placeholder="Label (e.g. Seasonal)"><select class="select sm" id="'+p+'Type">'+types.map(function(t){return '<option value="'+t[0]+'">'+t[1]+'</option>';}).join('')+'</select><div class="input-row grow"><input class="input sm mono" id="'+p+'Path" placeholder="Folder path"><button class="btn btn-secondary btn-sm"'+A('browseInto',p+'Path')+'>Browse…</button></div><button class="btn btn-primary btn-sm"'+A('addFolderFrom',key,p)+'>'+ic('plus')+'Add</button></div>',kw:'add folder path'});
  return h;
}

function vSet(){
  var q=(S.setQ||'').trim().toLowerCase();
  var h='<div class="view settings">'+pageHead('Settings','Everything that makes the vault yours.');
  h+='<div class="settings-layout"><aside class="settings-nav">'+searchField({id:'setSearch',value:S.setQ||'',placeholder:'Search settings',input:'setSearchInput',clear:'setSearchClear',size:'sm'})+'<nav>';
  SETTINGS_SECTIONS.forEach(function(sec){h+='<button class="set-nav'+(S.setSection===sec.id?' active':'')+'" data-sec="'+sec.id+'"'+A('scrollToSection',sec.id)+'><span class="lg-icon" style="--ic:'+sec.color+'">'+ic(sec.icon)+'</span>'+E(sec.label)+'</button>';});
  h+='<div class="set-nav-sep"></div><button class="set-nav"'+A('go','appearance')+'><span class="lg-icon" style="--ic:#ff9f0a">'+ic('palette')+'</span>Appearance'+ic('chevronRight','set-nav-go')+'</button><button class="set-nav"'+A('go','mal')+'><span class="lg-icon" style="--ic:#2e51a2">'+ic('layers')+'</span>MyAnimeList'+ic('chevronRight','set-nav-go')+'</button>';
  h+='</nav></aside><div class="settings-main" id="settingsMain">';
  SETTINGS_SECTIONS.forEach(function(sec){
    h+='<section class="set-sec" id="set-'+sec.id+'"><div class="set-sec-title">'+E(sec.label)+'</div><div class="list-group">'+sectionHtml(sec.id)+'</div></section>';
  });
  h+='<div class="set-empty hidden" id="setEmpty">'+emptyState('search','No settings match','Try another word, like “subtitle”, “tray” or “backup”.','',true)+'</div>';
  h+='</div></div></div>';
  return h;
}
function afterSettingsRender(){
  applySettingsFilter();
  if(S._scrollToSec&&S.setSection){var sec=document.getElementById('set-'+S.setSection);if(sec)sec.scrollIntoView({block:'start'});S._scrollToSec=false;}
  var mc=document.getElementById('mc');
  if(mc._setSpy)mc.removeEventListener('scroll',mc._setSpy);
  mc._setSpy=debounce(function(){
    if(S.view!=='settings')return;var top=mc.getBoundingClientRect().top+chromeTop()+120;var cur=null;
    document.querySelectorAll('.set-sec').forEach(function(s){if(s.style.display!=='none'&&s.getBoundingClientRect().top<=top)cur=s.id.slice(4);});
    if(cur&&cur!==S.setSection){S.setSection=cur;document.querySelectorAll('.set-nav[data-sec]').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-sec')===cur);});}
  },60);
  mc.addEventListener('scroll',mc._setSpy,{passive:true});
}
function applySettingsFilter(){
  var q=(S.setQ||'').trim().toLowerCase();var any=false;
  document.querySelectorAll('.set-sec').forEach(function(sec){
    var label=sec.querySelector('.set-sec-title').textContent.toLowerCase();var secHit=q&&label.indexOf(q)>=0;var vis=0;
    sec.querySelectorAll('.set-row').forEach(function(r){var show=!q||secHit||r.getAttribute('data-kw').indexOf(q)>=0;r.style.display=show?'':'none';if(show)vis++;});
    sec.style.display=vis?'':'none';if(vis)any=true;
    var nav=document.querySelector('.set-nav[data-sec="'+sec.id.slice(4)+'"]');if(nav)nav.classList.toggle('dimmed',!vis);
  });
  var em=document.getElementById('setEmpty');if(em)em.classList.toggle('hidden',any);
}
act('setSearchInput',function(el){S.setQ=el.value;el.closest('.search').classList.toggle('has-value',!!el.value);applySettingsFilter();});
act('setSearchClear',function(){S.setQ='';var i=document.getElementById('setSearch');if(i){i.value='';i.closest('.search').classList.remove('has-value');}applySettingsFilter();});
act('scrollToSection',function(el,ev,id){S.setSection=id;var sec=document.getElementById('set-'+id);if(sec)sec.scrollIntoView({behavior:S.cfg.animSpeed==='none'?'auto':'smooth',block:'start'});document.querySelectorAll('.set-nav[data-sec]').forEach(function(b){b.classList.toggle('active',b===el);});});
act('setNyaaQuality',function(el,ev,v){S.cfg.nyaaQuality=v;api.setConfig('nyaaQuality',v);});
act('setAutoMarkPct',function(el){var v=parseInt(el.value,10);if(v>=10&&v<=100){S.cfg.autoMarkPercent=v;api.setConfig('autoMarkPercent',v);toast('Auto-mark at '+v+'%','s');}else{el.value=S.cfg.autoMarkPercent||80;toast('Enter a value from 10 to 100','e');}});
act('setAutoDownloadEnabled',function(el){return toggleAutoDownloadGlobal(el.checked);});
act('setPollMinutes',function(el){var v=parseInt(el.value,10);S.cfg.autoDownloadPollMinutes=v;api.autoDownloadSetPollMinutes(v);});
act('setBatchLimit',function(el){var v=parseInt(el.value,10);S.cfg.autoDownloadBatchLimit=v;api.autoDownloadSetBatchLimit(v);api.setConfig('autoDownloadBatchLimit',v);});
act('setNotifPrefSw',function(el,ev,key){setNotifPref(key,el.checked);});
act('setPerformanceModeSw',function(el){setPerformanceMode(el.checked);});
act('setTraySw',function(el){return toggleMinimizeToTray(el.checked);});
act('setLumaSize',function(el,ev,v){setLumaSize(v);});
act('setLumaSpeed',function(el,ev,v){setLumaSpeed(v);});
act('resetAllConfirm',async function(){
  if(!await askConfirm({title:'Reset everything?',danger:true,confirm:'Reset AnimeVault',text:'Preferences, library folders, the MyAnimeList connection and watch history will be cleared. Cover art on disk is kept. A copy of your current config is archived automatically.'}))return;
  return resetAllPreferences();
});
act('browseInto',async function(el,ev,id){var f=await api.browseFolder();if(f){var i=document.getElementById(id);if(i)i.value=f;}});
act('brsPlayer',async function(el,ev,id,key){var f=await api.openFile([{name:'Executables',extensions:['exe']}]);if(f){var i=document.getElementById(id);if(i)i.value=f;S.cfg[key]=f;api.setConfig(key,f);toast('Saved','s');}});
act('addFolderFrom',function(el,ev,key,p){
  var label=(document.getElementById(p+'Label').value||'').trim();var type=document.getElementById(p+'Type').value;var path=(document.getElementById(p+'Path').value||'').trim();
  if(!path){toast('Choose a folder path first','e');return;}
  if(!S.cfg[key])S.cfg[key]=[];
  if(S.cfg[key].some(function(f){return String(f.path).toLowerCase()===path.toLowerCase();})){toast('That folder is already in the list','e');return;}
  label=label||type.charAt(0).toUpperCase()+type.slice(1);
  S.cfg[key].push({path:path,label:label,type:type});
  return afterFoldersChanged(key,'Added '+label);
});
act('removeFolder',async function(el,ev,key,i){
  var f=(S.cfg[key]||[])[i];if(!f)return;
  if(!await askConfirm({title:'Remove “'+(f.label||f.type)+'”?',text:'The folder is only removed from AnimeVault — nothing is deleted from disk.',confirm:'Remove',icon:'folder'}))return;
  S.cfg[key].splice(i,1);return afterFoldersChanged(key,'Folder removed');
});
act('moveFolder',function(el,ev,i,dir,manga){var key=manga?'mangaFolders':'folders';var f=S.cfg[key];var ni=i+dir;if(!f||ni<0||ni>=f.length)return;var t=f[i];f[i]=f[ni];f[ni]=t;api.setConfig(key,f);render();});
async function afterFoldersChanged(key,msg){
  await api.setConfig(key,S.cfg[key]);
  toast(msg,'s');render();
  // The watcher matches destinations against library roots; restart it so it sees the change.
  try{var ws=await api.watcherStatus();if(ws&&ws.enabled&&ws.folder){await api.watcherStop();await api.watcherStart(ws.folder,ws.dest||ws.folder);S.watcherStatus=await api.watcherStatus();}}catch(e){console.warn('[watcher restart]',e);}
  await loadLib(true);
}
expose('brsReader','detectReader','saveWatcherIgnore','previewFilenameParse','saveTitleAlias','editTitleAlias','deleteTitleAlias','resetNotifPrefs','rebuildLibraryIndex','exportLibraryJSON','exportLibraryCSV','backupAppData','restoreAppData','importAniList','clearAiKey','openLumaAssistant','catchupAllPendingEpisodes');

async function brsReader(){var f=await api.openFile([{name:'Executables',extensions:['exe']}]);if(f){var i=document.getElementById('sReaderPath');if(i)i.value=f;S.cfg.readerPath=f;api.setConfig('readerPath',f);toast('Reader saved','s');}}
async function detectReader(){
  var hint=document.getElementById('readerDetectHint');if(hint)hint.textContent='Scanning common install locations…';
  var hits=await api.detectMangaReaders();hits=Array.isArray(hits)?hits:(hits&&Array.isArray(hits.readers))?hits.readers:(hits&&hits.path?[{name:hits.path.replace(/.*[\\/]/,''),path:hits.path}]:[]);
  if(!hits.length){if(hint)hint.textContent='No supported reader found in Program Files or AppData. You can still browse to one manually.';toast('No readers detected','i');return;}
  var pick=hits.length===1?hits[0]:await askChoice({title:'Choose a reader',text:'Several readers are installed.',icon:'book',choices:hits.map(function(h2){return {label:h2.name,desc:h2.path,value:h2,icon:'book'};})});
  if(!pick)return;
  S.cfg.readerPath=pick.path;api.setConfig('readerPath',pick.path);var i=document.getElementById('sReaderPath');if(i)i.value=pick.path;
  if(hint)hint.textContent='Using '+pick.name+'.';toast('Reader set: '+pick.name,'s');
}
function saveWatcherIgnore(){
  var val=(document.getElementById('watcherIgnoreInput')||{}).value||'';
  var patterns=val.split(',').map(function(s){return s.trim();}).filter(Boolean);
  var bad=patterns.filter(function(p){try{new RegExp(p,'i');return false;}catch(e){return true;}});
  S.cfg.watcherIgnorePatterns=patterns;api.setConfig('watcherIgnorePatterns',patterns);
  toast(bad.length?'Saved — '+bad.length+' pattern(s) will be matched as plain text':'Ignore patterns saved',bad.length?'i':'s');
}
async function previewFilenameParse(){
  var file=document.getElementById('parserPreviewFile'),folder=document.getElementById('parserPreviewFolder'),out=document.getElementById('parserPreviewResult');if(!file||!out)return;
  if(!file.value.trim()){out.innerHTML='<span class="muted">Enter a filename first.</span>';return;}
  out.innerHTML='<span class="spinner"></span>';
  var r=await api.managerPreviewParse(file.value,folder?folder.value:'');
  if(!r||r.error){out.innerHTML='<span class="tag red">'+E(r&&r.error||'Could not parse this filename')+'</span>';return;}
  out.innerHTML='<div class="row wrap"><span class="tag '+(r.matched?'green':'yellow')+'">'+(r.matched?'Matched':'Needs review')+'</span><span class="tag">'+epLabel()+' '+E(r.mediaNumber==null?'?':r.mediaNumber)+'</span><span class="tag">'+E(r.series||'Unknown series')+'</span><span class="mono muted" style="font-size:11.5px">→ '+E(r.newName||'')+'</span></div>';
}
function saveTitleAlias(){
  var local=document.getElementById('aliasLocal'),mal=document.getElementById('aliasMal'),ani=document.getElementById('aliasAniList'),nyaa=document.getElementById('aliasNyaa');if(!local)return;
  var name=local.value.trim();if(!name){toast('Enter the local folder title','e');return;}
  aliasModeMap()[name]={mal:(mal.value.trim()||name),anilist:(ani.value.trim()||mal.value.trim()||name),nyaa:(nyaa.value.trim()||mal.value.trim()||name)};
  api.setConfig('titleAliases',S.cfg.titleAliases);toast('Alias saved','s');render();
}
function editTitleAlias(name){var row=aliasModeMap()[name]||{};var set=function(id,v){var el=document.getElementById(id);if(el)el.value=v||'';};set('aliasLocal',name);set('aliasMal',row.mal);set('aliasAniList',row.anilist);set('aliasNyaa',row.nyaa);var el=document.getElementById('aliasLocal');if(el)el.focus();}
function deleteTitleAlias(name){delete aliasModeMap()[name];api.setConfig('titleAliases',S.cfg.titleAliases);render();toast('Alias removed','i');}
function setNotifPref(key,enabled){if(!S.cfg.notificationPrefs)S.cfg.notificationPrefs={};S.cfg.notificationPrefs[key]=enabled;api.setConfig('notificationPrefs',S.cfg.notificationPrefs);}
function resetNotifPrefs(){S.cfg.notificationPrefs={};api.setConfig('notificationPrefs',{});render();toast('Notifications reset','s');}

async function exportLibraryJSON(){try{var data=await api.exportLibraryMetadata();downloadBlob(JSON.stringify(data,null,2),'application/json','animevault_library.json');toast('Exported JSON','s');}catch(e){toast('Export failed','e');}}
async function exportLibraryCSV(){try{var csv=await api.exportLibraryCSV();downloadBlob(csv,'text/csv','animevault_library.csv');toast('Exported CSV','s');}catch(e){toast('Export failed','e');}}
function downloadBlob(content,type,name){var blob=new Blob([content],{type:type});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);}
async function importAniList(){
  var el=document.getElementById('anilistUser');var user=el?el.value.trim():'';
  if(!user){toast('Enter an AniList username','e');return;}
  if(!/^[A-Za-z0-9_-]{2,40}$/.test(user)){toast('That doesn’t look like an AniList username','e');return;}
  if(!S.mal){toast('Connect MyAnimeList first','e');return;}
  if(!await askConfirm({title:'Import '+user+'’s AniList?',text:'Every entry with a MAL ID is added to your MyAnimeList as Plan to Watch. Existing entries may be overwritten.',confirm:'Import',icon:'globe'}))return;
  var id=activityStart('import','Import AniList list',user);toast('Importing from AniList…','i');
  try{
    var ids=await api.anilistUserMalIds(user);
    if(!ids||ids.error){activityFinish(id,'error',(ids&&ids.error)||'User not found');toast('AniList: '+((ids&&ids.error)||'user not found'),'e');return;}
    var n=0;for(var i=0;i<ids.length;i++){try{await api.malAddOrUpdateListItem(ids[i],{status:'plan_to_watch'});n++;activityUpdate(id,n+' / '+ids.length);}catch(err){console.error('[AniList import]',err);}await sleep(120);}
    activityFinish(id,'success','Imported '+n+' of '+ids.length);toast('Imported '+n+' entries as Plan to Watch','s');S.myListData=null;
  }catch(e){activityFinish(id,'error',e.message||String(e));toast('Import failed: '+(e.message||e),'e');}
}
async function backupAppData(){
  var id=activityStart('backup','Back up app data','Writing settings and cached covers');
  var r=await api.backupAppData();
  if(r&&r.success){activityFinish(id,'success',r.path);toast('Backup saved to '+r.path,'s',{label:'Show',onClick:function(){api.openFolder(r.path.replace(/[\\/][^\\/]+$/,''));}});}
  else{activityFinish(id,'error',r&&r.error);toast('Backup failed: '+(r&&r.error),'e');}
}
async function restoreAppData(){
  var f=await api.openFile([{name:'AnimeVault backup',extensions:['zip']}]);if(!f)return;
  if(!await askConfirm({title:'Restore this backup?',text:'Your current settings and watch history will be replaced by the backup. The app reloads afterwards.',confirm:'Restore',danger:true,icon:'database'}))return;
  var id=activityStart('backup','Restore app data',f);
  var r=await api.restoreAppData(f);
  if(r&&r.success){activityFinish(id,'success','Restore complete');toast('Restored — reloading…','s');setTimeout(function(){location.reload();},1200);}
  else{activityFinish(id,'error',r&&r.error);toast('Restore failed: '+(r&&r.error),'e');}
}
async function resetAllPreferences(){
  toast('Resetting…','i');
  await api.setAllConfig({setupDone:false,malAccessToken:'',malRefreshToken:'',malTokenExpiry:0,malCodeVerifier:'',malClientId:'',malClientSecret:'',folders:[],mangaFolders:[],watchHistory:{},mangaWatchHistory:{},animeImportInbox:[],mangaImportInbox:[],titleAliases:{anime:{},manga:{}},gapRules:{anime:{},manga:{}},activityLog:[],performanceMode:false,incrementalScan:true,watcherFolder:'',watcherDest:''});
  await api.clearLibraryScanCache();
  S.cfg=await api.getConfig();S.mal=false;S.lib=[];S.covers={};S.pendingNewSeries=[];S.activities=[];
  uMal();applyTheme();applyPerformanceMode(false);
  toast('Everything was reset','s');showSetupWizard();go('settings');
}
