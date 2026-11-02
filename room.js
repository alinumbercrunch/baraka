/* Baraka — the room as arithmetic, in millimetres. No DOM here, so all of it can be tested. */
/* lens, step: Codrops' 2000px perspective and 500px walk-in on a 1440px screen, as multiples of room width */
const ROOM={w:4800,d:12000,h:3000,gap:500,near:1200,grow:600,air:900,lens:1.39,step:.35};

const artistKey=k=>k.ap.replace(/^artist-|\.html$/g,"");
const ARTISTS=[...new Set(WORKS.map(artistKey))];
const neighbour=(a,by)=>ARTISTS[(ARTISTS.indexOf(a)+by+ARTISTS.length)%ARTISTS.length];

/* the hash is untrusted: it is only ever compared against the data, never shown */
function route(hash){
  const [a,no]=hash.replace(/^#/,"").split("/");
  const asked=WORKS.filter(k=>artistKey(k)===a);
  const works=asked.length ? asked : WORKS.filter(k=>k.ap===WORKS[0].ap);
  return {artist:artistKey(works[0]), works, work:works.find(k=>k.no===no)||null};
}

/* the largest faces you on the back wall; the rest go wherever has most room. null if one won't fit */
function layout(works,walls){
  const open=walls.map(v=>({...v,free:v.to-v.from-ROOM.gap,items:[]}));
  [...works].sort((a,b)=>b.w-a.w).every((k,i)=>{
    const v=i?open.reduce((a,b)=>b.free>a.free?b:a):open[0];
    v.fits=v.free>=k.w+ROOM.gap;
    if(v.fits){ v.free-=k.w+ROOM.gap; v.items.push(k) }
    return v.fits;
  });
  if(open.some(v=>v.fits===false)) return null;
  return open.flatMap(v=>{
    const n=v.items.length, used=v.items.reduce((s,k)=>s+k.w,0), even=(v.to-v.from-used)/(n+1);
    /* side walls hang from the end nearest you, or a short show disappears down the corridor */
    const space=v.near?Math.min(even,ROOM.air):even;
    let x=v.near==="to"?v.to-used-n*space:v.from+space;
    return v.items.map(k=>{
      const spot={k,wall:v.id,x:x+k.w/2,y:hang(k,ROOM.h)};
      x+=k.w+space;
      return spot;
    });
  });
}

/* a room too small for an artist's work grows; nothing is left off the wall */
function plan(works,flat){
  for(let n=0;;n++){
    const w=ROOM.w+n*ROOM.grow, d=ROOM.d+n*ROOM.grow;
    const near=ROOM.step*w+ROOM.gap;   // wall behind the camera's shoulder is off screen: nothing hangs there
    const walls=flat?[{id:"back",from:0,to:w}]:
      [{id:"back",from:0,to:w},{id:"left",from:near,to:d,near:"from"},{id:"right",from:0,to:d-near,near:"to"}];
    const spots=layout(works,walls);
    if(spots) return {w,d,h:ROOM.h,spots};
  }
}

/* where a wall point sits in the room, centred on the room, and the turn that faces it */
function place(room,{wall,x,y}){
  const up=room.h/2-y;
  if(wall==="left")  return {x:-room.w/2, y:up, z:room.d/2-x, turn:-90};
  if(wall==="right") return {x:room.w/2,  y:up, z:x-room.d/2, turn:90};
  return {x:x-room.w/2, y:up, z:-room.d/2, turn:0};
}

/* the room's light follows the clock in Japan, wherever the visitor is */
const SUN=[{id:"morning",l:"朝",from:5},{id:"noon",l:"昼",from:11},{id:"evening",l:"夕",from:16}];
function sunAt(date){
  const h=+new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Tokyo",hour:"numeric",hourCycle:"h23"}).format(date);
  return (SUN.findLast(p=>h>=p.from)||SUN[2]).id;   // before 5 am is still last evening
}

const lens=(room,stage)=>{ const u=Math.min(stage.w/room.w,stage.h/room.h); return {u,p:ROOM.lens*room.w*u} };

/* standing in the doorway. in: walked in. x: mm along the row of rooms. rx, ry: tilt in degrees */
function rest(room,stage,{in:inside=true,x=0,rx=0,ry=0}={}){
  const {u}=lens(room,stage);
  return "translate3d("+x*u+"px,0,"+(inside?ROOM.step*room.w*u:0)+"px) rotateX("+rx+"deg) rotateY("+ry+"deg) "+
    "translate3d(0,0,"+-room.d/2*u+"px)";
}
/* the demo's tilt: at most 1° up or down and 3° across, following the pointer */
const tilt=(px,py,stage)=>({rx:1-2*py/stage.h, ry:6*px/stage.w-3});

/* stage: {w,h} in px. aim: the free part of it. Face the work there, whole.
   Small works keep a stretch of wall round them, so they still look small. */
function face(room,spot,stage,aim){
  const {u,p}=lens(room,stage), c=place(room,spot);
  const f=.9*Math.min(aim.w/(Math.max(spot.k.w,ROOM.near)*u), aim.h/(Math.max(spot.k.h,ROOM.near)*u));
  const ox=(aim.x+aim.w/2-stage.w/2)/f, oy=(aim.y+aim.h/2-stage.h/2)/f;
  return {f,t:"translate3d("+ox+"px,"+oy+"px,"+p*(1-1/f)+"px) rotateY("+c.turn+"deg) "+
    "translate3d("+-c.x*u+"px,"+-c.y*u+"px,"+-c.z*u+"px)"};
}
