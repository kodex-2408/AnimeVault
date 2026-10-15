// renderer/reader.js - the built-in reader: one page, two pages or a long
// strip, left-to-right or right-to-left, with a slim toolbar on the right, the
// chapter switcher in the top-right corner and the zoom control bottom right.
// Three kinds of content (see main/players/reader.js):
//   pages - comic images streamed from the archive through page://
//   pdf   - pages drawn with pdf.js, then shown exactly like images
//   html  - EPUB/MOBI text, sanitized here and shown as one scrolling column
// A chapter is marked read once the reader reaches S.cfg.readerMarkPercent of
// its pages (or of the text).

var RD=null;            // the open reader, or null
var RD_MODES=['single','double','strip'];
var RD_MODE_LABEL={single:'Single page',double:'Double page',strip:'Long strip'};
var RD_FIT_LABEL={height:'Fit height',width:'Fit width',original:'Original size'};
var RD_BUILTIN_EXTS=['.cbz','.zip','.cbr','.rar','.pdf','.epub','.mobi'];
var RD_ZOOM_MIN=30,RD_ZOOM_MAX=400,RD_ZOOM_STEP=10;

function rdPref(key,def,allowed){var v=S.cfg[key];return allowed.indexOf(v)>=0?v:def;}
function rdSetPref(key,val){S.cfg[key]=val;api.setConfig(key,val);}
function rdCanOpen(fpath){
  if(S.cfg.mangaReader==='external')return false;
  var m=/\.[^.\\\/]+$/.exec(String(fpath||''));
  return !!m&&RD_BUILTIN_EXTS.indexOf(m[0].toLowerCase())>=0;
}
function rdMarkPct(){var v=Number(S.cfg.readerMarkPercent);return Number.isInteger(v)&&v>=10&&v<=100?v:90;}
function rdZoomPref(){var v=Number(S.cfg.readerZoom);return Number.isInteger(v)&&v>=RD_ZOOM_MIN&&v<=RD_ZOOM_MAX?v:100;}
// Last position per file: a page index, or for text a share of the scroll.
function rdSavedPos(p){try{var v=parseFloat(localStorage.getItem('rdpos:'+p));return isNaN(v)?0:v;}catch(e){return 0;}}
function rdSavePos(p,v){try{localStorage.setItem('rdpos:'+p,String(v));}catch(e){}}
function rdChapters(name){
  var s=S.lib.find(function(x){return x.name===name;});
  return s?s.episodes.slice().sort(function(a,b){return (a.episodeNum===null?1e9:a.episodeNum)-(b.episodeNum===null?1e9:b.episodeNum);}):[];
}

// ---------------------------------------------------------------- pdf.js --
var _pdfjs=null;
function rdLoadPdfjs(){
  if(!_pdfjs){
    _pdfjs=import(new URL('node_modules/pdfjs-dist/build/pdf.min.mjs',document.baseURI).href).then(function(lib){
      lib.GlobalWorkerOptions.workerSrc=new URL('node_modules/pdfjs-dist/build/pdf.worker.min.mjs',document.baseURI).href;
      return lib;
    });
    _pdfjs.catch(function(){_pdfjs=null;});
  }
  return _pdfjs;
}
async function rdOpenPdf(token){
  var lib=await rdLoadPdfjs();
  var data=await api.readerFileData(token);
  if(!data)throw new Error('The PDF could not be read');
  var base=new URL('node_modules/pdfjs-dist/',document.baseURI).href;
  return lib.getDocument({data:data,isEvalSupported:false,cMapUrl:base+'cmaps/',cMapPacked:true,standardFontDataUrl:base+'standard_fonts/',wasmUrl:base+'wasm/'}).promise;
}
// A PDF page drawn once at a sharp size, kept as an image URL (the newest 16).
async function rdPdfPageUrl(R,i){
  if(R.pdfUrls[i])return R.pdfUrls[i];
  if(!R.pdfJobs[i]){
    R.pdfJobs[i]=(async function(){
      var page=await R.pdf.getPage(i+1);
      var base=page.getViewport({scale:1});
      var scale=Math.max(1,Math.min(4,2200*Math.min(2,window.devicePixelRatio||1)/2/Math.max(base.width,base.height)));
      var vp=page.getViewport({scale:scale});
      var canvas=document.createElement('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
      var ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
      await page.render({canvasContext:ctx,viewport:vp}).promise;
      var blob=await new Promise(function(res){canvas.toBlob(res,'image/jpeg',0.92);});
      var url=URL.createObjectURL(blob);
      R.pdfUrls[i]=url;R.pdfBlobs[i]=blob;R.pdfOrder.push(i);
      while(R.pdfOrder.length>16){var old=R.pdfOrder.shift();if(old!==i){URL.revokeObjectURL(R.pdfUrls[old]);delete R.pdfUrls[old];delete R.pdfBlobs[old];}}
      delete R.pdfJobs[i];
      return url;
    })();
  }
  return R.pdfJobs[i];
}
function rdFillPdfImg(img){
  var R=RD;if(!R||R.kind!=='pdf'||img.getAttribute('src'))return;
  var i=Number(img.dataset.i);
  rdPdfPageUrl(R,i).then(function(u){if(RD===R&&img.isConnected&&!img.dataset.tr){img.src=u;img.classList.remove('rd-pending');}}).catch(function(e){console.warn('[Reader] PDF page',i+1,e);});
}
function rdReleasePdf(R){
  if(!R||!R.pdf)return;
  Object.keys(R.pdfUrls).forEach(function(k){URL.revokeObjectURL(R.pdfUrls[k]);});
  R.pdfBlobs={};
  try{R.pdf.destroy();}catch(e){}
}

// ------------------------------------------------- EPUB / MOBI sanitizer --
// Book HTML is untrusted: only plain text structure and pictures served by
// page:// survive. Everything else is unwrapped (its text kept) or dropped.
var RD_KEEP_TAGS=new Set(['P','DIV','SPAN','H1','H2','H3','H4','H5','H6','EM','STRONG','B','I','U','S','SUB','SUP','SMALL','BR','HR','IMG','FIGURE','FIGCAPTION','BLOCKQUOTE','UL','OL','LI','DL','DT','DD','TABLE','THEAD','TBODY','TFOOT','TR','TD','TH','CAPTION','PRE','CODE','RUBY','RT','RP','SECTION','ARTICLE','ASIDE','HEADER','FOOTER','CENTER','CITE','Q','ABBR','MARK','DEL','INS']);
var RD_DROP_TAGS=new Set(['SCRIPT','STYLE','LINK','META','TITLE','HEAD','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','TEXTAREA','SELECT','VIDEO','AUDIO','SOURCE','TEMPLATE','NOSCRIPT','CANVAS','MATH','BASE']);
function rdSanitize(html,token){
  var doc=new DOMParser().parseFromString('<!doctype html><body>'+html,'text/html');
  var prefix='page://'+token+'/r/';
  (function clean(node){
    Array.prototype.slice.call(node.childNodes).forEach(function(ch){
      if(ch.nodeType===3)return;
      if(ch.nodeType!==1){ch.remove();return;}
      var tag=ch.tagName.toUpperCase();
      if(RD_DROP_TAGS.has(tag)){ch.remove();return;}
      clean(ch);
      if(!RD_KEEP_TAGS.has(tag)){ch.replaceWith.apply(ch,Array.prototype.slice.call(ch.childNodes));return;}
      var src=tag==='IMG'?ch.getAttribute('src')||'':'';
      var alt=tag==='IMG'?ch.getAttribute('alt')||'':'';
      var colspan=ch.getAttribute('colspan'),rowspan=ch.getAttribute('rowspan');
      Array.prototype.slice.call(ch.attributes).forEach(function(a){ch.removeAttribute(a.name);});
      if(tag==='IMG'){
        if(src.indexOf(prefix)!==0||!/^\d+$/.test(src.slice(prefix.length))){ch.remove();return;}
        ch.setAttribute('src',src);ch.setAttribute('alt',alt);ch.setAttribute('loading','lazy');
      }
      if((tag==='TD'||tag==='TH')){if(/^\d{1,2}$/.test(colspan||''))ch.setAttribute('colspan',colspan);if(/^\d{1,2}$/.test(rowspan||''))ch.setAttribute('rowspan',rowspan);}
    });
  })(doc.body);
  return doc.body.innerHTML;
}

// ---------------------------------------------------------------- open --
async function openReader(name,fpath,num){
  var r;
  try{r=await api.readerOpen(fpath);}catch(e){r={error:e.message};}
  if(!r||r.unsupported)return false;
  if(r.error){toast(r.error,'e');return true;}
  var R={name:name,path:fpath,num:num,token:r.token,kind:r.kind||'pages',count:r.count||0,page:0,
    chapters:rdChapters(name),idx:-1,
    mode:rdPref('readerMode','single',RD_MODES),dir:rdPref('readerDir','ltr',['ltr','rtl']),fit:rdPref('readerFit','height',['height','width','original']),
    zoom:rdZoomPref(),panel:null,marked:false,wide:{},fs:false,
    pdf:null,pdfUrls:{},pdfBlobs:{},pdfOrder:[],pdfJobs:{},html:null,observer:null,tr:rdTrNew()};
  R.idx=R.chapters.findIndex(function(e){return e.path===fpath;});
  try{
    if(R.kind==='pdf'){R.pdf=await rdOpenPdf(R.token);R.count=R.pdf.numPages;}
    if(R.kind==='html'){R.html=(r.sections||[]).map(function(s){return '<section class="rd-sec">'+rdSanitize(s,R.token)+'</section>';}).join('');R.count=(r.sections||[]).length;}
  }catch(e){
    api.readerClose(R.token);
    toast('Could not open this file in the built-in reader: '+(e&&e.message||e),'e');
    return false; // falls back to the reader app
  }
  var saved=rdSavedPos(fpath);
  if(R.kind==='html')R.scrollTo=saved>0&&saved<0.98?saved:0;
  else R.page=saved>0&&saved<R.count-1?Math.floor(saved):0;
  if(RD&&RD!==R){api.readerClose(RD.token);rdReleasePdf(RD);rdTrRelease(RD);if(RD.observer)RD.observer.disconnect();R.fs=RD.fs;R.panel=RD.panel==='chapters'?'chapters':null;}
  else{try{R.fs=await api.isFullScreen();}catch(e){}}
  RD=R;
  rdBuild();
  if(rdTrSupported())rdTrLoad(R);
  return true;
}

function rdSrc(i){return 'page://'+RD.token+'/'+i;}
function rdLayer(){return document.getElementById('rdLayer');}
function rdIsText(){return RD&&RD.kind==='html';}

function rdBuild(){
  var el=rdLayer();
  if(!el){
    el=document.createElement('div');el.id='rdLayer';el.className='rd-layer';el.setAttribute('role','dialog');el.setAttribute('aria-label','Reader');
    el.addEventListener('wheel',rdOnWheel,{passive:false});
    document.body.appendChild(el);
  }
  var ch=RD.chapters[RD.idx],total=RD.chapters.length,text=rdIsText();
  var chipLabel=(RD.num!==null&&RD.num!==undefined?'Ch. '+RD.num:'Chapter')+(total?' / '+(RD.chapters[total-1].episodeNum!==null?RD.chapters[total-1].episodeNum:total):'');
  var tools=[['home','rdClose','Back to series (Esc)']];
  if(!text)tools.push(['bookOpen','rdCycleMode',RD_MODE_LABEL[RD.mode]+' (M)']);
  tools.push(['list','rdTogglePanel','Chapters (C)','chapters'],['gear','rdTogglePanel','Reader settings','settings']);
  if(!text)tools.push([RD.fit==='width'?'fitWidth':RD.fit==='height'?'fitHeight':'expand','rdCycleFit',RD_FIT_LABEL[RD.fit]+' (W)'],['swap','rdToggleDir',(RD.dir==='rtl'?'Right to left':'Left to right')+' (D)']);
  if(rdTrSupported())tools.push(['translate','rdToggleTranslate','Translate pages (T)','',RD.tr.on]);
  tools.push(['fullscreen','rdFullscreen',(RD.fs?'Exit fullscreen':'Fullscreen')+' (F)','',RD.fs],['help','rdTogglePanel','Keyboard shortcuts (?)','help']);
  var mode=text?'text':RD.mode;
  el.className='rd-layer rd-'+mode+' rd-fit-'+RD.fit+' rd-'+RD.dir+(RD.panel?' rd-has-panel':'')+(RD.zoom!==100?' rd-zoomed':'');
  el.style.setProperty('--rd-zoom',String(RD.zoom/100));
  el.innerHTML='<div class="rd-stage" id="rdStage" tabindex="-1"'+A('rdStageClick')+'></div>'
    +'<div class="rd-chip"><button class="rd-chip-btn" aria-label="Previous chapter"'+A('rdChapterStep',-1)+(RD.idx>0?'':' disabled')+'>'+ic('chevronLeft')+'</button>'
    +'<span class="rd-chip-label"'+(ch?Tip(ch.name):'')+'>'+E(chipLabel)+'</span>'
    +'<button class="rd-chip-btn" aria-label="Next chapter"'+A('rdChapterStep',1)+(RD.idx>=0&&RD.idx<total-1?'':' disabled')+'>'+ic('chevronRight')+'</button></div>'
    +'<nav class="rd-tools" aria-label="Reader tools">'+tools.map(function(t){
      var on=(t[3]&&RD.panel===t[3])||t[4];
      return '<button class="rd-tool'+(on?' on':'')+'" aria-label="'+E(t[2])+'"'+Tip(t[2])+(t[3]?A(t[1],t[3]):A(t[1]))+'>'+ic(t[0])+'</button>';
    }).join('')+'</nav>'
    +'<aside class="rd-panel" id="rdPanel">'+rdPanelHtml()+'</aside>'
    +'<div class="rd-zoom" role="group" aria-label="Zoom">'
      +'<button class="rd-chip-btn" aria-label="Zoom out (Ctrl −)"'+Tip('Zoom out (Ctrl −)')+A('rdZoomStep',-1)+(RD.zoom<=RD_ZOOM_MIN?' disabled':'')+'>'+ic('minimize')+'</button>'
      +'<button class="rd-zoom-val" id="rdZoomVal" aria-label="Reset zoom (Ctrl 0)"'+Tip('Reset to 100% (Ctrl 0)')+A('rdZoomReset')+'>'+RD.zoom+'%</button>'
      +'<button class="rd-chip-btn" aria-label="Zoom in (Ctrl +)"'+Tip('Zoom in (Ctrl +)')+A('rdZoomStep',1)+(RD.zoom>=RD_ZOOM_MAX?' disabled':'')+'>'+ic('plus')+'</button></div>'
    +'<div class="rd-progress" id="rdProgress"><div class="rd-progress-fill" id="rdProgressFill"></div></div>'
    +'<div class="rd-pageno" id="rdPageNo"></div>'
    +'<div class="rd-tr-status" id="rdTrStatus" role="status" aria-live="polite"></div>';
  rdRenderPages();
  rdTrStatus();
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
    var note='<div class="rd-set-note">Marked read at '+rdMarkPct()+'% of the '+(rdIsText()?'text':'pages')+'. Change it in Settings → Manga. Zoom with Ctrl + scroll wheel or the control in the bottom-right corner.</div>';
    var trNote=rdTrSupported()?'<div class="rd-set-note">Translate (T) letters '+E(RD.tr.lang||'English')+' into the pages; T again shows the originals. Language and model: Settings → Manga.</div>':'';
    if(rdIsText())return '<div class="rd-panel-title">Reader settings</div><div class="rd-set-note">Books with text scroll as one column; zoom changes the text size.</div>'+note;
    return '<div class="rd-panel-title">Reader settings</div>'
      +seg('Display','readerMode',RD.mode,[['single','Single'],['double','Double'],['strip','Long strip']])
      +seg('Direction','readerDir',RD.dir,[['ltr','Left → right'],['rtl','Right → left']])
      +seg('Fit','readerFit',RD.fit,[['height','Height'],['width','Width'],['original','Original']])
      +note+trNote;
  }
  if(RD.panel==='help'){
    var keys=[['→ / ←','Next / previous page (flipped right to left)'],['Space · Page Down','Next page'],['Page Up','Previous page'],['Home · End','First / last page'],['[ · ]','Previous / next chapter'],['Ctrl + wheel','Zoom in or out'],['Ctrl + / − / 0','Zoom in, out, reset'],['M','Single, double or long strip'],['W','Fit height, width or original'],['D','Reading direction'],['C','Chapter list'],['F','Fullscreen'],['T','Translate pages, or show the originals'],['Esc','Close panel, leave fullscreen, then the reader']];
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
function rdImg(i,lazy){
  var pdf=RD.kind==='pdf';
  return '<img class="rd-page'+(pdf?' rd-pending':'')+'" data-i="'+i+'"'+(pdf?'':' src="'+rdSrc(i)+'"')+(lazy?' loading="lazy"':'')+' decoding="async" alt="Page '+(i+1)+'">';
}

function rdRenderPages(){
  var stage=document.getElementById('rdStage');if(!stage)return;
  if(RD.observer){RD.observer.disconnect();RD.observer=null;}
  if(rdIsText()){
    stage.innerHTML='<div class="rd-col"><article class="rd-book">'+RD.html+'</article>'+rdEndCard()+'</div>';
    stage.onscroll=rdOnTextScroll;
    if(RD.scrollTo){var to=RD.scrollTo;RD.scrollTo=0;setTimeout(function(){stage.scrollTop=to*(stage.scrollHeight-stage.clientHeight);rdOnTextScroll();},60);}
  }else if(RD.mode==='strip'){
    var h='';
    for(var i=0;i<RD.count;i++)h+=rdImg(i,true);
    stage.innerHTML='<div class="rd-col">'+h+rdEndCard()+'</div>';
    stage.onscroll=rdOnStripScroll;
    if(RD.kind==='pdf'){
      RD.observer=new IntersectionObserver(function(entries){entries.forEach(function(en){if(en.isIntersecting)rdFillPdfImg(en.target);});},{root:stage,rootMargin:'1600px 0px'});
      stage.querySelectorAll('img.rd-pending').forEach(function(img){RD.observer.observe(img);});
    }
    var target=stage.querySelector('[data-i="'+RD.page+'"]');
    if(target&&RD.page>0)setTimeout(function(){target.scrollIntoView({block:'start'});},50);
  }else{
    stage.onscroll=null;
    RD.page=rdSpreadStart(RD.page);
    var pages=rdSpread(RD.page);
    if(RD.dir==='rtl')pages=pages.slice().reverse();
    stage.innerHTML='<div class="rd-spread">'+pages.map(function(i){return rdImg(i,false);}).join('')+'</div>';
    stage.scrollTop=0;stage.scrollLeft=0;
    stage.querySelectorAll('img').forEach(function(img){img.addEventListener('load',rdNoteSize);rdFillPdfImg(img);});
    for(var k=1;k<=3;k++){
      if(RD.page+k>=RD.count)break;
      if(RD.kind==='pdf')rdPdfPageUrl(RD,RD.page+k).catch(function(){});
      else{var pre=new Image();pre.src=rdSrc(RD.page+k);}
    }
  }
  rdUpdateProgress();
  rdTrUpdate();
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
  var mid=stage.getBoundingClientRect().top+stage.clientHeight*0.5,imgs=stage.querySelectorAll('.rd-page'),cur=0;
  for(var i=0;i<imgs.length;i++){if(imgs[i].getBoundingClientRect().top<=mid)cur=i;else break;}
  if(stage.scrollTop+stage.clientHeight>=stage.scrollHeight-4)cur=RD.count-1;
  if(cur!==RD.page){RD.page=cur;rdUpdateProgress();}
  if(RD.tr.on){clearTimeout(rdOnStripScroll._t);rdOnStripScroll._t=setTimeout(rdTrUpdate,250);}
}
function rdOnTextScroll(){
  var stage=document.getElementById('rdStage');if(!stage||!RD)return;
  var max=stage.scrollHeight-stage.clientHeight;
  RD.textPct=max>0?Math.min(1,(stage.scrollTop+stage.clientHeight)/stage.scrollHeight):1;
  RD.textPos=max>0?stage.scrollTop/max:0;
  rdUpdateProgress();
}

function rdUpdateProgress(){
  if(!RD)return;
  var pct,label;
  if(rdIsText()){
    pct=RD.textPct||0;label=Math.round(pct*100)+'%';
    rdSavePos(RD.path,pct>=0.995?0:(RD.textPos||0));
  }else{
    var last=RD.mode==='strip'?RD.page:Math.max.apply(null,rdSpread(RD.page));
    var first=RD.mode==='strip'?RD.page:Math.min.apply(null,rdSpread(RD.page));
    pct=RD.count?(last+1)/RD.count:0;
    label=(first===last?(last+1):(first+1)+'–'+(last+1))+' / '+RD.count;
    rdSavePos(RD.path,last>=RD.count-1?0:RD.page);
  }
  var fill=document.getElementById('rdProgressFill');if(fill)fill.style.width=(pct*100).toFixed(1)+'%';
  var no=document.getElementById('rdPageNo');if(no)no.textContent=label;
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

// ---------------------------------------------------------------- zoom --
function rdSetZoom(z){
  if(!RD)return;
  z=Math.max(RD_ZOOM_MIN,Math.min(RD_ZOOM_MAX,Math.round(z)));
  if(z===RD.zoom)return;
  var stage=document.getElementById('rdStage');
  // Keep the same spot of the page under the view while it grows or shrinks.
  var fy=stage&&stage.scrollHeight>stage.clientHeight?(stage.scrollTop+stage.clientHeight/2)/stage.scrollHeight:0.5;
  var fx=stage&&stage.scrollWidth>stage.clientWidth?(stage.scrollLeft+stage.clientWidth/2)/stage.scrollWidth:0.5;
  RD.zoom=z;
  var el=rdLayer();
  el.style.setProperty('--rd-zoom',String(z/100));
  el.classList.toggle('rd-zoomed',z!==100);
  var val=document.getElementById('rdZoomVal');if(val)val.textContent=z+'%';
  el.querySelectorAll('.rd-zoom .rd-chip-btn').forEach(function(b,k){b.disabled=k===0?z<=RD_ZOOM_MIN:z>=RD_ZOOM_MAX;});
  if(stage){
    stage.scrollTop=fy*stage.scrollHeight-stage.clientHeight/2;
    stage.scrollLeft=fx*stage.scrollWidth-stage.clientWidth/2;
  }
  clearTimeout(rdSetZoom._t);rdSetZoom._t=setTimeout(function(){rdSetPref('readerZoom',z);},400);
}
function rdZoomStep(d){if(RD)rdSetZoom((Math.round(RD.zoom/RD_ZOOM_STEP)+d)*RD_ZOOM_STEP);}
function rdZoomReset(){rdSetZoom(100);}
function rdOnWheel(e){
  if(!RD||!(e.ctrlKey||e.metaKey))return;
  e.preventDefault();
  rdZoomStep(e.deltaY<0?1:-1);
}

// ---------------------------------------------------------- navigation --
function rdGo(delta){
  if(!RD||RD.mode==='strip'||rdIsText())return;
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
function rdGoTo(i){
  if(!RD)return;
  var stage=document.getElementById('rdStage');
  if(rdIsText()){if(stage)stage.scrollTop=i<=0?0:stage.scrollHeight;return;}
  RD.page=Math.max(0,Math.min(RD.count-1,i));
  if(RD.mode==='strip'){var t=document.querySelector('#rdStage [data-i="'+RD.page+'"]');if(t)t.scrollIntoView({block:'start'});rdUpdateProgress();}else rdRenderPages();
}
async function rdChapterStep(d){
  if(!RD)return;
  var target=RD.chapters[RD.idx+d];
  if(!target){toast(d>0?'That was the last chapter in your library':'This is the first chapter','i');return;}
  await openReader(RD.name,target.path,target.episodeNum);
}
async function rdOpenChapter(i){var t=RD&&RD.chapters[i];if(t)await openReader(RD.name,t.path,t.episodeNum);}

function rdClose(){
  if(!RD)return;
  var R=RD,name=R.name;
  api.readerClose(R.token);
  if(R.observer)R.observer.disconnect();
  rdReleasePdf(R);
  rdTrRelease(R);
  if(R.fs)api.setFullScreen(false);
  RD=null;
  var el=rdLayer();if(el)el.remove();
  if(S.cur&&S.cur.name===name)odtl(name);
  if(S.view==='library'||S.view==='continue'||S.view==='completed')render();
}
function rdCycleMode(){if(rdIsText())return;rdSetOption('readerMode',RD_MODES[(RD_MODES.indexOf(RD.mode)+1)%RD_MODES.length]);toast(RD_MODE_LABEL[RD.mode],'i');}
function rdCycleFit(){if(rdIsText())return;var f=['height','width','original'];rdSetOption('readerFit',f[(f.indexOf(RD.fit)+1)%f.length]);toast(RD_FIT_LABEL[RD.fit],'i');}
function rdToggleDir(){if(rdIsText())return;rdSetOption('readerDir',RD.dir==='rtl'?'ltr':'rtl');toast(RD.dir==='rtl'?'Right to left':'Left to right','i');}
function rdSetOption(key,val){
  if(!RD)return;
  rdSetPref(key,val);
  if(key==='readerMode')RD.mode=val;else if(key==='readerDir')RD.dir=val;else if(key==='readerFit')RD.fit=val;
  rdBuild();
}
function rdTogglePanel(which){if(!RD)return;RD.panel=RD.panel===which?null:which;rdBuild();
  if(RD.panel==='chapters'){var cur=document.querySelector('.rd-ch.cur');if(cur)cur.scrollIntoView({block:'center'});}}
// The whole app window goes fullscreen; again (or Esc) restores it.
async function rdFullscreen(on){
  if(!RD)return;
  var R=RD,want=typeof on==='boolean'?on:!R.fs;
  try{R.fs=await api.setFullScreen(want);}catch(e){R.fs=false;}
  if(RD===R){var b=document.querySelector('.rd-tool[aria-label^="Fullscreen"],.rd-tool[aria-label^="Exit fullscreen"]');
    if(b){b.classList.toggle('on',R.fs);var lbl=(R.fs?'Exit fullscreen':'Fullscreen')+' (F)';b.setAttribute('aria-label',lbl);b.setAttribute('data-tip',lbl);}}
}
// Click the left or right part of the page to turn it (flipped right to left).
function rdStageClick(el,ev){
  if(!RD||RD.mode==='strip'||rdIsText()||(ev.target&&ev.target.closest&&ev.target.closest('button')))return;
  if(RD.panel){RD.panel=null;rdBuild();return;}
  var x=ev.clientX/window.innerWidth;
  if(x>0.38&&x<0.62)return;
  var forward=x>=0.62;if(RD.dir==='rtl')forward=!forward;
  rdGo(forward?1:-1);
}

// ---------------------------------------------------------- translation --
// The Translate tool (T) shows each page with its text translated: the
// balloons are found in the page (renderer/typeset.js), the model says what
// each one says, and the translation is lettered into the page image, which
// then replaces the original on screen. It is switched on per chapter, because
// every new page is one paid OpenRouter request; the main process keeps each
// answer, so reading a page again is free. T again shows the originals.
var RD_TR_LANGS=['English','Spanish','Portuguese','French','German','Italian','Indonesian','Vietnamese','Thai','Russian','Polish','Turkish','Arabic','Chinese (Simplified)','Korean','Japanese'];
var RD_TR_MAX_EDGE=2400;   // pages are lettered at up to this size
function rdTrNew(){return {on:false,pages:{},urls:{},pending:{},errors:{},halted:false,told:{},lang:'',hasKey:false};}
function rdTrSupported(){return !!RD&&(RD.kind==='pages'||RD.kind==='pdf');}
function rdTrRelease(R){if(!R||!R.tr)return;Object.keys(R.tr.urls).forEach(function(k){URL.revokeObjectURL(R.tr.urls[k]);});R.tr.urls={};}
async function rdTrLoad(R){
  var st;try{st=await api.translateState(R.token);}catch(e){return;}
  if(RD!==R||!st||!st.supported)return;
  var T=R.tr;T.lang=st.lang||'English';T.hasKey=!!st.hasKey;
  Object.keys(st.pages||{}).forEach(function(i){T.pages[i]=st.pages[i];});
  if(st.enabled&&st.hasKey){T.on=true;rdTrSyncTool();rdTrUpdate();}
}
async function rdToggleTranslate(){
  if(!rdTrSupported())return;
  var R=RD,T=R.tr;
  if(!T.on&&!T.hasKey){
    var st=null;try{st=await api.translateState(R.token);}catch(e){}
    if(RD!==R)return;
    if(!st||!st.hasKey){toast('Add your OpenRouter key in Settings → Companion to translate pages','e');return;}
    T.hasKey=true;T.lang=st.lang||'English';
  }
  T.on=!T.on;T.halted=false;T.errors={};T.told={};
  api.translateSetEnabled(R.token,T.on);
  rdTrSyncTool();
  if(T.on){
    if(!rdToggleTranslate.told){rdToggleTranslate.told=true;toast('Translating this chapter into '+T.lang+' as you read. Each new page is one paid OpenRouter request; translated pages are saved. Press T to see the original.','i');}
    rdTrUpdate();
  }else rdTrApply();
}
function rdTrSyncTool(){
  var b=document.querySelector('.rd-tool[aria-label^="Translate"]');
  if(b)b.classList.toggle('on',!!(RD&&RD.tr.on));
  rdTrStatus();
}
// Pages on screen, plus the next one in paged modes so it is ready in time.
function rdTrTargets(){
  var stage=document.getElementById('rdStage');if(!stage)return [];
  if(RD.mode!=='strip'){var p=rdSpread(RD.page).slice(),nx=RD.page+p.length;if(nx<RD.count)p.push(nx);return p;}
  var r=stage.getBoundingClientRect(),out=[];
  stage.querySelectorAll('img.rd-page').forEach(function(img){var b=img.getBoundingClientRect();if(b.bottom>r.top-200&&b.top<r.bottom+r.height*0.5)out.push(Number(img.dataset.i));});
  return out;
}
function rdTrUpdate(){
  if(!RD||!RD.tr||!RD.tr.on)return;
  var R=RD;
  if(R.mode==='strip')rdTrQueueAll(R);
  else rdTrTargets().forEach(function(i){rdTrRequest(R,i);});
  rdTrApply();rdTrStatus();
}
// Long strips (manhwa, webtoons): the whole chapter is queued the moment
// translation is switched on. RD_TR_PARALLEL pages are worked on at a time
// (detection, the request, lettering): the ones on screen first, then the rest
// of the chapter in reading order, then anything above.
var RD_TR_PARALLEL=3;
function rdTrQueueAll(R){
  var T=R.tr;if(T.queueRunning)return;
  var first=rdTrTargets()[0]||0,order=[];
  for(var k=first;k<R.count;k++)order.push(k);
  for(var j=0;j<first;j++)order.push(j);
  T.queueRunning=true;
  var next=0;
  function worker(){
    while(next<order.length){
      var i=order[next++];
      if(RD!==R||!T.on||T.halted)break;
      if(T.urls[i]||T.pending[i]||T.errors[i])continue;
      return rdTrRequest(R,i).then(worker);
    }
  }
  var workers=[];for(var w=0;w<RD_TR_PARALLEL;w++)workers.push(Promise.resolve().then(worker));
  Promise.all(workers).then(function(){T.queueRunning=false;});
}
// The page's own picture: from the archive, or as pdf.js drew it.
async function rdTrPageBlob(R,i){
  if(R.kind==='pdf'){await rdPdfPageUrl(R,i);return R.pdfBlobs[i]||null;}
  var bytes=await api.readerPageData(R.token,i);
  return bytes?new Blob([bytes]):null;
}
// The text detector's model, fetched once per session (the main process
// downloads it the first time, about 95 MB).
var _rdTrModel=null,_rdTrModelPct=null;
function rdTrModel(){
  if(!_rdTrModel){
    _rdTrModel=api.translateDetectorModel().then(function(r){if(!r||r.error)throw new Error((r&&r.error)||'The text detector is not available');_rdTrModelPct=null;return r;});
    _rdTrModel.catch(function(){_rdTrModel=null;_rdTrModelPct=null;rdTrStatus();});
  }
  return _rdTrModel;
}
if(api.onTranslateModelProgress)api.onTranslateModelProgress(function(f){_rdTrModelPct=Math.max(0,Math.min(99,Math.round(f*100)));rdTrStatus();});
// Where the text is: the detector when it can run, otherwise the balloons
// the page's own pixels show (renderer/typeset.js).
async function rdTrPlan(cv,img,W,H){
  try{
    var d=await TD.detect(cv,W,H,rdTrModel,true);
    return TS.plan(img,d);
  }catch(e){
    console.warn('[Translate] text detector unavailable, using the balloon finder:',e&&e.message||e);
    if(!rdTrPlan.told){rdTrPlan.told=true;toast('The text detector could not start ('+(e&&e.message||e)+'). Using the simpler balloon finder.','i');}
    return TS.planLegacy(img);
  }
}
// Finds the text, asks for the translation (unless it is saved), letters it
// in and returns the translated page as an image URL.
// Lettering version: finished pages saved by an older detector or lettering
// code are not reused (the hash covers the code that draws them).
var _rdTrRv=null;
function rdTrRv(){
  if(_rdTrRv)return _rdTrRv;
  var src=String(TS.plan)+String(TS.render)+String(TS.planLegacy)+(typeof TD!=='undefined'?String(TD.detect):'')+RD_TR_MAX_EDGE,h=5381;
  for(var k=0;k<src.length;k++)h=((h<<5)+h+src.charCodeAt(k))|0;
  return _rdTrRv='v'+(h>>>0).toString(36);
}
async function rdTrLetter(R,i){
  // A page finished before: show it straight away.
  try{var saved=await api.translatePageImage(R.token,i,rdTrRv());if(saved&&saved.byteLength)return URL.createObjectURL(new Blob([saved],{type:'image/jpeg'}));}catch(e){}
  var blob=await rdTrPageBlob(R,i);
  if(!blob)throw new Error('This page could not be read');
  var bmp=await createImageBitmap(blob);
  try{
    var sc=Math.min(1,RD_TR_MAX_EDGE/Math.max(bmp.width,bmp.height)),W=Math.round(bmp.width*sc),H=Math.round(bmp.height*sc);
    var cv=document.createElement('canvas');cv.width=W;cv.height=H;
    var ctx=cv.getContext('2d',{willReadFrequently:true});ctx.drawImage(bmp,0,0,W,H);
    var img=ctx.getImageData(0,0,W,H),det=await rdTrPlan(cv,img,W,H),items=R.tr.pages[i];
    if(!items){
      var ann=TS.annotate(cv,det,1600);
      var jpg=await new Promise(function(res){ann.toBlob(res,'image/jpeg',0.88);});
      var res=await api.translatePage(R.token,i,{image:new Uint8Array(await jpg.arrayBuffer()),regions:TS.regionBoxes(det)});
      if(!res||res.error)throw Object.assign(new Error((res&&res.error)||'Translation failed'),{kind:res&&res.kind});
      items=R.tr.pages[i]=Array.isArray(res.items)?res.items:[];
    }
    try{await document.fonts.load('700 20px "Comic Neue"');}catch(e){}
    TS.render(ctx,img,det,items);
    var out=await new Promise(function(res){cv.toBlob(res,'image/jpeg',0.95);});
    out.arrayBuffer().then(function(b){return api.translateSavePageImage(R.token,i,rdTrRv(),new Uint8Array(b));}).catch(function(){});
    return URL.createObjectURL(out);
  }finally{if(bmp.close)bmp.close();}
}
async function rdTrRequest(R,i){
  var T=R.tr;
  if(T.urls[i]||T.pending[i]||T.errors[i]||T.halted)return;
  T.pending[i]=true;rdTrStatus();
  var url=null,err=null;
  try{url=await rdTrLetter(R,i);}catch(e){err=e;}
  delete T.pending[i];
  if(RD!==R){if(url)URL.revokeObjectURL(url);return;}
  if(err){
    var msg=(err&&err.message)||'Translation failed';T.errors[i]=msg;
    if(err.kind==='key'||err.kind==='quota')T.halted=true; // no point sending more pages
    if(!T.told[msg]){T.told[msg]=true;toast('Page '+(i+1)+' wasn’t translated: '+msg,'e');}
  }else T.urls[i]=url;
  rdTrStatus();rdTrApply();
}
function rdTrStatus(){
  var el=document.getElementById('rdTrStatus');if(!el)return;
  var T=RD&&RD.tr;
  if(!T||!T.on){el.textContent='';el.classList.remove('on');return;}
  var busy=Object.keys(T.pending).length,failed=Object.keys(T.errors).length,txt;
  if(busy&&_rdTrModelPct!==null)txt='Downloading the text detector (95 MB, once): '+_rdTrModelPct+'%';
  else if(busy&&T.queueRunning)txt='Translating the chapter: '+Object.keys(T.urls).length+' of '+RD.count+' pages ready…';
  else if(busy)txt='Translating '+(busy===1?'1 page':busy+' pages')+'…';
  else if(T.halted)txt='Translation stopped: '+T.errors[Object.keys(T.errors)[0]];
  else if(failed)txt=(failed===1?'1 page':failed+' pages')+' not translated. Press T twice to retry.';
  else txt='Translated into '+T.lang+' · T shows the original';
  el.textContent=txt;el.classList.add('on');el.classList.toggle('busy',!!busy);
}
// Shows the translated pages (or the originals again when translation is off).
function rdTrApply(){
  if(!RD||!RD.tr)return;
  var T=RD.tr;
  document.querySelectorAll('#rdStage img.rd-page').forEach(function(img){
    var i=Number(img.dataset.i),url=T.on?T.urls[i]:null;
    if(url){if(img.getAttribute('src')!==url){img.dataset.tr='1';img.classList.remove('rd-pending');img.src=url;}return;}
    if(img.dataset.tr){delete img.dataset.tr;
      if(RD.kind==='pdf'){img.removeAttribute('src');img.classList.add('rd-pending');rdFillPdfImg(img);}
      else img.src=rdSrc(i);}
  });
}

act('rdStageClick',rdStageClick);
act('rdChapterStep',function(el,ev,d){return rdChapterStep(d);});
act('rdOpenChapter',function(el,ev,i){return rdOpenChapter(i);});
act('rdTogglePanel',function(el,ev,w){rdTogglePanel(w);});
act('rdSetOption',function(el,ev,k,v){rdSetOption(k,v);});
act('rdZoomStep',function(el,ev,d){rdZoomStep(d);});
act('rdFullscreen',function(){return rdFullscreen();});
act('rdToggleTranslate',function(){return rdToggleTranslate();});
expose('rdClose','rdCycleMode','rdCycleFit','rdToggleDir','rdZoomReset');

// Captured before the app's own shortcuts so nothing behind the reader reacts.
document.addEventListener('keydown',function(e){
  if(!RD||e.altKey)return;
  var t=e.target;if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'))return;
  var k=e.key,handled=true,rtl=RD.dir==='rtl',paged=RD.mode!=='strip'&&!rdIsText();
  if(e.ctrlKey||e.metaKey){
    if(k==='+'||k==='='||k==='Add')rdZoomStep(1);
    else if(k==='-'||k==='_'||k==='Subtract')rdZoomStep(-1);
    else if(k==='0')rdZoomReset();
    else handled=false;
  }
  else if(k==='Escape'){if(RD.panel){RD.panel=null;rdBuild();}else if(RD.fs){rdFullscreen(false);}else rdClose();}
  else if(k==='ArrowRight'&&paged)rdGo(rtl?-1:1);
  else if(k==='ArrowLeft'&&paged)rdGo(rtl?1:-1);
  else if((k===' '||k==='PageDown')&&paged)rdGo(1);
  else if(k==='PageUp'&&paged)rdGo(-1);
  else if(k==='Home')rdGoTo(0);
  else if(k==='End')rdGoTo(RD.count-1);
  else if(k===']')rdChapterStep(1);
  else if(k==='[')rdChapterStep(-1);
  else if(k==='m'||k==='M')rdCycleMode();
  else if(k==='w'||k==='W')rdCycleFit();
  else if(k==='d'||k==='D')rdToggleDir();
  else if(k==='c'||k==='C')rdTogglePanel('chapters');
  else if(k==='f'||k==='F')rdFullscreen();
  else if((k==='t'||k==='T')&&rdTrSupported())rdToggleTranslate();
  else if(k==='?')rdTogglePanel('help');
  else handled=false;
  if(handled){e.preventDefault();e.stopImmediatePropagation();}
},true);
