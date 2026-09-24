/* AnimeVault renderer — first-run setup. */

var SETUP_STEPS=[
  {title:'Welcome to AnimeVault',icon:'sparkles',body:function(){
    return '<p class="setup-lead">Your personal anime & manga library — organized, tracked and synced with MyAnimeList.</p><div class="setup-feats">'
      +feat('folder','Organizes your folders','Renames files and sorts new downloads automatically.')
      +feat('layers','Syncs with MyAnimeList','Progress, scores and airing times stay in step.')
      +feat('download','Finds new episodes','Opt in per series and new releases are handed to your torrent client.')
      +'</div><p class="field-hint" style="text-align:center;margin-top:16px">Switch between AnimeVault and MangaVault any time from the title bar or with <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>M</kbd>.</p>';
  }},
  {title:'Pick a look',icon:'palette',body:function(){
    var h='<div class="theme-grid compact">'+FULL_THEMES.map(themeSwatch).join('')+'</div>';
    h+='<div class="row wrap" style="margin-top:14px;justify-content:center"><div class="swatches">'+ACCENT_PRESETS.map(function(c){return '<button class="swatch'+(c.toLowerCase()===String(themeAccent()).toLowerCase()?' active':'')+'" style="--sw:'+c+'"'+A('setupAccent',c)+'></button>';}).join('')+'</div></div>';
    return h;
  }},
  {title:'Add your library',icon:'folderPlus',body:function(){
    var list=S.cfg.folders||[];
    var h='<p class="setup-lead">Point AnimeVault at the folders that hold your anime. You can add more later in Settings.</p>';
    if(list.length){h+='<div class="list-group" style="margin-bottom:12px">';list.forEach(function(f){h+='<div class="lg-row"><span class="tag accent cap">'+E(f.type)+'</span><div class="lg-main mono ellipsis" style="font-size:12px">'+E(f.path)+'</div></div>';});h+='</div>';}
    h+='<div class="row wrap" style="justify-content:center">'+seg('setupType',[{v:'seasonal',label:'Seasonal'},{v:'series',label:'Series'},{v:'movies',label:'Movies'}],S._setupType||'seasonal','setupType')+'<button class="btn btn-primary"'+A('setupAddFolder')+'>'+ic('folderPlus')+'Choose folder…</button></div>';
    return h;
  }},
  {title:'Playback',icon:'playCircle',body:function(){
    var pt=S.cfg.playerType||'bundled-mpv';
    return '<div class="list-group">'
      +setRow({icon:'playCircle',color:'#30d158',title:'Video player',desc:'Bundled MPV needs no setup.',ctrl:cfgSelect('playerType',[['bundled-mpv','Bundled MPV (recommended)'],['vlc','VLC'],['mpv','MPV'],['system-default','System default']],'bundled-mpv')})
      +setRow({icon:'subtitles',color:'#ffcc4d',title:'Subtitle language',ctrl:cfgSelect('subLangPrimary',[['','Off'],['en','English'],['es','Spanish'],['pt','Portuguese'],['fr','French'],['de','German'],['ja','Japanese']],'')})
      +setRow({icon:'magnet',color:'#0a84ff',title:'Release group',ctrl:cfgSelect('nyaaUploader',[['erai','Erai-raws'],['subsplease','SubsPlease'],['judas','Judas'],['varyg','VARYG']],'erai')})
      +'</div>';
  }},
  {title:'Connect MyAnimeList',icon:'layers',body:function(){
    if(S.mal)return emptyState('checkCircle','Already connected','Your progress will sync automatically.','',true);
    return '<p class="setup-lead">Optional — you can do this later from the MyAnimeList page.</p><div class="field"><label class="field-label">Client ID</label><input class="input mono" id="setupMalCid" value="'+E(S.cfg.malClientId||'')+'" placeholder="From myanimelist.net/apiconfig"></div>'
      +'<div class="field-hint" style="margin:8px 0 12px">Set the app’s redirect URL to <code class="code-chip">http://localhost:19876/callback</code>.</div>'
      +'<div class="row"><button class="btn btn-secondary"'+A('openUrl','https://myanimelist.net/apiconfig')+'>'+ic('external')+'Open API page</button><button class="btn btn-primary"'+A('setupConnectMal')+'>'+ic('link')+'Connect</button></div>';
  }},
  {title:'After you watch…',icon:'film',body:function(){
    var del=!!S.cfg.watchAndDelete;
    return '<div class="col">'
      +'<button class="row-card choice'+(del?'':' selected')+'"'+A('setupWatchDelete',false)+'><div class="lg-icon" style="--ic:var(--accent)">'+ic('library')+'</div><div class="grow"><div class="row-title">Keep files</div><div class="row-sub">Build a library you can rewatch. (Default)</div></div><span class="match-check">'+ic('check')+'</span></button>'
      +'<button class="row-card choice'+(del?' selected':'')+'"'+A('setupWatchDelete',true)+'><div class="lg-icon" style="--ic:var(--red)">'+ic('trash')+'</div><div class="grow"><div class="row-title">Watch & delete</div><div class="row-sub">Episodes are deleted after they’re marked as watched.</div></div><span class="match-check">'+ic('check')+'</span></button></div>';
  }},
  {title:'You’re all set',icon:'checkCircle',body:function(){
    return '<div class="setup-feats">'+feat('inbox','Library Hub','New series land in the Import Inbox for a quick review.')+feat('calendarClock','Schedule','A week-at-a-glance TV guide in your time zone.')+feat('command','Command palette','Press Ctrl K to jump anywhere.')+'</div>';
  }}
];
function feat(icon,title,text){return '<div class="setup-feat"><div class="lg-icon">'+ic(icon)+'</div><div><div class="row-title">'+E(title)+'</div><div class="row-sub">'+E(text)+'</div></div></div>';}
S._setupStep=0;
function showSetupWizard(){S._setupStep=0;renderSetupStep();}
function renderSetupStep(){
  var step=SETUP_STEPS[S._setupStep],n=SETUP_STEPS.length,first=S._setupStep===0,last=S._setupStep===n-1;
  var host=document.getElementById('setupWizard');
  var h='<div class="setup-layer"><div class="setup-card"><div class="setup-progress"><i style="width:'+((S._setupStep+1)/n*100)+'%"></i></div>'
    +'<div class="setup-head"><div class="empty-icon">'+ic(step.icon)+'</div><div class="setup-step">Step '+(S._setupStep+1)+' of '+n+'</div><div class="setup-title">'+E(step.title)+'</div></div>'
    +'<div class="setup-body" id="setupBody">'+step.body()+'</div>'
    +'<div class="setup-foot">'+(first?'<button class="btn btn-ghost"'+A('closeSetup')+'>Skip setup</button>':'<button class="btn btn-ghost"'+A('setupPrev')+'>'+ic('chevronLeft')+'Back</button>')
    +'<span class="spacer"></span>'+(last?'<button class="btn btn-primary btn-lg"'+A('closeSetup')+'>Get started'+ic('arrowRight')+'</button>':'<button class="btn btn-primary btn-lg"'+A('setupNext')+'>Continue'+ic('chevronRight')+'</button>')+'</div></div></div>';
  host.innerHTML=h;updateSegThumbs(host);
}
function setupNext(){if(S._setupStep<SETUP_STEPS.length-1){S._setupStep++;renderSetupStep();}}
function setupPrev(){if(S._setupStep>0){S._setupStep--;renderSetupStep();}}
function closeSetup(){var l=document.querySelector('.setup-layer');if(l){l.classList.add('closing');setTimeout(function(){document.getElementById('setupWizard').innerHTML='';},220);}S.cfg.setupDone=true;api.setConfig('setupDone',true);}
async function setupAddFolder(){
  var type=S._setupType||'seasonal';var f=await api.browseFolder();if(!f)return;
  if(!S.cfg.folders)S.cfg.folders=[];
  if(S.cfg.folders.some(function(x){return String(x.path).toLowerCase()===f.toLowerCase();})){toast('That folder is already added','i');return;}
  S.cfg.folders.push({path:f,label:type.charAt(0).toUpperCase()+type.slice(1),type:type});
  await api.setConfig('folders',S.cfg.folders);loadLib(true);renderSetupStep();toast('Folder added','s');
}
async function setupConnectMal(){
  var cid=document.getElementById('setupMalCid');if(!cid||!cid.value.trim()){toast('Enter your Client ID','e');return;}
  try{
    var url=await api.malGetAuthUrl(cid.value.trim(),'');var serverP=api.malStartAuthServer();setTimeout(function(){api.openExternal(url);},150);
    toast('Finish signing in in your browser…','i');
    var code=await serverP;if(!code){toast('Authorization timed out','e');return;}
    var r=await api.malExchangeToken(code);if(!r||!r.success){toast('Token exchange failed: '+((r&&r.error)||'unknown'),'e');return;}
    S.mal=true;S.cfg=await api.getConfig();uMal();toast('Connected to MyAnimeList','s');scheduleMalBackfill(800);renderSetupStep();
  }catch(e){toast('Connect failed: '+(e.message||e),'e');}
}
act('setupAccent',function(el,ev,c){setThemeAccent(c);renderSetupStep();});
act('setupType',function(el,ev,v){S._setupType=v;});
act('setupWatchDelete',function(el,ev,v){S.cfg.watchAndDelete=v;api.setConfig('watchAndDelete',v);renderSetupStep();});
expose('setupNext','setupPrev','closeSetup','setupAddFolder','setupConnectMal');
// Theme cards inside the wizard re-render the step after applying.
var _setFullThemeBase=setFullTheme;
setFullTheme=function(id){_setFullThemeBase(id);if(document.querySelector('.setup-layer'))setTimeout(renderSetupStep,30);};
