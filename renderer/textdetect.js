// Tsundoku - finds the text on a manga page for the reader's Translate tool.
//
// comic-text-detector (dmMaze, exported to ONNX by manga-image-translator) runs
// with ONNX Runtime Web: on the GPU (WebGPU) when there is one, otherwise on the
// CPU (WebAssembly). The model is not part of the app; the main process downloads
// it once (main/services/translate.js) and hands its bytes over.
//
// Two outputs are used, as in the browser extension this comes from:
//   blk - one box per text block (roughly one per balloon or caption);
//   det - a per-pixel text-line map: it drops blocks with no text under them and
//         adds blocks the first head missed.
// Boxes come back in page pixels, in reading order.
var TD=(function(){
  var INPUT=1024,CONF=0.3;
  var _lib=null,_session=null,_starting=null,_device='',_queue=Promise.resolve();

  function lib(){
    if(!_lib){
      var base=new URL('node_modules/onnxruntime-web/dist/',document.baseURI).href;
      _lib=import(base+'ort.webgpu.min.mjs').then(function(ort){
        ort.env.wasm.wasmPaths=base;
        ort.env.wasm.numThreads=typeof SharedArrayBuffer==='function'?Math.max(1,Math.min(8,(navigator.hardwareConcurrency||2)-1)):1;
        try{ort.env.webgpu.powerPreference='high-performance';}catch(e){}
        return ort;
      });
      _lib.catch(function(){_lib=null;});
    }
    return _lib;
  }
  // Starts the model once per session. getModel() resolves to its bytes.
  function start(getModel){
    if(_session)return Promise.resolve(_session);
    if(!_starting){
      _starting=(async function(){
        var ort=await lib(),bytes=await getModel();
        if(!bytes||!bytes.length)throw new Error('The text detector is not available');
        var eps=navigator.gpu?['webgpu','wasm']:['wasm'],lastErr=null;
        for(var k=0;k<eps.length;k++){
          try{_session=await ort.InferenceSession.create(bytes,{executionProviders:[eps[k]]});_device=eps[k]==='webgpu'?'GPU':'CPU';break;}
          catch(e){lastErr=e;console.warn('[TextDetect]',eps[k],'unavailable:',e&&e.message||e);}
        }
        if(!_session)throw lastErr||new Error('The text detector could not start');
        return _session;
      })();
      _starting.catch(function(){_starting=null;});
    }
    return _starting;
  }

  function box(x1,y1,x2,y2,conf){return {x1:x1,y1:y1,x2:x2,y2:y2,conf:conf};}
  function bw(b){return b.x2-b.x1;}
  function bh(b){return b.y2-b.y1;}

  function dilate(src,w,h,r){
    var tmp=new Uint8Array(w*h),out=new Uint8Array(w*h),x,y,c;
    for(y=0;y<h;y++){var row=y*w;c=0;for(x=0;x<Math.min(r,w);x++)c+=src[row+x];
      for(x=0;x<w;x++){if(x+r<w)c+=src[row+x+r];if(x-r-1>=0)c-=src[row+x-r-1];tmp[row+x]=c>0?1:0;}}
    for(x=0;x<w;x++){c=0;for(y=0;y<Math.min(r,h);y++)c+=tmp[y*w+x];
      for(y=0;y<h;y++){if(y+r<h)c+=tmp[(y+r)*w+x];if(y-r-1>=0)c-=tmp[(y-r-1)*w+x];out[y*w+x]=c>0?1:0;}}
    return out;
  }
  // Bounding boxes [x1,y1,x2,y2] (inclusive) of 8-connected components.
  function components(mask,w,h){
    var seen=new Uint8Array(w*h),stack=new Int32Array(w*h),out=[];
    for(var s=0;s<w*h;s++){
      if(!mask[s]||seen[s])continue;
      var top=0,x1=w,y1=h,x2=-1,y2=-1;stack[top++]=s;seen[s]=1;
      while(top){var p=stack[--top],px=p%w,py=(p-px)/w;
        if(px<x1)x1=px;if(px>x2)x2=px;if(py<y1)y1=py;if(py>y2)y2=py;
        for(var dy=-1;dy<=1;dy++){var ny=py+dy;if(ny<0||ny>=h)continue;
          for(var dx=-1;dx<=1;dx++){var nx=px+dx;if(nx<0||nx>=w)continue;var q=ny*w+nx;if(mask[q]&&!seen[q]){seen[q]=1;stack[top++]=q;}}}}
      out.push([x1,y1,x2,y2]);
    }
    return out;
  }
  function nms(boxes,iou){
    var keep=[];
    boxes.slice().sort(function(a,c){return c.conf-a.conf;}).forEach(function(b){
      var hit=keep.some(function(k){var ix=Math.max(0,Math.min(b.x2,k.x2)-Math.max(b.x1,k.x1)),iy=Math.max(0,Math.min(b.y2,k.y2)-Math.max(b.y1,k.y1));return ix*iy>iou*(bw(b)*bh(b)+bw(k)*bh(k)-ix*iy);});
      if(!hit)keep.push(b);
    });
    return keep;
  }
  // A box mostly inside another one joins it (tile overlaps, split blocks).
  function merge(boxes){
    var out=[];
    boxes.slice().sort(function(a,c){return bw(c)*bh(c)-bw(a)*bh(a);}).forEach(function(b){
      var o=out.find(function(o){var ix=Math.max(0,Math.min(b.x2,o.x2)-Math.max(b.x1,o.x1)),iy=Math.max(0,Math.min(b.y2,o.y2)-Math.max(b.y1,o.y1));return ix*iy>0.6*bw(b)*bh(b);});
      if(o){o.x1=Math.min(o.x1,b.x1);o.y1=Math.min(o.y1,b.y1);o.x2=Math.max(o.x2,b.x2);o.y2=Math.max(o.y2,b.y2);o.conf=Math.max(o.conf,b.conf);}
      else out.push(box(b.x1,b.y1,b.x2,b.y2,b.conf));
    });
    return out;
  }
  // Rows top to bottom, then right to left (manga) or left to right.
  function readingOrder(boxes,rtl){
    var rows=[];
    boxes.slice().sort(function(a,c){return a.y1-c.y1;}).forEach(function(b){
      var row=rows[rows.length-1];
      if(row&&b.y1<row[0].y1+bh(row[0])*0.5)row.push(b);else rows.push([b]);
    });
    return rows.reduce(function(all,row){return all.concat(row.sort(function(a,c){return rtl?c.x2-a.x2:a.x1-c.x1;}));},[]);
  }

  // One tile (sx, sy, sw, sh of the source) through the model. Boxes in source
  // pixels, plus the text-line map for that tile (lines: nw x nh at `scale`).
  async function runTile(ort,source,sx,sy,sw,sh){
    var scale=INPUT/Math.max(sw,sh),nw=Math.round(sw*scale),nh=Math.round(sh*scale);
    var cv=document.createElement('canvas');cv.width=INPUT;cv.height=INPUT;
    var g=cv.getContext('2d',{willReadFrequently:true});
    g.fillStyle='#000';g.fillRect(0,0,INPUT,INPUT);g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';
    g.drawImage(source,sx,sy,sw,sh,0,0,nw,nh);
    var px=g.getImageData(0,0,INPUT,INPUT).data,plane=INPUT*INPUT,blob=new Float32Array(3*plane);
    for(var i=0,p=0;i<plane;i++,p+=4){blob[i]=px[p]/255;blob[i+plane]=px[p+1]/255;blob[i+2*plane]=px[p+2]/255;}
    var input=new ort.Tensor('float32',blob,[1,3,INPUT,INPUT]),feeds={};feeds[_session.inputNames[0]]=input;
    var run=_queue.then(function(){return _session.run(feeds,['blk','seg','det']);});
    _queue=run.catch(function(){});
    var out=await run;
    var pred=out.blk.data,n=out.blk.dims[1],dim=out.blk.dims[2],det=out.det.data,seg=out.seg.data;
    var lines=new Uint8Array(nw*nh),strokes=new Uint8Array(nw*nh),sum=new Int32Array((nw+1)*(nh+1)),x,y;
    for(y=0;y<nh;y++){var row=0;for(x=0;x<nw;x++){var on=det[y*INPUT+x]>0.3?1:0;lines[y*nw+x]=on;strokes[y*nw+x]=Math.round(Math.max(0,Math.min(1,seg[y*INPUT+x]))*255);row+=on;sum[(y+1)*(nw+1)+x+1]=sum[y*(nw+1)+x+1]+row;}}
    function area(x1,y1,x2,y2){
      x1=Math.max(0,Math.min(nw,x1));x2=Math.max(0,Math.min(nw,x2));y1=Math.max(0,Math.min(nh,y1));y2=Math.max(0,Math.min(nh,y2));
      if(x2<=x1||y2<=y1)return [0,0];
      return [sum[y2*(nw+1)+x2]-sum[y1*(nw+1)+x2]-sum[y2*(nw+1)+x1]+sum[y1*(nw+1)+x1],(x2-x1)*(y2-y1)];
    }
    var boxes=[];
    for(i=0;i<n;i++){
      var o=i*dim,cls=0;for(var j=5;j<dim;j++)cls=Math.max(cls,pred[o+j]);
      var conf=pred[o+4]*cls;if(!(conf>CONF))continue;
      var cx=pred[o],cy=pred[o+1],w2=pred[o+2],h2=pred[o+3];
      var a=area(Math.max(0,Math.trunc(cx-w2/2)),Math.max(0,Math.trunc(cy-h2/2)),Math.trunc(cx+w2/2),Math.trunc(cy+h2/2));
      if(a[1]===0||a[0]/a[1]<0.04)continue;            // no text under it
      boxes.push(box(sx+(cx-w2/2)/scale,sy+(cy-h2/2)/scale,sx+(cx+w2/2)/scale,sy+(cy+h2/2)/scale,conf));
    }
    // text lines the block head missed (single lines in webtoons, mostly)
    components(dilate(lines,nw,nh,7),nw,nh).forEach(function(c){
      var x0=c[0],y0=c[1],ww=c[2]-c[0]+1,hh=c[3]-c[1]+1;
      if(ww<16||hh<16||area(x0,y0,x0+ww,y0+hh)[0]<120)return;
      x0+=6;y0+=6;ww-=12;hh-=12;
      var covered=boxes.some(function(b){return Math.min(x0+ww,(b.x2-sx)*scale)-Math.max(x0,(b.x1-sx)*scale)>0&&Math.min(y0+hh,(b.y2-sy)*scale)-Math.max(y0,(b.y1-sy)*scale)>0;});
      if(!covered)boxes.push(box(sx+x0/scale,sy+y0/scale,sx+(x0+ww)/scale,sy+(y0+hh)/scale,0.5));
    });
    return {boxes:boxes,lines:lines,strokes:strokes,nw:nw,nh:nh,scale:scale,sx:sx,sy:sy};
  }

  // Text boxes on a page (source: a canvas or ImageBitmap of w x h). Long strips
  // are run as overlapping square tiles. Also returns a text-line mask at page
  // size (1 = text stroke area), used to tell text from drawing when erasing.
  async function detect(source,w,h,getModel,rtl){
    await start(getModel);
    var ort=await lib(),tiles=[];
    if(h>w*1.5){var step=Math.trunc(w*0.8);for(var y=0;y<Math.max(h-w,0)+step;y+=step){var y0=Math.min(y,Math.max(h-w,0));tiles.push(await runTile(ort,source,0,y0,w,Math.min(w,h-y0)));}}
    else if(w>h*1.5){var st=Math.trunc(h*0.8);for(var x=0;x<Math.max(w-h,0)+st;x+=st){var x0=Math.min(x,Math.max(w-h,0));tiles.push(await runTile(ort,source,x0,0,Math.min(h,w-x0),h));}}
    else tiles.push(await runTile(ort,source,0,0,w,h));
    var all=[];tiles.forEach(function(t){all=all.concat(t.boxes);});
    all=all.map(function(b){return box(Math.max(0,b.x1),Math.max(0,b.y1),Math.min(w,b.x2),Math.min(h,b.y2),b.conf);}).filter(function(b){return bw(b)>6&&bh(b)>6;});
    var boxes=readingOrder(merge(nms(all,0.3)),rtl!==false);
    // the line map (1 = a line of text) and the stroke map (0-255: how surely
    // a pixel is part of a letter) at page size
    var mask=new Uint8Array(w*h),strokes=new Uint8Array(w*h);
    tiles.forEach(function(t){
      for(var py=0;py<h;py++){var fy=(py-t.sy)*t.scale,ly=Math.floor(fy);if(ly<0||ly>=t.nh)continue;
        for(var px=0;px<w;px++){var lx=Math.floor((px-t.sx)*t.scale);if(lx<0||lx>=t.nw)continue;var li=ly*t.nw+lx,pi=py*w+px;
          if(t.lines[li])mask[pi]=1;if(t.strokes[li]>strokes[pi])strokes[pi]=t.strokes[li];}}
    });
    return {boxes:boxes,lines:mask,strokes:strokes,device:_device};
  }

  return {detect:detect,start:start,device:function(){return _device;},readingOrder:readingOrder};
})();
