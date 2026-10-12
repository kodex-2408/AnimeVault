/* Tsundoku renderer — guided tour (5.11).

   Tsumi walks the user through the app. The page dims except for one
   highlighted area; a callout next to it explains what it is, and Tsumi hops
   over beside the callout and "says" the step. Most steps use Next; a few
   "Try it" steps wait for the real action (switch modes, open the command
   palette, right-click a card, open a series), always with a Skip.

   A step is { title, text, view?, before?(), target?() -> Element, wait?() ->
   bool, skipIf?() -> bool, after?() }. Clicks outside the highlight are
   blocked; on a Try it step the highlighted element itself stays clickable.
   Menus (z 4000) and the command palette (z 4500) sit above the blockers. */

var TOUR_CHAPTERS=[
  {id:'basics',label:'Basics'},
  {id:'cards',label:'Cards and series'},
  {id:'discover',label:'Discover and plan'},
  {id:'tools',label:'Library tools'}
];
var _tour=null;

function $q(sel){return document.querySelector(sel);}
function tourNav(v){return $q('.ni[data-view="'+v+'"]');}
function tourCard(){return $q('#mc .pc')||$q('.tour-sample');}
function tourSheetOpen(){var d=document.getElementById('dov');return !!(d&&d.classList.contains('open'));}

function tourSteps(chapter){
  var startMode=S.vaultMode;
  var B={
    basics:[
      {title:'Everything lives in the sidebar',text:'Your collection, Explore, My List and the tools are all one click away here. Press Ctrl B to fold the sidebar away.',target:function(){return $q('.sidebar');}},
      {title:'Try it: switch to '+(startMode==='manga'?'Anime':'Manga'),text:'Tsundoku keeps two libraries. Click '+(startMode==='manga'?'Anime':'Manga')+' to switch; every section follows along.',target:function(){return $q('#modeSeg');},wait:function(){return S.vaultMode!==startMode;}},
      {title:'Now switch back',text:'Same button. Ctrl Shift M switches from anywhere.',target:function(){return $q('#modeSeg');},wait:function(){return S.vaultMode===startMode;},skipIf:function(){return S.vaultMode===startMode;}},
      {title:'Try it: open the command palette',text:'Click here or press Ctrl K. Type a few letters to jump to a series, a section or an action like "Rescan library".',target:function(){return $q('.tb-search');},wait:function(){return !!(typeof _palState!=='undefined'&&_palState.open);},after:function(){if(typeof _closePalette==='function')_closePalette();}},
      {title:'MyAnimeList sync',text:'Green means your progress, scores and statuses sync as you watch. Click to pause syncing; while it is paused, episode checkmarks are locked.',target:function(){return $q('#syncToggle');}},
      {title:'That\'s me!',text:'Click here, or on me wherever I am hopping around, to chat. I can find a series, suggest what to watch next or take you to a setting.',target:function(){return $q('.tb-pill');}}
    ],
    cards:[
      {title:'A series card',text:'The cover, a badge for what is new or local, and a bar along the bottom: the bright part is what you have watched, the faint part is what has aired so far.',view:'library',before:tourEnsureCard,target:tourCard},
      {title:'Try it: right-click the card',text:'Right-click any card for quick actions: open the folder, mark everything watched, change the cover, track new episodes, and more.',target:tourCard,wait:function(){return !!(typeof _openMenu!=='undefined'&&_openMenu);},after:function(){if(typeof closeMenu==='function')closeMenu(true);}},
      {title:'Try it: open the series',text:'Click the card to open its page.',target:tourCard,wait:tourSheetOpen,skipIf:function(){return !$q('#mc .pc');}},
      {title:'Episodes',text:'Click an episode to play it. The check in the corner marks it watched (and syncs to MyAnimeList); watching past the auto-mark point ticks it for you.',target:function(){return $q('#dpn .ep-grid')||$q('#dpn .ep-list')||$q('#dpn .ep');},skipIf:function(){return !tourSheetOpen();}},
      {title:'Track new episodes',text:'Switch this on and new episodes are handed to your torrent client as soon as a good release appears on Nyaa.',target:function(){var sw=$q('#dpn [data-act="toggleTrackSwitch"]');return sw?(sw.closest('.panel')||sw):null;},skipIf:function(){return !tourSheetOpen()||isManga()||!$q('#dpn [data-act="toggleTrackSwitch"]');},after:function(){if(tourSheetOpen()&&typeof cdtl==='function')cdtl();}}
    ],
    discover:[
      {title:'Explore',text:'Top-rated and this season\'s shows from MyAnimeList. Filter by genre, type, score and status. Chinese animation is hidden here by default; switch that in Settings → Import & matching.',view:'explore',target:function(){return $q('#mc .chips')||tourNav('explore');}},
      {title:'My List',text:'Your whole MyAnimeList list, with progress bars that know how much has aired. Edit status, score and progress right from the cards.',target:function(){return tourNav('mylist');}},
      {title:'Schedule',text:'Everything you watch, in your time zone, with live countdowns. The folder chip shows local episodes; the download chip means new episodes are tracked.',view:'schedule',target:function(){return $q('#mc .ag')||$q('#mc .week-board')||tourNav('schedule');}},
      {title:'Agenda or Week',text:'Switch between the day-by-day list and the week board here.',target:function(){return $q('#mc [data-seg="schedView"]');},skipIf:function(){return !$q('#mc [data-seg="schedView"]');}}
    ],
    tools:[
      {title:'Library Hub',text:'New folders land in the Import Inbox: confirm the MyAnimeList match and they join your library.',target:function(){return tourNav('hub');}},
      {title:'File Management',text:'Rename files to a clean pattern, sort new downloads into the right folders, and find duplicates. Every change can be undone.',target:function(){return tourNav('filemgmt');}},
      {title:'Stats',text:'Hours watched, genres, scores and streaks.',target:function(){return tourNav('stats');}},
      {title:'Settings',text:'Players and subtitles, download rules, the built-in manga reader and page translation, notifications, and this tour again under Performance & window.',target:function(){return tourNav('settings');}}
    ]
  };
  return chapter?B[chapter]:B.basics.concat(B.cards,B.discover,B.tools);
}

// A clearly marked sample card when the collection is empty, so the card
// steps still have something to point at. Its right-click opens a demo menu.
function tourEnsureCard(){
  if($q('#mc .pc')||$q('.tour-sample'))return;
  var el=document.createElement('div');el.className='tour-sample pc';el.tabIndex=0;
  el.innerHTML='<div class="pc-art"><div class="ph">'+ic(VM('film','book'))+'</div><div class="pc-badges"><span class="media-badge">Sample</span></div>'
    +'<div class="pc-bottom"><div class="pc-prog" style="--p:40%;--a:75%"><b></b><i></i></div></div></div><div class="pc-body"><div class="pc-title">Your series here</div><div class="pc-meta"><span>5 / 12 '+epLabel().toLowerCase()+'</span></div></div>';
  el.addEventListener('contextmenu',function(e){e.preventDefault();openMenu(e,[{label:'Open folder',icon:'folder',run:function(){}},{label:'Mark all watched',icon:'checkCircle',run:function(){}},{label:'Change cover',icon:'image',run:function(){}},{label:'Track new episodes',icon:'download',run:function(){}}]);});
  document.body.appendChild(el);
}
function tourRemoveSample(){var s=$q('.tour-sample');if(s)s.remove();}

function startTour(chapter){
  if(_tour)endTour();
  closeMenu&&closeMenu(true);
  var steps=tourSteps(chapter);
  var layer=document.createElement('div');layer.className='tour-layer';layer.setAttribute('role','dialog');layer.setAttribute('aria-live','polite');
  layer.innerHTML='<div class="tour-spot"></div><div class="tour-block" data-b="t"></div><div class="tour-block" data-b="b"></div><div class="tour-block" data-b="l"></div><div class="tour-block" data-b="r"></div><div class="tour-block" data-b="c"></div>'
    +'<div class="tour-call"><div class="tour-head"><img src="companion/tsumi.svg" alt=""><span class="tour-who">Tsumi</span><span class="tour-count"></span></div><div class="tour-title"></div><div class="tour-text"></div>'
    +'<div class="tour-foot"><button class="btn btn-ghost btn-sm" data-tour="end">End tour</button><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-tour="back">Back</button><button class="btn btn-primary btn-sm" data-tour="next">Next</button></div></div>';
  document.body.appendChild(layer);document.body.classList.add('tour-on');
  layer.addEventListener('click',function(e){var b=e.target.closest('[data-tour]');if(!b)return;var a=b.getAttribute('data-tour');if(a==='end')endTour();else if(a==='back')tourGo(_tour.i-1,-1);else tourGo(_tour.i+1,1);});
  _tour={steps:steps,i:-1,layer:layer,raf:0,chapter:chapter||'all',waitDone:false};
  window.addEventListener('keydown',tourKeys,true);
  tourGo(0,1);
  _tour.raf=requestAnimationFrame(tourFrame);
}
function tourKeys(e){
  if(!_tour)return;
  // The palette and menus keep their own keys during a Try it step.
  if((typeof _palState!=='undefined'&&_palState.open)||(typeof _openMenu!=='undefined'&&_openMenu))return;
  if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();endTour();}
  else if(e.key==='ArrowRight'||(e.key==='Enter'&&!/INPUT|TEXTAREA/.test((e.target&&e.target.tagName)||''))){var st=_tour.steps[_tour.i];if(!st.wait||_tour.waitDone){e.preventDefault();e.stopImmediatePropagation();tourGo(_tour.i+1,1);}}
  else if(e.key==='ArrowLeft'){e.preventDefault();e.stopImmediatePropagation();tourGo(_tour.i-1,-1);}
}
async function tourGo(i,dir){
  if(!_tour)return;
  var prev=_tour.steps[_tour.i];
  if(prev&&prev.after&&dir>0)try{prev.after();}catch(e){}
  if(i<0)return;
  if(i>=_tour.steps.length){endTour(true);return;}
  var st=_tour.steps[i];
  if(st.view&&S.view!==st.view){go(st.view);await new Promise(function(r){setTimeout(r,350);});}
  if(st.before)try{st.before();}catch(e){}
  if(st.skipIf&&st.skipIf()){var n=i+(dir||1);if(n<0)return;return tourGo(n,dir||1);}
  _tour.i=i;_tour.waitDone=false;
  var L=_tour.layer;
  L.querySelector('.tour-title').textContent=st.title;
  L.querySelector('.tour-text').textContent=st.text;
  L.querySelector('.tour-count').textContent=(i+1)+' / '+_tour.steps.length;
  L.querySelector('[data-tour="back"]').hidden=i===0;
  tourSyncNext();
  L.classList.toggle('try',!!st.wait);
  if(typeof lumaSay==='function')lumaSay(2200);
}
function tourSyncNext(){
  var st=_tour.steps[_tour.i],b=_tour.layer.querySelector('[data-tour="next"]');
  var last=_tour.i===_tour.steps.length-1;
  b.textContent=st.wait&&!_tour.waitDone?'Skip':last?'Done':'Next';
  b.className='btn btn-sm '+(st.wait&&!_tour.waitDone?'btn-ghost':'btn-primary');
}
function tourFrame(){
  if(!_tour)return;
  _tour.raf=requestAnimationFrame(tourFrame);
  var st=_tour.steps[_tour.i];if(!st)return;
  if(st.wait&&!_tour.waitDone&&st.wait()){_tour.waitDone=true;tourSyncNext();var i=_tour.i;setTimeout(function(){if(_tour&&_tour.i===i)tourGo(i+1,1);},450);}
  var L=_tour.layer,el=null;try{el=st.target?st.target():null;}catch(e){}
  var vw=window.innerWidth,vh=window.innerHeight,r;
  if(el&&el.getBoundingClientRect){var b=el.getBoundingClientRect();if(b.width>0&&b.height>0){var pad=8;r={x:Math.max(4,b.left-pad),y:Math.max(4,b.top-pad)};r.w=Math.min(vw-4,b.right+pad)-r.x;r.h=Math.min(vh-4,b.bottom+pad)-r.y;}}
  var spot=L.querySelector('.tour-spot');
  if(!r){r={x:vw/2,y:vh/2,w:0,h:0};spot.classList.add('none');}else spot.classList.remove('none');
  spot.style.transform='translate('+r.x+'px,'+r.y+'px)';spot.style.width=r.w+'px';spot.style.height=r.h+'px';
  var set=function(k,x,y,w,h){var d=L.querySelector('[data-b="'+k+'"]');d.style.left=x+'px';d.style.top=y+'px';d.style.width=Math.max(0,w)+'px';d.style.height=Math.max(0,h)+'px';};
  set('t',0,0,vw,r.y);set('b',0,r.y+r.h,vw,vh-r.y-r.h);set('l',0,r.y,r.x,r.h);set('r',r.x+r.w,r.y,vw-r.x-r.w,r.h);
  // Next-only steps also block the highlight itself; Try it steps leave it clickable.
  if(st.wait&&!_tour.waitDone)set('c',0,0,0,0);else set('c',r.x,r.y,r.w,r.h);
  // Callout: right of the target, else below, left, above; clamped to the window.
  var call=L.querySelector('.tour-call'),cw=call.offsetWidth,ch=call.offsetHeight,g=16,x,y;
  if(!r.w){x=(vw-cw)/2;y=(vh-ch)/2;}
  else if(r.x+r.w+g+cw<vw-8){x=r.x+r.w+g;y=r.y;}
  else if(r.y+r.h+g+ch<vh-8){x=r.x;y=r.y+r.h+g;}
  else if(r.x-g-cw>8){x=r.x-g-cw;y=r.y;}
  else{x=r.x;y=r.y-g-ch;}
  x=Math.max(8,Math.min(vw-cw-8,x));y=Math.max(48,Math.min(vh-ch-8,y));
  call.style.transform='translate('+Math.round(x)+'px,'+Math.round(y)+'px)';
  // Tsumi stands on the callout's top edge, or beside it when that is too close to the title bar.
  if(typeof lumaGuide==='function')lumaGuide(y>120?{x:x+cw-34,y:y-34}:{x:x+cw+48<vw?x+cw+44:x-44,y:y+44});
}
function endTour(finished){
  if(!_tour)return;
  cancelAnimationFrame(_tour.raf);
  window.removeEventListener('keydown',tourKeys,true);
  var L=_tour.layer;L.classList.add('closing');setTimeout(function(){L.remove();},200);
  document.body.classList.remove('tour-on');tourRemoveSample();
  if(typeof lumaGuide==='function')lumaGuide(null);
  if(finished&&_tour.chapter==='all'){S.cfg.tourDone=true;api.setConfig('tourDone',true);toast('Tour finished. Replay any part from Settings → Performance & window.','s');}
  _tour=null;
}
act('startTour',function(el,ev,chapter){startTour(chapter||null);});
expose('endTour');
