/* Tsundoku renderer — Tsumi: AI chat dock (Claude Haiku 5.5 through OpenRouter with the user's own key, via the main process) and the floating mascot. */

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
  var h='<div class="luma-head"'+(S.ai.dockMinimized?A('minimizeLumaAssistant'):'')+'><img src="companion/tsumi.svg" alt=""><div class="grow"><div class="luma-name">Tsumi</div><div class="luma-status">'+(S.ai.busy?'Thinking…':hasKey?'Ready to help':'Needs a key')+'</div></div>'
    +(hasKey&&!S.ai.dockMinimized?'<button class="icon-btn sm plain"'+A('clearAiConversation')+Tip('New conversation')+'>'+ic('refresh')+'</button>':'')
    +'<button class="icon-btn sm plain"'+A('minimizeLumaAssistant')+Tip(S.ai.dockMinimized?'Expand':'Minimize')+'>'+ic(S.ai.dockMinimized?'chevronUp':'minus')+'</button>'
    +'<button class="icon-btn sm plain"'+A('closeLumaAssistant')+Tip('Close')+'>'+ic('x')+'</button></div>';
  if(!S.ai.dockMinimized){
    if(!hasKey){
      h+='<div class="luma-body luma-setup"><img src="companion/tsumi.svg" alt="" class="luma-hero"><div class="empty-title">Wake Tsumi ✨</div><div class="empty-text">Tsumi runs on Claude Haiku 5.5 through OpenRouter, with your own OpenRouter key. Haiku is a paid model, so add a little credit on OpenRouter first. The key is encrypted with your Windows account and never leaves the main process.</div>'
        +aiKeyForm('lumaDockKey')+'</div>';
    }else{
      h+='<div class="luma-body" id="lumaDockMsgs"></div><div class="luma-foot"><div class="luma-tools"><button class="luma-web'+(lumaWebSearchOn()?' on':'')+'" id="lumaWebBtn" aria-pressed="'+(lumaWebSearchOn()?'true':'false')+'"'+A('toggleLumaWebSearch')+Tip('Let Tsumi search the web for current answers')+'>'+ic('globe')+'Web search</button></div><div class="luma-input"><input id="lumaDockInput" placeholder="Ask Tsumi anything…" autocomplete="off"'+On('enter','sendAi')+'>'
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
    h+='<div class="luma-welcome"><img src="companion/tsumi.svg" alt="" class="luma-hero"><div class="empty-title">Hi, I’m Tsumi ✨</div><div class="empty-text">Ask about your library, what to watch next, or where a setting lives.</div><div class="chips luma-starters">'
      +'<button class="chip"'+A('quickAiPrompt','What should I watch next from my library?')+'>'+ic('sparkles')+'What next?</button>'
      +'<button class="chip"'+A('quickAiPrompt','What anime on my list airs today?')+'>'+ic('calendarClock')+'Airing today</button>'
      +'<button class="chip"'+A('lumaAction','autodl','','')+'>'+ic('zap')+'Check new episodes</button>'
      +'<button class="chip"'+A('quickAiPrompt','Help me set up my player and downloads')+'>'+ic('gear')+'Setup help</button></div></div>';
  }
  S.ai.msgs.forEach(function(m){
    if(m.role==='user')h+='<div class="luma-msg user"><div class="luma-bubble">'+E(m.content)+'</div></div>';
    else h+='<div class="luma-msg bot"><img class="luma-av" src="companion/tsumi.svg" alt=""><div class="luma-bubble">'+parseLumaBubbleHtml(m.content)+lumaSourcesHtml(m.sources)+'</div></div>';
  });
  if(S._aiPartial)h+='<div class="luma-msg bot"><img class="luma-av" src="companion/tsumi.svg" alt=""><div class="luma-bubble" id="lumaDockLive">'+parseLumaBubbleHtml(S._aiPartial)+'</div></div>';
  else if(S.ai.busy)h+='<div class="luma-msg bot"><img class="luma-av" src="companion/tsumi.svg" alt=""><div class="luma-bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>';
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
// Key entry used by the Tsumi dock, Settings and the setup wizard. Keys come
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
  api.aiSetKey(k).then(function(r){verified=!r||r.verified!==false;return api.getConfig();}).then(function(c){S.cfg=c;toast(verified?'Key saved — Tsumi is ready ✨':'Key saved, but OpenRouter couldn’t be reached to check it. Send Tsumi a message to test it.',verified?'s':'i');renderLumaDock();if(S.view==='settings')render();}).catch(function(e){toast('Saving the key failed: '+lumaErrorText(e),'e');});
}
async function clearAiKey(){
  if(!await askConfirm({title:'Remove the OpenRouter key?',text:'Tsumi won’t be able to answer until you add a key again.',confirm:'Remove',danger:true,icon:'lock'}))return;
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
// Tsumi (5.11, replaces the star): a little pile of unread books. Drawn as
// inline SVG so it stays sharp at every size. It hops from place to place
// (crouch, jump, squash on landing) with the top book wobbling a beat behind,
// puffs dust when it lands, blinks, looks where it is going, talks while the
// chat is answering, dozes off when left alone and does a happy hop on click.
var TSUMI_IMG='companion/tsumi.svg';
function tsumiSvg(){
  var eye=function(x){return '<ellipse cx="'+x+'" cy="57" rx="2.8" ry="3.6" fill="#2b2233"/><circle cx="'+(x+1)+'" cy="55.5" r="1.2" fill="#fff"/>';};
  var shut=function(x){return '<path d="M'+(x-3.6)+' 57 q 3.6 3.2 7.2 0" stroke="#2b2233" stroke-width="2.2" fill="none" stroke-linecap="round"/>';};
  var happy=function(x){return '<path d="M'+(x-3.6)+' 58.4 q 3.6 -5.4 7.2 0" stroke="#2b2233" stroke-width="2.2" fill="none" stroke-linecap="round"/>';};
  return '<svg viewBox="0 0 100 100" aria-hidden="true"><g class="ts-root">'
    +'<rect x="16" y="68" width="68" height="16" rx="3.5" fill="#3fb8a0"/><rect x="74" y="70" width="8" height="12" rx="1.5" fill="#e9fbf6"/><rect x="22" y="72" width="30" height="3" rx="1.5" fill="#2a8f7b"/>'
    +'<rect x="20" y="49" width="62" height="20" rx="3.5" fill="#f28ca6"/><rect x="20" y="51" width="7" height="16" rx="1.5" fill="#fff3f6"/>'
    +'<g class="ts-eyes"><g class="ts-open">'+eye(45)+eye(63)+'</g><g class="ts-shut" style="display:none">'+shut(45)+shut(63)+'</g><g class="ts-happy" style="display:none">'+happy(45)+happy(63)+'</g></g>'
    +'<ellipse cx="37.7" cy="61.5" rx="3" ry="1.8" fill="#e9567a" opacity=".55"/><ellipse cx="70.3" cy="61.5" rx="3" ry="1.8" fill="#e9567a" opacity=".55"/>'
    +'<path class="ts-smile" d="M50.4 62.6 q 3.6 3.4 7.2 0" stroke="#2b2233" stroke-width="2.2" fill="none" stroke-linecap="round"/><ellipse class="ts-talk" cx="54" cy="63.6" rx="3" ry="3.4" fill="#2b2233" style="display:none"/>'
    +'<g class="ts-top"><g transform="rotate(-5 52 41)"><rect x="27" y="33" width="50" height="16" rx="3.5" fill="#f4c152"/><rect x="66" y="35" width="7" height="12" rx="1.5" fill="#fff7e0"/></g></g>'
    +'</g></svg>';
}
var _lumaState=null;
function lumaSizeClass(){var v=S.cfg.lumaSize||'medium';return v==='small'?'small':v==='big'?'big':v==='rainbow'?'rainbow':'';}
function setLumaSize(v){S.cfg.lumaSize=v;api.setConfig('lumaSize',v);var el=document.getElementById('lumaImg');if(el)el.className='luma-sprite '+lumaSizeClass();else if(S.cfg.lumaMascot)initLuma();}
function setLumaSpeed(v){S.cfg.lumaSpeed=v;api.setConfig('lumaSpeed',v);}
function initLuma(){
  var root=document.getElementById('luma-root');
  // Always stop a running loop first; 4.x started a second loop on every toggle.
  if(_lumaState&&_lumaState.raf){cancelAnimationFrame(_lumaState.raf);_lumaState.raf=null;}
  if(!S.cfg.lumaMascot){if(root)root.remove();_lumaState=null;return;}
  if(!root){
    root=document.createElement('div');root.id='luma-root';document.body.appendChild(root);
    root.innerHTML='<div class="luma-sprite '+lumaSizeClass()+'" id="lumaImg" role="button" aria-label="Chat with Tsumi" title="Chat with Tsumi">'+tsumiSvg()+'</div>';
    root.querySelector('#lumaImg').addEventListener('click',function(){if(_lumaState){_lumaState.pokeT=0;_lumaState.mode='roam';_lumaState.idle=0;}toggleLumaAssistant();});
  }
  var el=root.querySelector('#lumaImg');el.className='luma-sprite '+lumaSizeClass();
  var q=function(c){return el.querySelector(c);};
  var prev=_lumaState;
  _lumaState={el:root,img:el,root:q('.ts-root'),top:q('.ts-top'),eyes:q('.ts-eyes'),open:q('.ts-open'),shut:q('.ts-shut'),happy:q('.ts-happy'),smile:q('.ts-smile'),talk:q('.ts-talk'),
    x:prev?prev.x:window.innerWidth*.55,y:prev?prev.y:window.innerHeight*.6,tx:0,ty:0,vx:0,vy:0,dir:1,phase:0,t:0,rest:0,idle:0,mode:'roam',
    pokeT:-1,blinkAt:2,wasAir:false,top1:{x:0,v:0},raf:null,last:0};
  if(lumaStill()){_lumaDrawStill(_lumaState);return;}
  _lumaState.raf=requestAnimationFrame(_lumaTick);
}
// Tsumi sits still, with no animation loop, in Performance Mode or with motion off.
function lumaStill(){return !!S.cfg.performanceMode||motionSpeed()==='none';}
function lumaSyncMotion(){if(S.cfg.lumaMascot)initLuma();}
function _tsT(el,o,px,py){if(!el)return;el.setAttribute('transform','translate('+(o.dx||0).toFixed(2)+' '+(o.dy||0).toFixed(2)+') translate('+px+' '+py+') rotate('+(o.rot||0).toFixed(2)+') scale('+(o.sx||1).toFixed(3)+' '+(o.sy||1).toFixed(3)+') translate('+(-px)+' '+(-py)+')');}
function _lumaPlace(st){st.img.style.transform='translate3d('+st.x.toFixed(1)+'px,'+st.y.toFixed(1)+'px,0) translate(-50%,-50%)';}
function _lumaDrawStill(st){
  st.x=Math.max(90,Math.min(window.innerWidth-90,st.x));st.y=Math.max(110,Math.min(window.innerHeight-130,st.y));
  _tsT(st.root,{},50,86);_tsT(st.top,{},50,48);_lumaPlace(st);
}
function _lumaTick(ts){
  var st=_lumaState;if(!st||!st.img)return;
  st.raf=requestAnimationFrame(_lumaTick);
  if(document.hidden)return;
  var dt=st.last?Math.min(.05,(ts-st.last)/1000):1/60;st.last=ts;st.t+=dt;
  var speedMul=S.cfg.lumaSpeed==='slow'?.6:S.cfg.lumaSpeed==='fast'?1.5:1;
  var busy=!!(S.ai&&S.ai.busy)||performance.now()<(st.talkUntil||0);if(busy||st.guide){st.mode='roam';st.idle=0;}
  if(st.guide){st.tx=st.guide.x;st.ty=st.guide.y;st.rest=0;}
  var sleeping=st.mode==='sleep';
  // Travel: pick a spot, hop there, rest a moment. Long idle -> doze.
  if(!st.tx&&!st.ty)_lumaPick(st);
  var dx=st.tx-st.x,dy=st.ty-st.y,dist=Math.sqrt(dx*dx+dy*dy);
  var want=(!sleeping&&st.rest<=0)?Math.min((st.guide?190:80)*speedMul,dist*1.8):0;
  if(dist<3&&st.rest<=0&&!st.guide){st.rest=1.5+Math.random()*3;st.idle++;if(st.idle>5&&!busy&&Math.random()<.4)st.mode='sleep';}
  if(st.rest>0){st.rest-=dt;if(st.rest<=0)_lumaPick(st);}
  var acc=1-Math.exp(-dt*4);
  st.vx+=((dist>.1?dx/dist*want:0)-st.vx)*acc;st.vy+=((dist>.1?dy/dist*want:0)-st.vy)*acc;
  var speed=Math.sqrt(st.vx*st.vx+st.vy*st.vy),moving=speed>6;
  if(Math.abs(st.vx)>4)st.dir=st.vx>0?1:-1;
  st.phase+=dt*(moving?1.6*speedMul:.4);
  var u=st.phase%1,air=moving&&u>.18&&u<.82;
  if(air){st.x+=st.vx*dt*1.9;st.y+=st.vy*dt*1.9;}
  var g={dy:0,rot:0,sx:1,sy:1};
  if(moving){
    if(u<.18){g.sx=1+.14*Math.sin(u/.18*Math.PI);g.sy=2-g.sx;}
    else if(u<.82){g.dy=-Math.sin((u-.18)/.64*Math.PI)*22;g.sy=1.07;g.sx=.95;}
    else{g.sx=1+.16*Math.sin((u-.82)/.18*Math.PI);g.sy=2-g.sx;}
  }else{g.sy=1+Math.sin(st.t*2.4)*.02;g.sx=2-g.sy;}
  if(st.wasAir&&!air&&S.cfg.lumaSparkles!==false){_lumaDust(st,-16);_lumaDust(st,10);}
  st.wasAir=air;
  // The top book follows on a spring, a beat behind.
  st.top1.v+=(-(st.top1.x-(moving?-st.dir*7*Math.sin(st.phase*Math.PI*2):0))*80-st.top1.v*7)*dt;st.top1.x+=st.top1.v*dt;
  _tsT(st.top,{rot:st.top1.x},50,48);
  // Click: a happy hop.
  if(st.pokeT>=0){st.pokeT+=dt;var p=Math.min(1,st.pokeT/.7);g.dy-=Math.sin(p*Math.PI)*24;g.rot+=Math.sin(p*Math.PI*2)*10;if(p>=1)st.pokeT=-1;}
  // Face: blink, look ahead, talk while the chat answers, sleep.
  var happy=st.pokeT>=0;
  if(st.t>st.blinkAt+.12)st.blinkAt=st.t+2+Math.random()*3.5;
  var blink=st.t>st.blinkAt&&st.t<st.blinkAt+.12;
  st.open.style.display=sleeping||happy?'none':'';st.shut.style.display=sleeping?'':'none';st.happy.style.display=happy&&!sleeping?'':'none';
  _tsT(st.eyes,{sy:blink?.12:1,dx:Math.max(-2,Math.min(2,st.vx*.03)),dy:Math.max(-1.5,Math.min(1.5,st.vy*.03))},54,57);
  var talking=busy&&!sleeping&&Math.sin(st.t*22)>-.2;st.talk.style.display=talking?'':'none';st.smile.style.display=talking?'none':'';
  if(sleeping){g.sy*=1+Math.sin(st.t*2)*.025;if(Math.random()<dt*.6)_lumaFx(st,'z',st.x+18,st.y-30);}
  _tsT(st.root,g,50,86);
  if(!st.guide){st.x=Math.max(60,Math.min(window.innerWidth-60,st.x));st.y=Math.max(80,Math.min(window.innerHeight-60,st.y));}
  _lumaPlace(st);
}
// Guided tour: Tsumi hops to a point beside the callout and stays awake there.
function lumaGuide(pt){var st=_lumaState;if(!st)return;st.guide=pt||null;if(pt&&lumaStill()){st.x=pt.x;st.y=pt.y;_lumaPlace(st);}}
function lumaSay(ms){var st=_lumaState;if(st)st.talkUntil=performance.now()+(ms||2000);}
function _lumaPick(st){st.tx=90+Math.random()*Math.max(1,window.innerWidth-180);st.ty=110+Math.random()*Math.max(1,window.innerHeight-240);}
function _lumaDust(st,off){_lumaFx(st,'dust',st.x+off,st.y+st.img.offsetHeight*.32);}
function _lumaFx(st,kind,x,y){
  if(!st.el||st.el.childElementCount>40)return;
  var s=document.createElement('span');s.className='luma-fx '+kind;if(kind==='z')s.textContent='z';
  s.style.left=x+'px';s.style.top=y+'px';s.style.setProperty('--dx',((Math.random()-.5)*20-st.dir*6)+'px');
  st.el.appendChild(s);setTimeout(function(){s.remove();},2100);
}
