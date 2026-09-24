/* AnimeVault renderer — Appearance. */

function themeSwatch(t){
  var acc=themeAccent(t);var active=currentTheme().id===t.id;
  var bg=t.gradient||t.bg;
  return '<button class="theme-card'+(active?' active':'')+'"'+A('setFullTheme',t.id)+' aria-pressed="'+active+'">'
    +'<div class="theme-mini" style="background:'+E(bg)+';color:'+E(t.t1)+'">'
    +'<div class="tm-side" style="background:'+E(t.s1)+'"><i style="background:'+E(acc)+'"></i><i></i><i></i><i></i></div>'
    +'<div class="tm-main"><div class="tm-bar" style="background:'+E(t.s1)+'"></div><div class="tm-cards"><i style="background:'+E(t.s2)+'"></i><i style="background:'+E(t.s3)+'"></i><i style="background:'+E(t.s2)+'"></i></div>'
    +'<div class="tm-btn" style="background:'+E(acc)+'"></div></div></div>'
    +'<div class="theme-name">'+E(t.label)+(active?ic('checkCircle'):'')+'</div></button>';
}
function vAppearance(){
  var t=currentTheme();var acc=themeAccent(t);
  var h='<div class="view appearance">'+pageHead('Appearance','Themes, color, glass and motion.');
  h+='<div class="appear-top"><div class="preview panel">'+previewMock()+'</div>'
    +'<div class="panel panel-pad appear-quick"><div class="panel-title" style="margin-bottom:12px">Accent color</div><div class="swatches">';
  ACCENT_PRESETS.forEach(function(c){h+='<button class="swatch'+(c.toLowerCase()===String(acc).toLowerCase()?' active':'')+'" style="--sw:'+c+'"'+A('setThemeAccent',c)+Tip(c)+'></button>';});
  h+='<label class="swatch custom"'+Tip('Custom color')+'><input type="color" value="'+E(acc)+'"'+On('input','accentLive')+On('change','accentPick')+'>'+ic('plus')+'</label></div>'
    +'<div class="row" style="margin-top:12px"><span class="mono muted" style="font-size:12px" id="accentHex">'+E(acc)+'</span><span class="spacer"></span>'+(S.cfg.themeAccents&&S.cfg.themeAccents[t.id]?'<button class="btn btn-ghost btn-xs"'+A('resetThemeAccent')+'>Use theme default</button>':'')+'</div>'
    +'<div class="panel-title" style="margin:18px 0 10px">Mode</div>'+seg('lightDark',[{v:'dark',label:'Dark',icon:'moon'},{v:'light',label:'Light',icon:'sun'}],t.dark?'dark':'light','setLightDark','block')
    +'</div></div>';
  h+='<div class="sec-head"><div class="sec-title">Dark themes</div></div><div class="theme-grid">'+FULL_THEMES.filter(function(x){return x.dark;}).map(themeSwatch).join('')+'</div>';
  h+='<div class="sec-head"><div class="sec-title">Light themes</div></div><div class="theme-grid">'+FULL_THEMES.filter(function(x){return !x.dark;}).map(themeSwatch).join('')+'</div>';
  var fonts=[['System','System (Segoe UI)'],['Segoe UI','Segoe UI'],['Inter','Inter'],['Roboto','Roboto'],['Nunito','Nunito'],['Outfit','Outfit'],['Plus Jakarta Sans','Plus Jakarta Sans'],['DM Sans','DM Sans'],['Lexend','Lexend'],['Poppins','Poppins'],['Space Grotesk','Space Grotesk'],['JetBrains Mono','JetBrains Mono']];
  var cur=S.cfg.fontFamily||'System';
  h+='<div class="sec-head"><div class="sec-title">Interface</div></div><div class="list-group">'
    +setRow({icon:'layers',color:'var(--accent)',title:'Transparency',desc:'Glass blurs what’s behind panels and menus. Solid is fastest.',ctrl:seg('glass',[{v:'glass',label:'Glass'},{v:'frosted',label:'Frosted'},{v:'solid',label:'Solid'}],S.cfg.glassLevel||'glass','setGlassLevel')})
    +setRow({icon:'image',color:'#ff9f0a',title:'Featured card',desc:'Tone of the blurred artwork behind the big card on Collection. Auto follows the theme.',ctrl:seg('heroTone',[{v:'auto',label:'Auto'},{v:'light',label:'Light'},{v:'dark',label:'Dark'}],S.cfg.heroTone||'auto','setHeroTone')})
    +setRow({icon:'activity',color:'#30d158',title:'Motion',desc:'Speed of transitions, springs and hovers. “None” turns animation off.',ctrl:seg('motion',[{v:'none',label:'None'},{v:'slow',label:'Relaxed'},{v:'default',label:'Normal'},{v:'fast',label:'Snappy'}],S.cfg.animSpeed||'default','setAnimSpeed')})
    +setRow({icon:'type',color:'#0a84ff',title:'Font',desc:'Fonts other than the system font must be installed on this computer.',ctrl:'<select class="select sm"'+On('change','setFontSel')+'>'+fonts.map(function(f){return '<option value="'+E(f[0])+'"'+(cur===f[0]?' selected':'')+'>'+E(f[1])+'</option>';}).join('')+'</select>'})
    +setRow({icon:'sparkles',color:'#bf5af2',title:'Background effects',desc:'Soft light behind the interface.',ctrl:switchCtl(S.cfg.backgroundEffects!==false,'setBgEffects')})
    +(S.cfg.backgroundEffects!==false?setRow({title:'Effect',ctrl:seg('bgType',[{v:'ambient',label:'Ambient'},{v:'orbs',label:'Orbs'},{v:'particles',label:'Particles'},{v:'mesh',label:'Mesh'}],S.cfg.backgroundType||'ambient','setBgType')})
      +setRow({title:'Intensity',ctrl:seg('bgInt',[{v:'subtle',label:'Subtle'},{v:'medium',label:'Medium'},{v:'vivid',label:'Vivid'}],S.cfg.backgroundIntensity||'medium','setBgIntensity')}):'')
    +setRow({icon:'cpu',color:'#8e8e93',title:'Performance mode',desc:'Disables glass, blur and ambient effects everywhere.',ctrl:switchCtl(!!S.cfg.performanceMode,'setPerformanceModeSw')})
    +'</div>';
  return h+'</div>';
}
function previewMock(){
  var lib=librarySeries().slice(0,4);
  var h='<div class="pv"><div class="pv-bar"><span></span><span></span><span></span><div class="pv-search">'+ic('search')+'Search</div></div><div class="pv-body"><div class="pv-side"><div class="pv-ni active">'+ic('grid')+'Collection</div><div class="pv-ni">'+ic('compass')+'Explore</div><div class="pv-ni">'+ic('calendarClock')+'Schedule</div><div class="pv-ni">'+ic('gear')+'Settings</div></div>'
    +'<div class="pv-main"><div class="pv-title">Continue watching</div><div class="pv-cards">';
  for(var i=0;i<4;i++){var s=lib[i];var c=s?S.covers[s.name]:'';h+='<div class="pv-card">'+(c?'<img src="'+E(c)+'" alt="">':'')+'<div class="pv-prog"><i style="width:'+(30+i*17)+'%"></i></div></div>';}
  h+='</div><div class="row" style="margin-top:12px"><span class="btn btn-primary btn-sm">'+ic('play')+'Resume</span><span class="btn btn-secondary btn-sm">Details</span><span class="tag accent">Today 9:30 PM</span></div></div></div></div>';
  return h;
}
function renderAppearanceLive(){var hx=document.getElementById('accentHex');if(hx)hx.textContent=S.cfg.accentColor;document.querySelectorAll('.swatch:not(.custom)').forEach(function(s){s.classList.toggle('active',s.style.getPropertyValue('--sw').trim().toLowerCase()===String(S.cfg.accentColor).toLowerCase());});}
act('accentLive',function(el){var rgb=hexToRgb(el.value);var root=document.documentElement;root.style.setProperty('--accent',el.value);root.style.setProperty('--accent-rgb',rgb.join(', '));root.style.setProperty('--on-accent',relLum(rgb)>.42?'#1d1303':'#ffffff');});
act('accentPick',function(el){setThemeAccent(el.value);});
act('setLightDark',function(el,ev,mode){var t=currentTheme();if((mode==='dark')===t.dark)return;toggleQuickTheme();});
act('setFontSel',function(el){setFont(el.value==='System'?'':el.value);});
act('setBgEffects',function(el){S.cfg.backgroundEffects=el.checked;api.setConfig('backgroundEffects',el.checked);initBackgroundEffects();render();});
act('setBgType',function(el,ev,v){S.cfg.backgroundType=v;api.setConfig('backgroundType',v);initBackgroundEffects();});
act('setBgIntensity',function(el,ev,v){S.cfg.backgroundIntensity=v;api.setConfig('backgroundIntensity',v);initBackgroundEffects();});
expose('setFullTheme','setThemeAccent','resetThemeAccent','setGlassLevel','setAnimSpeed','setHeroTone');
