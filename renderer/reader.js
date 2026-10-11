// renderer/reader.js - the built-in manga reader: one page, two pages or a
// long strip, left-to-right or right-to-left, with a slim toolbar on the right
// and the chapter switcher in the top-right corner. Pages stream from the
// chapter archive through page://; a chapter is marked read once the reader
// reaches S.cfg.readerMarkPercent of its pages.

var RD=null;            // the open reader, or null
var RD_MODES=['single','double','strip'];
var RD_MODE_LABEL={single:'Single page',double:'Double page',strip:'Long strip'};
var RD_FIT_LABEL={height:'Fit height',width:'Fit width',original:'Original size'};
var RD_BUILTIN_EXTS=['.cbz','.zip','.cbr','.rar'];

function rdPref(key,def,allowed){var v=S.cfg[key];return allowed.indexOf(v)>=0?v:def;}
function rdSetPref(key,val){S.cfg[key]=val;api.setConfig(key,val);}
function rdCanOpen(fpath){
  if(S.cfg.mangaReader==='external')return false;
  var m=/\.[^.\\\/]+$/.exec(String(fpath||''));
  return !!m&&RD_BUILTIN_EXTS.indexOf(m[0].toLowerCase())>=0;
}
function rdMarkPct(){var v=Number(S.cfg.readerMarkPercent);return Number.isInteger(v)&&v>=10&&v<=100?v:90;}
function rdPosKey(p){return 'rdpos:'+p;}
function rdSavedPage(p){try{var v=parseInt(localStorage.getItem(rdPosKey(p)),10);return isNaN(v)?0:v;}catch(e){return 0;}}
function rdSavePage(p,i){try{localStorage.setItem(rdPosKey(p),String(i));}catch(e){}}
function rdChapters(name){
  var s=S.lib.find(function(x){return x.name===name;});
  return s?s.episodes.slice().sort(function(a,b){return (a.episodeNum===null?1e9:a.episodeNum)-(b.episodeNum===null?1e9:b.episodeNum);}):[];
}

async function openReader(name,fpath,num){
  var r;
  try{r=await api.readerOpen(fpath);}catch(e){r={error:e.message};}
  if(!r||r.unsupported)return false;
  if(r.error){toast(r.error,'e');return true;}
  if(RD&&RD.token&&RD.token!==r.token)api.readerClose(RD.token);
  var chapters=rdChapters(name);
  var idx=chapters.findIndex(function(e){return e.path===fpath;});
  var saved=rdSavedPage(fpath);
  RD={name:name,path:fpath,num:num,token:r.token,count:r.count,
    page:saved>0&&saved<r.count-1?saved:0,chapters:chapters,idx:idx,
    mode:rdPref('readerMode','single',RD_MODES),dir:rdPref('readerDir','ltr',['ltr','rtl']),fit:rdPref('readerFit','height',['height','width','original']),
    panel:null,marked:false,wide:{}};
  rdBuild();
  return true;
}

function rdSrc(i){return 'page://'+RD.token+'/'+i;}
function rdLayer(){return document.getElementById('rdLayer');}

function rdBuild(){
  var el=rdLayer();
  if(!el){el=document.createElement('div');el.id='rdLayer';el.className='rd-layer';el.setAttribute('role','dialog');el.setAttribute('aria-label','Manga reader');document.body.appendChild(el);}
  var ch=RD.chapters[RD.idx],total=RD.chapters.length;
  var chipLabel=(RD.num!==null&&RD.num!==undefined?'Ch. '+RD.num:'Chapter')+(total?' / '+(RD.chapters[total-1].episodeNum!==null?RD.chapters[total-1].episodeNum:total):'');
  var tools=[
    ['home','rdClose','Back to series (Esc)'],
    ['bookOpen','rdCycleMode',RD_MODE_LABEL[RD.mode]+' (M)'],
    ['list','rdTogglePanel','Chapters (C)','chapters'],
    ['gear','rdTogglePanel','Reader settings','settings'],
    [RD.fit==='width'?'fitWidth':RD.fit==='height'?'fitHeight':'expand','rdCycleFit',RD_FIT_LABEL[RD.fit]+' (W)'],
    ['swap','rdToggleDir',(RD.dir==='rtl'?'Right to left':'Left to right')+' (D)'],
    ['fullscreen','rdFullscreen','Fullscreen (F)'],
    ['help','rdTogglePanel','Keyboard shortcuts (?)','help']
  ];
  el.className='rd-layer rd-'+RD.mode+' rd-fit-'+RD.fit+' rd-'+RD.dir+(RD.panel?' rd-has-panel':'');
  el.innerHTML='<div class="rd-stage" id="rdStage" tabindex="-1"'+A('rdStageClick')+'></div>'
    +'<div class="rd-chip"><button class="rd-chip-btn" aria-label="Previous chapter"'+A('rdChapterStep',-1)+(RD.idx>0?'':' disabled')+'>'+ic('chevronLeft')+'</button>'
    +'<span class="rd-chip-label"'+(ch?Tip(ch.name):'')+'>'+E(chipLabel)+'</span>'
    +'<button class="rd-chip-btn" aria-label="Next chapter"'+A('rdChapterStep',1)+(RD.idx>=0&&RD.idx<total-1?'':' disabled')+'>'+ic('chevronRight')+'</button></div>'
    +'<nav class="rd-tools" aria-label="Reader tools">'+tools.map(function(t){
      var on=t[3]&&RD.panel===t[3];
      return '<button class="rd-tool'+(on?' on':'')+'" aria-label="'+E(t[2])+'"'+Tip(t[2])+(t[3]?A(t[1],t[3]):A(t[1]))+'>'+ic(t[0])+'</button>';
    }).join('')+'</nav>'
    +'<aside class="rd-panel" id="rdPanel">'+rdPanelHtml()+'</aside>'
    +'<div class="rd-progress" id="rdProgress"><div class="rd-progress-fill" id="rdProgressFill"></div></div>'
    +'<div class="rd-pageno" id="rdPageNo"></div>';
  rdRenderPages();
  var st=document.getElementById('rdStage');if(st)st.focus({preventScroll:true});
}

function rdPanelHtml(){
  if(RD.panel==='chapters'){
    var ws=new Set(((S.lib.find(function(x){return x.name===RD.name;})||{}).watchData||{}).episodesWatched||[]);
    return '<div class="rd-panel-title">Chapters</div><div class="rd-ch-list">'+RD.chapters.map(function(e,i){
      var t=epTitle(e),n=e.episodeNum;
      return '<button class="rd-ch'+(i===RD.idx?' cur':'')+(n!==null&&ws.has(n)?' read':'')+'"'+A('rdOpenChapter',i)+Tip(e.name)+'>'
        +'<span class="rd-ch-num">'+(n!==null?n:'?')+'</span><span class="rd-ch-title">'+E(t||'')+'</span><span class="rd-ch-dot"></span></button>';
    }).join('')+'</div>';
  }
  if(RD.panel==='settings'){
    var seg=function(label,key,cur,opts){
      return '<div class="rd-set"><div class="rd-set-label">'+label+'</div><div class="rd-seg">'+opts.map(function(o){
        return '<button class="'+(cur===o[0]?'on':'')+'"'+A('rdSetOption',key,o[0])+'>'+o[1]+'</button>';}).join('')+'</div></div>';
    };
    return '<div class="rd-panel-title">Reader settings</div>'
      +seg('Display','readerMode',RD.mode,[['single','Single'],['double','Double'],['strip','Long strip']])
      +seg('Direction','readerDir',RD.dir,[['ltr','Left → right'],['rtl','Right → left']])
      +seg('Fit','readerFit',RD.fit,[['height','Height'],['width','Width'],['original','Original']])
      +'<div class="rd-set-note">Chapters are marked read at '+rdMarkPct()+'% of their pages. Change it in Settings → Manga.</div>';
  }
  if(RD.panel==='help'){
    var keys=[['→ / ←','Next / previous page (flipped right to left)'],['Space · Page Down','Next page'],['Page Up','Previous page'],['Home · End','First / last page'],['[ · ]','Previous / next chapter'],['M','Single, double or long strip'],['W','Fit height, width or original'],['D','Reading direction'],['C','Chapter list'],['F','Fullscreen'],['Esc','Close panel, then the reader']];
    return '<div class="rd-panel-title">Keyboard shortcuts</div><div class="rd-keys">'+keys.map(function(k){return '<div class="rd-key"><kbd>'+k[0]+'</kbd><span>'+k[1]+'</span></div>';}).join('')+'</div>';
  }
  return '';
}

// Pages shown together in double mode: the cover alone, wide spreads alone.
function rdSpread(i){
  if(RD.mode!=='double'||i===0||RD.wide[i])return [i];
  if(i+1<RD.count&&!RD.wide[i+1])return [i,i+1];
  return [i];
}
function rdSpreadStart(i){
  if(RD.mode!=='double')return i;
  var p=0;
  while(p<RD.count){var sp=rdSpread(p);if(sp.indexOf(i)>=0)return p;p+=sp.length;}
  return i;
}

function rdRenderPages(){
  var stage=document.getElementById('rdStage');if(!stage)return;
  if(RD.mode==='strip'){
    var h='';
    for(var i=0;i<RD.count;i++)h+='<img class="rd-page" data-i="'+i+'" src="'+rdSrc(i)+'" loading="lazy" decoding="async" alt="Page '+(i+1)+'">';
    h+=rdEndCard();
    stage.innerHTML=h;
    stage.onscroll=rdOnStripScroll;
    var target=stage.querySelector('[data-i="'+RD.page+'"]');
    if(target&&RD.page>0)setTimeout(function(){target.scrollIntoView({block:'start'});},50);
  }else{
    stage.onscroll=null;
    RD.page=rdSpreadStart(RD.page);
    var pages=rdSpread(RD.page);
    if(RD.dir==='rtl')pages=pages.slice().reverse();
    stage.innerHTML='<div class="rd-spread">'+pages.map(function(i){return '<img class="rd-page" data-i="'+i+'" src="'+rdSrc(i)+'" decoding="async" alt="Page '+(i+1)+'">';}).join('')+'</div>';
    stage.scrollTop=0;
    stage.querySelectorAll('img').forEach(function(img){img.addEventListener('load',rdNoteSize);});
    for(var k=1;k<=3;k++){if(RD.page+k<RD.count){var pre=new Image();pre.src=rdSrc(RD.page+k);}}
  }
  rdUpdateProgress();
}
function rdEndCard(){
  var next=RD.chapters[RD.idx+1];
  return '<div class="rd-end">'+(next?'<button class="btn btn-primary"'+A('rdChapterStep',1)+'>Next: Chapter '+E(String(next.episodeNum!==null?next.episodeNum:''))+'</button>':'<span class="muted">That was the last chapter in your library.</span>')
    +'<button class="btn btn-secondary"'+A('rdClose')+'>Back to series</button></div>';
}
// A page wider than tall is a two-page spread: double mode shows it alone.
function rdNoteSize(ev){
  if(!RD)return;
  var img=ev.target,i=Number(img.dataset.i);
  var wide=img.naturalWidth>img.naturalHeight*1.1;
  if(wide&&!RD.wide[i]&&RD.mode==='double'){RD.wide[i]=true;rdRenderPages();}
}
function rdOnStripScroll(){
  var stage=document.getElementById('rdStage');if(!stage||!RD)return;
  var mid=stage.scrollTop+stage.clientHeight*0.5,imgs=stage.querySelectorAll('.rd-page'),cur=0;
  for(var i=0;i<imgs.length;i++){if(imgs[i].offsetTop<=mid)cur=i;else break;}
  if(stage.scrollTop+stage.clientHeight>=stage.scrollHeight-4)cur=RD.count-1;
  if(cur!==RD.page){RD.page=cur;rdUpdateProgress();}
}

function rdUpdateProgress(){
  if(!RD)return;
  var last=RD.mode==='strip'?RD.page:Math.max.apply(null,rdSpread(RD.page));
  var pct=RD.count?(last+1)/RD.count:0;
  var fill=document.getElementById('rdProgressFill');if(fill)fill.style.width=(pct*100).toFixed(1)+'%';
  var no=document.getElementById('rdPageNo');
  if(no){var first=RD.mode==='strip'?RD.page:Math.min.apply(null,rdSpread(RD.page));no.textContent=(first===last?(last+1):(first+1)+'–'+(last+1))+' / '+RD.count;}
  rdSavePage(RD.path,last>=RD.count-1?0:RD.page);
  if(!RD.marked&&pct*100>=rdMarkPct())rdMarkRead();
}

async function rdMarkRead(){
  var name=RD.name,num=RD.num;RD.marked=true;
  if(num===null||num===undefined)return;
  if(checkmarksLocked()){toast('Ch '+num+' not marked: MAL sync is paused','i');return;}
  var s=S.lib.find(function(x){return x.name===name;});if(!s)return;
  if((s.watchData&&s.watchData.episodesWatched||[]).indexOf(num)>=0)return;
  var all=s.episodes.filter(function(e){return e.episodeNum!==null;}).map(function(e){return e.episodeNum;});
  var wd=await api.markUpTo(name,num,all);_patchLibWatchData(name,wd);
  toast('Marked Ch '+num+' as read','s');
  if(RD&&RD.panel==='chapters'){var p=document.getElementById('rdPanel');if(p)p.innerHTML=rdPanelHtml();}
  await autoSyncSeries(name);
}

function rdGo(delta){
  if(!RD||RD.mode==='strip')return;
  if(delta>0){
    var next=RD.page+rdSpread(RD.page).length;
    if(next>=RD.count){rdChapterStep(1);return;}
    RD.page=next;
  }else{
    if(RD.page===0){if(RD.idx>0)rdChapterStep(-1);return;}
    RD.page=rdSpreadStart(RD.page-1);
  }
  rdRenderPages();
}
function rdGoTo(i){if(!RD)return;RD.page=Math.max(0,Math.min(RD.count-1,i));
  if(RD.mode==='strip'){var t=document.querySelector('#rdStage [data-i="'+RD.page+'"]');if(t)t.scrollIntoView({block:'start'});rdUpdateProgress();}else rdRenderPages();}
async function rdChapterStep(d){
  if(!RD)return;
  var target=RD.chapters[RD.idx+d];
  if(!target){toast(d>0?'That was the last chapter in your library':'This is the first chapter','i');return;}
  await openReader(RD.name,target.path,target.episodeNum);
}
async function rdOpenChapter(i){var t=RD&&RD.chapters[i];if(t)await openReader(RD.name,t.path,t.episodeNum);}

function rdClose(){
  if(!RD)return;
  var name=RD.name;
  api.readerClose(RD.token);
  RD=null;
  var el=rdLayer();if(el)el.remove();
  if(document.fullscreenElement)document.exitFullscreen().catch(function(){});
  if(S.cur&&S.cur.name===name)odtl(name);
  if(S.view==='library'||S.view==='continue'||S.view==='completed')render();
}
function rdCycleMode(){rdSetOption('readerMode',RD_MODES[(RD_MODES.indexOf(RD.mode)+1)%RD_MODES.length]);toast(RD_MODE_LABEL[RD.mode],'i');}
function rdCycleFit(){var f=['height','width','original'];rdSetOption('readerFit',f[(f.indexOf(RD.fit)+1)%f.length]);toast(RD_FIT_LABEL[RD.fit],'i');}
function rdToggleDir(){rdSetOption('readerDir',RD.dir==='rtl'?'ltr':'rtl');toast(RD.dir==='rtl'?'Right to left':'Left to right','i');}
function rdSetOption(key,val){
  if(!RD)return;
  rdSetPref(key,val);
  if(key==='readerMode')RD.mode=val;else if(key==='readerDir')RD.dir=val;else if(key==='readerFit')RD.fit=val;
  rdBuild();
}
function rdTogglePanel(which){if(!RD)return;RD.panel=RD.panel===which?null:which;rdBuild();
  if(RD.panel==='chapters'){var cur=document.querySelector('.rd-ch.cur');if(cur)cur.scrollIntoView({block:'center'});}}
function rdFullscreen(){
  var el=rdLayer();if(!el)return;
  if(document.fullscreenElement)document.exitFullscreen().catch(function(){});
  else el.requestFullscreen().catch(function(){});
}
// Click the left or right part of the page to turn it (flipped right to left).
function rdStageClick(el,ev){
  if(!RD||RD.mode==='strip'||(ev.target&&ev.target.closest&&ev.target.closest('button')))return;
  if(RD.panel){RD.panel=null;rdBuild();return;}
  var x=ev.clientX/window.innerWidth;
  if(x>0.38&&x<0.62)return;
  var forward=x>=0.62;if(RD.dir==='rtl')forward=!forward;
  rdGo(forward?1:-1);
}

act('rdStageClick',rdStageClick);
act('rdChapterStep',function(el,ev,d){return rdChapterStep(d);});
act('rdOpenChapter',function(el,ev,i){return rdOpenChapter(i);});
act('rdTogglePanel',function(el,ev,w){rdTogglePanel(w);});
act('rdSetOption',function(el,ev,k,v){rdSetOption(k,v);});
expose('rdClose','rdCycleMode','rdCycleFit','rdToggleDir','rdFullscreen');

// Captured before the app's own shortcuts so nothing behind the reader reacts.
document.addEventListener('keydown',function(e){
  if(!RD||e.ctrlKey||e.metaKey||e.altKey)return;
  var t=e.target;if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'))return;
  var k=e.key,handled=true,rtl=RD.dir==='rtl';
  if(k==='Escape'){if(RD.panel){RD.panel=null;rdBuild();}else if(document.fullscreenElement){document.exitFullscreen().catch(function(){});}else rdClose();}
  else if(k==='ArrowRight'&&RD.mode!=='strip')rdGo(rtl?-1:1);
  else if(k==='ArrowLeft'&&RD.mode!=='strip')rdGo(rtl?1:-1);
  else if((k===' '||k==='PageDown')&&RD.mode!=='strip')rdGo(1);
  else if(k==='PageUp'&&RD.mode!=='strip')rdGo(-1);
  else if(k==='Home')rdGoTo(0);
  else if(k==='End')rdGoTo(RD.count-1);
  else if(k===']')rdChapterStep(1);
  else if(k==='[')rdChapterStep(-1);
  else if(k==='m'||k==='M')rdCycleMode();
  else if(k==='w'||k==='W')rdCycleFit();
  else if(k==='d'||k==='D')rdToggleDir();
  else if(k==='c'||k==='C')rdTogglePanel('chapters');
  else if(k==='f'||k==='F')rdFullscreen();
  else if(k==='?')rdTogglePanel('help');
  else handled=false;
  if(handled){e.preventDefault();e.stopImmediatePropagation();}
},true);
