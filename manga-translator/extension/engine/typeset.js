// Tsundoku - manga lettering for the reader's Translate tool.
//
// The model is good at reading and translating but poor at saying exactly
// where text is, so placement never depends on its coordinates alone:
//   1. detect()   finds the speech balloons on the page from its pixels: white
//                 areas enclosed by an outline, with dark text inside.
//   2. annotate() numbers them on a copy of the page; the model answers
//                 "balloon 3 says ..." (and gives boxes only for text that is
//                 not in a numbered balloon).
//   3. render()   erases the original text inside each balloon and letters the
//                 translation into the balloon's own shape: lines follow its
//                 curve, words are never split, and the type is as large as
//                 fits, within a size that suits the page.
// Everything works on ImageData, so the result is drawn into the page image
// itself and follows zoom, fit and every reading mode.
var TS=(function(){
  var WHITE=200;          // a balloon's paper (0-255 grey)
  var INK=110;            // text strokes
  var FONT='"Comic Neue","Comic Sans MS","Segoe Print",sans-serif';

  function toGray(d,n){
    var g=new Uint8Array(n);
    for(var i=0,j=0;i<n;i++,j+=4)g[i]=(d[j]*77+d[j+1]*150+d[j+2]*29)>>8;
    return g;
  }
  // Binary erosion with a (2r+1) square (out of the page counts as white).
  function erode(m,W,H,r){
    var t=new Uint8Array(W*H),o=new Uint8Array(W*H),pre=new Int32Array(Math.max(W,H)+1),k,x,y,a,b;
    for(y=0;y<H;y++){
      var row=y*W;pre[0]=0;for(x=0;x<W;x++)pre[x+1]=pre[x]+m[row+x];
      for(x=0;x<W;x++){a=Math.max(0,x-r);b=Math.min(W,x+r+1);t[row+x]=(pre[b]-pre[a]===b-a)?1:0;}
    }
    for(x=0;x<W;x++){
      pre[0]=0;for(y=0;y<H;y++)pre[y+1]=pre[y]+t[y*W+x];
      for(y=0;y<H;y++){a=Math.max(0,y-r);b=Math.min(H,y+r+1);o[y*W+x]=(pre[b]-pre[a]===b-a)?1:0;}
    }
    return o;
  }

  // Connected white areas. The white mask is eroded first so thin leaks (a gap
  // in a balloon's outline, a tail touching the gutter) do not merge areas,
  // then each area grows back over the original white by the same radius.
  function label(white,W,H,r){
    var N=W*H,er=r>0?erode(white,W,H,r):white,lab=new Int32Array(N),stack=new Int32Array(N),n=0,i,p,sp;
    for(i=0;i<N;i++){
      if(!er[i]||lab[i])continue;
      n++;sp=0;stack[sp++]=i;lab[i]=n;
      while(sp){p=stack[--sp];var x=p%W;
        if(x>0&&er[p-1]&&!lab[p-1]){lab[p-1]=n;stack[sp++]=p-1;}
        if(x<W-1&&er[p+1]&&!lab[p+1]){lab[p+1]=n;stack[sp++]=p+1;}
        if(p>=W&&er[p-W]&&!lab[p-W]){lab[p-W]=n;stack[sp++]=p-W;}
        if(p<N-W&&er[p+W]&&!lab[p+W]){lab[p+W]=n;stack[sp++]=p+W;}}
    }
    if(r>0){
      var q=new Int32Array(N),dist=new Uint8Array(N),qh=0,qt=0;
      for(i=0;i<N;i++)if(lab[i])q[qt++]=i;
      while(qh<qt){p=q[qh++];if(dist[p]>r)continue;var px=p%W,nb=[px>0?p-1:-1,px<W-1?p+1:-1,p>=W?p-W:-1,p<N-W?p+W:-1];
        for(var k=0;k<4;k++){var c=nb[k];if(c>=0&&white[c]&&!lab[c]){lab[c]=lab[p];dist[c]=dist[p]+1;q[qt++]=c;}}}
    }
    return {lab:lab,count:n};
  }

  // A white area as a region: its pixels (1), the holes it encloses (2: the
  // text), its bounding box and the centre of the filled shape.
  function regionOf(L,g,W,H,c,st){
    var x0=st.x0[c],y0=st.y0[c],x1=st.x1[c],y1=st.y1[c],bw=x1-x0+1,bh=y1-y0+1,lab=L.lab;
    var fill=new Uint8Array(bw*bh),q=new Int32Array(bw*bh),qt=0,qh=0,x,y,i;
    for(y=0;y<bh;y++)for(x=0;x<bw;x++)if(lab[(y0+y)*W+x0+x]===c)fill[y*bw+x]=1;
    // outside: reached from the box edge without crossing the area
    var out=new Uint8Array(bw*bh);
    function seed(i){if(!fill[i]&&!out[i]){out[i]=1;q[qt++]=i;}}
    for(x=0;x<bw;x++){seed(x);seed((bh-1)*bw+x);}
    for(y=0;y<bh;y++){seed(y*bw);seed(y*bw+bw-1);}
    while(qh<qt){i=q[qh++];x=i%bw;
      if(x>0)seed(i-1);if(x<bw-1)seed(i+1);if(i>=bw)seed(i-bw);if(i<bw*(bh-1))seed(i+bw);}
    // how much of the area's edge is dark: a balloon has an outline (looked
    // for a few pixels out, past the outline's anti-aliased fringe)
    var edge=0,dark=0,reachOut=Math.max(2,Math.round(Math.min(W,H)/300));
    function darkFrom(gx,gy,dx,dy){for(var t=1;t<=reachOut;t++){var px=gx+dx*t,py=gy+dy*t;if(px<0||py<0||px>=W||py>=H)return false;if(g[py*W+px]<150)return true;if(lab[py*W+px]===c)return false;}return false;}
    for(y=0;y<bh;y++)for(x=0;x<bw;x++){i=y*bw+x;if(fill[i]!==1)continue;var gx=x0+x,gy=y0+y;
      if(x===0||!fill[i-1]&&out[i-1]){edge++;if(darkFrom(gx,gy,-1,0))dark++;}
      if(x===bw-1||!fill[i+1]&&out[i+1]){edge++;if(darkFrom(gx,gy,1,0))dark++;}
      if(y===0||!fill[i-bw]&&out[i-bw]){edge++;if(darkFrom(gx,gy,0,-1))dark++;}
      if(y===bh-1||!fill[i+bw]&&out[i+bw]){edge++;if(darkFrom(gx,gy,0,1))dark++;}}
    var holes=0,ink=0,sx=0,sy=0,filled=0;
    for(y=0;y<bh;y++)for(x=0;x<bw;x++){i=y*bw+x;
      if(!fill[i]&&!out[i]){fill[i]=2;holes++;if(g[(y0+y)*W+x0+x]<INK)ink++;}
      if(fill[i]){filled++;sx+=x;sy+=y;}}
    return {lab:c,x0:x0,y0:y0,x1:x1,y1:y1,w:bw,h:bh,fill:fill,area:st.area[c],holes:holes,ink:ink,filled:filled,outline:dark/Math.max(1,edge),
      cx:x0+sx/Math.max(1,filled),cy:y0+sy/Math.max(1,filled),touches:x0===0||y0===0||x1===W-1||y1===H-1};
  }
  // Blobs inside the holes: text is many small ones, a drawing a few large ones.
  function holeBlobs(R){
    var f=R.fill,w=R.w,h=R.h,seen=new Uint8Array(w*h),st=new Int32Array(w*h),count=0,max=0;
    for(var i=0;i<w*h;i++){if(f[i]!==2||seen[i])continue;count++;var sp=0,a=0;st[sp++]=i;seen[i]=1;
      while(sp){var p=st[--sp];a++;var x=p%w;
        if(x>0&&f[p-1]===2&&!seen[p-1]){seen[p-1]=1;st[sp++]=p-1;}
        if(x<w-1&&f[p+1]===2&&!seen[p+1]){seen[p+1]=1;st[sp++]=p+1;}
        if(p>=w&&f[p-w]===2&&!seen[p-w]){seen[p-w]=1;st[sp++]=p-w;}
        if(p<w*(h-1)&&f[p+w]===2&&!seen[p+w]){seen[p+w]=1;st[sp++]=p+w;}}
      if(a>max)max=a;}
    return {count:count,max:max};
  }
  // Why a white area is not a balloon ('' when it is one).
  function notBalloon(R,W,H){
    var N=W*H,minSide=Math.min(W,H);
    if(R.area<N*0.0012||R.filled>N*0.2)return 'size';
    if(R.w<minSide*0.03||R.h<minSide*0.03)return 'thin';
    if(R.filled/(R.w*R.h)<0.66)return 'shape';          // balloons fill their box
    if(R.outline<0.75)return 'outline';                 // and are drawn with an outline
    var hr=R.holes/R.filled;
    if(hr<0.012||hr>0.55)return 'text amount';          // some text, not mostly drawing
    if(R.ink<R.filled*0.006)return 'ink';
    var b=holeBlobs(R);
    return b.count>=2&&b.max<=R.filled*0.3?'':'blobs';
  }

  function stats(L,W,H){
    var n=L.count+1,x0=new Int32Array(n).fill(W),y0=new Int32Array(n).fill(H),x1=new Int32Array(n).fill(-1),y1=new Int32Array(n).fill(-1),area=new Int32Array(n),lab=L.lab;
    for(var y=0,i=0;y<H;y++)for(var x=0;x<W;x++,i++){var c=lab[i];if(!c)continue;area[c]++;
      if(x<x0[c])x0[c]=x;if(x>x1[c])x1[c]=x;if(y<y0[c])y0[c]=y;if(y>y1[c])y1[c]=y;}
    return {x0:x0,y0:y0,x1:x1,y1:y1,area:area};
  }

  // Finds the balloons. Region ids run in reading order (right to left,
  // top to bottom, in rough rows).
  function detect(img,opts){
    var rejected=[];
    var W=img.width,H=img.height,N=W*H,g=toGray(img.data,N),white=new Uint8Array(N);
    for(var i=0;i<N;i++)white[i]=g[i]>=WHITE?1:0;
    var r=Math.max(1,Math.round(Math.min(W,H)/450));
    var L=label(white,W,H,r),st=stats(L,W,H),regions=[];
    for(var c=1;c<=L.count;c++){
      if(st.area[c]<N*0.0012||st.area[c]>N*0.2)continue;
      var R=regionOf(L,g,W,H,c,st),why=notBalloon(R,W,H);
      if(!why)regions.push(R);
      else if(opts&&opts.debug)rejected.push({box:[R.x0,R.y0,R.x1,R.y1],why:why,outline:+R.outline.toFixed(2),holes:+(R.holes/R.filled).toFixed(3),fill:+(R.filled/(R.w*R.h)).toFixed(2)});
    }
    var band=H*0.1;
    regions.sort(function(a,b){var ra=Math.floor(a.y0/band),rb=Math.floor(b.y0/band);return ra!==rb?ra-rb:b.x1-a.x1;});
    regions.forEach(function(R,k){R.id=k+1;});
    return {W:W,H:H,gray:g,L:L,st:st,regions:regions,rejected:rejected};
  }


  // ------------------------------------------------ with the text detector --
  // The detector (renderer/textdetect.js) says where the letters are; this turns
  // its blocks into units, one per balloon (or per lobe of joined balloons):
  //   balloon - text inside a closed white area: the whole inside is repainted
  //             and the translation fills its shape;
  //   open    - text on white that runs off into the margin or a plain panel:
  //             only the part around the text is used;
  //   art     - text over the drawing: only the letters are covered and the
  //             translation gets a halo in the background colour.
  var STROKE=110;           // stroke map value (0-255) that counts as a letter

  // Chamfer (3-4) distance to the mask's edge, inside the mask.
  function distIn(m,w,h){
    var d=new Float32Array(w*h),x,y,i,INF=1e9;
    for(i=0;i<w*h;i++)d[i]=m[i]?INF:0;
    for(y=0;y<h;y++)for(x=0;x<w;x++){i=y*w+x;if(!d[i])continue;var v=d[i];
      v=Math.min(v,x>0?d[i-1]+3:3,y>0?d[i-w]+3:3,x>0&&y>0?d[i-w-1]+4:4,x<w-1&&y>0?d[i-w+1]+4:4);d[i]=v;}
    for(y=h-1;y>=0;y--)for(x=w-1;x>=0;x--){i=y*w+x;if(!d[i])continue;var u=d[i];
      u=Math.min(u,x<w-1?d[i+1]+3:3,y<h-1?d[i+w]+3:3,x<w-1&&y<h-1?d[i+w+1]+4:4,x>0&&y<h-1?d[i+w-1]+4:4);d[i]=u;}
    for(i=0;i<w*h;i++)d[i]/=3;
    return d;
  }
  // Labels the 4-connected parts of a mask; returns {lab, sizes}.
  function parts(m,w,h){
    var lab=new Int32Array(w*h),st=new Int32Array(w*h),sizes=[0];
    for(var s=0;s<w*h;s++){if(!m[s]||lab[s])continue;var id=sizes.length,sp=0,n=0;st[sp++]=s;lab[s]=id;
      while(sp){var p=st[--sp];n++;var x=p%w;
        if(x>0&&m[p-1]&&!lab[p-1]){lab[p-1]=id;st[sp++]=p-1;}if(x<w-1&&m[p+1]&&!lab[p+1]){lab[p+1]=id;st[sp++]=p+1;}
        if(p>=w&&m[p-w]&&!lab[p-w]){lab[p-w]=id;st[sp++]=p-w;}if(p<w*(h-1)&&m[p+w]&&!lab[p+w]){lab[p+w]=id;st[sp++]=p+w;}}
      sizes.push(n);}
    return {lab:lab,sizes:sizes};
  }
  // Grows labelled seeds through the mask (multi-source BFS): each pixel goes to
  // the seed it is closest to inside the shape.
  function grow(seedLab,m,w,h){
    var out=Int32Array.from(seedLab),q=new Int32Array(w*h),qh=0,qt=0,i;
    for(i=0;i<w*h;i++)if(out[i])q[qt++]=i;
    while(qh<qt){i=q[qh++];var x=i%w,nb=[x>0?i-1:-1,x<w-1?i+1:-1,i>=w?i-w:-1,i<w*(h-1)?i+w:-1];
      for(var k=0;k<4;k++){var c=nb[k];if(c>=0&&m[c]&&!out[c]){out[c]=out[i];q[qt++]=c;}}}
    return out;
  }
  // Joined balloons: the shape thins out between its lobes. Cut it at the
  // lowest distance level where it falls apart into two or more cores that each
  // hold a fair share of the text; every pixel then joins its nearest core.
  // Returns a part label per pixel (1..n), or null for a single balloon.
  function splitLobes(m,w,h,isText){
    var d=distIn(m,w,h),max=0,i,total=0;
    for(i=0;i<w*h;i++){if(d[i]>max)max=d[i];if(isText[i])total++;}
    if(max<4||total<20)return null;
    var fracs=[0.3,0.4,0.5,0.6,0.7];
    for(var f=0;f<fracs.length;f++){
      var t=max*fracs[f],core=new Uint8Array(w*h);
      for(i=0;i<w*h;i++)core[i]=d[i]>t?1:0;
      var P=parts(core,w,h);if(P.sizes.length<3)continue;
      var big=Math.max.apply(null,P.sizes);
      var seed=new Int32Array(w*h);for(i=0;i<w*h;i++)if(P.lab[i]&&P.sizes[P.lab[i]]>=big*0.12)seed[i]=P.lab[i];
      var lab=grow(seed,m,w,h),count={};
      for(i=0;i<w*h;i++)if(isText[i]&&lab[i])count[lab[i]]=(count[lab[i]]||0)+1;
      var good=Object.keys(count).filter(function(k){return count[k]>=Math.max(30,total*0.12);});
      if(good.length<2)continue;
      // parts without much text join their neighbours
      var keep=new Int32Array(w*h),map={};good.forEach(function(k,j){map[k]=j+1;});
      for(i=0;i<w*h;i++)if(lab[i]&&map[lab[i]])keep[i]=map[lab[i]];
      return {lab:grow(keep,m,w,h),n:good.length};
    }
    return splitByText(m,w,h,isText,total);
  }
  // Splits, then splits each part again (three balloons run together).
  function splitDeep(m,w,h,isText,depth){
    var r=splitLobes(m,w,h,isText);
    if(!r||depth<=1)return r;
    var out=new Int32Array(w*h),n=0,i;
    for(var k=1;k<=r.n;k++){
      var sm=new Uint8Array(w*h),st=new Uint8Array(w*h);
      for(i=0;i<w*h;i++)if(r.lab[i]===k){sm[i]=1;if(isText[i])st[i]=1;}
      var sub=splitDeep(sm,w,h,st,depth-1);
      if(!sub){n++;for(i=0;i<w*h;i++)if(sm[i])out[i]=n;}
      else{for(var j=1;j<=sub.n;j++){n++;for(i=0;i<w*h;i++)if(sm[i]&&sub.lab[i]===j)out[i]=n;}}
    }
    return {lab:out,n:n};
  }
  // Second chance: the text itself falls into groups more than about a
  // character apart (two lines of dialogue in joined balloons whose lobes don't
  // pinch, like a round balloon run into a jagged one). Each group gets the
  // part of the shape nearest to it.
  function splitByText(m,w,h,isText,total){
    var P=parts(isText,w,h),sz=[],i;
    for(i=1;i<P.sizes.length;i++)if(P.sizes[i]>=6){
      var x1=w,y1=h,x2=0,y2=0;for(var j=0;j<w*h;j++)if(P.lab[j]===i){var x=j%w,y=j/w|0;if(x<x1)x1=x;if(x>x2)x2=x;if(y<y1)y1=y;if(y>y2)y2=y;}
      sz.push(Math.max(x2-x1+1,y2-y1+1));}
    if(sz.length<3)return null;
    sz.sort(function(a,b){return a-b;});
    var ch=sz[Math.floor(sz.length*0.75)],gap=Math.max(3,Math.round(ch*0.55));
    var G=parts(dilateBits(isText,w,h,gap),w,h),count={};
    for(i=0;i<w*h;i++)if(isText[i]&&G.lab[i])count[G.lab[i]]=(count[G.lab[i]]||0)+1;
    var good=Object.keys(count).filter(function(k){return count[k]>=Math.max(30,total*0.12);});
    if(good.length<2)return null;
    var seed=new Int32Array(w*h),map={};good.forEach(function(k,j){map[k]=j+1;});
    for(i=0;i<w*h;i++)if(isText[i]&&map[G.lab[i]])seed[i]=map[G.lab[i]];
    return {lab:grow(seed,m,w,h),n:good.length};
  }
  function dilateBits(bits,w,h,r){
    var inv=new Uint8Array(w*h),i;for(i=0;i<w*h;i++)inv[i]=bits[i]?0:1;
    var e=erode(inv,w,h,r);for(i=0;i<w*h;i++)inv[i]=e[i]?0:1;return inv;
  }
  // Keeps the parts of a mask that reach into a rectangle (local coordinates)
  // and are at least a quarter the size of the largest such part.
  function keepTouching(m,w,h,rx1,ry1,rx2,ry2){
    var P=parts(m,w,h),hit={},x,y,big=0;
    rx1=Math.max(0,rx1|0);ry1=Math.max(0,ry1|0);rx2=Math.min(w-1,rx2|0);ry2=Math.min(h-1,ry2|0);
    for(y=ry1;y<=ry2;y++)for(x=rx1;x<=rx2;x++){var l=P.lab[y*w+x];if(l){hit[l]=1;if(P.sizes[l]>big)big=P.sizes[l];}}
    var out=new Uint8Array(w*h);for(var i=0;i<w*h;i++){var k=P.lab[i];if(k&&hit[k]&&P.sizes[k]>=big*0.25)out[i]=1;}
    return out;
  }

  // Splits scattered letters into compact clusters (rain of sound effects
  // across a margin, separate signs): groups more than about a character apart.
  function clusters(pts,W){
    if(pts.length<60)return [pts];
    var x1=1e9,y1=1e9,x2=-1,y2=-1;pts.forEach(function(p){var x=p%W,y=p/W|0;if(x<x1)x1=x;if(x>x2)x2=x;if(y<y1)y1=y;if(y>y2)y2=y;});
    var w=x2-x1+1,h=y2-y1+1,m=new Uint8Array(w*h);pts.forEach(function(p){m[((p/W|0)-y1)*w+p%W-x1]=1;});
    var P=parts(m,w,h),sz=[];
    for(var i=1;i<P.sizes.length;i++)if(P.sizes[i]>=6){var bx1=w,by1=h,bx2=0,by2=0;for(var j=0;j<w*h;j++)if(P.lab[j]===i){var x=j%w,y=j/w|0;if(x<bx1)bx1=x;if(x>bx2)bx2=x;if(y<by1)by1=y;if(y>by2)by2=y;}sz.push(Math.max(bx2-bx1+1,by2-by1+1));}
    if(!sz.length)return [pts];
    sz.sort(function(a,b){return a-b;});
    var gap=Math.max(3,Math.round(sz[Math.floor(sz.length*0.75)]*0.55)),G=parts(dilateBits(m,w,h,gap),w,h),out={};
    pts.forEach(function(p){var l=G.lab[((p/W|0)-y1)*w+p%W-x1];(out[l]=out[l]||[]).push(p);});
    return Object.keys(out).map(function(k){return out[k];});
  }

  // How big the original characters are: the 75th percentile of the letters'
  // connected pieces (kana break into several, kanji mostly hold together).
  function charSize(pts,W){
    if(pts.length<20)return 0;
    var x1=1e9,y1=1e9,x2=-1,y2=-1;pts.forEach(function(p){var x=p%W,y=p/W|0;if(x<x1)x1=x;if(x>x2)x2=x;if(y<y1)y1=y;if(y>y2)y2=y;});
    var w=x2-x1+1,h=y2-y1+1,m=new Uint8Array(w*h);pts.forEach(function(p){m[((p/W|0)-y1)*w+p%W-x1]=1;});
    var P=parts(m,w,h),bx={};
    for(var i=0;i<w*h;i++){var l=P.lab[i];if(!l||P.sizes[l]<8)continue;var x=i%w,y=i/w|0,b=bx[l]||(bx[l]=[x,y,x,y]);if(x<b[0])b[0]=x;if(y<b[1])b[1]=y;if(x>b[2])b[2]=x;if(y>b[3])b[3]=y;}
    var sz=Object.keys(bx).map(function(k){var b=bx[k];return Math.max(b[2]-b[0]+1,b[3]-b[1]+1);}).sort(function(a,b){return a-b;});
    return sz.length?sz[Math.floor(sz.length*0.75)]:0;
  }

  function plan(img,td,opts){
    opts=opts||{};
    var W=img.width,H=img.height,N=W*H,g=toGray(img.data,N),white=new Uint8Array(N),i,x,y;
    for(i=0;i<N;i++)white[i]=g[i]>=WHITE?1:0;
    var L=label(white,W,H,Math.max(1,Math.round(Math.min(W,H)/450))),st=stats(L,W,H),lab=L.lab,S=td.strokes;
    var regionCache={},units=[];
    function regionFor(c){if(!regionCache[c])regionCache[c]=regionOf(L,g,W,H,c,st);return regionCache[c];}
    // 1. letters, by the white area that holds them
    var groups={},near=Math.max(3,Math.round(Math.min(W,H)/250));
    td.boxes.forEach(function(b,bi){
      var x1=Math.max(0,Math.floor(b.x1)-2),y1=Math.max(0,Math.floor(b.y1)-2),x2=Math.min(W-1,Math.ceil(b.x2)+2),y2=Math.min(H-1,Math.ceil(b.y2)+2);
      var counts={};
      for(y=y1;y<=y2;y++)for(x=x1;x<=x2;x++){var c=lab[y*W+x];if(c)counts[c]=(counts[c]||0)+1;}
      var cands=Object.keys(counts).filter(function(c){return counts[c]>=(x2-x1+1)*(y2-y1+1)*0.04&&st.area[c]<=N*0.45;}).map(Number);
      for(y=y1;y<=y2;y++)for(x=x1;x<=x2;x++){var p=y*W+x;if(S[p]<STROKE)continue;
        var owner=0;
        for(var k=0;k<cands.length&&!owner;k++){var R=regionFor(cands[k]);var lx=x-R.x0,ly=y-R.y0;if(lx>=0&&ly>=0&&lx<R.w&&ly<R.h&&R.fill[ly*R.w+lx])owner=cands[k];}
        if(!owner){ // touching the outline: the white area right next to it
          for(var r=1;r<=near&&!owner;r++){var xs=[x-r,x+r,x,x],ys=[y,y,y-r,y+r];for(var q=0;q<4;q++){var xx=xs[q],yy=ys[q];if(xx<0||yy<0||xx>=W||yy>=H)continue;var cc=lab[yy*W+xx];if(cc&&cands.indexOf(cc)>=0){owner=cc;break;}}}
        }
        var key=owner?'w'+owner:'a'+bi;
        (groups[key]=groups[key]||{owner:owner,box:bi,pts:[]}).pts.push(p);
      }
    });
    // 2. each group becomes one or more units
    var pending=Object.keys(groups);
    for(var pi=0;pi<pending.length;pi++)(function(key){
      var gp=groups[key];
      if(gp.pts.length<25)return;                                  // specks
      var tb=bounds(gp.pts,W);
      if(!gp.owner){clusters(gp.pts,W).forEach(function(c){if(c.length>=25)units.push(artUnit(bounds(c,W),c));});return;}
      var R=regionFor(gp.owner),tw=tb.x2-tb.x1+1,th=tb.y2-tb.y1+1;
      var closed=R.w<=tw*3.2+40&&R.h<=th*3.2+40&&R.filled<=tw*th*15&&R.filled/(R.w*R.h)>=0.3&&!(R.touches&&R.filled>N*0.05);
      var mask,mx,my,mw,mh;
      if(closed){mask=new Uint8Array(R.w*R.h);for(i=0;i<mask.length;i++)mask[i]=R.fill[i]?1:0;mx=R.x0;my=R.y0;mw=R.w;mh=R.h;}
      else{
        // the white runs on: cut thin necks, keep what reaches the text
        var m2=Math.round(Math.max(tw,th)*0.6)+8;mx=Math.max(R.x0,tb.x1-m2);my=Math.max(R.y0,tb.y1-m2);mw=Math.min(R.x1,tb.x2+m2)-mx+1;mh=Math.min(R.y1,tb.y2+m2)-my+1;
        mask=new Uint8Array(mw*mh);
        for(y=0;y<mh;y++)for(x=0;x<mw;x++){var lx2=mx+x-R.x0,ly2=my+y-R.y0;if(R.fill[ly2*R.w+lx2])mask[y*mw+x]=1;}
        var rr=Math.max(3,Math.round(Math.min(tw,th)*0.06));
        mask=keepTouching(dilateBits(erode(mask,mw,mh,rr),mw,mh,rr),mw,mh,tb.x1-mx,tb.y1-my,tb.x2-mx,tb.y2-my);
        var leaks=false;for(y=0;y<mh&&!leaks;y++)for(x=0;x<mw;x++){if(!mask[y*mw+x])continue;if((x===0&&mx>0)||(y===0&&my>0)||(x===mw-1&&mx+mw<W)||(y===mh-1&&my+mh<H)){leaks=true;break;}}
        if(leaks&&!gp.split){ // scattered letters on open white: one unit per cluster
          var cl=clusters(gp.pts,W);
          if(cl.length>1){cl.forEach(function(c,ci){if(c.length>=25){groups[key+'_'+ci]={owner:gp.owner,box:gp.box,pts:c,split:true};pending.push(key+'_'+ci);}});return;}
        }
        if(leaks){ // still open: only around the text
          var cm=Math.round(Math.max(tw,th)*0.12)+3;
          for(y=0;y<mh;y++)for(x=0;x<mw;x++){var gx=mx+x,gy=my+y;if(gx<tb.x1-cm||gx>tb.x2+cm||gy<tb.y1-cm||gy>tb.y2+cm)mask[y*mw+x]=0;}
        }
        closed=!leaks;
      }
      // the letters join the shape (holes, and letters touching the outline)
      var isText=new Uint8Array(mw*mh);
      gp.pts.forEach(function(p){var px=p%W-mx,py=(p/W|0)-my;if(px>=0&&py>=0&&px<mw&&py<mh){isText[py*mw+px]=1;mask[py*mw+px]=1;}});
      var lobes=closed?splitDeep(mask,mw,mh,isText,3):null;
      var n=lobes?lobes.n:1;
      for(var li=1;li<=n;li++){
        var um=new Uint8Array(mw*mh),pts=[];
        for(i=0;i<mw*mh;i++)if(mask[i]&&(!lobes||lobes.lab[i]===li)){um[i]=1;if(isText[i])pts.push((my+(i/mw|0))*W+mx+i%mw);}
        if(pts.length<25)continue;
        units.push(shapeUnit(closed?'balloon':'open',um,mx,my,mw,mh,pts,bounds(pts,W),img));
      }
    })(pending[pi]);
    // letters crossing a balloon's outline came out as text over the drawing:
    // they belong to the balloon next to them
    units=units.filter(function(a){
      if(a.kind!=='art')return true;
      var best=null,bn=0,pad=near*2;
      units.forEach(function(u){if(!u.fill)return;var n=0;
        if(!u._near)u._near=dilateBits(u.fill,u.w,u.h,pad);
        a.pts.forEach(function(p){var x=p%W-u.x0,y=(p/W|0)-u.y0;if(x>=0&&y>=0&&x<u.w&&y<u.h&&u._near[y*u.w+x])n++;});
        if(n>bn){bn=n;best=u;}});
      if(!best||bn<a.pts.length*0.3)return true;
      best.pts=best.pts.concat(a.pts);best.tb=bounds(best.pts,W);
      return false;
    });
    // reading order: rows from the top, right to left (manga)
    units.forEach(function(u){delete u._near;u.ch=charSize(u.pts,W);});
    var band=H*0.08;
    units.sort(function(a,b){var ra=Math.floor(a.tb.y1/band),rb=Math.floor(b.tb.y1/band);return ra!==rb?ra-rb:b.tb.x2-a.tb.x2;});
    units.forEach(function(u,k){u.id=k+1;});
    return {W:W,H:H,gray:g,strokes:S,units:units,detector:true};

    function bounds(pts,Wd){var a={x1:1e9,y1:1e9,x2:-1,y2:-1};pts.forEach(function(p){var px=p%Wd,py=p/Wd|0;if(px<a.x1)a.x1=px;if(px>a.x2)a.x2=px;if(py<a.y1)a.y1=py;if(py>a.y2)a.y2=py;});return a;}
    function artUnit(tb,pts){return {kind:'art',tb:tb,pts:pts};}
    function shapeUnit(kind,m,mx,my,mw,mh,pts,tb,img){
      var sx=0,sy=0,n=0,rs=[],gs=[],bs=[],d=img.data;
      for(var i=0;i<mw*mh;i++){if(!m[i])continue;var px=mx+i%mw,py=my+(i/mw|0);sx+=px;sy+=py;n++;
        if(n%5===0&&S[py*W+px]<40&&g[py*W+px]>=WHITE){var j=(py*W+px)*4;rs.push(d[j]);gs.push(d[j+1]);bs.push(d[j+2]);}}
      return {kind:kind,tb:tb,pts:pts,x0:mx,y0:my,w:mw,h:mh,fill:m,cx:sx/Math.max(1,n),cy:sy/Math.max(1,n),paper:[median(rs),median(gs),median(bs)]};
    }
  }

  // Without the detector: the balloons detect() finds, as units.
  function planLegacy(img){
    var det=detect(img);
    det.units=det.regions.map(function(R){return {kind:'legacy',R:R,id:R.id,tb:{x1:R.x0,y1:R.y0,x2:R.x1,y2:R.y1}};});
    return det;
  }

  // The page for the model: at most maxEdge pixels, each unit's text outlined
  // in red with its number on a tag at the top-left corner.
  function annotate(source,P,maxEdge){
    var sc=Math.min(1,maxEdge/Math.max(P.W,P.H)),w=Math.round(P.W*sc),h=Math.round(P.H*sc);
    var cv=document.createElement('canvas');cv.width=w;cv.height=h;
    var ctx=cv.getContext('2d');ctx.drawImage(source,0,0,w,h);
    var fs=Math.max(13,Math.round(h*0.017)),lw=Math.max(2,Math.round(h/600));
    ctx.font='700 '+fs+'px sans-serif';ctx.textBaseline='middle';ctx.textAlign='center';
    P.units.forEach(function(u){
      var x=u.tb.x1*sc-3,y=u.tb.y1*sc-3,bw=(u.tb.x2-u.tb.x1+1)*sc+6,bh=(u.tb.y2-u.tb.y1+1)*sc+6;
      ctx.strokeStyle='#e0102e';ctx.lineWidth=lw;ctx.setLineDash([lw*3,lw*2]);ctx.strokeRect(x,y,bw,bh);ctx.setLineDash([]);
      var t=String(u.id),tw=Math.max(fs*1.3,ctx.measureText(t).width+fs*0.6),th=fs*1.25;
      var tx=Math.max(0,x-tw*0.6),ty=Math.max(0,y-th*0.7);
      ctx.fillStyle='#e0102e';ctx.fillRect(tx,ty,tw,th);ctx.fillStyle='#fff';ctx.fillText(t,tx+tw/2,ty+th/2+1);
    });
    return cv;
  }
  // Unit boxes (the text) on the model's 0-1000 scale.
  function regionBoxes(P){
    return P.units.map(function(u){return {id:u.id,x0:Math.round(u.tb.x1/P.W*1000),y0:Math.round(u.tb.y1/P.H*1000),x1:Math.round((u.tb.x2+1)/P.W*1000),y1:Math.round((u.tb.y2+1)/P.H*1000)};});
  }

  // ------------------------------------------------------------ lettering --
  function median(arr){if(!arr.length)return 255;arr.sort(function(a,b){return a-b;});return arr[arr.length>>1];}
  // Paper colour of a region: the median of its own pixels.
  function paperOf(img,R,W){
    var rs=[],gs=[],bs=[],d=img.data,step=Math.max(1,Math.floor(R.w*R.h/4000));
    for(var i=0;i<R.w*R.h;i+=step){if(R.fill[i]!==1)continue;var x=R.x0+i%R.w,y=R.y0+Math.floor(i/R.w),j=(y*W+x)*4;rs.push(d[j]);gs.push(d[j+1]);bs.push(d[j+2]);}
    return [median(rs),median(gs),median(bs)];
  }
  // Convex hull of a mask's set pixels, as a [left, right] interval per row.
  function hullRows(m,w,h){
    var pts=[],x,y;
    for(y=0;y<h;y++){var a=-1,b=-1;for(x=0;x<w;x++)if(m[y*w+x]){if(a<0)a=x;b=x;}if(a>=0){pts.push([a,y]);if(b!==a)pts.push([b,y]);}}
    pts.sort(function(p,q){return p[0]-q[0]||p[1]-q[1];});
    function cross(o,a,b){return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);}
    var lo=[],up=[],i;
    for(i=0;i<pts.length;i++){while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],pts[i])<=0)lo.pop();lo.push(pts[i]);}
    for(i=pts.length-1;i>=0;i--){while(up.length>=2&&cross(up[up.length-2],up[up.length-1],pts[i])<=0)up.pop();up.push(pts[i]);}
    var poly=lo.slice(0,-1).concat(up.slice(0,-1)),L=new Float32Array(h).fill(1e9),Rr=new Float32Array(h).fill(-1e9);
    if(poly.length===1)poly.push(poly[0]);
    for(i=0;i<poly.length;i++){var p=poly[i],q=poly[(i+1)%poly.length],ya=Math.min(p[1],q[1]),yb=Math.max(p[1],q[1]);
      for(y=Math.ceil(ya);y<=Math.floor(yb);y++){
        if(yb===ya){L[y]=Math.min(L[y],p[0],q[0]);Rr[y]=Math.max(Rr[y],p[0],q[0]);continue;}
        var xx=p[0]+(q[0]-p[0])*(y-p[1])/(q[1]-p[1]);if(xx<L[y])L[y]=xx;if(xx>Rr[y])Rr[y]=xx;}}
    return {L:L,R:Rr};
  }
  // Erases the original text, painted in the balloon's own paper colour:
  // the holes; anything inside the balloon's convex outline within a
  // character's reach of them (characters touching the balloon's edge are not
  // holes); off-white speckle near the text; and a 2 px rim, so no
  // anti-aliased edge is left. Works in the region's box widened by `reach`,
  // where white slivers the region lost to erosion (beside a character in a
  // narrow tip) are first given back to it.
  function eraseRegion(img,R,det,reach){
    var W=det.W,H=det.H,G=det.gray,lab=det.L.lab,paper=paperOf(img,R,W),d=img.data;
    var ex0=Math.max(0,R.x0-reach),ey0=Math.max(0,R.y0-reach),ex1=Math.min(W-1,R.x1+reach),ey1=Math.min(H-1,R.y1+reach);
    var w=ex1-ex0+1,h=ey1-ey0+1,n=w*h,m=new Uint8Array(n),x,y,i,k;
    for(y=0;y<R.h;y++)for(x=0;x<R.w;x++){var v=R.fill[y*R.w+x];if(v)m[(R.y0-ey0+y)*w+R.x0-ex0+x]=v;}
    // give back unlabelled white slivers next to the region (not if they run away: a gap in the outline)
    // (a few pixels deep only: a tail or a gap must not carry it into the art)
    var q=new Int32Array(n),depth=new Uint8Array(n),qh=0,qt=0,grown=0,deep=Math.max(3,Math.round(reach/5));
    for(i=0;i<n;i++)if(m[i]===1)q[qt++]=i;
    while(qh<qt){i=q[qh++];if(depth[i]>=deep)continue;x=i%w;
      var nb=[x>0?i-1:-1,x<w-1?i+1:-1,i>=w?i-w:-1,i<n-w?i+w:-1];
      for(k=0;k<4;k++){var c=nb[k];if(c<0||m[c])continue;var gi=(ey0+Math.floor(c/w))*W+ex0+c%w;
        if(G[gi]>=WHITE&&!lab[gi]){m[c]=3;depth[c]=depth[i]+1;grown++;q[qt++]=c;}}}
    if(grown>R.area*0.15)for(i=0;i<n;i++)if(m[i]===3)m[i]=0;
    // the outline is never touched: stay this far inside the hull
    var hull=hullRows(m,w,h),inset=Math.max(2.5,Math.min(W,H)/350);
    var inH=new Uint8Array(n);
    for(y=0;y<h;y++)for(x=0;x<w;x++)if(y>=inset&&y<h-inset&&x>=hull.L[y]+inset&&x<=hull.R[y]-inset)inH[y*w+x]=1;
    // Text: pieces of non-paper inside the hull. A piece fully inside is text;
    // one that touches the edge band is text only if the contact is small and
    // the piece is dense like lettering (a character touching the outline),
    // not a thin line coming in from outside (an outline or a tail).
    var seen=new Uint8Array(n),mark=new Uint8Array(n),stack=new Int32Array(n),piece=[];
    for(var s0=0;s0<n;s0++){
      if(seen[s0]||!inH[s0]||m[s0]===1||m[s0]===3)continue;
      var sp=0,touch=0,bx0=w,by0=h,bx1=0,by1=0,ink=0;piece.length=0;stack[sp++]=s0;seen[s0]=1;
      while(sp){i=stack[--sp];piece.push(i);x=i%w;y=(i/w)|0;
        if(x<bx0)bx0=x;if(x>bx1)bx1=x;if(y<by0)by0=y;if(y>by1)by1=y;
        if(G[(ey0+y)*W+ex0+x]<INK)ink++;
        for(var dy=-1;dy<=1;dy++)for(var dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;var xx=x+dx,yy=y+dy;
          if(xx<0||yy<0||xx>=w||yy>=h){touch++;continue;}
          var c3=yy*w+xx;if(!inH[c3]){touch++;continue;}
          if(seen[c3]||m[c3]===1||m[c3]===3)continue;seen[c3]=1;stack[sp++]=c3;}}
      var cnt=piece.length,dense=cnt/((bx1-bx0+1)*(by1-by0+1));
      var isText=touch===0||(touch<=cnt*0.08&&dense>=0.16&&ink>=cnt*0.15);
      if(isText)for(k=0;k<cnt;k++)mark[piece[k]]=1;
    }
    // off-white speckle and anti-aliasing near the erased text
    var dist=new Int16Array(n).fill(-1);qh=qt=0;
    for(i=0;i<n;i++)if(mark[i]){dist[i]=0;q[qt++]=i;}
    while(qh<qt){i=q[qh++];if(dist[i]>=reach)continue;x=i%w;
      var nb2=[x>0?i-1:-1,x<w-1?i+1:-1,i>=w?i-w:-1,i<n-w?i+w:-1];
      for(k=0;k<4;k++){var c2=nb2[k];if(c2>=0&&dist[c2]<0){dist[c2]=dist[i]+1;q[qt++]=c2;}}}
    var pg=(paper[0]*77+paper[1]*150+paper[2]*29)>>8;
    for(i=0;i<n;i++)if((m[i]===1||m[i]===3)&&dist[i]>=0&&G[(ey0+((i/w)|0))*W+ex0+i%w]<pg-14)mark[i]=1;
    for(k=0;k<2;k++){var next=mark.slice();
      for(y=0;y<h;y++)for(x=0;x<w;x++){i=y*w+x;if(mark[i]||!(m[i]===1||m[i]===3))continue;
        if((x>0&&mark[i-1])||(x<w-1&&mark[i+1])||(y>0&&mark[i-w])||(y<h-1&&mark[i+w]))next[i]=1;}
      mark=next;}
    for(i=0;i<n;i++){if(!mark[i])continue;var j=((ey0+Math.floor(i/w))*W+ex0+i%w)*4;d[j]=paper[0];d[j+1]=paper[1];d[j+2]=paper[2];}
    // the erased area joins the paper for lettering
    for(y=0;y<R.h;y++)for(x=0;x<R.w;x++){var li=(R.y0-ey0+y)*w+R.x0-ex0+x;if((mark[li]||m[li]===3)&&!R.fill[y*R.w+x])R.fill[y*R.w+x]=2;}
    return paper;
  }
  // Usable width on each row: the filled shape shrunk by a margin, as the run
  // around the centre (a tail or a neighbouring lobe never widens a line).
  function rowSpans(R,margin){
    var w=R.w,h=R.h,f=R.fill,inner=new Uint8Array(w*h),x,y;
    for(y=0;y<h;y++)for(x=0;x<w;x++)inner[y*w+x]=f[y*w+x]?1:0;
    var er=erode(inner,w,h,margin);
    // out of the box counts as white in erode(): clear a margin at the edges
    for(y=0;y<h;y++)for(x=0;x<w;x++)if(x<margin||y<margin||x>=w-margin||y>=h-margin)er[y*w+x]=0;
    var cx=Math.round(R.cx-R.x0),L=new Int32Array(h).fill(-1),Rr=new Int32Array(h).fill(-1);
    for(y=0;y<h;y++){var row=y*w;
      var s=Math.max(0,Math.min(w-1,cx));
      if(!er[row+s]){var best=-1,bd=1e9;for(x=0;x<w;x++)if(er[row+x]&&Math.abs(x-cx)<bd){bd=Math.abs(x-cx);best=x;}if(best<0)continue;s=best;}
      var a=s,b=s;while(a>0&&er[row+a-1])a--;while(b<w-1&&er[row+b+1])b++;
      L[y]=R.x0+a;Rr[y]=R.x0+b+1;}
    var top=-1,bot=-1;for(y=0;y<h;y++)if(L[y]>=0){if(top<0)top=y;bot=y;}
    return {band:function(ya,yb){var l=-1e9,r=1e9;ya=Math.floor(ya-R.y0);yb=Math.ceil(yb-R.y0);if(ya<0||yb>=h)return null;
        for(var yy=ya;yy<=yb;yy++){if(L[yy]<0)return null;if(L[yy]>l)l=L[yy];if(Rr[yy]<r)r=Rr[yy];}
        return r>l?[l,r]:null;},
      top:R.y0+Math.max(0,top),bottom:R.y0+Math.max(0,bot)};
  }
  function rectSpans(x0,y0,x1,y1){return {band:function(ya,yb){return ya>=y0-0.5&&yb<=y1+0.5?[x0,x1]:null;},top:y0,bottom:y1};}

  // Words, each with what joins it to the next: a space, or nothing after a
  // hyphen or dash (a line may break there). Chinese, Japanese and Thai have
  // no spaces, so they break between characters.
  function tokens(text){
    text=String(text||'').replace(/\s+/g,' ').trim();
    if(!text)return [];
    if(!/\s/.test(text)&&/[\u0e00-\u0e7f\u3000-\u9fff\uff00-\uffef]/.test(text))return Array.from(text).map(function(c){return {t:c,j:''};});
    var out=[];
    text.split(' ').forEach(function(w){
      var parts=w.split(/(?<=[^\s][-\u2013\u2014\u2026\/])(?=[^\s\-\u2013\u2014\u2026!?.,~])/);
      parts.forEach(function(p,i){out.push({t:p,j:i<parts.length-1?'':' '});});
    });
    return out;
  }
  // Greedy fill of words into lines of the given widths. null if they don't fit.
  function fill(tk,widths,measure){
    var lines=[],k=0,cur='',join='';
    for(var i=0;i<tk.length;i++){
      var wd=tk[i].t,cand=cur?cur+join+wd:wd;
      if(k>=widths.length)return null;
      if(measure(cand)<=widths[k]){cur=cand;join=tk[i].j;continue;}
      if(!cur)return null;                               // one word wider than the line
      lines.push(cur);k++;cur=wd;join=tk[i].j;
      if(k>=widths.length||measure(cur)>widths[k])return null;
    }
    if(cur){if(k>=widths.length)return null;lines.push(cur);}
    return lines;
  }
  // The largest size (up to maxS) at which the text fits the shape in whole
  // words, centred on (cx, cy); lines are then evened out.
  function fit(ctx,text,shape,cx,cy,maxS,minS,italic){
    var tk=tokens(text);if(!tk.length)return null;
    var cache={};
    for(var s=maxS;s>=minS;s-=0.5){
      ctx.font=(italic?'italic ':'')+'700 '+s+'px '+FONT;
      var measure=function(t){var v=cache[s+'|'+t];if(v===undefined)v=cache[s+'|'+t]=ctx.measureText(t).width;return v;};
      var lh=s*1.16,avail=shape.bottom-shape.top,maxN=Math.floor(avail/lh);
      for(var n=1;n<=maxN;n++){
        var top=Math.max(shape.top,Math.min(shape.bottom-n*lh,cy-n*lh/2)),ivs=[],ok=true;
        for(var k=0;k<n;k++){var iv=shape.band(top+k*lh+lh*0.12,top+(k+1)*lh-lh*0.12);if(!iv){ok=false;break;}ivs.push(iv);}
        if(!ok)continue;
        var widths=ivs.map(function(v){return v[1]-v[0];}),lines=fill(tk,widths,measure);
        if(!lines||lines.length<n&&n>1&&fill(tk,widths.slice(0,n-1),measure))continue;
        // even the lines out: the narrowest widths that still need n lines
        for(var f=0.95;f>=0.5;f-=0.05){var l2=fill(tk,widths.map(function(v){return v*f;}),measure);if(!l2||l2.length>lines.length)break;lines=l2;}
        // centre the block on the lines actually used
        var used=lines.length,top2=Math.max(shape.top,Math.min(shape.bottom-used*lh,cy-used*lh/2)),out=[];
        for(k=0;k<used;k++){var iv2=shape.band(top2+k*lh+lh*0.12,top2+(k+1)*lh-lh*0.12)||ivs[k];
          var mid=(iv2[0]+iv2[1])/2,half=(iv2[1]-iv2[0])/2,lw=measure(lines[k]);
          var x=Math.max(iv2[0]+lw/2,Math.min(iv2[1]-lw/2,cx+(mid-cx)*0.7));if(half*2<lw)x=mid;
          out.push({text:lines[k],x:x,y:top2+k*lh+lh/2});}
        return {size:s,lh:lh,lines:out,italic:!!italic};
      }
    }
    return null;
  }
  // Last resort for a word too long for the shape at the smallest size: split it.
  function fitHard(ctx,text,shape,cx,cy,minS){
    ctx.font='700 '+minS+'px '+FONT;
    var parts=[];String(text).split(/\s+/).forEach(function(wd){
      while(wd.length>4&&ctx.measureText(wd).width>Math.max(10,(shape.band(cy-minS/2,cy+minS/2)||[0,minS*6])[1]-(shape.band(cy-minS/2,cy+minS/2)||[0,minS*6])[0])){var cut=Math.ceil(wd.length/2);parts.push(wd.slice(0,cut)+'-');wd=wd.slice(cut);}
      parts.push(wd);});
    return fit(ctx,parts.join(' '),shape,cx,cy,minS,minS-2);
  }
  function draw(ctx,lay,color,outline){
    ctx.font=(lay.italic?'italic ':'')+'700 '+lay.size+'px '+FONT;ctx.textAlign='center';ctx.textBaseline='middle';
    lay.lines.forEach(function(l){
      if(outline){ctx.lineJoin='round';ctx.lineWidth=Math.max(2,lay.size*0.22);ctx.strokeStyle=outline;ctx.strokeText(l.text,l.x,l.y);}
      ctx.fillStyle=color;ctx.fillText(l.text,l.x,l.y);});
  }

  function overlap(a,b){
    var ix=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0)),iy=Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
    var sa=Math.max(1,(a.x1-a.x0)*(a.y1-a.y0)),sb=Math.max(1,(b.x1-b.x0)*(b.y1-b.y0));
    return ix*iy/Math.min(sa,sb);
  }
  // A box the model gave for text outside the numbered balloons: if it sits
  // on a white area holding text (a balloon detect() passed over), letter it
  // like a balloon.
  function regionUnder(det,box,taken){
    var lab=det.L.lab,W=det.W,counts={},best=0,bc=0;
    var x0=Math.max(0,Math.round(box.x0)),x1=Math.min(W-1,Math.round(box.x1)),y0=Math.max(0,Math.round(box.y0)),y1=Math.min(det.H-1,Math.round(box.y1));
    for(var y=y0;y<=y1;y+=2)for(var x=x0;x<=x1;x+=2){var c=lab[y*W+x];if(c){counts[c]=(counts[c]||0)+1;if(counts[c]>best){best=counts[c];bc=c;}}}
    if(!bc||taken[bc])return null;
    var st=det.st,bw=st.x1[bc]-st.x0[bc]+1,bh=st.y1[bc]-st.y0[bc]+1;
    if(bw>(x1-x0+1)*1.8+20||bh>(y1-y0+1)*1.8+20)return null;  // the white runs well past the text: not a balloon
    var R=regionOf(det.L,det.gray,W,det.H,bc,st);
    if(R.holes<R.filled*0.01||R.filled/(R.w*R.h)<0.45)return null;
    return R;
  }

  // Paints the masked pixels by filling in from their edges (each pass takes
  // the average of the known neighbours), so screentone and gradients behind
  // text over the drawing are continued instead of covered by a flat patch.
  function inpaint(img,W,H,pts,r){
    var d=img.data,set={},list=[],i,k;
    pts.forEach(function(p){var px=p%W,py=p/W|0;for(var dy=-r;dy<=r;dy++)for(var dx=-r;dx<=r;dx++){var x=px+dx,y=py+dy;if(x<0||y<0||x>=W||y>=H)continue;var q=y*W+x;if(!set[q]){set[q]=1;list.push(q);}}});
    // On plain paper (a sign, a caption on white) a flat fill in the paper's
    // colour is cleaner than blending in nearby lines.
    var ring=[];list.forEach(function(q){var x=q%W,y=q/W|0;for(var t=0;t<4;t++){var o=t===0?q-r-1:t===1?q+r+1:t===2?q-(r+1)*W:q+(r+1)*W;if(o>=0&&o<W*H&&!set[o])ring.push(o);}});
    if(ring.length){
      var lv=ring.map(function(o){var j=o*4;return (d[j]*77+d[j+1]*150+d[j+2]*29)>>8;}).sort(function(a,b){return a-b;});
      var med=lv[lv.length>>1],light=lv.filter(function(v){return Math.abs(v-med)<24;}).length/lv.length;
      if(med>=200&&light>=0.7){
        var rs=[],gs=[],bs=[];ring.forEach(function(o){var j=o*4;if(Math.abs(((d[j]*77+d[j+1]*150+d[j+2]*29)>>8)-med)<24){rs.push(d[j]);gs.push(d[j+1]);bs.push(d[j+2]);}});
        var pc=[median(rs),median(gs),median(bs)];
        list.forEach(function(q){var j=q*4;d[j]=pc[0];d[j+1]=pc[1];d[j+2]=pc[2];});
        return;
      }
    }
    var known=function(q){return !set[q];};
    for(var pass=0;pass<200&&list.length;pass++){
      var next=[],fills=[];
      for(k=0;k<list.length;k++){var q=list[k],x=q%W,y=q/W|0,rr=0,gg=0,bb=0,c=0;
        var nb=[x>0?q-1:-1,x<W-1?q+1:-1,y>0?q-W:-1,y<H-1?q+W:-1,x>0&&y>0?q-W-1:-1,x<W-1&&y>0?q-W+1:-1,x>0&&y<H-1?q+W-1:-1,x<W-1&&y<H-1?q+W+1:-1];
        for(var t=0;t<8;t++){var o=nb[t];if(o<0||!known(o))continue;var j=o*4;rr+=d[j];gg+=d[j+1];bb+=d[j+2];c++;}
        if(c)fills.push([q,rr/c,gg/c,bb/c]);else next.push(q);}
      fills.forEach(function(f){var j=f[0]*4;d[j]=f[1];d[j+1]=f[2];d[j+2]=f[3];delete set[f[0]];});
      if(!fills.length)break;list=next;
    }
  }
  function lum(c){return (c[0]*77+c[1]*150+c[2]*29)>>8;}

  // Letters the model's items into the page. items: {region, text} for a
  // numbered unit, or {x0,y0,x1,y1 (0-1000), kind, text} for other text.
  function render(ctx,img,P,items,opts){
    opts=opts||{};
    var W=P.W,H=P.H,byId={},taken={},jobs=[],groups={};
    P.units.forEach(function(u){byId[u.id]=u;});
    // opts.scale: the reader's text size preference (1 = as large as fits, up
    // to the page's usual size)
    var sc=opts.scale>0?Math.max(0.5,Math.min(1.5,opts.scale)):1;
    var maxS=Math.max(11,H*0.026)*Math.max(1,sc),minS=Math.max(8,H*0.0105)*Math.min(1,sc);
    function claim(u,text){taken[u.id]=true;if(!groups[u.id])groups[u.id]={u:u,texts:[]};groups[u.id].texts.push(text);}
    function ubox(u){return {x0:u.tb.x1/W*1000,y0:u.tb.y1/H*1000,x1:(u.tb.x2+1)/W*1000,y1:(u.tb.y2+1)/H*1000};}
    var boxed=[];
    (items||[]).forEach(function(it){
      if(!it||!it.text)return;
      var box=it.box||(isFinite(it.x0)&&isFinite(it.x1)?{x0:+it.x0,y0:+it.y0,x1:+it.x1,y1:+it.y1}:null);
      var u=it.region!=null?byId[it.region]:null;
      // a saved answer from a page whose units were numbered differently
      if(u&&box&&overlap(ubox(u),box)<0.5)u=null;
      if(u)claim(u,it.text);else if(box)boxed.push({it:it,box:box});
    });
    // text given as a box: a unit under it (unless already lettered: then it is
    // the same text twice), a balloon the old finder missed, or a box of its own
    boxed.forEach(function(b){
      var bestU=null,bo=0;P.units.forEach(function(u){var o=overlap(ubox(u),b.box);if(o>bo){bo=o;bestU=u;}});
      if(bo>=0.5){if(!taken[bestU.id])claim(bestU,b.it.text);return;}
      var px={x0:b.box.x0/1000*W,y0:b.box.y0/1000*H,x1:b.box.x1/1000*W,y1:b.box.y1/1000*H};
      if(P.L){var R=regionUnder(P,px,taken);if(R){var lu={kind:'legacy',R:R,id:'r'+R.lab,tb:{x1:R.x0,y1:R.y0,x2:R.x1,y2:R.y1}};claim(lu,b.it.text);return;}}
      if(P.strokes){
        // with the detector: the letters inside the box are covered, never a panel
        var pts=[],x0=Math.max(0,Math.floor(px.x0)),x1=Math.min(W-1,Math.ceil(px.x1)),y0=Math.max(0,Math.floor(px.y0)),y1=Math.min(H-1,Math.ceil(px.y1));
        for(var yy=y0;yy<=y1;yy++)for(var xx=x0;xx<=x1;xx++)if(P.strokes[yy*W+xx]>=60)pts.push(yy*W+xx);
        var au={kind:'art',id:'b'+jobs.length+'_'+boxed.indexOf(b),pts:pts,tb:pts.length>=25?{x1:Infinity,y1:Infinity,x2:-1,y2:-1}:{x1:x0,y1:y0,x2:x1,y2:y1}};
        if(pts.length>=25)pts.forEach(function(p){var x=p%W,y=p/W|0;if(x<au.tb.x1)au.tb.x1=x;if(x>au.tb.x2)au.tb.x2=x;if(y<au.tb.y1)au.tb.y1=y;if(y>au.tb.y2)au.tb.y2=y;});
        claim(au,b.it.text);return;
      }
      jobs.push({box:px,item:b.it});
    });
    // erase everything first, then letter (lettering must not be erased by a neighbour)
    var reach=Math.round(H*0.03),list=Object.keys(groups).map(function(k){return groups[k];}),d=img.data;
    list.forEach(function(gp){
      var u=gp.u;
      if(u.kind==='legacy'){u.paper=eraseRegion(img,u.R,P,reach);return;}
      if(u.kind==='art'){
        if(u.pts.length)inpaint(img,W,H,u.pts,Math.max(2,Math.round(Math.min(u.tb.x2-u.tb.x1,u.tb.y2-u.tb.y1)*0.05)));
        u.paper=boxBackground(img,{x0:u.tb.x1,y0:u.tb.y1,x1:u.tb.x2,y1:u.tb.y2},W,H);
        return;
      }
      // balloon / open: the whole shape in the paper colour, letters included
      var pc=u.paper;
      for(var i=0;i<u.w*u.h;i++){if(!u.fill[i])continue;var j=((u.y0+(i/u.w|0))*W+u.x0+i%u.w)*4;d[j]=pc[0];d[j+1]=pc[1];d[j+2]=pc[2];}
      // letters touching the outline (the detector marked them as letters),
      // and their anti-aliased fringe, but never the dark outline next to them
      var isPt={};u.pts.forEach(function(p){isPt[p]=1;});
      u.pts.forEach(function(p){
        var j1=p*4;d[j1]=pc[0];d[j1+1]=pc[1];d[j1+2]=pc[2];
        var px=p%W,py=p/W|0;
        for(var dy=-2;dy<=2;dy++)for(var dx=-2;dx<=2;dx++){var x=px+dx,y=py+dy;if(x<0||y<0||x>=W||y>=H)continue;var q=y*W+x;if(isPt[q])continue;
          var lx=x-u.x0,ly=y-u.y0,inside=lx>=0&&ly>=0&&lx<u.w&&ly<u.h&&u.fill[ly*u.w+lx];
          if(!inside&&P.gray[q]<170)continue;var j2=q*4;d[j2]=pc[0];d[j2+1]=pc[1];d[j2+2]=pc[2];}});
    });
    jobs.forEach(function(j){j.paper=boxBackground(img,j.box,W,H);});
    ctx.putImageData(img,0,0);
    // Each balloon at the largest size that fits, then the page evened out:
    // no balloon more than 1.2x the page's median size, like a letterer would.
    // Shouted text (characters well above the page's usual size) may be
    // lettered bigger, up to most of its original size.
    var chs=P.units.map(function(u){return u.ch||0;}).filter(Boolean).sort(function(a,b){return a-b;}),medCh=chs.length?chs[chs.length>>1]:0;
    list.forEach(function(gp){var u=gp.u;gp.emph=!!(u.ch&&(u.ch*0.8>maxS||(medCh&&u.ch>medCh*1.35)));gp.maxS=gp.emph?Math.min(H*0.05,Math.max(maxS,u.ch*0.8)):maxS;});
    var lays=list.map(function(gp){
      var u=gp.u,text=gp.texts.join(' ');gp.text=text;
      if(u.kind==='art'){gp.shape=null;return null;}
      var S=u.kind==='legacy'?u.R:u,margin=Math.max(2,Math.round(Math.min(S.w,S.h)*0.07));
      var shape=rowSpans(S,margin),mS=Math.min(gp.maxS,(shape.bottom-shape.top)*(gp.emph?0.6:0.45));
      gp.shape=shape;gp.cx=S.cx;gp.cy=S.cy;
      return fit(ctx,text,shape,S.cx,S.cy,Math.max(minS,mS),minS)||fitHard(ctx,text,shape,S.cx,S.cy,minS);
    });
    var sizes=lays.filter(function(l,k){return l&&!list[k].emph;}).map(function(l){return l.size;}).sort(function(a,b){return a-b;});
    var cap=sizes.length>=3?Math.max(minS,sizes[sizes.length>>1]*1.2):Infinity;
    lays.forEach(function(lay,k){
      var gp=list[k],u=gp.u;
      if(u.kind==='art'){letterArt(ctx,gp,maxS,minS,W,H,P);return;}
      if(lay&&lay.size>cap&&!gp.emph)lay=fit(ctx,gp.text,gp.shape,gp.cx,gp.cy,cap,minS)||lay;
      if(lay&&sc<1)lay=fit(ctx,gp.text,gp.shape,gp.cx,gp.cy,Math.max(minS,lay.size*sc),minS)||lay;
      if(lay)draw(ctx,lay,lum(u.paper||[255,255,255])>140?'#111':'#fff');
    });
    jobs.forEach(function(j){letterBox(ctx,j,maxS,minS,W,H);});
    return ctx;
  }
  // Text over the drawing: no balloon to fit, and a vertical Japanese column is
  // far too narrow for a translation, so the area is widened to at least 80% of
  // its height (and a small share of the page), centred on the original. The
  // translation gets a halo in the background colour so it reads over the art.
  // The light area around text outside balloons (a sign, a paper slip, a
  // caption on white), as a shape to letter into; null over busy art.
  function lightArea(P,u){
    var W=P.W,H=P.H,G=P.gray,t=u.tb,tw=t.x2-t.x1+1,th=t.y2-t.y1+1,m=Math.round(Math.max(tw,th)*0.8)+6;
    var x0=Math.max(0,t.x1-m),y0=Math.max(0,t.y1-m),x1=Math.min(W-1,t.x2+m),y1=Math.min(H-1,t.y2+m),w=x1-x0+1,h=y1-y0+1;
    var isPt={};(u.pts||[]).forEach(function(p){isPt[p]=1;});
    var ok=new Uint8Array(w*h),seen=new Uint8Array(w*h),q=new Int32Array(w*h),qh=0,qt=0,i,x,y;
    for(y=0;y<h;y++)for(x=0;x<w;x++){var g=(y0+y)*W+x0+x;if(G[g]>=190||isPt[g])ok[y*w+x]=1;}
    for(y=t.y1-y0;y<=t.y2-y0;y++)for(x=t.x1-x0;x<=t.x2-x0;x++){i=y*w+x;if(ok[i]&&!seen[i]){seen[i]=1;q[qt++]=i;}}
    while(qh<qt){i=q[qh++];x=i%w;var nb=[x>0?i-1:-1,x<w-1?i+1:-1,i>=w?i-w:-1,i<w*(h-1)?i+w:-1];
      for(var k=0;k<4;k++){var c=nb[k];if(c>=0&&ok[c]&&!seen[c]){seen[c]=1;q[qt++]=c;}}}
    // a thin ring of light around the letters is just their own edge: not an area
    var n=0,sx=0,sy=0;for(i=0;i<w*h;i++)if(seen[i]){n++;sx+=i%w;sy+=i/w|0;}
    if(n<tw*th*2)return null;
    var opened=dilateBits(erode(seen,w,h,2),w,h,2),R={x0:x0,y0:y0,w:w,h:h,fill:opened,cx:(t.x1+t.x2)/2,cy:(t.y1+t.y2)/2};
    var sh=rowSpans(R,Math.max(2,Math.round(Math.min(tw,th)*0.15)));
    var mid=sh.band(R.cy-4,R.cy+4);
    return mid&&mid[1]-mid[0]>=Math.max(tw,th*0.6)?{shape:sh,cx:R.cx,cy:R.cy}:null;
  }
  function letterArt(ctx,gp,maxS,minS,W,H,P){
    var la=P&&P.gray?lightArea(P,gp.u):null;
    if(la){
      var lay0=fit(ctx,gp.text,la.shape,la.cx,la.cy,Math.max(minS,maxS),Math.max(7,minS*0.85))||fitHard(ctx,gp.text,la.shape,la.cx,la.cy,Math.max(7,minS*0.85));
      if(lay0){draw(ctx,lay0,'#111','rgba(255,255,255,0.95)');return;}
    }
    var t=gp.u.tb,x1=t.x1,x2=t.x2,y1=t.y1,y2=t.y2;
    var minW=Math.max(x2-x1,Math.min((y2-y1)*0.8,W*0.11)),minH=Math.max(y2-y1,W*0.04);
    if(x2-x1<minW){var cx=(x1+x2)/2;x1=Math.max(0,Math.min(W-minW,cx-minW/2));x2=Math.min(W,x1+minW);}
    if(y2-y1<minH){var cy=(y1+y2)/2;y1=Math.max(0,Math.min(H-minH,cy-minH/2));y2=Math.min(H,y1+minH);}
    var bg=gp.u.paper||[255,255,255],light=lum(bg)>140,shape=rectSpans(x1,y1,x2,y2);
    var lay=fit(ctx,gp.text,shape,(x1+x2)/2,(y1+y2)/2,Math.max(minS,Math.min(maxS,(y2-y1)*0.5)),Math.max(7,minS*0.85))||fitHard(ctx,gp.text,shape,(x1+x2)/2,(y1+y2)/2,Math.max(7,minS*0.85));
    if(lay)draw(ctx,lay,light?'#111':'#fff',light?'rgba(255,255,255,0.95)':'rgba(0,0,0,0.9)');
  }
  // Text on art or in a caption box: a panel in the box's own background
  // colour covers the original, and the translation goes on top.
  function boxBackground(img,b,W,H){
    var d=img.data,rs=[],gs=[],bs=[],x0=Math.max(0,b.x0|0),x1=Math.min(W-1,b.x1|0),y0=Math.max(0,b.y0|0),y1=Math.min(H-1,b.y1|0);
    var step=Math.max(1,Math.floor((x1-x0)*(y1-y0)/3000));
    for(var i=0,n=(x1-x0+1)*(y1-y0+1);i<n;i+=step){var x=x0+i%(x1-x0+1),y=y0+Math.floor(i/(x1-x0+1)),j=(y*W+x)*4;rs.push(d[j]);gs.push(d[j+1]);bs.push(d[j+2]);}
    return [median(rs),median(gs),median(bs)];
  }
  function letterBox(ctx,j,maxS,minS,W,H){
    var b=j.box,pad=Math.max(3,Math.round(Math.min(b.x1-b.x0,b.y1-b.y0)*0.08));
    var x0=Math.max(0,b.x0-pad),y0=Math.max(0,b.y0-pad),x1=Math.min(W,b.x1+pad),y1=Math.min(H,b.y1+pad);
    var p=j.paper,light=(p[0]*77+p[1]*150+p[2]*29)/256>150,rad=Math.min(12,(x1-x0)/4,(y1-y0)/4);
    ctx.fillStyle='rgb('+p[0]+','+p[1]+','+p[2]+')';
    ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x0,y0,x1-x0,y1-y0,rad);else ctx.rect(x0,y0,x1-x0,y1-y0);ctx.fill();
    var inset=pad*0.6,shape=rectSpans(x0+inset,y0+inset,x1-inset,y1-inset);
    var italic=j.item.kind==='sfx',mS=Math.min(maxS,(y1-y0)*0.6);
    var lay=fit(ctx,j.item.text,shape,(x0+x1)/2,(y0+y1)/2,Math.max(minS,mS),Math.max(7,minS*0.8),italic)||fitHard(ctx,j.item.text,shape,(x0+x1)/2,(y0+y1)/2,Math.max(7,minS*0.8));
    if(lay)draw(ctx,lay,light?'#111':'#fff');
  }

  return {plan:plan,planLegacy:planLegacy,detect:detect,annotate:annotate,regionBoxes:regionBoxes,render:render,fit:fit,tokens:tokens,FONT:FONT};
})();
