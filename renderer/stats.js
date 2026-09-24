/* AnimeVault renderer — Stats dashboard (SVG charts, single accent hue for magnitude). */

var _statsSeq=0;
async function renderStats(){
  var mc=document.getElementById('mc');var seq=++_statsSeq;
  var cached=S._statsCounts&&S._statsCounts.mode===S.vaultMode?S._statsCounts:null;
  if(!cached)mc.innerHTML='<div class="view">'+pageHead('Stats','Crunching your library…')+'<div class="kpis">'+[0,1,2,3,4].map(function(){return '<div class="skeleton" style="height:108px;border-radius:var(--r-lg)"></div>';}).join('')+'</div></div>';
  var counts=cached;
  if(!counts){
    counts={mode:S.vaultMode,source:'local',counts:null};
    if(S.mal){try{var r=await api.malGetStatusCounts();if(r&&r.counts){counts.counts=r.counts;counts.source=r.source||'mal';}}catch(e){console.warn('[Stats] MAL counts unavailable',e);}}
    S._statsCounts=counts;
  }
  if(seq!==_statsSeq||S.view!=='stats')return;
  mc.innerHTML=vStats(counts);updateSegThumbs(mc);
}
act('statsRefresh',function(){S._statsCounts=null;renderStats();});

function vStats(countInfo){
  var all=librarySeries();
  if(!all.length)return '<div class="view">'+pageHead('Stats')+emptyState('chart','No stats yet','Add library folders and your statistics will appear here.','<button class="btn btn-primary"'+A('go','settings')+'>Add folders</button>')+'</div>';
  var totalEps=0,watchedEps=0,diskBytes=0,linked=0,meanSum=0,meanN=0;
  var byCat={},byFormat={},genreCounts={},yearCounts={},scoreDist={},monthly={};
  var dayCounts={};
  all.forEach(function(s){
    totalEps+=s.episodeCount||0;
    var w=s.watchData&&s.watchData.episodesWatched?s.watchData.episodesWatched.length:0;watchedEps+=w;
    (s.episodes||[]).forEach(function(e){diskBytes+=e.size||0;});
    var c=s.category||'Uncategorized';byCat[c]=(byCat[c]||0)+1;
    var md=s.watchData&&s.watchData.malData;
    if(s.watchData&&s.watchData.malId)linked++;
    if(md){
      var f=(md.media_type||'unknown').toUpperCase();byFormat[f]=(byFormat[f]||0)+1;
      (md.genres||[]).forEach(function(g){var n=g.name||g;if(n)genreCounts[n]=(genreCounts[n]||0)+1;});
      if(md.start_date){var y=String(md.start_date).slice(0,4);if(y>='1950')yearCounts[y]=(yearCounts[y]||0)+1;}
      if(md.mean){meanSum+=+md.mean;meanN++;var b=Math.min(10,Math.max(1,Math.floor(+md.mean)));scoreDist[b]=(scoreDist[b]||0)+1;}
    }
    var lw=s.watchData&&s.watchData.lastWatched;
    if(lw){var mk=_statsMonthKey(lw);if(mk)monthly[mk]=(monthly[mk]||0)+1;var dk=String(lw).slice(0,10);dayCounts[dk]=(dayCounts[dk]||0)+1;}
  });
  var statusCounts={watching:0,completed:0,plan_to_watch:0,on_hold:0,dropped:0};
  if(countInfo&&countInfo.counts){Object.keys(countInfo.counts).forEach(function(k){var kk=k==='reading'?'watching':k==='plan_to_read'?'plan_to_watch':k;statusCounts[kk]=(statusCounts[kk]||0)+(countInfo.counts[k]||0);});}
  else all.forEach(function(s){var ml=getMyListStatus(s.watchData&&s.watchData.malData);if(ml&&ml.status){var k=ml.status==='reading'?'watching':ml.status==='plan_to_read'?'plan_to_watch':ml.status;statusCounts[k]=(statusCounts[k]||0)+1;}});
  var pct=totalEps?Math.round(watchedEps/totalEps*100):0;

  var h='<div class="view stats">'+pageHead('Stats','A look at your '+VM('anime','manga')+' library'+(countInfo&&countInfo.source==='mal'?' and your MyAnimeList account':''),'<button class="btn btn-ghost btn-sm"'+A('statsRefresh')+'>'+ic('refresh')+'Refresh</button>');
  h+='<div class="kpis">'
    +kpi('library','Series',all.length.toLocaleString(),Object.keys(byCat).length+' categories')
    +kpi(VM('film','book'),epLabelFull()+' on disk',totalEps.toLocaleString(),fmtBytes(diskBytes))
    +kpi('checkCircle',watchedLabel().charAt(0).toUpperCase()+watchedLabel().slice(1),watchedEps.toLocaleString(),pct+'% of files','<div class="progress" style="--p:'+pct+'%"><i></i></div>')
    +kpi('link','Linked to MAL',linked+'<small> / '+all.length+'</small>',Math.round(linked/all.length*100)+'% of library','<div class="progress" style="--p:'+Math.round(linked/all.length*100)+'%"><i></i></div>')
    +kpi('star','Average MAL score',meanN?(meanSum/meanN).toFixed(2):'—',meanN?'across '+meanN+' rated series':'link series to see scores')
    +'</div>';

  h+='<div class="chart-grid">';
  // Status donut
  var stMeta=[['watching',watchingLabel(),'var(--st-watching)'],['completed','Completed','var(--st-completed)'],['plan_to_watch',planLabel(),'var(--st-plan)'],['on_hold','On hold','var(--st-hold)'],['dropped','Dropped','var(--st-dropped)']];
  h+=chartCard('Your list by status',countInfo&&countInfo.source==='mal'?'From your MyAnimeList account':'From linked library series',donut(stMeta.map(function(m){return {label:m[1],value:statusCounts[m[0]]||0,color:m[2]};})),'span-4');
  // Score distribution
  var scoreRows=[];for(var i=1;i<=10;i++)scoreRows.push({label:String(i),value:scoreDist[i]||0,tip:'MAL score '+i+'.00–'+i+'.99'});
  h+=chartCard('MAL score distribution','Series in your library by community score',columns(scoreRows,{unit:'series'}),'span-4');
  // Formats
  var fmt=Object.keys(byFormat).sort(function(a,b){return byFormat[b]-byFormat[a];}).map(function(k){return {label:k,value:byFormat[k]};});
  h+=chartCard('Formats','',fmt.length?hbars(fmt,{unit:'series'}):chartEmpty('Link series to MyAnimeList to see formats'),'span-4');
  // Heatmap
  h+=chartCard(VM('Watch activity','Reading activity'),'Days you last '+watchedLabel()+' something, past 26 weeks',heatmap(dayCounts),'span-8');
  // Genres
  var gen=Object.keys(genreCounts).sort(function(a,b){return genreCounts[b]-genreCounts[a];}).slice(0,10).map(function(k){return {label:k,value:genreCounts[k]};});
  h+=chartCard('Top genres','',gen.length?hbars(gen,{unit:'series'}):chartEmpty('Link series to MyAnimeList to see genres'),'span-4 row-2');
  // Monthly
  var months=[];var d=new Date();d.setDate(1);
  for(var m=11;m>=0;m--){var dd=new Date(d.getFullYear(),d.getMonth()-m,1);var key=dd.getFullYear()+'-'+String(dd.getMonth()+1).padStart(2,'0');months.push({label:dd.toLocaleDateString(undefined,{month:'short'}),value:monthly[key]||0,tip:dd.toLocaleDateString(undefined,{month:'long',year:'numeric'})});}
  h+=chartCard('Series last '+watchedLabel()+', by month','Past 12 months',columns(months,{unit:'series'}),'span-4');
  // Years
  var years=Object.keys(yearCounts).sort().slice(-12).map(function(y){return {label:"'"+y.slice(2),value:yearCounts[y],tip:'Premiered in '+y};});
  h+=chartCard('Premiere year','Most recent 12 years',years.length?columns(years,{unit:'series'}):chartEmpty('Link series to MyAnimeList to see years'),'span-4');
  // Categories
  var cats=Object.keys(byCat).sort(function(a,b){return byCat[b]-byCat[a];}).map(function(k){return {label:k,value:byCat[k]};});
  h+=chartCard('Library categories','',hbars(cats,{unit:'series',cap:true}),'span-4');
  h+='</div></div>';
  return h;
}
function kpi(icon,label,value,sub,extra){return '<div class="kpi"><div class="kpi-label">'+ic(icon)+E(label)+'</div><div class="kpi-value">'+value+'</div>'+(sub?'<div class="kpi-sub">'+E(sub)+'</div>':'')+(extra||'')+'</div>';}
function chartCard(title,sub,body,cls){return '<div class="chart-card panel '+(cls||'')+'"><div class="chart-head"><div class="chart-title">'+E(title)+'</div>'+(sub?'<div class="chart-sub">'+E(sub)+'</div>':'')+'</div><div class="chart-body">'+body+'</div></div>';}
function chartEmpty(t){return '<div class="chart-empty">'+ic('info')+E(t)+'</div>';}

function donut(rows){
  var total=rows.reduce(function(a,r){return a+r.value;},0);
  if(!total)return chartEmpty('No list data yet');
  var R=62,C=2*Math.PI*R,off=0,gap=total>1?2:0;
  var svg='<svg class="donut" viewBox="0 0 160 160" role="img" aria-label="Status breakdown"><circle cx="80" cy="80" r="'+R+'" class="donut-track"/>';
  rows.forEach(function(r){
    if(!r.value)return;var len=r.value/total*C;var dash=Math.max(0,len-gap);
    svg+='<circle cx="80" cy="80" r="'+R+'" class="donut-seg" style="stroke:'+r.color+';stroke-dasharray:'+dash.toFixed(2)+' '+(C-dash).toFixed(2)+';stroke-dashoffset:'+(-off).toFixed(2)+'"'+Tip(r.label+': '+r.value.toLocaleString()+' ('+Math.round(r.value/total*100)+'%)')+'/>';
    off+=len;
  });
  svg+='<text x="80" y="76" class="donut-total">'+total.toLocaleString()+'</text><text x="80" y="96" class="donut-label">entries</text></svg>';
  var legend='<div class="legend">'+rows.map(function(r){return '<div class="legend-row"><span class="legend-sw" style="background:'+r.color+'"></span><span class="grow">'+E(r.label)+'</span><span class="num">'+r.value.toLocaleString()+'</span><span class="muted num">'+Math.round(r.value/total*100)+'%</span></div>';}).join('')+'</div>';
  return '<div class="donut-wrap">'+svg+legend+'</div>';
}
function columns(rows,o){
  o=o||{};var max=Math.max.apply(null,rows.map(function(r){return r.value;}).concat([1]));
  if(!rows.some(function(r){return r.value;}))return chartEmpty('Nothing to show yet');
  var peak=rows.reduce(function(a,r,i){return r.value>rows[a].value?i:a;},0);
  var h='<div class="cols">';
  rows.forEach(function(r,i){
    var pct=r.value/max*100;
    h+='<div class="col-item"'+Tip((r.tip||r.label)+': '+r.value.toLocaleString()+(o.unit?' '+o.unit:''))+'><div class="col-track">'+(i===peak&&r.value?'<span class="col-val">'+r.value+'</span>':'')+'<div class="col-bar" style="height:'+Math.max(r.value?3:0,pct).toFixed(1)+'%"></div></div><div class="col-label">'+E(r.label)+'</div></div>';
  });
  return h+'</div>';
}
function hbars(rows,o){
  o=o||{};var max=Math.max.apply(null,rows.map(function(r){return r.value;}).concat([1]));
  return '<div class="hbars">'+rows.map(function(r){return '<div class="hbar"'+Tip(r.label+': '+r.value+(o.unit?' '+o.unit:''))+'><span class="hbar-label ellipsis'+(o.cap?' cap':'')+'">'+E(r.label)+'</span><span class="hbar-track"><i style="width:'+(r.value/max*100).toFixed(1)+'%"></i></span><span class="hbar-val num">'+r.value+'</span></div>';}).join('')+'</div>';
}
function heatmap(dayCounts){
  var weeks=26;var today=new Date();today.setHours(0,0,0,0);
  var start=new Date(today);start.setDate(start.getDate()-(weeks*7-1)-((start.getDay()+6)%7));
  var max=1;Object.keys(dayCounts).forEach(function(k){if(dayCounts[k]>max)max=dayCounts[k];});
  var h='<div class="heat"><div class="heat-days"><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span>Sun</span></div><div class="heat-grid">';
  var d=new Date(start);var lastMonth=-1;var monthsRow='';
  for(var w=0;w<=weeks;w++){
    var col='<div class="heat-col">';
    var mlabel='';
    for(var i=0;i<7;i++){
      if(d>today){col+='<span class="heat-cell future"></span>';}
      else{
        var key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
        var c=dayCounts[key]||0;var lvl=c?Math.min(4,Math.ceil(c/max*4)):0;
        col+='<span class="heat-cell l'+lvl+'"'+Tip(d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})+' — '+(c?plural(c,'series','series'):'no activity'))+'></span>';
        if(i===0&&d.getMonth()!==lastMonth){mlabel=d.toLocaleDateString(undefined,{month:'short'});lastMonth=d.getMonth();}
      }
      d.setDate(d.getDate()+1);
    }
    col+='</div>';h+=col;monthsRow+='<span>'+E(mlabel)+'</span>';
  }
  h+='</div></div><div class="heat-foot"><div class="heat-months">'+monthsRow+'</div><div class="heat-legend">Less<span class="heat-cell l0"></span><span class="heat-cell l1"></span><span class="heat-cell l2"></span><span class="heat-cell l3"></span><span class="heat-cell l4"></span>More</div></div>';
  return h;
}
