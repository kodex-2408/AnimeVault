/* AnimeVault renderer — Luma: AI chat dock (OpenRouter via main process) and the floating mascot. */

var LUMA_MODEL='google/gemini-3.5-flash-lite';
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
  var hasKey=S.cfg.hasOpenrouterApiKey;
  var h='<div class="luma-head"'+(S.ai.dockMinimized?A('minimizeLumaAssistant'):'')+'><img src="luma/luma-front.png" alt=""><div class="grow"><div class="luma-name">Luma</div><div class="luma-status">'+(S.ai.busy?'Thinking…':hasKey?'Ready to help':'Needs a key')+'</div></div>'
    +(hasKey&&!S.ai.dockMinimized?'<button class="icon-btn sm plain"'+A('clearAiConversation')+Tip('New conversation')+'>'+ic('refresh')+'</button>':'')
    +'<button class="icon-btn sm plain"'+A('minimizeLumaAssistant')+Tip(S.ai.dockMinimized?'Expand':'Minimize')+'>'+ic(S.ai.dockMinimized?'chevronUp':'minus')+'</button>'
    +'<button class="icon-btn sm plain"'+A('closeLumaAssistant')+Tip('Close')+'>'+ic('x')+'</button></div>';
  if(!S.ai.dockMinimized){
    if(!hasKey){
      h+='<div class="luma-body luma-setup"><img src="luma/luma-front.png" alt="" class="luma-hero"><div class="empty-title">Wake Luma ✨</div><div class="empty-text">Add an OpenRouter key to chat about your library from anywhere in the app. It’s encrypted with your Windows account and never leaves the main process.</div>'
        +'<input class="input mono" id="lumaDockKey" type="password" placeholder="sk-or-v1-…" autocomplete="off"'+On('enter','saveAiKey')+'><button class="btn btn-primary btn-block"'+A('saveAiKey')+'>Connect</button>'
        +'<button class="btn btn-ghost btn-sm"'+A('openUrl','https://openrouter.ai/keys')+'>'+ic('external')+'Get a key</button></div>';
    }else{
      h+='<div class="luma-body" id="lumaDockMsgs"></div><div class="luma-foot"><div class="luma-input"><input id="lumaDockInput" placeholder="Ask Luma anything…" autocomplete="off"'+On('enter','sendAi')+'>'
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
    else h+='<div class="luma-msg bot"><img class="luma-av" src="luma/luma-front.png" alt=""><div class="luma-bubble">'+parseLumaBubbleHtml(m.content)+'</div></div>';
  });
  if(S._aiPartial)h+='<div class="luma-msg bot"><img class="luma-av" src="luma/luma-front.png" alt=""><div class="luma-bubble" id="lumaDockLive">'+parseLumaBubbleHtml(S._aiPartial)+'</div></div>';
  else if(S.ai.busy)h+='<div class="luma-msg bot"><img class="luma-av" src="luma/luma-front.png" alt=""><div class="luma-bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>';
  box.innerHTML=h;box.scrollTop=box.scrollHeight;
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
function saveAiKey(){
  var el=document.getElementById('lumaDockKey');var k=el?el.value.trim():'';
  if(!k){toast('Paste your OpenRouter key first','e');return;}
  if(k.indexOf('sk-or-')!==0){toast('OpenRouter keys start with sk-or-','e');return;}
  api.aiSetKey(k).then(function(){return api.getConfig();}).then(function(c){S.cfg=c;toast('Key saved — Luma is ready ✨','s');renderLumaDock();if(S.view==='settings')render();}).catch(function(e){toast('Saving the key failed: '+(e.message||e),'e');});
}
async function clearAiKey(){
  if(!await askConfirm({title:'Remove the OpenRouter key?',text:'Luma won’t be able to answer until you add a key again.',confirm:'Remove',danger:true,icon:'lock'}))return;
  await api.aiClearKey();S.cfg=await api.getConfig();S.ai.msgs=[];toast('Key removed','i');if(S.ai.dockOpen)renderLumaDock();if(S.view==='settings')render();
}
function finishAiTurn(){var p=stripThinkingTags(S._aiPartial||'').trim();if(p)S.ai.msgs.push({role:'assistant',content:p});S._aiPartial='';S.ai.busy=false;renderAiMsgs();setBusyUi(false);}
function handleAiError(msg){
  S.ai.busy=false;S._aiPartial='';
  S.ai.msgs.push({role:'assistant',content:'Aw, stardust — I couldn’t get a response:\n`'+String(msg||'Unknown error').slice(0,300)+'`\n\nCheck your OpenRouter key and credits, then try again.'});
  renderAiMsgs();setBusyUi(false);
}
async function sendAi(){
  if(S.ai.busy)return;
  if(!S.cfg.hasOpenrouterApiKey){toast('Add your OpenRouter key first','e');openLumaAssistant();return;}
  var inp=document.getElementById('lumaDockInput');var q=inp?inp.value.trim():'';if(!q)return;inp.value='';
  S.ai.msgs.push({role:'user',content:q});S.ai.busy=true;S._aiPartial='';renderAiMsgs();setBusyUi(true);
  if(S.cfg.openrouterModel!==LUMA_MODEL){S.cfg.openrouterModel=LUMA_MODEL;api.aiSetModel(LUMA_MODEL);}
  var msgs=(S.ai.msgs||[]).filter(function(m){return m&&typeof m.content==='string'&&m.content.trim();}).slice(-16);
  var r=await api.aiSend([{role:'system',content:buildAiSystem()}].concat(msgs),LUMA_MODEL,{webSearch:!!S.ai.webSearch});
  if(r&&!r.ok)handleAiError(r.error||'Failed to get a response');
}
function stopAi(){api.aiStop();finishAiTurn();}
expose('toggleLumaAssistant','openLumaAssistant','closeLumaAssistant','minimizeLumaAssistant','clearAiConversation','saveAiKey','sendAi','stopAi','quickAiPrompt');

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
