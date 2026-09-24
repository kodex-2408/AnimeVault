/* AnimeVault renderer — domain helpers (ported logic; behavior unchanged unless noted). */
function isManga(){return S.vaultMode==='manga';}
function malStatusOptions(){return isManga()
  ?[['reading',watchingLabel()],['completed','Completed'],['on_hold','On Hold'],['dropped','Dropped'],['plan_to_read',planLabel()]]
  :[['watching',watchingLabel()],['completed','Completed'],['on_hold','On Hold'],['dropped','Dropped'],['plan_to_watch',planLabel()]];}
function VM(animeLabel,mangaLabel){return isManga()?mangaLabel:animeLabel;}
function parseEpisodeNumber(filename){
  var base=filename.replace(/\.[^.]+$/,'');
  var cleaned=base.replace(/\b(?:Season\s*\d{1,2}|S\d{1,2})\b/gi,'');
  cleaned=cleaned.replace(/\s*[\[\(]\s*(?:19|20)\d{2}\s*[\]\)]\s*/g,'');
  cleaned=cleaned.replace(/\s+/g,' ').trim();
  // Pattern 1: S01E05
  var m=cleaned.match(/S\d{1,2}E(\d{1,3})/i);
  if(m)return parseInt(m[1]);
  // Pattern 2: Episode 05, EP 05
  m=cleaned.match(/Episode\s+(\d{1,3})/i);
  if(m)return parseInt(m[1]);
  m=cleaned.match(/\bEP?\s*(\d{1,3})\b/i);
  if(m)return parseInt(m[1]);
  // Pattern 3: - 05 (dash-separated)
  m=cleaned.match(/-\s*(\d{1,3})(?:v\d)?(?:\s*(?:\[|\(|\.|$))/);
  if(m)return parseInt(m[1]);
  // Pattern 3a: NUMBER - resolution ("Title 05 - 1080p")
  m=cleaned.match(/(?:^|[\s._-])(\d{1,3})(?:v\d)?\s*[-–—]\s*\d{3,4}[pk]\b/i);
  if(m)return parseInt(m[1]);
  // Pattern 3b: NUMBER - text (number followed by dash then non-digit)
  m=cleaned.match(/(\d{1,3})\s*[-–—]\s*\D/);
  if(m)return parseInt(m[1]);
  // Pattern 4: rightmost standalone number not followed by dash
  var candidates=[];
  var p4regex=/\s+(\d{1,3})(?:v\d)?(?=\s|$|\[|\(|\.)/g;
  var p4m;
  while((p4m=p4regex.exec(cleaned))!==null){
    var rest=cleaned.slice(p4regex.lastIndex);
    if(!/^\s*[-–—]/.test(rest)) candidates.push(parseInt(p4m[1]));
  }
  if(candidates.length)return candidates[candidates.length-1];
  // Fallback: number at end
  m=cleaned.match(/\b(\d{1,3})\s*$/);
  if(m)return parseInt(m[1]);
  return null;
}
function parseChapterNumber(filename){
  var base=filename.replace(/\.[^.]+$/,'');
  var m=base.match(/(?:Ch(?:apter)?[.\s]*(\d{1,4})|Ch\s*(\d{1,4})|C\s*(\d{1,4})|#(\d{1,4})|-\s*(\d{1,4})(?:v\d)?\s*[\[\(\.\s]|\s+(\d{1,4})(?:v\d)?\s*[\[\(\.\s])/i);
  if(m)return parseInt(m[1]||m[2]||m[3]||m[4]||m[5]||m[6]);
  m=base.match(/\b(\d{1,4})\s*$/);
  if(m)return parseInt(m[1]);
  return null;
}
function notifEnabled(key){
  var np=S.cfg.notificationPrefs||{};
  return np[key]!==false;
}
function importInboxKey(){return isManga()?'mangaImportInbox':'animeImportInbox';}
function aliasModeMap(){
  if(!S.cfg.titleAliases||typeof S.cfg.titleAliases!=='object')S.cfg.titleAliases={anime:{},manga:{}};
  var mode=isManga()?'manga':'anime';
  if(!S.cfg.titleAliases[mode])S.cfg.titleAliases[mode]={};
  return S.cfg.titleAliases[mode];
}
function aliasFor(name,provider){
  var row=aliasModeMap()[name]||{};
  return String(row[provider]||row.canonical||name||'').trim()||name;
}
function pendingForStorage(item){
  return {
    series:item.series,files:(item.files||[]).map(function(f){return {name:f.name,newName:f.newName,originalPath:f.originalPath,isFolder:!!f.isFolder,fileCount:f.fileCount||0,file:f.file,series:f.series};}),
    fromLibrary:!!item.fromLibrary,category:item.category||'custom',sourceFolder:item.sourceFolder||'',autoTrack:!!item.autoTrack,
    selectedMalId:item.selectedMalId||null,malMatches:Array.isArray(item.malMatches)?item.malMatches.slice(0,5):null,addedAt:item.addedAt||Date.now()
  };
}
function normalizeMalSearchResults(resp){
  var rows=(resp&&resp.data!==undefined)?resp.data:resp;
  if(!Array.isArray(rows))rows=[];
  return rows.map(function(x){return x&&x.node?x.node:x;}).filter(function(x){return x&&x.id&&x.title;});
}
function normalizeMatchTitle(value){return String(value||'').toLowerCase().replace(/\b(?:season|part|cour)\s*\d+\b/g,' ').replace(/\bs\d+\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim();}
function explicitSeasonNumber(value){var s=String(value||'');var m=s.match(/\bS(?:eason)?\s*(\d{1,2})\b/i)||s.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+Season\b/i);if(m)return parseInt(m[1],10);var roman=s.match(/\b(II|III|IV|V|VI)\b/i);if(roman)return {II:2,III:3,IV:4,V:5,VI:6}[roman[1].toUpperCase()]||0;return 0;}
function titleMatchConfidence(a,b){
  a=normalizeMatchTitle(a);b=normalizeMatchTitle(b);if(!a||!b)return 0;if(a===b)return 100;
  var aw=a.split(/\s+/),bw=b.split(/\s+/),aset={};aw.forEach(function(w){if(w.length>1)aset[w]=1;});
  var common=0,total=Object.keys(aset).length;var seen={};bw.forEach(function(w){if(w.length>1&&!seen[w]){seen[w]=1;if(aset[w])common++;else total++;}});
  var token=total?common/total:0;var prefix=(a.startsWith(b)||b.startsWith(a)) ? .18 : 0;return Math.max(0,Math.min(100,Math.round((token+prefix)*100)));
}
function pendingMalMeta(n){
  var parts=[];
  if(n.media_type)parts.push(String(n.media_type).replace(/_/g,' '));
  var count=n.num_episodes||n.num_chapters;
  if(count)parts.push(count+' '+epLabel().toLowerCase());
  parts.push('★ '+(n.mean||'N/A'));
  return parts.join(' · ');
}
function selectedPendingMalMatch(item){
  if(!item||!item.selectedMalId||!item.malMatches)return null;
  return item.malMatches.find(function(n){return String(n.id)===String(item.selectedMalId);})||null;
}
function pendingSeriesKey(item){
  return (item&&item.series?String(item.series):'').toLowerCase();
}
function importReviewKey(){
  return isManga()?'mangaImportReviewDismissed':'animeImportReviewDismissed';
}
function knownSeriesKey(){
  return isManga()?'mangaKnownSeries':'animeKnownSeries';
}
function isImportReviewDismissed(name){
  var list=S.cfg[importReviewKey()]||[];
  return list.indexOf(name)>=0;
}
function markImportReviewDismissed(name){
  var key=importReviewKey();
  var list=S.cfg[key]||[];
  if(list.indexOf(name)<0)list.push(name);
  S.cfg[key]=list;
  api.setConfig(key,list);
}
function malListStatusUsable(ls){
  if(!ls||typeof ls!=='object')return false;
  return !!(ls.status||ls.score!=null||ls.num_episodes_watched!=null||ls.num_watched_episodes!=null||ls.num_chapters_read!=null);
}
function getMyListStatus(md){
  if(!md)return null;
  if(md.my_list_status&&typeof md.my_list_status==='object')return md.my_list_status;
  // Legacy flat list-status shape only: require a list-specific field so that
  // plain MAL anime objects (media .status like "finished_airing", .mean) are
  // never mistaken for the user's list status.
  if(!(md.score!=null||md.num_episodes_watched!=null||md.num_watched_episodes!=null||md.num_chapters_read!=null))return null;
  return {
    status:md.status,
    score:md.score,
    num_episodes_watched:md.num_episodes_watched!=null?md.num_episodes_watched:(md.num_watched_episodes!=null?md.num_watched_episodes:0),
    num_chapters_read:md.num_chapters_read
  };
}
// Common label shortcuts
function epLabel(){return VM('Ep','Ch');}
function epLabelFull(){return VM('Episodes','Chapters');}
function watchingLabel(){return VM('Watching','Reading');}
function planLabel(){return VM('Plan to Watch','Plan to Read');}
function watchedLabel(){return VM('watched','read');}
function epWatchedField(ls){return isManga()?(ls.num_chapters_read||0):(ls.num_episodes_watched||0);}
function totalField(a){var t=isManga()?(a.num_chapters||0):(a.num_episodes||0);if(!t&&a.status==='currently_airing'&&a.start_date){t=estimateAired(a.start_date,0);}return t||0;}
function getCats(){
  var folderOrder=(isManga()?(S.cfg.mangaFolders||[]):(S.cfg.folders||[])).map(function(f){return f.type}).filter(function(v,i,a){return a.indexOf(v)===i});
  var cats=new Set();S.lib.forEach(function(s){if(!s.name.startsWith('__unsorted'))cats.add(s.category)});
  var libCats=Array.from(cats);
  var ordered=[];
  folderOrder.forEach(function(fc){if(libCats.indexOf(fc)>=0&&ordered.indexOf(fc)<0)ordered.push(fc)});
  libCats.forEach(function(c){if(ordered.indexOf(c)<0)ordered.push(c)});
  return ordered;
}
function nxtUn(s){var w=new Set(s.watchData&&s.watchData.episodesWatched||[]);return s.episodes.find(function(e){return e.episodeNum!==null&&!w.has(e.episodeNum)})}
function isTitleSimilar(a,b){
  a=a.toLowerCase().replace(/[^a-z0-9\s]/g,'').trim();
  b=b.toLowerCase().replace(/[^a-z0-9\s]/g,'').trim();
  if(a===b)return true;
  if(a.includes(b)||b.includes(a))return true;
  var aw=a.split(/\s+/),bw=new Set(b.split(/\s+/)),com=0;
  aw.forEach(function(w){if(bw.has(w))com++});
  return com/Math.max(aw.length,bw.size)>=0.5;
}
function normalizeNyaaSearchTitle(value){
  return String(value||'').normalize('NFKC')
    .replace(/\b([a-z]{3,}?)(sama|san|chan|kun)\b/gi,'$1 $2')
    .replace(/[\u2010-\u2015:!?;~._'"()\/\\-]+/g,' ')
    .replace(/\s+/g,' ').trim();
}
function nyaaSearchAnchor(value){
  var noise={a:1,an:1,and:1,the:1,of:1,in:1,on:1,to:1,for:1,with:1,wa:1,no:1,ni:1,ga:1,de:1,desu:1,wo:1,o:1,season:1,cour:1,part:1};
  var roman={i:1,ii:1,iii:1,iv:1,v:1,vi:1,vii:1,viii:1,ix:1,x:1,xi:1,xii:1};
  var base=normalizeNyaaSearchTitle(value).toLowerCase().split(/\s+/).filter(function(w){return w&&!noise[w];});
  var words=base.filter(function(w){
    return !roman[w]&&!/^s\d{1,2}$/.test(w)&&!/^\d{1,2}$/.test(w)&&!/^\d{1,2}(st|nd|rd|th)$/.test(w);
  });
  if(!words.length)words=base;
  if(!words.length)return normalizeNyaaSearchTitle(value);
  if(/^\d+$/.test(words[0]))return words[0];
  return words[0].length>=5?words[0]:words.slice(0,2).join(' ');
}
function compactNyaaBrowserQuery(seriesTitle,uploader){
  var anchor=nyaaSearchAnchor(seriesTitle);
  if(uploader==='erai')return 'erai hevc '+anchor;
  if(uploader==='subsplease')return 'subsplease '+anchor;
  if(uploader==='judas')return 'judas hevc '+anchor;
  if(uploader==='varyg')return 'varyg hevc '+anchor;
  return anchor;
}
function buildNyaaUrl(seriesTitle,epNum){
  seriesTitle=aliasFor(seriesTitle,'nyaa');
  var cat=isManga()?'3_1':'1_2';
  var uploader=S.cfg.nyaaUploader||'erai';
  var quality=S.cfg.nyaaQuality||'1080p';
  seriesTitle=normalizeNyaaSearchTitle(seriesTitle)||seriesTitle;
  var q='';
  if(isManga()){
    q=seriesTitle;
  } else {
    q=compactNyaaBrowserQuery(seriesTitle,uploader);
  }
  return 'https://nyaa.si/?f=0&c='+cat+'&q='+encodeURIComponent(q)+'&s=id&o=desc';
}
function getCurrentSeason(){var m=new Date().getMonth();if(m<3)return{season:'winter',year:new Date().getFullYear()};if(m<6)return{season:'spring',year:new Date().getFullYear()};if(m<9)return{season:'summer',year:new Date().getFullYear()};return{season:'fall',year:new Date().getFullYear()};}
function _isDonghua(a){
  if(!a)return false;
  var studios=a.studios||[];
  for(var i=0;i<studios.length;i++){
    var sn=(studios[i].name||'').toLowerCase();
    for(var j=0;j<_cnStudios.length;j++){if(sn.indexOf(_cnStudios[j])>=0)return true;}
  }
  var title=a.title||'';
  var cjkCount=0;for(var k=0;k<title.length;k++){var code=title.charCodeAt(k);if(code>=0x4E00&&code<=0x9FFF)cjkCount++;}
  if(title.length>0&&cjkCount/title.length>0.5)return true;
  return false;
}
function _filterDonghua(items){
  if(S.cfg.hideDonghua===false)return items;
  return items.filter(function(a){return !_isDonghua(a)});
}
function estimateAired(startDate,total){
  if(!startDate)return total||0;
  var start=new Date(startDate);var now=new Date();
  var weeks=Math.floor((now-start)/(7*24*3600000))+1;
  if(total&&weeks>total)return total;
  return Math.max(1,weeks);
}
function getLocalBroadcast(broadcastOrDay, maybeTime){
  if(!broadcastOrDay)return null;
  var dayName='', timeStr='';
  if(typeof broadcastOrDay==='object'&&broadcastOrDay!==null){
    dayName=String(broadcastOrDay.day_of_the_week||'').toLowerCase().trim();
    timeStr=String(broadcastOrDay.start_time||'').trim();
  }else{
    dayName=String(broadcastOrDay||'').toLowerCase().trim();
    timeStr=String(maybeTime||'').trim();
  }
  var days=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  var dayIdx=days.indexOf(dayName);
  if(dayIdx<0)return null;

  var jstHours=0, jstMinutes=0;
  if(timeStr){
    var parts=timeStr.split(':');
    jstHours=parseInt(parts[0],10)||0;
    jstMinutes=parseInt(parts[1],10)||0;
  }

  // Use reference Sunday Jan 4, 2026 in JST (UTC+9)
  var refDay=4+dayIdx;
  var refDayStr=refDay<10?'0'+refDay:''+refDay;
  var hh=jstHours<10?'0'+jstHours:''+jstHours;
  var mm=jstMinutes<10?'0'+jstMinutes:''+jstMinutes;

  var jstDate=new Date('2026-01-'+refDayStr+'T'+hh+':'+mm+':00+09:00');
  var localDayIdx=jstDate.getDay();
  var localDay=days[localDayIdx];
  var localHours=jstDate.getHours();
  var localMins=jstDate.getMinutes();
  var pad=function(n){return n<10?'0'+n:''+n};
  var time24=pad(localHours)+':'+pad(localMins);
  var period=localHours>=12?'PM':'AM';
  var h12=localHours%12||12;
  var time12=h12+':'+pad(localMins)+' '+period;

  return {
    day: localDay,
    time24: time24,
    time12: time12,
    localDayIdx: localDayIdx,
    originalJstDay: dayName,
    originalJstTime: timeStr
  };
}
function calcNextBroadcast(broadcastOrDay, maybeTime){
  var local=getLocalBroadcast(broadcastOrDay, maybeTime);
  if(!local)return '';
  var now=new Date();
  var currentDayIdx=now.getDay();
  var diffDays=(local.localDayIdx-currentDayIdx+7)%7;
  if(diffDays===0){
    var curMins=now.getHours()*60+now.getMinutes();
    var airMins=parseInt(local.time24.split(':')[0],10)*60+parseInt(local.time24.split(':')[1],10);
    if(curMins>airMins+180)return 'Aired Today';
    return 'Today '+local.time12;
  }
  if(diffDays===1)return 'Tomorrow '+local.time12;
  var dayShorts=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return dayShorts[local.localDayIdx]+' '+local.time12;
}
function getMalStatus(s){var md=s.watchData&&s.watchData.malData;var mls=getMyListStatus(md);return mls?mls.status:null;}
function gapModeMap(){if(!S.cfg.gapRules||typeof S.cfg.gapRules!=='object')S.cfg.gapRules={anime:{},manga:{}};var mode=isManga()?'manga':'anime';if(!S.cfg.gapRules[mode])S.cfg.gapRules[mode]={};return S.cfg.gapRules[mode];}
function parseGapNumberList(value){var out=[];String(value||'').split(',').forEach(function(part){part=part.trim();var m=part.match(/^(\d+)\s*-\s*(\d+)$/);if(m){var a=parseInt(m[1],10),b=parseInt(m[2],10);for(var n=Math.min(a,b);n<=Math.max(a,b)&&out.length<500;n++)out.push(n);}else if(/^\d+$/.test(part))out.push(parseInt(part,10));});return out.filter(function(n,i,a){return a.indexOf(n)===i});}
function expectedGapEnd(s,nums){
  var md=s.watchData&&s.watchData.malData||{};var total=isManga()?(md.num_chapters||0):(md.num_episodes||0);var localMax=nums.length?Math.max.apply(null,nums):0;
  var tracked=(S._autoDownloadWatchlist||[]).find(function(w){return w.seriesName===s.name||Number(w.malId)===Number(s.watchData&&s.watchData.malId)});
  var verified=tracked&&Number(tracked.verifiedLatest)||0;
  if(md.status==='finished_airing'||md.status==='finished')return Math.max(localMax,total||0);
  if(md.status==='currently_airing'&&!isManga())return Math.max(localMax,verified||estimateAired(md.start_date,total||0));
  return Math.max(localMax,verified);
}
function analyzeEpisodeGapsV2(s){
  var numbered={};(s.episodes||[]).forEach(function(ep){var n=Number(ep.episodeNum);if(isFinite(n))numbered[n]=true;});
  var nums=Object.keys(numbered).map(Number).filter(function(n){return isFinite(n)&&Math.floor(n)===n}).sort(function(a,b){return a-b});if(!nums.length)return {missing:[],start:1,end:0,expected:0};
  var rule=gapModeMap()[s.name]||{};var min=nums[0];var start=Number(rule.start)||((min>12)?min:1);var end=expectedGapEnd(s,nums);var ignored=new Set((rule.ignore||[]).map(Number));var missing=[];
  if(end-start>500)start=min;
  for(var n=Math.max(1,Math.floor(start));n<=Math.floor(end);n++){if(!numbered[n]&&!ignored.has(n))missing.push(n);}
  if(missing.length>Math.max(nums.length*3,60))missing=[];
  return {missing:missing,start:start,end:end,expected:end,ignored:Array.from(ignored)};
}
function _hcAnalyzeSeries(s){
  var eps=s.episodes||[];
  var numbered={},orphans=[];
  eps.forEach(function(ep){
    if(ep.episodeNum===null||ep.episodeNum===undefined||isNaN(ep.episodeNum)){orphans.push(ep);return;}
    var key=ep.episodeNum;(numbered[key]=numbered[key]||[]).push(ep);
  });
  // Duplicates
  var dups=[];
  Object.keys(numbered).forEach(function(k){if(numbered[k].length>1)dups.push({num:parseFloat(k),files:numbered[k]});});
  // Missing (only if we have enough signal — at least two numbered eps and a reasonable range)
  var nums=Object.keys(numbered).map(parseFloat).filter(function(n){return !isNaN(n)});
  var missing=[];
  if(nums.length>=2){
    var min=Math.min.apply(null,nums),max=Math.max.apply(null,nums);
    // Only whole-number gaps — don't flag fractional chapter numbers as missing.
    for(var n=Math.floor(min);n<=Math.ceil(max);n++){
      if(!numbered[n]&&!numbered[n+'.0']&&!numbered[String(n)])missing.push(n);
    }
    // Sanity: if too many "missing" relative to total, this is probably a
    // movies/special folder — don't pollute the report.
    if(missing.length>nums.length*2)missing=[];
  }
  return {missing:missing,duplicates:dups,orphans:orphans};
}
function _syncHealthAnalyze(){
  var all=(S.lib||[]).filter(function(s){return !s.name.startsWith('__unsorted')});
  var linked=[],unlinked=[],missingData=[],conflicts=[],invalid=[],suspicious=[];
  all.forEach(function(s){
    var wd=s.watchData||{};
    if(!wd.malId){unlinked.push(s);return;}
    linked.push(s);
    if(!/^\d+$/.test(String(wd.malId)))invalid.push(s);
    if(!wd.malData)missingData.push(s);
    else{
      var md=wd.malData;
      if(!malListStatusUsable(md.my_list_status))missingData.push(s);
      var localTitle=aliasFor(s.name,'mal');var titles=[md.title,md.alternative_titles&&md.alternative_titles.en,md.alternative_titles&&md.alternative_titles.ja].filter(Boolean);
      var confidence=0;titles.forEach(function(t){confidence=Math.max(confidence,titleMatchConfidence(localTitle,t));});
      var reasons=[];if(confidence<45)reasons.push('title similarity is only '+confidence+'%');
      var localSeason=explicitSeasonNumber(localTitle),malSeason=explicitSeasonNumber(md.title);if(localSeason&&malSeason&&localSeason!==malSeason)reasons.push('season differs ('+localSeason+' vs '+malSeason+')');
      var folderYear=String(s.name).match(/\b((?:19|20)\d{2})\b/),malYear=md.start_date&&String(md.start_date).match(/^(\d{4})/);
      if(folderYear&&malYear&&Math.abs(parseInt(folderYear[1],10)-parseInt(malYear[1],10))>1)reasons.push('year differs ('+folderYear[1]+' vs '+malYear[1]+')');
      var localNums=(s.episodes||[]).map(function(ep){return Number(ep.episodeNum)}).filter(function(n){return isFinite(n)});var localMax=localNums.length?Math.max.apply(null,localNums):0;
      var expected=isManga()?(md.num_chapters||0):(md.num_episodes||0);if(expected&&localMax>expected+3)reasons.push('local numbering exceeds MAL total '+expected);
      if(reasons.length)suspicious.push({series:s,confidence:confidence,reasons:reasons,malTitle:md.title||'Unknown'});
    }
    var local=(wd.episodesWatched||[]).length;
    var ml=getMyListStatus(wd.malData)||{};
    var remote=epWatchedField(ml);
    if(remote>local)conflicts.push({series:s,type:'remote_ahead',local:local,remote:remote});
    else if(local>remote&&remote>0)conflicts.push({series:s,type:'local_ahead',local:local,remote:remote});
  });
  suspicious.sort(function(a,b){return a.confidence-b.confidence});
  return {all:all,linked:linked,unlinked:unlinked,missingData:missingData,conflicts:conflicts,invalid:invalid,suspicious:suspicious};
}
function _palFuzzy(query,candidate){
  if(!query)return 0;
  var q=query.toLowerCase(),c=(candidate||'').toLowerCase();
  if(!c)return -Infinity;
  if(c===q)return 1000;
  if(c.indexOf(q)===0)return 800;                    // prefix match
  if(c.indexOf(q)>=0)return 500-c.indexOf(q);        // substring
  // Fall through to char-by-char subsequence scoring
  var qi=0,score=0,prevMatchIdx=-2;
  for(var ci=0;ci<c.length&&qi<q.length;ci++){
    var ch=c.charAt(ci);
    var isBoundary=ci===0||' _-.[](){}'.indexOf(c.charAt(ci-1))>=0;
    if(ch===q.charAt(qi)){
      score+=1;
      if(ci===prevMatchIdx+1)score+=3;               // consecutive
      if(isBoundary)score+=4;                         // word-start
      prevMatchIdx=ci;
      qi++;
    }
  }
  if(qi<q.length)return -Infinity;                   // query didn't fully match
  // Penalize long strings so shorter candidates rank higher when scores tie.
  return score-Math.min(c.length/40,4);
}
function formatLumaMarkdown(raw){
  if(!raw)return '';
  var s=E(raw);
  // Code blocks: ```lang ... ```
  s=s.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g,function(_,lang,code){return '<pre class="md-pre"><code>'+code.trim()+'</code></pre>';});
  // Inline code: `code`
  s=s.replace(/`([^`\n]+)`/g,'<code class="md-code">$1</code>');
  // Headers
  s=s.replace(/^###\s+(.+)$/gm,'<div class="md-h md-h3">$1</div>');
  s=s.replace(/^##\s+(.+)$/gm,'<div class="md-h md-h2">$1</div>');
  s=s.replace(/^#\s+(.+)$/gm,'<div class="md-h md-h1">$1</div>');
  // Horizontal rules
  s=s.replace(/^(?:---|\*\*\*|___)\s*$/gm,'<hr class="md-hr">');
  // Bold & Italic
  s=s.replace(/\*\*\*([^\*\n]+)\*\*\*/g,'<strong><em>$1</em></strong>');
  s=s.replace(/___([^_\n]+)___/g,'<strong><em>$1</em></strong>');
  // Bold
  s=s.replace(/\*\*([^\*\n]+)\*\*/g,'<strong>$1</strong>');
  s=s.replace(/__([^_\n]+)__/g,'<strong>$1</strong>');
  // Italic
  s=s.replace(/\*([^\*\n]+)\*/g,'<em>$1</em>');
  s=s.replace(/(?:^|\s)_([^_\n]+)_(?=\s|$)/g,' <em>$1</em>');
  // Strikethrough
  s=s.replace(/~~([^~\n]+)~~/g,'<del>$1</del>');
  // Bullet lists
  s=s.replace(/^[ \t]*[-*•][ \t]+(.+)$/gm,'<div class="md-li"><span class="md-mark">•</span><span>$1</span></div>');
  // Numbered lists
  s=s.replace(/^[ \t]*(\d+)\.[ \t]+(.+)$/gm,'<div class="md-li"><span class="md-mark num">$1.</span><span>$2</span></div>');
  // Paragraphs & newlines
  s=s.replace(/\n\n+/g,'<div class="md-gap"></div>');
  s=s.replace(/\n/g,'<br>');
  return s;
}
function stripThinkingTags(str){
  if(!str)return '';
  var s=str.replace(/<(?:think|thought|reasoning)>[\s\S]*?<\/(?:think|thought|reasoning)>/gi,'');
  s=s.replace(/<(?:think|thought|reasoning)>[\s\S]*$/gi,'');
  return s;
}
function buildAiSystem(){
  var lines=[];
  var list=S.lib.filter(function(s){return !s.name.startsWith('__unsorted');}).slice(0,60);
  list.forEach(function(s){
    var wd=s.watchData||{};
    var watched=(wd.episodesWatched||[]).length;
    var score=wd.malData&&wd.malData.mean?(' · MAL '+wd.malData.mean):'';
    lines.push('- '+s.name+' ('+(s.category||'custom')+') - '+watched+'/'+(s.episodeCount||0)+' '+(isManga()?'ch':'ep')+score);
  });
  return 'You are Luma, the cute, enthusiastic star companion and anime library assistant for AnimeVault!'
    +' Personality: Cheerful, friendly, smart, and anime-savvy. You sprinkle star and cute expressions naturally (★, (｡•̀ᴗ-)✧, ✨, 🌟).'
    +' Answer clearly and concisely with short paragraphs or bullet points.'
    +' You have direct capabilities in the app and can trigger navigation and actions by including these exact tags in your reply when helpful:'
    +' [action:download|Exact Series Title] (search and download episodes from Nyaa torrents)'
    +' [action:detail|Exact Series Title] (view series details and episode list)'
    +' [action:autodl|check] (run auto-download scan for currently airing watchlist)'
    +' [action:organize|files] (open file management & folder organizer)'
    +' [action:rescan|library] (rescan library folders for newly added episodes)'
    +' [action:sync|mal] (sync watching progress with MyAnimeList)'
    +' [action:nav|schedule] (open airing schedule calendar)'
    +' [action:nav|explore] (open explore & discovery)'
    +' [action:nav|hub] (open download hub & background activity)'
    +' [action:nav|stats] (open stats dashboard)'
    +' App Settings Navigation — use these to direct users to any setting or preferences in the app:'
    +' [action:nav|settings|player] (VLC/MPV player selection, bundled MPV, playback auto-mark %)'
    +' [action:nav|settings|subtitles] (Primary and fallback subtitle language selection)'
    +' [action:nav|settings|nyaa] (Nyaa quality, preferred uploader like Erai/SubsPlease/Judas, HEVC preference)'
    +' [action:nav|settings|autodl] (Auto-download toggles, poll interval, catch-up batch limit)'
    +' [action:nav|settings|folders] (Library folders and paths)'
    +' [action:nav|settings|manga] (Manga folders and reader application)'
    +' [action:nav|settings|notifications] (Toast and tray notification preferences)'
    +' [action:nav|settings|appearance] (Full themes, pearl accent, dark and light modes)'
    +' [action:nav|settings|sync] (MyAnimeList connection and synchronization)'
    +' [action:nav|settings|performance] (Performance mode, animation smoothness, incremental indexing)'
    +' [action:nav|settings|tray] (Minimize to system tray)'
    +' [action:nav|settings|luma] (Luma mascot settings, companion size, speed, sparkles)'
    +' [action:nav|settings|backup] (Backup app data, restore, export JSON/CSV, AniList import)'
    +' [action:nav|settings|parser] (Filename parser preview and title aliases)'
    +(lines.length?(' User library (up to 60 items):\n'+lines.join('\n')):' User library is currently empty.');
}
function exfFilterResults(items){var ef=S.exFilter||{genres:[],types:[],minScore:0,status:''};return items.filter(function(a){if(ef.genres.length){var ag=(a.genres||[]).map(function(g){return g.name||g});if(!ef.genres.some(function(g){return ag.indexOf(g)>=0}))return false;}if(ef.types.length){if(ef.types.indexOf(a.media_type||'')<0)return false;}if(ef.minScore>0){if(!a.mean||a.mean<ef.minScore)return false;}if(ef.status){if((a.status||'')!==ef.status)return false;}return true;});}
function _statsMonthKey(iso){return iso?String(iso).substring(0,7):'';}
function filt(list){var f=list.slice();if(S.q){var q=S.q.toLowerCase();f=f.filter(function(s){return s.name.toLowerCase().includes(q)})}
  if(S.filter==='watching')f=f.filter(function(s){var ml=getMyListStatus(s.watchData&&s.watchData.malData);if(ml)return ml.status==='watching'||ml.status==='reading';var w=s.watchData&&s.watchData.episodesWatched;return w&&w.length>0&&w.length<s.episodeCount});
  else if(S.filter==='completed')f=f.filter(function(s){var ml=getMyListStatus(s.watchData&&s.watchData.malData);if(ml)return ml.status==='completed';var w=s.watchData&&s.watchData.episodesWatched;return w&&s.episodeCount>0&&w.length>=s.episodeCount});
  else if(S.filter==='plan_to_watch')f=f.filter(function(s){var ml=getMyListStatus(s.watchData&&s.watchData.malData);if(ml)return ml.status==='plan_to_watch'||ml.status==='plan_to_read';return !s.watchData||!s.watchData.episodesWatched||!s.watchData.episodesWatched.length});
  else if(S.filter==='on_hold')f=f.filter(function(s){var ml=getMyListStatus(s.watchData&&s.watchData.malData);return ml&&ml.status==='on_hold'});
  else if(S.filter==='dropped')f=f.filter(function(s){var ml=getMyListStatus(s.watchData&&s.watchData.malData);return ml&&ml.status==='dropped'});
  if(S.catFilter!=='all')f=f.filter(function(s){return s.category===S.catFilter});
  // Advanced search filters (Batch B F8)
  var sf=S.searchFilters||{};
  if(sf.status&&sf.status!=='all')f=f.filter(function(s){var ml=getMyListStatus(s.watchData&&s.watchData.malData);return ml&&ml.status===sf.status});
  if(sf.type&&sf.type!=='all')f=f.filter(function(s){var ml=s.watchData&&s.watchData.malData&&s.watchData.malData.media_type;return ml&&ml===sf.type});
  if(sf.minScore>0)f=f.filter(function(s){var ml=s.watchData&&s.watchData.malData&&s.watchData.malData.mean;return ml&&ml>=sf.minScore});
  if(sf.maxScore<10)f=f.filter(function(s){var ml=s.watchData&&s.watchData.malData&&s.watchData.malData.mean;return ml&&ml<=sf.maxScore});
  if(sf.genres&&sf.genres.length)f=f.filter(function(s){var g=(s.watchData&&s.watchData.malData&&s.watchData.malData.genres)||[];return sf.genres.some(function(gf){return g.some(function(gg){return(gg.name||'')===gf})})});
  if(sf.yearMin>0)f=f.filter(function(s){var sd=s.watchData&&s.watchData.malData&&s.watchData.malData.start_date;var y=sd?parseInt(sd.substring(0,4)):0;return y>=sf.yearMin});
  if(sf.yearMax<9999)f=f.filter(function(s){var sd=s.watchData&&s.watchData.malData&&s.watchData.malData.start_date;var y=sd?parseInt(sd.substring(0,4)):0;return y>0&&y<=sf.yearMax});
  if(sf.season)f=f.filter(function(s){var sd=s.watchData&&s.watchData.malData&&s.watchData.malData.start_date;var sy=sd?parseInt(sd.substring(0,4)):0;var sm=sd?parseInt(sd.substring(5,7)):0;var ssn=(sm>=1&&sm<=3)?'winter':(sm>=4&&sm<=6)?'spring':(sm>=7&&sm<=9)?'summer':(sm>=10&&sm<=12)?'fall':'';return ssn===sf.season&&sy>0});
  var sortFn=_SORT_FNS[S.librarySort]||_SORT_FNS.name;
  return f.sort(sortFn)}
var _SORT_FNS={
  name:function(a,b){return a.name.localeCompare(b.name)},
  lastWatched:function(a,b){return((b.watchData&&b.watchData.lastWatched)||'').localeCompare((a.watchData&&a.watchData.lastWatched)||'')},
  episodeCount:function(a,b){return(b.episodeCount||0)-(a.episodeCount||0)||a.name.localeCompare(b.name)},
  score:function(a,b){var as=a.watchData&&a.watchData.malData&&a.watchData.malData.mean||0;var bs=b.watchData&&b.watchData.malData&&b.watchData.malData.mean||0;return bs-as||a.name.localeCompare(b.name)},
  progress:function(a,b){var ap=a.episodeCount>0?((a.watchData&&a.watchData.episodesWatched||[]).length/a.episodeCount):0;var bp=b.episodeCount>0?((b.watchData&&b.watchData.episodesWatched||[]).length/b.episodeCount):0;return bp-ap||a.name.localeCompare(b.name)}
};
var _LIB_SORT_LABELS={name:'Name',lastWatched:'Last Watched',episodeCount:'Episodes',score:'Score',progress:'Progress'};
var _cnStudios=['bilibili','haoliners','emon','colored-pencil','b.cmay','shanghai','tencent','iqiyi','youku','cg year','creative power','sparkly key','nice boat','shenying','china film','enlight','foch','pb animation','alpha group','xing yi kai chen','wolf smoke','big firebird','l2 studio','calf studio','high energy studio','studio liu','garden culture','dc impression vision','ruo hong culture','original force','nanjing'];
var EXF_GENRES=['Action','Adventure','Comedy','Drama','Fantasy','Horror','Mystery','Romance','Sci-Fi','Slice of Life','Sports','Supernatural','Thriller','Ecchi','Mecha','Music','Psychological','Historical','Isekai','Martial Arts','Military','School','Shounen','Shoujo','Seinen','Josei','Harem','Magic'];
var EXF_TYPES_ANIME=[{v:'tv',l:'TV Series'},{v:'movie',l:'Movie'},{v:'ova',l:'OVA'},{v:'ona',l:'ONA'},{v:'special',l:'Special'}];
var EXF_TYPES_MANGA=[{v:'manga',l:'Manga'},{v:'novel',l:'Novel'},{v:'one_shot',l:'One Shot'},{v:'manhwa',l:'Manhwa'},{v:'manhua',l:'Manhua'},{v:'doujinshi',l:'Doujinshi'}];
var EXF_TYPES=EXF_TYPES_ANIME;// alias, replaced at runtime by isManga()
var EXF_SCORES=[{v:9,l:'9+ Masterpiece'},{v:8,l:'8+ Great'},{v:7,l:'7+ Good'},{v:6,l:'6+ Decent'}];
var EXF_STATUSES_ANIME=[{v:'currently_airing',l:'Airing'},{v:'finished_airing',l:'Finished'},{v:'not_yet_aired',l:'Upcoming'}];
var EXF_STATUSES_MANGA=[{v:'currently_publishing',l:'Publishing'},{v:'finished',l:'Finished'},{v:'not_yet_published',l:'Upcoming'}];
var EXF_STATUSES=EXF_STATUSES_ANIME;// alias
