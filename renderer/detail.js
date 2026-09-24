/* AnimeVault renderer — series detail sheet, MAL linking/editing, covers, downloads. */

if(!S.epView)S.epView='grid';

function openSheet(html,keepScroll){
  var dov=document.getElementById('dov'),dpn=document.getElementById('dpn');
  var wasOpen=dov.classList.contains('open');var st=dpn.scrollTop;
  dpn.innerHTML=html;
  if(!wasOpen){dov.classList.remove('closing');dov.classList.add('open');dpn.scrollTop=0;}
  else if(keepScroll)dpn.scrollTop=st;
  else dpn.scrollTop=0;
  updateSegThumbs(dpn);
}
function cdtl(){
  var dov=document.getElementById('dov');if(!dov||!dov.classList.contains('open'))return;
  dov.classList.add('closing');S.cur=null;S._curMal=null;
  setTimeout(function(){dov.classList.remove('open','closing');},220);
}
document.addEventListener('DOMContentLoaded',function(){
  var dov=document.getElementById('dov');
  if(dov)dov.addEventListener('mousedown',function(e){if(e.target.classList.contains('dbk'))cdtl();});
});

function sheetHero(o){
  // o: {cover,eyebrow,title,metaHtml,actionsHtml}
  return '<div class="sheet-hero">'+(o.cover?'<img class="sheet-bg" src="'+E(o.cover)+'" alt="">':'')+'<div class="sheet-scrim"></div>'
    +'<button class="icon-btn btn-on-media sheet-close"'+A('cdtl')+' aria-label="Close">'+ic('x')+'</button>'
    +'<div class="sheet-head">'+(o.cover?'<img class="sheet-poster" src="'+E(o.cover)+'" alt="">':'<div class="sheet-poster ph">'+ic(VM('film','book'))+'</div>')
    +'<div class="sheet-headtext">'+(o.eyebrow?'<div class="sheet-eyebrow">'+o.eyebrow+'</div>':'')
    +'<div class="sheet-title">'+E(o.title)+'</div>'+(o.metaHtml?'<div class="sheet-meta">'+o.metaHtml+'</div>':'')
    +'<div class="sheet-actions">'+(o.actionsHtml||'')+'</div></div></div></div>';
}
function statTile(label,value,opts){
  opts=opts||{};
  return '<div class="stat-tile'+(opts.act?' editable':'')+'"'+(opts.act||'')+(opts.tip?Tip(opts.tip):'')+'><div class="stat-label">'+E(label)+(opts.act?ic('pencil'):'')+'</div><div class="stat-value'+(opts.cls?' '+opts.cls:'')+'">'+value+'</div></div>';
}
function linkChips(title,malId){
  var sn=encodeURIComponent(title||'');
  var links=isManga()
    ?[['MangaDex','https://mangadex.org/search?q='+sn],['MangaFire','https://mangafire.to/search?keyword='+sn],['MangaReader','https://mangareader.to/search?keyword='+sn]]
    :[['Crunchyroll','https://www.crunchyroll.com/search?q='+sn],['Miruro','https://www.miruro.to/search?query='+sn],['Netflix','https://www.netflix.com/search?q='+sn]];
  var h='<div class="chips">';
  links.forEach(function(l){h+='<button class="chip"'+A('openUrl',l[1])+'>'+ic('external')+E(l[0])+'</button>';});
  h+='<button class="chip"'+A('openNyaa',title)+'>'+ic('search')+'Nyaa</button>';
  if(malId)h+='<button class="chip"'+A('openUrl','https://myanimelist.net/'+VM('anime','manga')+'/'+malId)+'>'+ic('layers')+'MyAnimeList</button>';
  return h+'</div>';
}
// Long synopses fade out under a mask with a "Show more" link; short ones
// (roughly three lines at sheet width) render in full.
function synopsisBlock(text){if(!text)return '';var short=String(text).length<=230;return '<p class="synopsis'+(short?' short':'')+'"'+(short?'':A('toggleSynopsis'))+'>'+E(text)+'</p>'+(short?'':'<button class="synopsis-more"'+A('toggleSynopsisMore')+'>Show more'+ic('chevronDown')+'</button>');}
act('toggleSynopsis',function(el){el.classList.toggle('open');});
act('toggleSynopsisMore',function(el){var p=el.previousElementSibling;if(p)p.classList.add('open');});
act('openUrl',function(el,ev,url){api.openExternal(url);});
act('openNyaa',function(el,ev,title,ep){api.openExternal(buildNyaaUrl(title,ep));});

// ------------------------------------------------------------ local series --
async function odtl(name){
  var s=S.lib.find(function(x){return x.name===name;});if(!s)return;
  var sameSeries=S.cur&&S.cur.name===name&&document.getElementById('dov').classList.contains('open');
  S.cur=s;
  if(!sameSeries)openSheet('<div class="sheet-loading">'+loadingBlock()+'</div>');
  var c=S.covers[s.name]||'';
  var res=await Promise.all([api.getEpisodes(s.path),api.getWatchHistory(s.name)]);
  var eps=res[0]||[],wd=res[1]||{};
  if(!S.cur||S.cur.name!==name)return;
  var ws=new Set(wd.episodesWatched||[]);
  var md=wd.malData||null;var mls=getMyListStatus(md);
  var malWatched=mls?epWatchedField(mls):0;
  var displayWatched=malWatched>0?malWatched:ws.size;
  var nyaaTitle=md&&md.title?md.title:s.name;
  var total=md?(isManga()?md.num_chapters||md.num_episodes:md.num_episodes)||0:0;
  var totalLabel=total||s.episodeCount;
  var next=nxtUn(Object.assign({},s,{watchData:{episodesWatched:wd.episodesWatched||[]}}));
  var bc=md&&md.broadcast&&md.status==='currently_airing'?calcNextBroadcast(md.broadcast):'';
  var tracked=!isManga()&&(S._autoDownloadWatchlist||[]).find(function(w){return w.seriesName===s.name||(wd.malId&&Number(w.malId)===Number(wd.malId));});

  var eyebrow=[];
  if(md&&md.media_type)eyebrow.push(E(String(md.media_type).toUpperCase()));
  if(md&&md.status)eyebrow.push(E(String(md.status).replace(/_/g,' ')));
  if(s.category)eyebrow.push('<span class="cap">'+E(s.category)+'</span>');
  var meta='';
  if(md&&md.mean)meta+='<span class="tag star lg">★ '+md.mean+'</span>';
  if(mls&&mls.status)meta+='<span class="tag lg"><span class="status st-'+mls.status+'">'+E(statusLabel(mls.status))+'</span></span>';
  meta+='<span class="tag lg">'+displayWatched+' / '+totalLabel+' '+watchedLabel()+'</span>';
  if(bc)meta+='<span class="tag lg accent">'+ic('tv')+E(bc)+'</span>';
  if(tracked)meta+='<span class="tag lg green">'+ic('download')+'Auto-download</span>';
  if(!wd.malId)meta+='<span class="tag lg yellow">'+ic('unlink')+'Not linked</span>';

  var actions='<button class="btn btn-primary btn-lg"'+A('pNxt',s.name)+'>'+ic('play')+(next?(displayWatched?VM('Continue','Continue'):VM('Play','Read'))+' '+epLabel()+' '+(next.episodeNum!=null?next.episodeNum:''):VM('Play from start','Read from start'))+'</button>'
    +dlSplitBtn(nyaaTitle,md)
    +'<button class="icon-btn btn-on-media"'+A('openFolderPath',s.path)+Tip('Show in folder')+'>'+ic('folderOpen')+'</button>'
    +'<button class="icon-btn btn-on-media"'+A('seriesMoreMenu',s.name)+Tip('More')+'>'+ic('sliders')+'</button>';

  var h=sheetHero({cover:c,eyebrow:eyebrow.join(' · '),title:s.name,metaHtml:meta,actionsHtml:actions});
  h+='<div class="sheet-body">';
  if(md){
    h+='<div class="stat-row">'
      +statTile('Your score',mls&&mls.score?'★ '+mls.score+'<small>/10</small>':'<span class="muted">—</span>',{act:A('openMalEdit',s.name,'score'),tip:'Edit on MyAnimeList'})
      +statTile('Progress',(mls?epWatchedField(mls):0)+'<small>/'+(total||'?')+'</small>',{act:A('openMalEdit',s.name,'progress'),tip:'Edit on MyAnimeList'})
      +statTile('Status',mls&&mls.status?'<span class="status st-'+mls.status+'">'+E(statusLabel(mls.status))+'</span>':'<span class="muted">—</span>',{act:A('openMalEdit',s.name,'status'),cls:'sm',tip:'Edit on MyAnimeList'})
      +(md.mean?statTile('MAL score','★ '+md.mean):'')
      +(md.rank?statTile('Rank','#'+md.rank):'')
      +(md.popularity?statTile('Popularity','#'+md.popularity):'')
      +'</div>';
    h+=synopsisBlock(md.synopsis);
    if(md.genres&&md.genres.length)h+='<div class="chips" style="margin-bottom:14px">'+md.genres.map(function(g){return '<span class="tag">'+E(g.name||g)+'</span>';}).join('')+'</div>';
  }
  h+=linkChips(s.name,wd.malId);

  h+='<div class="sec-head"><div class="sec-title">'+epLabelFull()+'</div><span class="sec-count">'+eps.length+' files</span><span class="spacer"></span>'
    +seg('epView',[{v:'grid',icon:'grid',tip:'Grid'},{v:'list',icon:'list',tip:'List'}],S.epView,'setEpView')
    +'<button class="btn btn-ghost btn-sm"'+A('markAll',s.name)+'>'+ic('checkCircle')+'Mark all '+watchedLabel()+'</button></div>';
  h+=eps.length?renderDetailEpisodes(eps,s,ws):emptyState(VM('film','book'),'No files found','This folder doesn’t contain any '+VM('video','manga')+' files yet.','',true);

  h+='<div class="sheet-cards">';
  // MAL card
  h+='<div class="panel panel-pad"><div class="row" style="margin-bottom:10px">'+ic('layers')+'<div class="panel-title grow">MyAnimeList</div>'
    +(wd.malId?'<span class="tag green">'+ic('link')+'#'+wd.malId+'</span>':'<span class="tag yellow">Unlinked</span>')+'</div>';
  if(!S.mal){h+='<div class="field-hint">Connect your MyAnimeList account to sync progress for this series.</div><div class="row" style="margin-top:12px"><button class="btn btn-secondary btn-sm"'+A('go','mal')+'>Connect</button></div>';}
  else if(wd.malId){
    h+='<div class="field-hint">'+(md&&md.title?'Linked to <b>'+E(md.title)+'</b>. ':'')+(S.cfg.syncPaused?'Real-time sync is paused.':'Progress syncs automatically when you watch.')+'</div>'
      +'<div class="row wrap" style="margin-top:12px"><button class="btn btn-secondary btn-sm"'+A('syncMal',s.name)+'>'+ic('refresh')+'Sync now</button>'
      +'<button class="btn btn-ghost btn-sm"'+A('fetchMD',s.name,wd.malId)+'>Refresh data</button>'
      +'<button class="btn btn-ghost btn-sm"'+A('malRelink',s.name)+'>Change link</button></div>';
  }else{
    h+='<div class="field-hint">Link this folder to a MyAnimeList entry to sync progress, scores and airing data.</div><div class="row" style="margin-top:12px"><button class="btn btn-primary btn-sm"'+A('malRelink',s.name)+'>'+ic('link')+'Link now</button></div>';
  }
  h+='</div>';
  if(!isManga()){
    h+='<div class="panel panel-pad"><div class="row" style="margin-bottom:10px">'+ic('download')+'<div class="panel-title grow">Auto-download</div>'+switchCtl(!!tracked,'toggleTrackSwitch',[s.name,wd.malId||0])+'</div>';
    if(tracked){
      h+='<dl class="dl"><dt>Estimated aired</dt><dd>'+(tracked.estimatedLatest||'—')+'</dd><dt>Verified available</dt><dd>'+(tracked.verifiedLatest||'not checked')+'</dd><dt>Last handed off</dt><dd>'+(tracked.lastDownloadedEp||0)+'</dd></dl>'
        +'<div class="row wrap" style="margin-top:12px"><button class="btn btn-secondary btn-sm"'+A('catchupSingleSeries',s.name,wd.malId||0)+'>'+ic('zap')+'Catch up</button>'
        +'<button class="btn btn-ghost btn-sm"'+A('verifySeriesLatest',s.name,wd.malId||0)+'>Verify latest</button>'
        +'<button class="btn btn-ghost btn-sm"'+A('setEpisodeOffsetPrompt',s.name,tracked.episodeOffset||0)+'>Numbering '+((tracked.episodeOffset||0)>0?'+':'')+(tracked.episodeOffset||0)+'</button></div>';
    }else h+='<div class="field-hint">Opt in to have new episodes found on Nyaa and handed to your torrent client. Tracking is never enabled automatically.</div>';
    h+='</div>';
  }
  h+='</div>';
  h+='<div class="danger-row"><div><div class="row-title">Delete local files</div><div class="row-sub">'+plural(s.episodeCount,'file','files')+' in '+E(s.path)+'</div></div><button class="btn btn-danger btn-sm"'+A('confirmDeleteSeries',s.name)+'>'+ic('trash')+'Delete…</button></div>';
  h+='</div>';
  openSheet(h,sameSeries);
}
function seriesMoreMenu(el,ev,name){
  var s=S.lib.find(function(x){return x.name===name;});if(!s)return;
  var hasMal=s.watchData&&s.watchData.malId;
  toggleMenu(el,[
    {label:'Change cover',icon:'image',run:function(){openCoverSearch(name);}},
    {label:'Rename folder & files',icon:'pencil',run:function(){renameSeriesPrompt(name);}},
    {label:hasMal?'Change MAL link':'Link to MyAnimeList',icon:'link',run:function(){malRelink(name);}},
    hasMal?{label:'Unlink from MyAnimeList',icon:'unlink',run:function(){malUnlink(name).then(function(){odtl(name);});}}:null,
    {sep:true},
    {label:'Mark all '+watchedLabel(),icon:'checkCircle',run:function(){markAll(name);}},
    {label:'Copy folder path',icon:'copy',run:function(){try{navigator.clipboard.writeText(s.path);toast('Path copied','s');}catch(e){}}},
    {sep:true},
    {label:'Delete files…',icon:'trash',danger:true,run:function(){confirmDeleteSeries(name);}}
  ],{alignRight:true});
}
act('seriesMoreMenu',function(el,ev,name){seriesMoreMenu(el,ev,name);});
act('openFolderPath',function(el,ev,p){api.openFolder(p);});
act('setEpView',function(el,ev,v){S.epView=v;if(S.cur)odtl(S.cur.name);});
act('toggleTrackSwitch',function(el,ev,name,malId){toggleAutoDownloadTrack(name,malId);});

function renderDetailEpisodes(eps,s,ws){
  var h='';
  if(S.epView==='grid'){
    h+='<div class="ep-grid">';
    eps.forEach(function(ep){var n=ep.episodeNum;var w=n!==null&&ws.has(n);
      h+='<div class="ep'+(w?' watched':'')+'"'+A('playEpisode',s.name,ep.path,n)+' tabindex="0" role="button"'+Tip(ep.name)+'>'
        +'<div class="ep-num">'+(n!==null?n:'?')+'</div><div class="ep-name">'+E(ep.name)+'</div><div class="ep-size">'+fmtBytes(ep.size)+'</div>'
        +(n!==null?'<button class="ep-check"'+A('toggleWatched',s.name,n,w)+(w?Tip('Mark as not '+watchedLabel()):Tip('Mark as '+watchedLabel()))+'>'+ic('check')+'</button>':'')
        +'<span class="ep-play">'+ic('play')+'</span></div>';
    });
    h+='</div>';
  }else{
    h+='<div class="list-group ep-list">';
    eps.forEach(function(ep){var n=ep.episodeNum;var w=n!==null&&ws.has(n);
      h+='<div class="lg-row clickable ep-row'+(w?' watched':'')+'"'+A('playEpisode',s.name,ep.path,n)+'>'
        +'<div class="ep-row-num">'+(n!==null?n:'?')+'</div><div class="lg-main"><div class="lg-title ellipsis">'+E(ep.name)+'</div><div class="lg-desc">'+fmtBytes(ep.size)+'</div></div>'
        +(n!==null?'<button class="ep-check"'+A('toggleWatched',s.name,n,w)+'>'+ic('check')+'</button>':'')+'</div>';
    });
    h+='</div>';
  }
  return h;
}
act('playEpisode',function(el,ev,name,path,num){return pEp(name,path,num);});
act('toggleWatched',function(el,ev,name,num,was){return tw(name,num,was);});
expose('cdtl','odtl','markAll','syncMal','fetchMD','catchupSingleSeries','verifySeriesLatest','setEpisodeOffsetPrompt','confirmDeleteSeries','renameSeriesPrompt','openCoverSearch');

async function setEpisodeOffsetPrompt(name,current){
  var raw=await askText({title:'Episode numbering correction',text:'Shifts the verified episode number for releases that number differently than MyAnimeList (e.g. continuing numbering across seasons).',label:'Offset (−12 to +12)',value:String(current||0),confirm:'Save',
    validate:function(v){var n=parseInt(v,10);return isNaN(n)||n<-12||n>12?'Enter a whole number from −12 to +12':'';}});
  if(raw===null)return;var offset=parseInt(raw,10);
  await api.autoDownloadUpdateSeries(name,{episodeOffset:offset,verifiedLatest:0,verifiedAt:0});
  S._autoDownloadWatchlist=await api.autoDownloadGetWatchlist();toast('Numbering correction saved','s');
  if(S.cur&&S.cur.name===name)odtl(name);
  if(S.view==='settings'||S.view==='hub')render();
}

// ------------------------------------------------------ MAL (remote) detail --
async function openExploreDetail(malId){
  S._curMal=malId;S.cur=null;
  openSheet('<div class="sheet-loading">'+loadingBlock()+'</div>',document.getElementById('dov').classList.contains('open'));
  var a=await api.malGetAnimeDetails(malId);
  if(S._curMal!==malId)return;
  if(!a||a.error){openSheet('<div class="sheet-body" style="padding-top:60px">'+emptyState('alert','Couldn’t load this entry',E((a&&a.error)||'MyAnimeList did not respond.'),'<button class="btn btn-secondary"'+A('cdtl')+'>Close</button>')+'</div>');return;}
  var img=a.main_picture?a.main_picture.large||a.main_picture.medium:'';
  var mls=a.my_list_status||null;
  var total=(isManga()?(a.num_chapters||a.num_episodes):(a.num_episodes||a.num_chapters))||0;
  if(!total&&a.status==='currently_airing'&&a.start_date)total=estimateAired(a.start_date,0);
  var watched=mls?epWatchedField(mls):0,score=mls?mls.score||0:0,status=mls?mls.status||'':'';
  var bc=a.broadcast&&a.status==='currently_airing'?calcNextBroadcast(a.broadcast):'';
  var local=S.lib.find(function(s){return s.watchData&&Number(s.watchData.malId)===Number(a.id);});
  var eyebrow=[];if(a.media_type)eyebrow.push(E(a.media_type.toUpperCase()));if(a.status)eyebrow.push(E(a.status.replace(/_/g,' ')));if(a.start_date)eyebrow.push(E(String(a.start_date).slice(0,4)));
  var meta=(a.mean?'<span class="tag star lg">★ '+a.mean+'</span>':'')+(status?'<span class="tag lg"><span class="status st-'+status+'">'+E(statusLabel(status))+'</span></span>':'<span class="tag lg">Not on your list</span>')
    +'<span class="tag lg">'+(total||'?')+' '+epLabel().toLowerCase()+'</span>'+(bc?'<span class="tag lg accent">'+ic('tv')+E(bc)+'</span>':'')+(local?'<span class="tag lg green">'+ic('folder')+'In your library</span>':'');
  var editArgs=[a.id,a.title||'',status,score,watched,total||0];
  var actions=(local?'<button class="btn btn-primary btn-lg"'+A('pNxt',local.name)+'>'+ic('play')+VM('Play','Read')+'</button>':'<button class="btn btn-primary btn-lg"'+A.apply(null,['openMyListEdit'].concat(editArgs))+'>'+ic(status?'pencil':'plus')+(status?'Edit list entry':'Add to list')+'</button>')
    +dlSplitBtn(a.title,a)
    +(local?'<button class="icon-btn btn-on-media"'+A('openSeries',local.name)+Tip('Open local series')+'>'+ic('folder')+'</button>':'');
  var h=sheetHero({cover:img,eyebrow:eyebrow.join(' · '),title:a.title,metaHtml:meta,actionsHtml:actions});
  h+='<div class="sheet-body"><div class="stat-row">'
    +statTile('Your score',score?'★ '+score+'<small>/10</small>':'<span class="muted">—</span>',{act:A.apply(null,['openMyListEdit'].concat(editArgs))})
    +statTile('Progress',watched+'<small>/'+(total||'?')+'</small>',{act:A.apply(null,['openMyListEdit'].concat(editArgs))})
    +statTile('Status',status?'<span class="status st-'+status+'">'+E(statusLabel(status))+'</span>':'<span class="muted">—</span>',{act:A.apply(null,['openMyListEdit'].concat(editArgs)),cls:'sm'})
    +(a.rank?statTile('Rank','#'+a.rank):'')+(a.popularity?statTile('Popularity','#'+a.popularity):'')
    +'</div>';
  h+=synopsisBlock(a.synopsis);
  if(a.genres&&a.genres.length)h+='<div class="chips" style="margin-bottom:14px">'+a.genres.map(function(g){return '<span class="tag">'+E(g.name)+'</span>';}).join('')+'</div>';
  h+=linkChips(a.title,a.id);
  if(local&&local.episodes&&local.episodes.length){
    var ws=new Set((local.watchData&&local.watchData.episodesWatched)||[]);
    local.episodes.forEach(function(ep){var n=ep.episodeNum!=null?ep.episodeNum:parseEpisodeNumber(ep.name);if(n!==null&&n<=watched)ws.add(n);});
    h+='<div class="sec-head"><div class="sec-title">'+VM('Downloaded episodes','Downloaded chapters')+'</div><span class="sec-count">'+local.episodes.length+'</span></div>';
    h+=renderDetailEpisodes(local.episodes,local,ws);
  }
  h+='</div>';
  openSheet(h);
}
expose('openExploreDetail');
ACT.openMyListEdit=function(el,ev){return openMyListEdit.apply(null,Array.prototype.slice.call(arguments,2));};

// ------------------------------------------------------------ MAL edit modal --
function malEditBody(ids,status,score,eps,total){
  var h='<div class="fields">';
  h+='<div class="field"><label class="field-label">Status</label><div class="chips status-picker" data-target="'+ids.status+'">';
  malStatusOptions().forEach(function(o){h+='<button class="chip'+(status===o[0]?' on':'')+'" data-val="'+o[0]+'"><span class="status st-'+o[0]+'"></span>'+E(o[1])+'</button>';});
  h+='</div><input type="hidden" id="'+ids.status+'" value="'+E(status||(isManga()?'reading':'watching'))+'"></div>';
  h+='<div class="field"><label class="field-label">Score</label><div class="score-picker" data-target="'+ids.score+'">';
  for(var i=0;i<=10;i++)h+='<button class="'+(Number(score||0)===i?'on':'')+'" data-val="'+i+'">'+(i===0?'—':i)+'</button>';
  h+='</div><input type="hidden" id="'+ids.score+'" value="'+(score||0)+'"></div>';
  h+='<div class="field"><label class="field-label">'+epLabelFull()+' '+VM('watched','read')+(total?' <span class="muted">of '+total+'</span>':'')+'</label>'
    +'<div class="stepper"><button class="icon-btn" data-step="-1">'+ic('minus')+'</button><input class="input" type="number" id="'+ids.eps+'" min="0" max="'+(total||9999)+'" value="'+(eps||0)+'"><button class="icon-btn" data-step="1">'+ic('plus')+'</button>'
    +(total?'<button class="btn btn-ghost btn-sm" data-step="max">All '+total+'</button>':'')+'</div></div>';
  return h+'</div>';
}
function wireMalEditModal(m,ids,total){
  m.el.addEventListener('click',function(e){
    var chip=e.target.closest('.status-picker .chip');
    if(chip){chip.parentElement.querySelectorAll('.chip').forEach(function(c){c.classList.toggle('on',c===chip);});document.getElementById(ids.status).value=chip.getAttribute('data-val');return;}
    var sc=e.target.closest('.score-picker button');
    if(sc){sc.parentElement.querySelectorAll('button').forEach(function(c){c.classList.toggle('on',c===sc);});document.getElementById(ids.score).value=sc.getAttribute('data-val');return;}
    var st=e.target.closest('[data-step]');
    if(st){var inp=document.getElementById(ids.eps);var v=st.getAttribute('data-step');var n=parseInt(inp.value,10)||0;n=v==='max'?total:n+parseInt(v,10);inp.value=clamp(n,0,total||9999);
      if(total&&n>=total){var cs=m.el.querySelector('.status-picker .chip[data-val="completed"]');if(cs)cs.click();}}
  });
}
function openMalEdit(name){
  var s=S.lib.find(function(x){return x.name===name;});if(!s)return;
  var wd=s.watchData||{};var md=wd.malData||{};var mls=getMyListStatus(md)||{};
  if(!wd.malId){toast('Link this series to MyAnimeList first','e',{label:'Link',onClick:function(){malRelink(name);}});return;}
  var total=isManga()?(md.num_chapters||0):(md.num_episodes||0);
  var ids={status:'meStatus',score:'meScore',eps:'meEps'};
  var m=openModal({id:'malEditOverlay',title:md.title||name,sub:'Edit your MyAnimeList entry',icon:'layers',width:520,
    body:malEditBody(ids,mls.status,mls.score,isManga()?(mls.num_chapters_read||0):(mls.num_episodes_watched||0),total),
    foot:'<div class="left"><button class="btn btn-danger btn-sm"'+A('malRemoveConfirm',name,wd.malId)+'>'+ic('trash')+'Remove</button></div><button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary"'+A('saveMalEdit',name,wd.malId)+'>Save</button>'});
  wireMalEditModal(m,ids,total);
}
function closeMalEdit(){closeModalById('malEditOverlay');}
function openMyListEdit(malId,title,currentStatus,currentScore,currentEps,totalEps){
  if(!S.mal){toast('Connect MyAnimeList first','e',{label:'Connect',onClick:function(){go('mal');}});return;}
  var ids={status:'mleStatus',score:'mleScore',eps:'mleEps'};
  var m=openModal({id:'myListEditOverlay',title:title,sub:currentStatus?'Edit your list entry':'Add to your MyAnimeList',icon:'layers',width:520,
    body:malEditBody(ids,currentStatus||(isManga()?'plan_to_read':'plan_to_watch'),currentScore,currentEps,totalEps),
    foot:(currentStatus?'<div class="left"><button class="btn btn-danger btn-sm"'+A('myListRemoveConfirm',malId)+'>'+ic('trash')+'Remove</button></div>':'')+'<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary"'+A('saveMyListEdit',malId)+'>Save</button>'});
  wireMalEditModal(m,ids,totalEps);
}
function closeMyListEdit(){closeModalById('myListEditOverlay');}
act('saveMalEdit',function(el,ev,name,malId){return saveMalEdit(name,malId);});
act('saveMyListEdit',function(el,ev,malId){return saveMyListEdit(malId);});
act('malRemoveConfirm',async function(el,ev,name,malId){if(await askConfirm({title:'Remove from MyAnimeList?',text:'This deletes the entry from your MAL list. Local files are not touched.',danger:true,confirm:'Remove'})){closeMalEdit();malRemoveFromList(name,malId);}});
act('myListRemoveConfirm',async function(el,ev,malId){if(await askConfirm({title:'Remove from MyAnimeList?',text:'This deletes the entry from your MAL list.',danger:true,confirm:'Remove'})){closeMyListEdit();malRemoveFromMyList(malId);}});
ACT.openMalEdit=function(el,ev,name){openMalEdit(name);};

// ------------------------------------------------------ link to MyAnimeList --
function malRelink(name,startWithId){
  if(!S.mal){toast('Connect MyAnimeList first','e',{label:'Connect',onClick:function(){go('mal');}});return;}
  var q=startWithId?'#':aliasFor(name,'mal');
  var m=openModal({id:'malRelinkOverlay',title:'Link to MyAnimeList',sub:'Local folder: <b>'+E(name)+'</b>',icon:'link',width:620,
    body:'<div class="input-row" style="margin-bottom:12px">'+searchField({id:'mrlInput',value:q,placeholder:'Search MyAnimeList or type #ID',enter:'malRelinkSearch',clear:'malRelinkClear',extra:' data-series="'+E(name)+'" autofocus'}).replace('class="search','class="search grow')
      +'<button class="btn btn-primary"'+A('malRelinkSearch',name)+'>Search</button></div>'
      +'<div class="field-hint" style="margin-bottom:10px">Tip: paste a MAL ID like <kbd>#61126</kbd> to link directly.</div>'
      +'<div id="mrlResults" class="result-list"></div>',
    foot:'<button class="btn btn-ghost" data-modal-close>Cancel</button>'});
  if(!startWithId)setTimeout(function(){malRelinkSearch(name);},60);
  return m;
}
function malManualIdInput(name){malRelink(name,true);}
function closeMalRelink(){closeModalById('malRelinkOverlay');}
function closeMalManualId(){closeMalRelink();}
function resultRow(o){
  // o: {img,title,meta,conf,act}
  return '<button class="result-row"'+o.act+'>'+(o.img?'<img class="thumb" src="'+E(o.img)+'" alt="" loading="lazy">':'<span class="thumb"></span>')
    +'<span class="grow"><span class="row-title ellipsis">'+E(o.title)+'</span><span class="row-sub">'+E(o.meta||'')+'</span></span>'
    +(o.conf!=null?confMeter(o.conf):'')+ic('chevronRight')+'</button>';
}
function confMeter(v){var c=v>=70?'var(--green)':v>=45?'var(--yellow)':'var(--red)';return '<span class="conf" style="--cc:'+c+';--v:'+v+'%"'+Tip('Title match confidence')+'><i></i>'+v+'%</span>';}
async function malRelinkSearch(name){
  if(typeof name!=='string'){var el=document.getElementById('mrlInput');name=el?el.getAttribute('data-series'):'';}
  var inp=document.getElementById('mrlInput'),res=document.getElementById('mrlResults');if(!inp||!res)return;
  var q=inp.value.trim();if(!q||q==='#')return;
  inp.closest('.search').classList.add('loading');
  res.innerHTML='<div class="result-skel">'+[0,1,2].map(function(){return '<div class="skeleton" style="height:64px;border-radius:12px"></div>';}).join('')+'</div>';
  try{
    var idm=q.match(/^#\s*(\d+)$/);
    if(idm){
      var id=parseInt(idm[1],10);var d=await api.malGetAnimeDetails(id);
      if(!d||d.error){res.innerHTML=emptyState('search','No entry #'+id,'Double-check the ID from the MyAnimeList URL.','',true);return;}
      res.innerHTML=resultRow({img:d.main_picture&&(d.main_picture.medium||d.main_picture.large),title:d.title,meta:(d.media_type||'').toUpperCase()+' · '+(d.num_episodes||d.num_chapters||'?')+' '+epLabel().toLowerCase()+' · ★ '+(d.mean||'—')+' · #'+id,conf:titleMatchConfidence(aliasFor(name,'mal'),d.title),act:A('malRelinkPick',name,id,d.title||'')});
      return;
    }
    var r=await api.malSearch(q);
    if(r&&r.error){res.innerHTML=emptyState('alert','Search failed',E(r.error),'',true);return;}
    var items=normalizeMalSearchResults(r).slice(0,8);
    if(!items.length){res.innerHTML=emptyState('search','No results','Try a shorter or romanized title, or paste the MAL ID.','',true);return;}
    res.innerHTML=items.map(function(n){return resultRow({img:n.main_picture&&(n.main_picture.medium||n.main_picture.large),title:n.title,meta:(n.media_type||'').toUpperCase()+' · '+(n.num_episodes||n.num_chapters||'?')+' '+epLabel().toLowerCase()+' · ★ '+(n.mean||'—')+' · #'+n.id,conf:titleMatchConfidence(aliasFor(name,'mal'),n.title),act:A('malRelinkPick',name,n.id,n.title)});}).join('');
  }catch(e){res.innerHTML=emptyState('alert','Search failed',E(e.message||String(e)),'',true);}
  finally{var s2=inp.closest('.search');if(s2)s2.classList.remove('loading');}
}
act('malRelinkSearch',function(el,ev,name){if(typeof name!=='string'){var i=document.getElementById('mrlInput');name=i?i.getAttribute('data-series'):'';}return malRelinkSearch(name);});
act('malRelinkClear',function(){var i=document.getElementById('mrlInput');if(i){i.value='';i.focus();i.closest('.search').classList.remove('has-value');}});
act('malRelinkPick',function(el,ev,name,id,title){return malRelinkPick(name,id,title);});
expose('malManualIdInput','malUnlink');
async function lnkMal(name,id,title){return malRelinkPick(name,id,title);}

// ------------------------------------------------------------- cover search --
function openCoverSearch(name){
  var q=aliasFor(name,'anilist');
  openModal({id:'coverSearchOverlay',title:'Change cover',sub:'<b>'+E(name)+'</b>',icon:'image',width:680,
    body:'<div class="input-row" style="margin-bottom:14px">'+searchField({id:'coverSearchInput',value:q,placeholder:'Search AniList or type #MALID',enter:'runCoverSearch',clear:'coverSearchClear',extra:' data-series="'+E(name)+'" autofocus'}).replace('class="search','class="search grow')
      +'<button class="btn btn-primary"'+A('runCoverSearch',name)+'>Search</button></div><div id="coverSearchResults" class="cover-results"></div>',
    foot:'<div class="left"><button class="btn btn-ghost"'+A('coverAutoFetch',name)+'>'+ic('wand')+'Auto-pick best match</button></div><button class="btn btn-ghost" data-modal-close>Cancel</button>'});
  setTimeout(function(){runCoverSearch(name);},60);
}
function closeCoverSearch(){closeModalById('coverSearchOverlay');}
async function runCoverSearch(name){
  if(typeof name!=='string'){var i0=document.getElementById('coverSearchInput');name=i0?i0.getAttribute('data-series'):'';}
  var inp=document.getElementById('coverSearchInput'),res=document.getElementById('coverSearchResults');if(!inp||!res)return;
  var q=inp.value.trim();if(!q)return;
  res.innerHTML=[0,1,2,3,4].map(function(){return '<div class="skeleton" style="aspect-ratio:2/3;border-radius:12px"></div>';}).join('');
  try{
    if(/^#\d+$/.test(q)){var d=await api.malGetAnimeDetails(parseInt(q.slice(1),10));if(!d||d.error){res.innerHTML='<div class="span-all">'+emptyState('search','MAL entry not found','','',true)+'</div>';return;}q=d.title||q;}
    var r=await api.anilistSearch(q,10);
    if(!r||!r.length){res.innerHTML='<div class="span-all">'+emptyState('image','No covers found','Try another title.','',true)+'</div>';return;}
    res.innerHTML=r.map(function(a){
      var img=a.coverImage?a.coverImage.large||a.coverImage.medium:'';var url=a.coverImage?(a.coverImage.extraLarge||a.coverImage.large):'';
      var t=a.title?(a.title.romaji||a.title.english||''):'';
      return '<button class="cover-opt"'+A('coverPickClose',name,url)+Tip(t)+'>'+(img?'<img src="'+E(img)+'" alt="" loading="lazy">':'')+'<span class="ellipsis">'+E(t)+'</span><span class="muted">'+(a.seasonYear||'')+'</span></button>';
    }).join('');
  }catch(e){res.innerHTML='<div class="span-all">'+emptyState('alert','Search failed',E(e.message||String(e)),'',true)+'</div>';}
}
act('runCoverSearch',function(el,ev,name){return runCoverSearch(name);});
act('coverSearchClear',function(){var i=document.getElementById('coverSearchInput');if(i){i.value='';i.focus();i.closest('.search').classList.remove('has-value');}});
act('coverPickClose',function(el,ev,name,url){closeCoverSearch();return coverPick(name,url);});
act('coverAutoFetch',function(el,ev,name){closeCoverSearch();return fetch1(name);});

// ---------------------------------------------------------- download button --
function dlSplitBtn(title,malData){
  var mls=getMyListStatus(malData);
  var status=((malData&&(malData.status||(mls&&mls.status)))||'').toString();
  var isAiring=status==='currently_airing'||status==='airing';
  return '<div class="split"><button class="btn btn-on-media btn-lg"'+A('dlDefault',title,isAiring)+Tip(isAiring?'Download the latest verified episode':'Download the best-seeded full release')+'>'+ic('download')+'Download</button>'
    +'<button class="btn btn-on-media btn-lg"'+A('dlMenu',title,isAiring)+' aria-label="More download options">'+ic('chevronDown')+'</button></div>';
}
act('dlDefault',function(el,ev,title,isAiring){return autoDownloadLatest(title,isAiring);});
act('dlMenu',function(el,ev,title,isAiring){
  var split=el.closest('.split');
  toggleMenu(split||el,[
    isAiring?{label:'Latest episode',sub:'verified',icon:'download',run:function(){autoDownloadLatest(title,true);}}:null,
    {label:'Entire series',sub:'best seeded',icon:'box',run:function(){autoDownloadFull(title,isAiring);}},
    {label:'Browse on Nyaa',icon:'external',run:function(){api.openExternal(buildNyaaUrl(title));}}
  ],{title:'Download'});
});
