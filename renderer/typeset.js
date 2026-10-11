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

  // The page for the model: at most maxEdge pixels, balloons outlined in red
  // with their number on a tag at the top-left corner.
  function annotate(source,det,maxEdge){
    var sc=Math.min(1,maxEdge/Math.max(det.W,det.H)),w=Math.round(det.W*sc),h=Math.round(det.H*sc);
    var cv=document.createElement('canvas');cv.width=w;cv.height=h;
    var ctx=cv.getContext('2d');ctx.drawImage(source,0,0,w,h);
    var fs=Math.max(13,Math.round(h*0.017)),lw=Math.max(2,Math.round(h/600));
    ctx.font='700 '+fs+'px sans-serif';ctx.textBaseline='middle';ctx.textAlign='center';
    det.regions.forEach(function(R){
      var x=R.x0*sc-2,y=R.y0*sc-2,bw=R.w*sc+4,bh=R.h*sc+4;
      ctx.strokeStyle='#e0102e';ctx.lineWidth=lw;ctx.setLineDash([lw*3,lw*2]);ctx.strokeRect(x,y,bw,bh);ctx.setLineDash([]);
      var t=String(R.id),tw=Math.max(fs*1.3,ctx.measureText(t).width+fs*0.6),th=fs*1.25;
      var tx=Math.max(0,x-tw*0.35),ty=Math.max(0,y-th*0.55);
      ctx.fillStyle='#e0102e';ctx.fillRect(tx,ty,tw,th);ctx.fillStyle='#fff';ctx.fillText(t,tx+tw/2,ty+th/2+1);
    });
    return cv;
  }
  // Region boxes on the model's 0-1000 scale.
  function regionBoxes(det){
    return det.regions.map(function(R){return {id:R.id,x0:Math.round(R.x0/det.W*1000),y0:Math.round(R.y0/det.H*1000),x1:Math.round((R.x1+1)/det.W*1000),y1:Math.round((R.y1+1)/det.H*1000)};});
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

  // Letters the model's items into the page. items: {region, text} for a
  // numbered balloon, or {x0,y0,x1,y1 (0-1000), kind, text} for other text.
  function render(ctx,img,det,items,opts){
    opts=opts||{};
    var W=det.W,H=det.H,byId={},taken={},jobs=[];
    det.regions.forEach(function(R){byId[R.id]=R;});
    var maxS=Math.max(11,H*0.026),minS=Math.max(8,H*0.0105);
    var groups={};
    function claim(R,text){taken[R.lab]=true;if(!groups[R.lab])groups[R.lab]={R:R,texts:[]};groups[R.lab].texts.push(text);}
    var boxed=[];
    // numbered balloons first (one balloon may get two lines of dialogue)
    (items||[]).forEach(function(it){
      if(!it||!it.text)return;
      var box=it.box||(isFinite(it.x0)&&isFinite(it.x1)?{x0:+it.x0,y0:+it.y0,x1:+it.x1,y1:+it.y1}:null);
      var R=it.region!=null?byId[it.region]:null;
      // a saved answer from a page whose balloons were numbered differently
      if(R&&box){var rb={x0:R.x0/W*1000,y0:R.y0/H*1000,x1:(R.x1+1)/W*1000,y1:(R.y1+1)/H*1000};if(overlap(rb,box)<0.5)R=null;}
      if(R)claim(R,it.text);else if(box)boxed.push({it:it,box:box});
    });
    // then text given as a box: a balloon it sits on (unless that balloon is
    // already lettered: then it is the same text twice), or a box of its own
    boxed.forEach(function(b){
      var px={x0:b.box.x0/1000*W,y0:b.box.y0/1000*H,x1:b.box.x1/1000*W,y1:b.box.y1/1000*H};
      var bestR=null,bo=0;det.regions.forEach(function(Q){var o=overlap({x0:Q.x0,y0:Q.y0,x1:Q.x1,y1:Q.y1},px);if(o>bo){bo=o;bestR=Q;}});
      if(bo>=0.5){if(!taken[bestR.lab])claim(bestR,b.it.text);return;}
      var U=regionUnder(det,px,taken);
      if(U)claim(U,b.it.text);else jobs.push({box:px,item:b.it});
    });
    // erase first, then letter (lettering must not be erased by a neighbour)
    var reach=Math.round(H*0.03);
    var regionJobs=Object.keys(groups).map(function(k){var g=groups[k];eraseRegion(img,g.R,det,reach);return g;});
    jobs.forEach(function(j){j.paper=boxBackground(img,j.box,W,H);});
    ctx.putImageData(img,0,0);
    // Each balloon at the largest size that fits, then the page evened out:
    // no balloon more than 1.2x the page's median size, like a letterer would.
    var lays=regionJobs.map(function(gp){
      var R=gp.R,margin=Math.max(2,Math.round(Math.min(R.w,R.h)*0.07)),shape=rowSpans(R,margin);
      var text=gp.texts.join(' '),mS=Math.min(maxS,(shape.bottom-shape.top)*0.45);
      gp.shape=shape;gp.text=text;
      return fit(ctx,text,shape,R.cx,R.cy,Math.max(minS,mS),minS)||fitHard(ctx,text,shape,R.cx,R.cy,minS);
    });
    var sizes=lays.filter(Boolean).map(function(l){return l.size;}).sort(function(a,b){return a-b;});
    var cap=sizes.length>=3?Math.max(minS,sizes[sizes.length>>1]*1.2):Infinity;
    lays.forEach(function(lay,k){
      var gp=regionJobs[k];
      if(lay&&lay.size>cap)lay=fit(ctx,gp.text,gp.shape,gp.R.cx,gp.R.cy,cap,minS)||lay;
      if(lay)draw(ctx,lay,'#111');
    });
    jobs.forEach(function(j){letterBox(ctx,j,maxS,minS,W,H);});
    return ctx;
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

  return {detect:detect,annotate:annotate,regionBoxes:regionBoxes,render:render,fit:fit,tokens:tokens,FONT:FONT};
})();
