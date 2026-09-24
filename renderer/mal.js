/* AnimeVault renderer — MyAnimeList account page. */

function vMal(){
  var h='<div class="view">'+pageHead('MyAnimeList','Connect your account to sync progress, scores and airing data.');
  if(!S.mal){
    h+='<div class="mal-connect panel"><div class="mal-connect-art">'+ic('layers')+'</div><div class="grow">'
      +'<div class="panel-title" style="font-size:17px">Connect MyAnimeList</div><div class="panel-sub" style="margin:4px 0 18px">AnimeVault uses your own MAL API app, so your credentials stay on this computer.</div>'
      +'<ol class="steps">'
      +'<li><div class="step-title">Create an API app</div><div class="field-hint">Open the MAL API page, create a client and set the redirect URL below.</div><div class="row wrap" style="margin-top:8px"><button class="btn btn-secondary btn-sm"'+A('openUrl','https://myanimelist.net/apiconfig')+'>'+ic('external')+'Open myanimelist.net/apiconfig</button>'
        +'<button class="btn btn-ghost btn-sm"'+A('copyText','http://localhost:19876/callback')+'>'+ic('copy')+'Copy redirect URL</button></div><code class="code-chip">http://localhost:19876/callback</code></li>'
      +'<li><div class="step-title">Paste your credentials</div><div class="fields cols-2" style="margin-top:8px">'
        +'<div class="field"><label class="field-label">Client ID</label><input class="input mono" id="malCid" value="'+E(S.cfg.malClientId||'')+'" autocomplete="off" spellcheck="false"></div>'
        +'<div class="field"><label class="field-label">Client secret</label><input class="input mono" id="malCsec" type="password" value="" autocomplete="off" placeholder="'+(S.cfg.hasMalClientSecret?'Saved — leave blank to keep':'Optional for some apps')+'"></div></div></li>'
      +'<li><div class="step-title">Authorize</div><div class="field-hint">Your browser opens — approve access in the newest tab.</div><button class="btn btn-primary" style="margin-top:10px"'+A('startMal')+'>'+ic('link')+'Connect</button></li>'
      +'</ol></div></div>';
    return h+'</div>';
  }
  var all=librarySeries();var linked=all.filter(function(s){return s.watchData&&s.watchData.malId;});var unlinked=all.filter(function(s){return !(s.watchData&&s.watchData.malId);});
  var mismatched=linked.filter(function(s){var md=s.watchData.malData;return md&&md.title&&!isTitleSimilar(s.name,md.title);});
  var paused=!!S.cfg.syncPaused;var exp=S.cfg.malTokenExpiry?new Date(S.cfg.malTokenExpiry):null;
  h+='<div class="mal-account panel"><div class="lg-icon" style="--ic:'+(paused?'var(--yellow)':'var(--green)')+';width:44px;height:44px;border-radius:14px">'+ic('layers')+'</div>'
    +'<div class="grow"><div class="panel-title" style="font-size:16px">Connected</div><div class="panel-sub">'+(paused?'Real-time sync is paused — progress stays local until you resume.':'Progress syncs to MyAnimeList as you watch.')+(exp?' Token renews '+E(exp.toLocaleDateString()):'')+'</div></div>'
    +'<div class="row"><span class="muted" style="font-size:12px">Sync</span>'+switchCtl(!paused,'toggleSyncSw')+'</div></div>';
  h+='<div class="tool-grid" style="margin-top:14px">'
    +toolTile({icon:'refresh',title:'Refresh links',desc:'Refreshes metadata for linked series and sends unlinked ones to the Import Inbox.',actions:['<button class="btn btn-secondary btn-sm"'+A('autoSyncAll')+'>Refresh</button>']})
    +toolTile({icon:'heartPulse',color:'var(--green)',title:'Sync health',desc:'Finds suspicious links, missing metadata and progress conflicts.',actions:['<button class="btn btn-secondary btn-sm"'+A('runSyncHealth')+'>Check</button>']})
    +toolTile({icon:'history',color:'var(--blue)',title:'Sync activity',desc:'The last 50 changes sent to MyAnimeList, with any errors.',actions:['<button class="btn btn-secondary btn-sm"'+A('openSyncActivity')+'>View log</button>']})
    +toolTile({icon:'logOut',color:'var(--red)',title:'Disconnect',desc:'Removes the saved tokens from this computer. Links are kept.',actions:['<button class="btn btn-danger btn-sm"'+A('disconnMalConfirm')+'>Disconnect</button>']})
    +'</div>';
  var f=S.malLinkFilter||'all';
  var rows=f==='mismatch'?mismatched:f==='unlinked'?unlinked:f==='linked'?linked:all;
  var q=(S.malLinkQ||'').toLowerCase();if(q)rows=rows.filter(function(s){return s.name.toLowerCase().indexOf(q)>=0||(s.watchData&&s.watchData.malData&&String(s.watchData.malData.title||'').toLowerCase().indexOf(q)>=0);});
  h+='<div class="sec-head"><div class="sec-title">Review links</div></div>';
  h+='<div class="toolbar-lite">'+seg('malLinkFilter',[{v:'all',label:'All',count:all.length},{v:'linked',label:'Linked',count:linked.length},{v:'mismatch',label:'Possible mismatch',count:mismatched.length},{v:'unlinked',label:'Unlinked',count:unlinked.length}],f,'setMalLinkFilter')
    +'<span class="spacer"></span>'+searchField({value:S.malLinkQ||'',placeholder:'Filter',input:'malLinkQInput',clear:'malLinkQClear',size:'sm'}).replace('class="search','class="search toolbar-search')+'</div>';
  if(!rows.length)h+=emptyState('checkCircle','Nothing to review',f==='mismatch'?'No suspicious links — every title looks like its MAL entry.':'No series in this group.','',true);
  else{
    h+='<div class="list-group link-list">';
    rows.forEach(function(s){
      var md=s.watchData&&s.watchData.malData;var id=s.watchData&&s.watchData.malId;
      var img=md&&md.main_picture?(md.main_picture.medium||md.main_picture.large):(S.covers[s.name]||'');
      var conf=md&&md.title?titleMatchConfidence(aliasFor(s.name,'mal'),md.title):null;
      var mismatch=md&&md.title&&!isTitleSimilar(s.name,md.title);
      h+='<div class="lg-row'+(mismatch?' warn-row':'')+'">'+(img?'<img class="thumb" src="'+E(img)+'" alt="" loading="lazy">':'<span class="thumb ph">'+ic('unlink')+'</span>')
        +'<div class="lg-main"><div class="lg-title ellipsis">'+E(s.name)+'</div><div class="lg-desc ellipsis">'
        +(id?ic('arrowRight')+' '+E(md&&md.title?md.title:'MAL #'+id)+(md?' · '+(totalField(md)||'?')+' '+epLabel().toLowerCase()+' · '+E((md.media_type||'').toUpperCase()):''):'<span class="yellow-txt">Not linked</span>')+'</div></div>'
        +(conf!=null?confMeter(conf):'')
        +'<div class="lg-ctrl">'+(id?'<button class="btn btn-ghost btn-xs"'+A('malRelink',s.name)+'>Change</button><button class="icon-btn sm danger"'+A('malUnlinkConfirm',s.name)+Tip('Unlink')+'>'+ic('unlink')+'</button>'
          :'<button class="btn btn-secondary btn-xs"'+A('malRelink',s.name)+'>'+ic('search')+'Search</button><button class="btn btn-ghost btn-xs"'+A('malManualIdInput',s.name)+'>#ID</button>')+'</div></div>';
    });
    h+='</div>';
  }
  return h+'</div>';
}
act('toggleSyncSw',function(){toggleSync();});
act('setMalLinkFilter',function(el,ev,v){S.malLinkFilter=v;render();});
act('malLinkQInput',function(el){S.malLinkQ=el.value;var p=el.selectionStart;malLinkRender(p);});
act('malLinkQClear',function(){S.malLinkQ='';render();});
var malLinkRender=debounce(function(p){render();var i=document.querySelector('.toolbar-search input');if(i){i.focus();try{i.setSelectionRange(p,p);}catch(e){}}},160);
act('copyText',function(el,ev,t){try{navigator.clipboard.writeText(t);toast('Copied','s');}catch(e){toast('Copy failed','e');}});
act('disconnMalConfirm',async function(){if(await askConfirm({title:'Disconnect MyAnimeList?',text:'Saved tokens are removed from this computer. Your series stay linked and you can reconnect any time.',confirm:'Disconnect',danger:true,icon:'logOut'}))return disconnMal();});
act('malUnlinkConfirm',async function(el,ev,name){if(await askConfirm({title:'Unlink “'+name+'”?',text:'Progress will stop syncing for this series until you link it again.',confirm:'Unlink',danger:true,icon:'unlink'}))return malUnlink(name);});
expose('startMal','openSyncActivity');

async function openSyncActivity(){
  var log=await api.malGetSyncLog()||[];
  var h;
  if(!log.length)h=emptyState('history','No sync activity yet','Changes sent to MyAnimeList will be listed here.','',true);
  else{
    h='<div class="list-group">';
    log.forEach(function(e){
      var changes=(e.changes||[]).map(function(c){return E(String(c.field).replace(/_/g,' '))+' <span class="muted">'+E(String(c.from))+' →</span> '+E(String(c.to));}).join(' · ')||'<span class="muted">no field changes</span>';
      h+='<div class="lg-row"><div class="lg-icon" style="--ic:'+(e.success?'var(--green)':'var(--red)')+'">'+ic(e.success?'check':'alert')+'</div><div class="lg-main"><div class="lg-title ellipsis">'+E(e.seriesName||'')+'</div><div class="lg-desc">'+changes+(e.success?'':' · <span class="red-txt">'+E(e.error||'Failed')+'</span>')+'</div></div><span class="muted" style="font-size:11.5px;white-space:nowrap"'+Tip(new Date(e.timestamp).toLocaleString())+'>'+E(timeAgo(e.timestamp))+'</span></div>';
    });
    h+='</div>';
  }
  openModal({id:'syncActivityOverlay',title:'Sync activity',sub:'Most recent first',icon:'history',width:720,body:h,
    foot:(log.length?'<div class="left"><button class="btn btn-ghost"'+A('clearSyncActivity')+'>'+ic('trash')+'Clear log</button></div>':'')+'<button class="btn btn-primary" data-modal-close>Done</button>'});
}
act('clearSyncActivity',async function(){if(!await askConfirm({title:'Clear the sync log?',confirm:'Clear',danger:true}))return;await api.malClearSyncLog();closeModalById('syncActivityOverlay');openSyncActivity();});

// Awaitable conflict dialog used by autoSyncSeries().
function promptSyncConflict(name,localEps,malEps){
  return new Promise(function(resolve){
    var lbl=epLabelFull().toLowerCase();var done=false;
    var m=openModal({title:'Progress conflict',sub:'<b>'+E(name)+'</b>',icon:'alert',tone:'warn',width:500,dismissable:true,
      body:'<p class="dim" style="margin-bottom:14px;line-height:1.55">MyAnimeList has <b>'+malEps+'</b> '+lbl+' '+watchedLabel()+', but this computer only has <b>'+localEps+'</b>. How should it be resolved?</p>'
        +'<div class="col">'
        +'<button class="row-card choice" data-choice="mal"><div class="lg-icon" style="--ic:var(--blue)">'+ic('layers')+'</div><div class="grow"><div class="row-title">Keep MyAnimeList ('+malEps+')</div><div class="row-sub">Adopt the remote progress on this computer</div></div></button>'
        +'<button class="row-card choice" data-choice="local"><div class="lg-icon" style="--ic:var(--accent)">'+ic('monitor')+'</div><div class="grow"><div class="row-title">Keep this computer ('+localEps+')</div><div class="row-sub">Overwrite MyAnimeList with the local count</div></div></button>'
        +'<button class="row-card choice" data-choice="merge"><div class="lg-icon" style="--ic:var(--green)">'+ic('arrowUp')+'</div><div class="grow"><div class="row-title">Use the higher ('+Math.max(localEps,malEps)+')</div><div class="row-sub">Merge to whichever is further along</div></div></button></div>',
      foot:'<button class="btn btn-ghost" data-choice="cancel">Do nothing</button>',
      onClose:function(){if(!done){done=true;resolve('cancel');}}});
    m.el.addEventListener('click',function(e){var b=e.target.closest('[data-choice]');if(!b)return;done=true;resolve(b.getAttribute('data-choice'));m.close();});
  });
}

// Sync issues summary (shown after bulk operations report review items).
function showSyncErrorPanel(items){
  items=items||[];if(!items.length)return;
  var old=document.getElementById('syncErrorPanel');if(old)old.remove();
  var el=document.createElement('div');el.id='syncErrorPanel';el.className='notice';
  el.innerHTML='<div class="notice-head"><div class="modal-icon warn">'+ic('alert')+'</div><div class="grow"><div class="notice-title">'+plural(items.length,'series needs','series need')+' a MAL link</div><div class="notice-text">Automatic matching wasn’t confident enough.</div></div><button class="icon-btn sm plain" data-sep="close">'+ic('x')+'</button></div>'
    +'<div class="notice-list">'+items.slice(0,5).map(function(it,i){return '<div class="notice-row"><span class="grow ellipsis">'+E(it.name)+'</span><button class="btn btn-secondary btn-xs" data-sep="fix" data-i="'+i+'">Fix</button></div>';}).join('')+'</div>'
    +'<div class="notice-actions"><button class="btn btn-ghost btn-sm" data-sep="all">Review all links</button></div>';
  el.addEventListener('click',function(e){var b=e.target.closest('[data-sep]');if(!b)return;var a=b.getAttribute('data-sep');el.remove();if(a==='fix')malRelink(items[+b.getAttribute('data-i')].name);else if(a==='all')go('mal');});
  document.getElementById('tc').appendChild(el);
}
