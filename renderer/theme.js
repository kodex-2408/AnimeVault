/* AnimeVault renderer — themes, accent, motion, transparency, backgrounds. */

// Eight dark and eight light themes, each from its own color family.
// Ids from 4.x are reused where a theme kept its slot; retired ids map to
// their closest replacement through THEME_ALIASES so saved choices carry over.
var FULL_THEMES=[
  // ---- dark
  {id:'black',label:'Midnight',dark:true,accent:'#ff9f0a',bg:'#0a0f1c',bg2:'#0e1424',s1:'#141b2d',s2:'#1b2338',s3:'#242e45',t1:'#eef1f8',t2:'#a3abbd',t3:'#6f788c',gradient:'radial-gradient(1100px 700px at 10% -10%,rgba(59,91,180,.22),transparent 60%),radial-gradient(800px 520px at 100% 100%,rgba(255,159,10,.07),transparent 60%),#0a0f1c'},
  {id:'chess',label:'Noir Gold',dark:true,accent:'#d9ad55',bg:'#0b0a08',bg2:'#11100d',s1:'#181612',s2:'#201e18',s3:'#2a2720',t1:'#f1ebdf',t2:'#b3aa98',t3:'#7c7463'},
  {id:'graphite',label:'Graphite',dark:true,accent:'#c7c7cc',bg:'#1a1b1e',bg2:'#202125',s1:'#27282c',s2:'#303136',s3:'#3a3b41',t1:'#f5f5f7',t2:'#aeaeb2',t3:'#7c7c82'},
  {id:'aurora',label:'Aurora',dark:true,accent:'#9d8cff',bg:'#0d0a1f',bg2:'#120e29',s1:'#191436',s2:'#211b42',s3:'#2b2451',t1:'#eeebfb',t2:'#aaa3c9',t3:'#756e96',gradient:'radial-gradient(1200px 700px at 12% -10%,rgba(124,92,255,.26),transparent 60%),radial-gradient(900px 600px at 100% 100%,rgba(45,212,191,.10),transparent 60%),#0d0a1f'},
  {id:'forest',label:'Forest',dark:true,accent:'#3ddc97',bg:'#07120d',bg2:'#0b1812',s1:'#11211a',s2:'#172b22',s3:'#1f372c',t1:'#e7f3ec',t2:'#9db6a8',t3:'#6a8274',gradient:'radial-gradient(1100px 700px at 0% 0%,rgba(16,185,129,.16),transparent 60%),#07120d'},
  {id:'midnight',label:'Lagoon',dark:true,accent:'#2dd4d4',bg:'#041517',bg2:'#071c1f',s1:'#0c2528',s2:'#122f33',s3:'#1a3b40',t1:'#e3f4f4',t2:'#97b8b9',t3:'#648486',gradient:'radial-gradient(1100px 700px at 100% 0%,rgba(20,184,196,.18),transparent 60%),#041517'},
  {id:'ember',label:'Crimson',dark:true,accent:'#ff5a5f',bg:'#150708',bg2:'#1c0b0c',s1:'#261112',s2:'#311719',s3:'#3d1f21',t1:'#f8e9e9',t2:'#c09c9d',t3:'#8a6a6b',gradient:'radial-gradient(1100px 700px at 0% 0%,rgba(220,38,38,.17),transparent 60%),#150708'},
  {id:'orchid',label:'Orchid',dark:true,accent:'#ff6ec7',bg:'#160916',bg2:'#1d0d1d',s1:'#271327',s2:'#321a32',s3:'#3f223f',t1:'#f8eaf6',t2:'#bf9fbb',t3:'#896c86',gradient:'radial-gradient(1100px 700px at 90% -10%,rgba(217,70,239,.18),transparent 60%),#160916'},
  // ---- light
  {id:'pearl',label:'Pearl',dark:false,accent:'#e0862b',bg:'#f3f2ef',bg2:'#eceae6',s1:'#ffffff',s2:'#f7f6f3',s3:'#ebe9e4',t1:'#1b1a17',t2:'#57534b',t3:'#8a857b'},
  {id:'white',label:'Porcelain',dark:false,accent:'#0a84ff',bg:'#f6f8fb',bg2:'#edf1f6',s1:'#ffffff',s2:'#f7f9fc',s3:'#e8edf4',t1:'#0f1319',t2:'#4b5563',t3:'#7c8594'},
  {id:'cloud',label:'Cloud',dark:false,accent:'#5e5ce6',bg:'#e3e5e9',bg2:'#dadde2',s1:'#f2f3f5',s2:'#eceef1',s3:'#dee1e6',t1:'#16181d',t2:'#4a505b',t3:'#767c87'},
  {id:'matcha',label:'Matcha',dark:false,accent:'#4f9a2e',bg:'#eef2e6',bg2:'#e5ebda',s1:'#fbfdf7',s2:'#f4f7ee',s3:'#e3e9d6',t1:'#1c2415',t2:'#4f5b43',t3:'#7a856d'},
  {id:'seafoam',label:'Seafoam',dark:false,accent:'#0d9488',bg:'#e7f4f2',bg2:'#dcedea',s1:'#f8fdfc',s2:'#f0f8f7',s3:'#dbebe8',t1:'#0f2523',t2:'#3f5e5a',t3:'#6c8783'},
  {id:'lilac',label:'Lilac',dark:false,accent:'#7c5cff',bg:'#f0edfa',bg2:'#e7e2f6',s1:'#fcfbff',s2:'#f6f3fd',s3:'#e5dff5',t1:'#1d1830',t2:'#524a6d',t3:'#807899'},
  {id:'sakura',label:'Sakura',dark:false,accent:'#e0457b',bg:'#fbeef2',bg2:'#f5e2e8',s1:'#fffafb',s2:'#fdf3f6',s3:'#f1dce3',t1:'#2b1820',t2:'#6b4a56',t3:'#997682'},
  {id:'cream',label:'Butter',dark:false,accent:'#c99400',bg:'#f9f4de',bg2:'#f2ebcd',s1:'#fffdf3',s2:'#fcf8e8',s3:'#eee6c7',t1:'#29240f',t2:'#625a39',t3:'#908766'}
];
var THEME_ALIASES={gray:'graphite',starry:'black',claude:'pearl'};
var ACCENT_PRESETS=['#ff9f0a','#ffb340','#ff6b35','#ff453a','#ff375f','#bf5af2','#7d7aff','#0a84ff','#40c8ff','#30d158','#66d4a8','#c7c7cc'];

function currentTheme(){var id=S.cfg.fullTheme||'black';id=THEME_ALIASES[id]||id;return FULL_THEMES.find(function(t){return t.id===id;})||FULL_THEMES[0];}
function hexToRgb(hex){var m=String(hex||'').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);if(!m)return [255,159,10];var h=m[1];if(h.length===3)h=h.split('').map(function(c){return c+c;}).join('');return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}
function relLum(rgb){return rgb.map(function(v){v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);}).reduce(function(a,v,i){return a+v*[.2126,.7152,.0722][i];},0);}
function themeAccent(t){t=t||currentTheme();return (S.cfg.themeAccents&&S.cfg.themeAccents[t.id])||t.accent;}

function applyTheme(){
  var t=currentTheme();
  var accent=themeAccent(t);
  S.cfg.accentColor=accent;
  var root=document.documentElement;
  root.classList.toggle('light',!t.dark);
  var rgb=hexToRgb(accent);
  var vars={'--bg':t.bg,'--bg-2':t.bg2,'--surface-1':t.s1,'--surface-2':t.s2,'--surface-3':t.s3,'--text-1':t.t1,'--text-2':t.t2,'--text-3':t.t3,
    '--accent':accent,'--accent-rgb':rgb.join(', '),'--on-accent':relLum(rgb)>.42?'#1d1303':'#ffffff'};
  Object.keys(vars).forEach(function(k){root.style.setProperty(k,vars[k]);});
  var font=S.cfg.fontFamily;
  if(font&&font!=='System')root.style.setProperty('--font','"'+String(font).replace(/["\\]/g,'')+'", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif');
  else root.style.removeProperty('--font');
  document.body.style.background=t.gradient||t.bg;
  root.dataset.glass=S.cfg.glassLevel||'glass';
  root.dataset.heroTone=S.cfg.heroTone==='light'||S.cfg.heroTone==='dark'?S.cfg.heroTone:(t.dark?'dark':'light');
  try{localStorage.setItem('av_theme_cache',JSON.stringify({light:!t.dark,bg:t.bg,gradient:t.gradient||'',accent:accent,rgb:rgb.join(', ')}));}catch(e){}
  var tb=document.getElementById('themeToggleBtn');
  if(tb){tb.innerHTML=ic(t.dark?'sun':'moon');tb.setAttribute('data-tip',t.dark?'Switch to light theme':'Switch to dark theme');}
}

function setFullTheme(id){
  S.cfg.fullTheme=id;
  if(!S.cfg.themeAccents)S.cfg.themeAccents={};
  var t=FULL_THEMES.find(function(x){return x.id===id;});
  if(t)S.cfg.accentColor=S.cfg.themeAccents[id]||t.accent;
  api.setConfig('fullTheme',id);
  withViewTransition(function(){applyTheme();if(S.view==='appearance')render();});
}
function setThemeAccent(color){
  if(!/^#[0-9a-f]{6}$/i.test(color||''))return;
  var t=currentTheme();
  if(!S.cfg.themeAccents)S.cfg.themeAccents={};
  S.cfg.themeAccents[t.id]=color;S.cfg.accentColor=color;
  api.setConfig('themeAccents',S.cfg.themeAccents);
  applyTheme();
  if(S.view==='appearance')renderAppearanceLive();
}
function resetThemeAccent(){var t=currentTheme();if(S.cfg.themeAccents)delete S.cfg.themeAccents[t.id];api.setConfig('themeAccents',S.cfg.themeAccents||{});applyTheme();if(S.view==='appearance')render();}
function toggleQuickTheme(){
  var t=currentTheme();
  // Remember the last theme used on each side so the toggle round-trips.
  var key=t.dark?'lastDarkTheme':'lastLightTheme';S.cfg[key]=t.id;api.setConfig(key,t.id);
  var next=t.dark?(S.cfg.lastLightTheme||'pearl'):(S.cfg.lastDarkTheme||'black');
  setFullTheme(next);
}
function setFont(f){S.cfg.fontFamily=f;api.setConfig('fontFamily',f);applyTheme();}
function setHeroTone(v){S.cfg.heroTone=v;api.setConfig('heroTone',v);applyTheme();if(S.view==='appearance')render();}
function setGlassLevel(v){S.cfg.glassLevel=v;api.setConfig('glassLevel',v);applyTheme();if(S.view==='appearance')render();}

function withViewTransition(fn){
  if(document.startViewTransition&&S.cfg.animSpeed!=='none'&&!S.cfg.performanceMode){try{document.startViewTransition(fn);return;}catch(e){}}
  fn();
}

// ------------------------------------------------------------------ motion --
function applyAnimSpeed(speed){
  var root=document.documentElement;
  root.dataset.motion=speed==='none'?'none':speed==='slow'?'slow':speed==='fast'?'fast':'default';
}
function setAnimSpeed(speed){S.cfg.animSpeed=speed;api.setConfig('animSpeed',speed);applyAnimSpeed(speed);initBackgroundEffects();if(S.view==='appearance')render();}

function applyPerformanceMode(enabled){
  enabled=!!enabled;
  document.documentElement.classList.toggle('performance-mode',enabled);
  if(enabled)clearBgEffects();else initBackgroundEffects();
  applyAnimSpeed(S.cfg.animSpeed||'default');
}
function setPerformanceMode(enabled){
  S.cfg.performanceMode=!!enabled;api.setConfig('performanceMode',!!enabled);applyPerformanceMode(enabled);
  if(S.view==='settings'||S.view==='appearance')render();
  toast(enabled?'Performance mode on — glass and motion reduced':'Performance mode off','s');
}

// ------------------------------------------------------ background effects --
function clearBgEffects(){var c=document.getElementById('bgAnimationContainer');if(c)c.innerHTML='';}
function initBackgroundEffects(){
  clearBgEffects();
  var amb=document.getElementById('ambient');
  var on=S.cfg.backgroundEffects!==false&&!S.cfg.performanceMode;
  if(amb)amb.style.display=on?'':'none';
  if(!on||S.cfg.animSpeed==='none')return;
  var type=S.cfg.backgroundType||'ambient';
  var intensity=S.cfg.backgroundIntensity||'medium';
  var countMult={subtle:.5,medium:1,vivid:1.7}[intensity]||1;
  var alpha={subtle:.35,medium:.6,vivid:.9}[intensity]||.6;
  if(amb)amb.style.opacity=String({subtle:.6,medium:1,vivid:1.4}[intensity]||1);
  var c=document.getElementById('bgAnimationContainer');if(!c)return;
  var speed={slow:1.6,fast:.5}[S.cfg.animSpeed]||1;
  var frag=document.createDocumentFragment();
  if(type==='particles'){
    var n=Math.floor(22*countMult);
    for(var i=0;i<n;i++){
      var p=document.createElement('i');p.className='bg-particle';
      var size=Math.random()*3+1.2,dur=(24+Math.random()*36)*speed;
      p.style.cssText='left:'+(Math.random()*100)+'%;width:'+size+'px;height:'+size+'px;opacity:'+(alpha*(.4+Math.random()*.5)).toFixed(2)+';animation-duration:'+dur.toFixed(1)+'s;animation-delay:-'+(Math.random()*dur).toFixed(1)+'s';
      frag.appendChild(p);
    }
  }else if(type==='orbs'){
    var m=Math.max(2,Math.floor(4*countMult));
    for(var j=0;j<m;j++){
      var o=document.createElement('i');o.className='bg-orb'+(j%3===1?' alt':j%3===2?' alt2':'');
      var s=260+Math.random()*320;
      o.style.cssText='left:'+(Math.random()*90)+'%;top:'+(Math.random()*90)+'%;width:'+s+'px;height:'+s+'px;opacity:'+alpha+';animation-duration:'+((18+Math.random()*16)*speed).toFixed(1)+'s;animation-delay:-'+(Math.random()*10).toFixed(1)+'s';
      frag.appendChild(o);
    }
  }else if(type==='mesh'){
    var mesh=document.createElement('i');mesh.className='bg-mesh';mesh.style.opacity=String(alpha);mesh.style.animationDuration=(28*speed)+'s';frag.appendChild(mesh);
  }
  c.appendChild(frag);
}
