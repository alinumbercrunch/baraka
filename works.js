/* Baraka — the one list of works, and the rules every page reads it through. */
const WORKS=[
 {no:"BK-014",t:"朝の輪郭",a:"森　柊",ap:"artist-mori.html",mon:"2026.10",w:2148,h:1312,d:45,med:"油彩・キャンバス",kg:9.0,fix:"アンカー必要",price:320000,f:"img/w5.jpg"},
 {no:"BK-052",t:"海辺の家",a:"森　柊",ap:"artist-mori.html",mon:"2026.10",w:1460,h:960,d:35,med:"油彩・キャンバス",kg:4.5,fix:"アンカー必要",price:198000,f:"img/w4.jpg"},
 {no:"BK-061",t:"小さな庭",a:"森　柊",ap:"artist-mori.html",mon:"2026.10",w:364,h:258,d:20,med:"水彩・紙",kg:0.4,fix:"フック可",price:48000,f:"img/w1.jpg"},
 {no:"BK-007",t:"波の記憶",a:"中村あかり",ap:"artist-nakamura.html",mon:"2026.09",w:2260,h:1715,d:50,med:"アクリル・麻",kg:12.4,fix:"下地補強が必要",price:420000,f:"img/w6.jpg"},
 {no:"BK-032",t:"白い午後",a:"中村あかり",ap:"artist-nakamura.html",mon:"2026.09",w:1015,h:594,d:30,med:"油彩・パネル",kg:2.0,fix:"アンカー必要",price:128000,f:"img/w3.jpg"},
 {no:"BK-045",t:"堆積",a:"小松　杏",ap:"artist-komatsu.html",mon:"2026.08",w:946,h:511,d:25,med:"ミクストメディア",kg:1.5,fix:"フック可",price:96000,f:"img/w2.jpg"},
 {no:"BK-021",t:"立つ",a:"石井悠真",ap:"artist-ishii.html",mon:"2026.07",w:2717,h:2133,d:60,med:"岩絵具・和紙",kg:18.5,fix:"下地補強が必要",price:680000,f:"img/w7.jpg",sold:true}
];
const ARTIST={mori:{ro:"Mori Shū",pl:"藤沢",words:"描き終えた絵は、置かれた部屋の光によってもう一度仕上がる、と思っています。"},nakamura:{ro:"Nakamura Akari",pl:"鎌倉"},
  komatsu:{ro:"Komatsu An",pl:"茅ヶ崎"},ishii:{ro:"Ishii Yūma",pl:"逗子"}};
const mm=n=>Math.round(n).toLocaleString("en-US"), yen=n=>"¥"+n.toLocaleString("en-US");
const byNo=no=>WORKS.find(k=>k.no===no);
const page=k=>k.no.replace("-","").toLowerCase()+".html";

/* centre height above the floor: eye level, lowered if the top would crowd the ceiling */
function hang(k,wallH){
  const top=wallH-150;
  return 1500+k.h/2>top ? Math.round((top-k.h/2)/10)*10 : 1500;
}

/* what the visitor saved: read as untrusted, it may be corrupt or from an older version */
const isObj=v=>!!v && typeof v==="object" && !Array.isArray(v);
function loadStore(){
  try{ const s=JSON.parse(localStorage.getItem("bk3")); return isObj(s)?s:{} }catch(e){ return {} }
}
function saveStore(patch){
  try{ localStorage.setItem("bk3",JSON.stringify({...loadStore(),...patch})) }catch(e){}
}
function loadPicks(){ const p=loadStore().p; return isObj(p)?p:{} }

/* a sold work can never join the list */
function togglePick(picks,k){
  if(k.sold) return picks;
  const n={...picks};
  if(n[k.no]) delete n[k.no]; else n[k.no]={room:""};
  return n;
}
