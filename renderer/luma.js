/* AnimeVault renderer — Luma: AI chat dock (Claude Haiku 5.5 through OpenRouter with the user's own key, via the main process) and the floating mascot. */

var AI_KEY_PAGE='https://openrouter.ai/keys';
var AI_CREDITS_PAGE='https://openrouter.ai/credits';
function lumaActionButton(act2,tgt,ext){
  var label='Open',icon='arrowRight';
  if(act2==='nav'){
    var map={schedule:['Airing schedule','calendarClock'],explore:['Explore','compass'],stats:['Stats','chart'],hub:['Library Hub','inbox'],downloads:['Downloads','download'],appearance:['Appearance','palette'],mal:['MyAnimeList','layers'],filemgmt:['File Management','folder'],organize:['File Management','folder'],settings:['Settings','gear'],set:['Settings','gear']};
    var m=map[tgt]||['Go to '+tgt,'arrowRight'];label=m[0];icon=m[1];
    if((tgt==='settings'||tgt==='set')&&ext)label=ext.charAt(0).toUpperCase()+ext.slice(1)+' settings';
  }else if(act2==='nyaa'||act2==='download'){label='Find downloads: '+tgt;icon='download';}
  else if(act2==='detail'){label='View '+tgt;icon='info';}
  else if(act2==='autodl'){label='Check for new episodes';icon='zap';}
  else if(act2==='rescan'||act2==='scan'){label='Rescan library';icon='refresh';}
  else if(act2==='sync'){label='Refresh MAL links';icon='layers';}
  else if(act2==='organize'||act2==='filemgmt'){label='File tools';icon='folder';}
  else if(act2==='hub'){label='Library Hub';icon='inbox';}
  return '<button class="chip luma-act"'+A('lumaAction',act2,tgt||'',ext||'')+'>'+ic(icon)+E(label)+'</button>';
}
function parseLumaBubbleHtml(content){
  if(!content)return '';
  var raw=stripThinkingTags(content);if(!raw.trim())return '';
  var actions=[];
  var clean=raw.replace(/\[action:([a-zA-Z0-9_-]+)\|([^\]|]+)(?:\|([^\]]+))?\]/g,function(m,a,t,x){a=a.toLowerCase();actions.push(lumaActionButton(a,(t||'').trim(),(x||'').trim()));return '';});
  var html=formatLumaMarkdown(clean);
  if(actions.length)html+='<div class="luma-actions">'+actions.join('')+'</div>';
  return html;
}
function executeLumaAction(type,target,extra){
  if(type==='nav'){
    if(target==='appearance'||extra==='appearance'||extra==='theme'||extra==='themes'||extra==='colors'){go('appearance');return;}
    if(target==='mal'||target==='sync'||extra==='mal'||extra==='myanimelist'||extra==='sync'){go('mal');return;}
    if(target==='settings'||target==='set'){
      var secMap={player:'playback',subtitles:'playback',nyaa:'downloads',autodl:'downloads',folders:'library',manga:'manga',notifications:'notifications',performance:'system',tray:'system',luma:'companion',backup:'data',parser:'aliases'};
      S.setSection=secMap[extra]||'library';S._scrollToSec=true;go('settings');return;
    }
    if(target==='organize')target='filemgmt';
    go(target);return;
  }
  if(type==='nyaa'||type==='download'){quickNyaaSearch(target);return;}
  if(type==='detail'){
    var t=(target||'').toLowerCase().trim();
    var m=S.lib.find(function(s){return s.name.toLowerCase().trim()===t||(s.watchData&&s.watchData.malData&&String(s.watchData.malData.title||'').toLowerCase().trim()===t);});
    if(m)odtl(m.name);else quickNyaaSearch(target);return;
  }
  if(type==='schedule'){go('schedule');return;}
  if(type==='stats'){go('stats');return;}
  if(type==='autodl'){
    toast('Checking tracked series for new episodes…','i');
    api.autoDownloadPollNow(false).then(function(res){var r=res&&res.results;toast(r&&r.downloaded&&r.downloaded.length?r.downloaded.length+' new episode(s) handed off':'No new episodes right now','s');}).catch(function(e){toast('Check failed: '+(e.message||e),'e');});
    return;
  }
  if(type==='rescan'||type==='scan'){loadLib().then(function(){toast('Library rescanned','s');});return;}
  if(type==='sync'){autoSyncAll();return;}
  if(type==='organize'||type==='filemgmt'){go('filemgmt');return;}
  if(type==='hub'){go('hub');}
}
act('lumaAction',function(el,ev,a,t,x){executeLumaAction(a,t,x);});

// ------------------------------------------------------------------- dock --
function renderLumaDock(){
  var dock=document.getElementById('lumaAssistantDock');
  if(!dock){
    dock=document.createElement('div');dock.id='lumaAssistantDock';dock.className='luma-dock';document.body.appendChild(dock);
    dock.addEventListener('mousedown',function(e){if(e.target.closest('.luma-head')&&!e.target.closest('button'))startLumaDockDrag(e);});
  }
  dock.classList.toggle('minimized',!!S.ai.dockMinimized);
  var hasKey=S.cfg.hasOpenRouterKey;
  var h='<div class="luma-head"'+(S.ai.dockMinimized?A('minimizeLumaAssistant'):'')+'><img src="luma/luma-front.png" alt=""><div class="grow"><div class="luma-name">Luma</div><div class="luma-status">'+(S.ai.busy?'Thinking…':hasKey?'Ready to help':'Needs a key')+'</div></div>'
    +(hasKey&&!S.ai.dockMinimized?'<button class="icon-btn sm plain"'+A('clearAiConversation')+Tip('New conversation')+'>'+ic('refresh')+'</button>':'')
    +'<button class="icon-btn sm plain"'+A('minimizeLumaAssistant')+Tip(S.ai.dockMinimized?'Expand':'Minimize')+'>'+ic(S.ai.dockMinimized?'chevronUp':'minus')+'</button>'
    +'<button class="icon-btn sm plain"'+A('closeLumaAssistant')+Tip('Close')+'>'+ic('x')+'</button></div>';
  if(!S.ai.dockMinimized){
    if(!hasKey){
      h+='<div class="luma-body luma-setup"><img src="luma/luma-front.png" alt="" class="luma-hero"><div class="empty-title">Wake Luma ✨</div><div class="empty-text">Luma runs on Claude Haiku 5.5 through OpenRouter, with your own OpenRouter key. Haiku is a paid model, so add a little credit on OpenRouter first. The key is encrypted with your Windows account and never leaves the main process.</div>'
        +aiKeyForm('lumaDockKey')+'</div>';
    }else{
      h+='<div class="luma-body" id="lumaDockMsgs"></div><div class="luma-foot"><div class="luma-tools"><button class="luma-web'+(lumaWebSearchOn()?' on':'')+'" id="lumaWebBtn" aria-pressed="'+(lumaWebSearchOn()?'true':'false')+'"'+A('toggleLumaWebSearch')+Tip('Let Luma search the web for current answers')+'>'+ic('globe')+'Web search</button></div><div class="luma-input"><input id="lumaDockInput" placeholder="Ask Luma anything…" autocomplete="off"'+On('enter','sendAi')+'>'
        +'<button class="luma-send" id="lumaDockSendBtn"'+A('sendAi')+(S.ai.busy?' style="display:none"':'')+' aria-label="Send">'+ic('send')+'</button><button class="luma-stop" id="lumaDockStopBtn"'+A('stopAi')+(S.ai.busy?'':' style="display:none"')+' aria-label="Stop">'+ic('stop')+'</button></div></div>';
    }
  }
  dock.innerHTML=h;
  if(hasKey&&!S.ai.dockMinimized)renderLumaDockMsgs();
}
function renderLumaDockMsgs(){
  var box=document.getElementById('lumaDockMsgs');if(!box)return;
  var h='';
  if(!S.ai.msgs.length){
    h+='<div class="luma-welcome"><img src="luma/luma-front.png" alt="" class="luma-hero"><div class="empty-title">Hi, I’m Luma ✨</div><div class="empty-text">Ask about your library, what to watch next, or where a setting lives.</div><div class="chips luma-starters">'
      +'<button class="chip"'+A('quickAiPrompt','What should I watch next from my library?')+'>'+ic('sparkles')+'What next?</button>'
      +'<button class="chip"'+A('quickAiPrompt','What anime on my list airs today?')+'>'+ic('calendarClock')+'Airing today</button>'
      +'<button class="chip"'+A('lumaAction','autodl','','')+'>'+ic('zap')+'Check new episodes</button>'
      +'<button class="chip"'+A('quickAiPrompt','Help me set up my player and downloads')+'>'+ic('gear')+'Setup help</button></div></div>';
  }
  S.ai.msgs.forEach(function(m){
    if(m.role==='user')h+='<div class="luma-msg user"><div class="luma-bubble">'+E(m.content)+'</div></div>';
    else h+='<div class="luma-msg bot"><img class="luma-av" src="luma/luma-front.png" alt=""><div class="luma-bubble">'+parseLumaBubbleHtml(m.content)+lumaSourcesHtml(m.sources)+'</div></div>';
  });
  if(S._aiPartial)h+='<div class="luma-msg bot"><img class="luma-av" src="luma/luma-front.png" alt=""><div class="luma-bubble" id="lumaDockLive">'+parseLumaBubbleHtml(S._aiPartial)+'</div></div>';
  else if(S.ai.busy)h+='<div class="luma-msg bot"><img class="luma-av" src="luma/luma-front.png" alt=""><div class="luma-bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>';
  box.innerHTML=h;box.scrollTop=box.scrollHeight;
}
// Pages the web search used, as link chips under the reply. Titles are escaped
// text; the link opens in the system browser through the same checked path as
// every other external link.
function lumaSourcesHtml(sources){
  if(!sources||!sources.length)return '';
  var chips=sources.slice(0,6).map(function(s){
    var host='';try{host=new URL(s.url).hostname.replace(/^www\./,'');}catch(e){return '';}
    return '<button class="luma-src"'+A('openUrl',s.url)+Tip(s.title||s.url)+'>'+ic('globe')+'<span>'+E(host)+'</span></button>';
  }).join('');
  return chips?'<div class="luma-sources"><span class="luma-sources-label">Sources</span>'+chips+'</div>':'';
}
function lumaWebSearchOn(){return S.cfg.lumaWebSearch!==false;}
function toggleLumaWebSearch(){
  var on=!lumaWebSearchOn();S.cfg.lumaWebSearch=on;api.setConfig('lumaWebSearch',on);
  var b=document.getElementById('lumaWebBtn');if(b){b.classList.toggle('on',on);b.setAttribute('aria-pressed',on?'true':'false');}
  toast(on?'Web search on — replies can use current web results':'Web search off','i');
  if(S.view==='settings')render();
}
function renderAiMsgs(){if(S.ai.dockOpen)renderLumaDockMsgs();}
function toggleLumaAssistant(){if(S.ai.dockOpen)closeLumaAssistant();else openLumaAssistant();}
function openLumaAssistant(){S.ai.dockOpen=true;S.ai.dockMinimized=false;renderLumaDock();var d=document.getElementById('lumaAssistantDock');if(d){d.classList.remove('closing');}var inp=document.getElementById('lumaDockInput')||document.getElementById('lumaDockKey');if(inp)setTimeout(function(){inp.focus();},80);}
function closeLumaAssistant(){S.ai.dockOpen=false;var d=document.getElementById('lumaAssistantDock');if(d){d.classList.add('closing');setTimeout(function(){if(!S.ai.dockOpen)d.remove();},200);}}
function minimizeLumaAssistant(){S.ai.dockMinimized=!S.ai.dockMinimized;renderLumaDock();}
function quickAiPrompt(q){if(!S.ai.dockOpen)openLumaAssistant();var inp=document.getElementById('lumaDockInput');if(inp)inp.value=q;sendAi();}
function scrollAiBottom(){var b=document.getElementById('lumaDockMsgs');if(b)b.scrollTop=b.scrollHeight;}
var _lumaDrag=null;
function startLumaDockDrag(e){
  var dock=document.getElementById('lumaAssistantDock');if(!dock)return;var r=dock.getBoundingClientRect();
  _lumaDrag={x:e.clientX,y:e.clientY,l:r.left,t:r.top,w:r.width};
  dock.style.right='auto';dock.style.bottom='auto';dock.style.left=r.left+'px';dock.style.top=r.top+'px';dock.classList.add('dragging');
  document.addEventListener('mousemove',onLumaDockDrag);document.addEventListener('mouseup',stopLumaDockDrag);e.preventDefault();
}
function onLumaDockDrag(e){if(!_lumaDrag)return;var d=document.getElementById('lumaAssistantDock');if(!d)return;
  d.style.left=clamp(_lumaDrag.l+e.clientX-_lumaDrag.x,8,window.innerWidth-_lumaDrag.w-8)+'px';d.style.top=clamp(_lumaDrag.t+e.clientY-_lumaDrag.y,54,window.innerHeight-60)+'px';}
function stopLumaDockDrag(){_lumaDrag=null;var d=document.getElementById('lumaAssistantDock');if(d)d.classList.remove('dragging');document.removeEventListener('mousemove',onLumaDockDrag);document.removeEventListener('mouseup',stopLumaDockDrag);}

function setBusyUi(busy){var s=document.getElementById('lumaDockSendBtn'),t=document.getElementById('lumaDockStopBtn');if(s)s.style.display=busy?'none':'';if(t)t.style.display=busy?'':'none';var st=document.querySelector('.luma-status');if(st)st.textContent=busy?'Thinking…':'Ready to help';}
function clearAiConversation(){if(S.ai.busy){try{api.aiStop();}catch(e){}S.ai.busy=false;}S.ai.msgs=[];S._aiPartial='';renderAiMsgs();setBusyUi(false);}
// Key entry used by the Luma dock, Settings and the setup wizard. Keys come
// from OpenRouter (openrouter.ai/keys); Haiku needs a little credit there.
function aiKeyForm(inputId,compact){
  return '<div class="ai-key-form'+(compact?' compact':'')+'"><input class="input mono" id="'+inputId+'" type="password" placeholder="Paste your OpenRouter key" autocomplete="off" spellcheck="false"'+On('enter','saveAiKey',inputId)+'>'
    +'<button class="btn btn-primary'+(compact?'':' btn-block')+'"'+A('saveAiKey',inputId)+'>'+ic('sparkles')+'Save key</button>'
    +'<button class="btn btn-ghost btn-sm"'+A('openUrl',AI_KEY_PAGE)+'>'+ic('external')+'Get a key at OpenRouter</button></div>';
}
// Electron wraps main-process errors as "Error invoking remote method 'x': Error: …".
function lumaErrorText(e){return String((e&&e.message)||e||'').replace(/^Error invoking remote method '[^']*': (?:Error: )?/,'');}
function saveAiKey(inputId){
  var el=document.getElementById(typeof inputId==='string'&&inputId?inputId:'lumaDockKey');var k=el?el.value.trim():'';
  if(!k){toast('Paste your OpenRouter key first','e');return;}
  if(k.length<20||/\s/.test(k.replace(/^\S+\s*[=:]\s*/,''))){toast('That doesn’t look like an OpenRouter key — copy the whole key from openrouter.ai/keys','e');return;}
  var verified=true;
  api.aiSetKey(k).then(function(r){verified=!r||r.verified!==false;return api.getConfig();}).then(function(c){S.cfg=c;toast(verified?'Key saved — Luma is ready ✨':'Key saved, but OpenRouter couldn’t be reached to check it. Send Luma a message to test it.',verified?'s':'i');renderLumaDock();if(S.view==='settings')render();}).catch(function(e){toast('Saving the key failed: '+lumaErrorText(e),'e');});
}
async function clearAiKey(){
  if(!await askConfirm({title:'Remove the OpenRouter key?',text:'Luma won’t be able to answer until you add a key again.',confirm:'Remove',danger:true,icon:'lock'}))return;
  await api.aiClearKey();S.cfg=await api.getConfig();S.ai.msgs=[];toast('Key removed','i');if(S.ai.dockOpen)renderLumaDock();if(S.view==='settings')render();
}
function finishAiTurn(){var p=stripThinkingTags(S._aiPartial||'').trim();if(p)S.ai.msgs.push({role:'assistant',content:p,sources:S._aiSources||[]});S._aiPartial='';S._aiSources=[];S.ai.busy=false;renderAiMsgs();setBusyUi(false);}
// One bubble per failed turn (the error arrives as an event and as the
// result); the hint depends on whether the key, the credits or OpenRouter failed.
var AI_ERROR_HINTS={key:'Check your OpenRouter key in Settings → Companion, then try again.',quota:'Check your OpenRouter credits at openrouter.ai/credits, then try again.',busy:'Haiku is busy on OpenRouter right now. Try again in a moment.',other:'Please try again in a moment.'};
function handleAiError(msg,kind){
  if(!S.ai.busy)return;
  S.ai.busy=false;S._aiPartial='';
  var hint=AI_ERROR_HINTS[kind]!=null?AI_ERROR_HINTS[kind]:AI_ERROR_HINTS.other;
  S.ai.msgs.push({role:'assistant',error:true,content:'Aw, stardust — I couldn’t get a response:\n`'+String(msg||'Unknown error').slice(0,300)+'`'+(hint?'\n\n'+hint:'')});
  renderAiMsgs();setBusyUi(false);
}
async function sendAi(){
  if(S.ai.busy)return;
  if(!S.cfg.hasOpenRouterKey){toast('Add your OpenRouter key first','e');openLumaAssistant();return;}
  var inp=document.getElementById('lumaDockInput');var q=inp?inp.value.trim():'';if(!q)return;inp.value='';
  S.ai.msgs.push({role:'user',content:q});S.ai.busy=true;S._aiPartial='';renderAiMsgs();setBusyUi(true);
  var msgs=(S.ai.msgs||[]).filter(function(m){return m&&!m.error&&typeof m.content==='string'&&m.content.trim();}).slice(-16).map(function(m){return {role:m.role,content:m.content};});
  S._aiSources=[];
  var r=await api.aiSend([{role:'system',content:buildAiSystem()}].concat(msgs),{webSearch:lumaWebSearchOn()});
  if(r&&!r.ok)handleAiError(r.message||r.error||'Failed to get a response',r.kind);
}
function stopAi(){api.aiStop();finishAiTurn();}
expose('toggleLumaAssistant','openLumaAssistant','closeLumaAssistant','minimizeLumaAssistant','clearAiConversation','saveAiKey','sendAi','stopAi','quickAiPrompt','toggleLumaWebSearch');

// ----------------------------------------------------------------- mascot --
var LUMA_FRAMES={front:'luma/luma-front.png',left:'luma/luma-left.png',leanLeft:'luma/luma-lean-left.png',leanRight:'luma/luma-lean-right.png'};
var LUMA_SPARKLES=['luma/sparkle1.png','luma/sparkle2.png','luma/sparkle3.png'];
var _lumaState=null;
function lumaSizeClass(){var v=S.cfg.lumaSize||'medium';return v==='small'?'small':v==='big'?'big':v==='rainbow'?'rainbow':'';}
function setLumaSize(v){S.cfg.lumaSize=v;api.setConfig('lumaSize',v);var img=document.getElementById('lumaImg');if(img)img.className='luma-sprite '+lumaSizeClass();else if(S.cfg.lumaMascot)initLuma();}
function setLumaSpeed(v){S.cfg.lumaSpeed=v;api.setConfig('lumaSpeed',v);}
function initLuma(){
  var root=document.getElementById('luma-root');
  // Always stop a running loop first; 4.x started a second loop on every toggle.
  if(_lumaState&&_lumaState.raf){cancelAnimationFrame(_lumaState.raf);_lumaState.raf=null;}
  if(!S.cfg.lumaMascot){if(root)root.remove();_lumaState=null;return;}
  if(!root){
    root=document.createElement('div');root.id='luma-root';document.body.appendChild(root);
    root.innerHTML='<img class="luma-sprite '+lumaSizeClass()+'" id="lumaImg" src="'+LUMA_FRAMES.front+'" alt="Luma" title="Chat with Luma">';
    root.querySelector('#lumaImg').addEventListener('click',toggleLumaAssistant);
  }
  var img=root.querySelector('#lumaImg');img.className='luma-sprite '+lumaSizeClass();
  var prev=_lumaState;
  _lumaState={el:root,img:img,x:prev?prev.x:window.innerWidth*.55,y:prev?prev.y:window.innerHeight*.6,tx:0,ty:0,dir:1,paused:false,frontTimer:0,bob:0,raf:null,src:'',last:0};
  _lumaState.raf=requestAnimationFrame(_lumaTick);
}
function _lumaTick(ts){
  var st=_lumaState;if(!st||!st.img)return;
  st.raf=requestAnimationFrame(_lumaTick);
  if(document.hidden)return;
  var dt=st.last?Math.min(50,ts-st.last):16;st.last=ts;var k=dt/16.67;
  var speed=S.cfg.animSpeed==='none'?0:(S.cfg.lumaSpeed==='slow'?.55:S.cfg.lumaSpeed==='fast'?1.5:1)*(S.cfg.performanceMode?.7:1);
  st.bob+=.035*k;var bobY=Math.sin(st.bob)*10*speed;var moving=false;
  if(!st.paused){
    if((!st.tx&&!st.ty)||(Math.abs(st.x-st.tx)<4&&Math.abs(st.y-st.ty)<4)||Math.random()<.004*k){st.tx=90+Math.random()*(window.innerWidth-180);st.ty=110+Math.random()*(window.innerHeight-240);}
    var dx=st.tx-st.x,dy=st.ty-st.y,dist=Math.sqrt(dx*dx+dy*dy);
    if(dist>2){var v=Math.min(2.2*speed,dist*.03)*k;st.x+=dx/dist*v;st.y+=dy/dist*v;st.dir=dx>0?1:-1;}
    moving=dist>24&&speed>0;
    if(Math.random()<.0025*k){st.paused=true;st.frontTimer=60+Math.random()*80;}
    if(S.cfg.lumaSparkles!==false&&speed>0&&Math.random()<.08*k)_lumaSpawnSparkle(st);
  }else{st.frontTimer-=k;if(st.frontTimer<=0){st.paused=false;st.tx=0;st.ty=0;}}
  var src=moving?(st.dir>0?LUMA_FRAMES.leanRight:LUMA_FRAMES.leanLeft):LUMA_FRAMES.front;
  if(src!==st.src){st.img.src=src;st.src=src;}
  st.img.style.transform='translate3d('+st.x.toFixed(1)+'px,'+(st.y+bobY).toFixed(1)+'px,0) translate(-50%,-50%) scale('+(moving?1.05:1)+','+(moving?.96:1)+')';
}
function _lumaSpawnSparkle(st){
  if(!st.el||st.el.childElementCount>40)return;
  var s=document.createElement('img');s.className='luma-star';s.alt='';s.src=LUMA_SPARKLES[Math.floor(Math.random()*LUMA_SPARKLES.length)];
  var size=10+Math.random()*14;s.style.cssText='left:'+(st.x-30+Math.random()*60)+'px;top:'+(st.y-40+Math.random()*70)+'px;width:'+size+'px;height:'+size+'px';
  st.el.appendChild(s);setTimeout(function(){s.remove();},2400);
}
