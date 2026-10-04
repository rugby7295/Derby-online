// サーバー側レース計算(クライアントの能力値は一切信用しない)
const ST=['逃げ','先行','差し','追込'],SK={逃げ:.12,先行:.06,差し:-.06,追込:-.12};
const N1=['サンダー','ブラック','ゴールド','ブルー','レッド','スカイ','ダーク','ホワイト','キング','ラスト'],N2=['ロード','スター','ウイング','ファング','エース','ムーン','アロー','レジェンド'];
const rnd=n=>Math.floor(Math.random()*n),cl=(v,a,b)=>Math.min(b,Math.max(a,Math.round(+v)||a));
const G={S:1.04,A:1.02,B:1,C:.97,D:.94},GR=['S','A','B','C','D'],PE=['おとなしい','やんちゃ','臆病','負けず嫌い','神経質','大物','気分屋'],GT=['早熟','普通','持続','晩成','超晩成'],TT_=['雨に強い','大舞台に強い','堅実','ムラっ気','末脚鋭い','スタートダッシュ','追込の達人','距離延長に強い','短距離の鬼','不屈','芝の申し子','ダートの鬼','王者の風格','幸運'];
const cm=(h,c,d)=>(c?G[c.surf=='芝'?h.tf||'B':h.td||'B']*(c.going>=2?G[h.wt||'B']:1)*(!h.tn||h.tn=='B'||h.tn==c.turn?1:.985)*(h.tt=='雨に強い'&&c.weather=='雨'?1.03:1)*(h.tt=='大舞台に強い'&&c.big?1.03:1):1)*(({s:d<1500,t:d>=2100,d:!!c&&c.surf=='ダート',w:!!c&&c.going>=2,m:d>=1400&&d<=1800})[h.ln]?1.03:1);
const tb=(h,c,d)=>{const t=h.tt;return t=='スタートダッシュ'&&(h.st=='逃げ'||h.st=='先行')?1.015:t=='追込の達人'&&(h.st=='差し'||h.st=='追込')?1.015:t=='距離延長に強い'&&d>=2000?1.02:t=='短距離の鬼'&&d<1500?1.02:t=='不屈'&&h.fat>=60?1.04:t=='芝の申し子'&&c&&c.surf=='芝'?1.02:t=='ダートの鬼'&&c&&c.surf=='ダート'?1.02:t=='王者の風格'&&c&&c.big?1.02:t=='幸運'?1+Math.random()*.02:1};
const nz=h=>.15*(1-((h.stab||50)-50)/250)*(h.pe=='気分屋'?1.5:1)*(h.tt=='堅実'?.7:h.tt=='ムラっ気'?1.4:1)*(h.tt=='王者の風格'?.85:1);
const gq=()=>['B','B','A','C','B','S','D','A'][rnd(8)];
const ext=g=>({sx:rnd(2)?'牡':'牝',tf:gq(),td:gq(),wt:gq(),tn:['L','R','B'][rnd(3)],pe:PE[rnd(7)],gt:GT[rnd(5)],acc:g(),men:g(),stab:g(),gro:g(),ln:'stdmwa'[rnd(6)],tt:TT_[rnd(TT_.length)]});
const cond=()=>{const w=['晴','晴','曇','雨'][rnd(4)];return{surf:Math.random()<.7?'芝':'ダート',weather:w,going:w=='雨'?2+rnd(2):rnd(2),turn:['L','R'][rnd(2)]}};
const CLS=[{n:'新馬戦',r:40,b:60000,w:0},{n:'1勝クラス',r:50,b:100000,w:1},{n:'オープン',r:62,b:200000,w:3},{n:'G3',r:72,b:400000,w:5},{n:'G2',r:82,b:800000,w:8},{n:'G1',r:92,b:2000000,w:12}];
const cf=h=>h.fat<30?1.02:h.fat<60?1:h.fat<80?.95:.88;
const str=(h,d,c)=>{const w=d<1500?[.4,.2,.25]:d<2100?[.35,.3,.2]:[.3,.4,.15];return(w[0]*h.spd+w[1]*h.sta+w[2]*h.pow+.1*h.gut+.05*h.int)/(w[0]+w[1]+w[2]+.15)*cf(h)*(1+(h.jb||0))*(1+((h.acc||50)-50)/(h.tt=='末脚鋭い'?350:700))*cm(h,c,d)*tb(h,c,d)};
const ovr=h=>Math.round((h.spd+h.sta+h.pow+h.gut+h.int)/5);
function sanitize(h){const o={n:String(h.n||'名無し').slice(0,10),st:ST.includes(h.st)?h.st:'先行',fat:cl(h.fat,0,100),w:cl(h.w,0,999),r:cl(h.r,0,9999),e:cl(h.e,0,1e9)};for(const k of['spd','sta','pow','gut','int','acc','men','stab','gro'])o[k]=cl(h[k]||50,20,100);o.sx=h.sx=='牝'?'牝':'牡';for(const k of['tf','td','wt'])o[k]=GR.includes(h[k])?h[k]:'B';o.tn=['L','R','B'].includes(h.tn)?h.tn:'B';o.pe=PE.includes(h.pe)?h.pe:'おとなしい';o.gt=GT.includes(h.gt)?h.gt:'普通';o.ln=h.ln&&'stdmwa'.includes(h.ln)?h.ln:'a';o.tt=TT_.includes(h.tt)?h.tt:'';if(h.ped&&typeof h.ped=='object'){o.ped={};for(const k of['f','m','ff','fm','mf','mm'])o.ped[k]=String(h.ped[k]||'').slice(0,10)}return o}
const pn=()=>N1[rnd(N1.length)]+N2[rnd(N2.length)];
function npc(r){const g=()=>cl(r+rnd(15)-7,20,100);return{n:N1[rnd(N1.length)]+N2[rnd(N2.length)],spd:g(),sta:g(),pow:g(),gut:g(),int:g(),fat:0,w:0,r:0,e:0,st:ST[rnd(4)],...ext(g),ped:{f:pn(),m:pn(),ff:pn(),fm:pn(),mf:pn(),mm:pn()}}}
function simulate(entries,d,c){const sc=entries.map((x,i)=>[str(x.h,d,c)*(1+(Math.random()*2-1)*nz(x.h)),i]).sort((a,b)=>b[0]-a[0]).map(a=>a[1]);
 return{order:sc,anim:entries.map((x,i)=>({T:1+sc.indexOf(i)*.014,c:SK[x.h.st]*1.2+(Math.random()-.5)*.04,a:(Math.random()-.5)*.03}))}}
const LB={spd:1,sta:1,pow:1,gut:1,int:1};
function train(h,k,tr,fac){if(k=='rest'){h.fat=Math.max(0,h.fat-40-4*((fac&&fac.rest)|0));if(rnd(3)==0)h.stab=Math.min(100,(h.stab||50)+1);return'rest'}if(!LB[k])throw new Error('bad');
 if(h.fat>80){if(rnd(10)<3)h.gut=Math.max(20,h.gut-1);h.fat=Math.min(100,h.fat+5);return'tired'}
 const g=Math.max(1,Math.round((1+rnd(3))*(h[k]>80?.5:1)));const gg=g+(((tr==1&&k=='spd')||(tr==2&&k=='sta')||(tr==4&&h[k]<60))?1:0)+(((h.gt=='早熟'&&h.r<10)||(h.gt=='晩成'&&h.r>=10)||(h.gt=='超晩成'&&h.r>=20)||(h.gt=='持続'&&h.r>=5))?1:0)+((h.gro||50)>70&&rnd(3)==0?1:0)+(Math.random()<.06*((fac&&fac.tr)|0)?1:0);if((k=='pow'||k=='spd')&&rnd(2)==0)h.acc=Math.min(100,(h.acc||50)+1);if(k=='int')h.men=Math.min(100,(h.men||50)+1);h[k]=Math.min(100,h[k]+gg);if(k=='int')h.gut=Math.min(100,h.gut+1);h.fat=Math.min(100,h.fat+(k=='int'?6:15)-(tr==3?3:0));return k+'+'+gg}
const auto=(h,tr,fac)=>h.fat>60?train(h,'rest',tr,fac):train(h,['spd','sta','pow','gut'].sort((a,b)=>h[a]-h[b])[0],tr,fac);
const price=h=>Math.round(ovr(h)**2*30/100)*100,sellp=h=>Math.round(ovr(h)**2*18/100)*100,market=()=>[0,1,2,3].map(i=>npc(35+rnd(28)+i*3));
const TYN={win:1,plc:1,quin:2,waku:2,exa:2,wide:2,trio:3,tri:3};
const mt=(t,s,o)=>t=='win'?o[0]==s[0]:t=='plc'?o.slice(0,3).includes(s[0]):(t=='quin'||t=='waku')?s.every(x=>o.slice(0,2).includes(x)):t=='exa'?o[0]==s[0]&&o[1]==s[1]:t=='tri'?s.every((x,i)=>o[i]==x):s.every(x=>o.slice(0,3).includes(x));
function makeSims(en,d,c,N=1500){const st=en.map(x=>str(x.h,d,c)),q=[];for(let n=0;n<N;n++)q.push(st.map((v,i)=>[v*(1+(Math.random()*2-1)*nz(en[i].h)),i]).sort((a,b)=>b[0]-a[0]).slice(0,3).map(a=>a[1]));return q}
const packSims=q=>q.map(o=>o.join('')).join(''),odds=(q,t,sel)=>{const p=q.filter(o=>mt(t,sel,o)).length/q.length;return Math.min(999,Math.max(1.1,.78/Math.max(p,.5/q.length)))};
const JK=[{id:0,n:'見習い騎手',st:null,pr:0},{id:1,n:'逃げの名手',st:'逃げ',pr:80000},{id:2,n:'先行巧者',st:'先行',pr:80000},{id:3,n:'差しの魔術師',st:'差し',pr:80000},{id:4,n:'追込の鬼',st:'追込',pr:80000}],
TR=[{id:0,n:'標準の調教師',pr:0,d:''},{id:1,n:'スピード育成',pr:80000,d:'スピード調教+1'},{id:2,n:'スタミナ育成',pr:80000,d:'スタミナ調教+1'},{id:3,n:'安定型',pr:80000,d:'調教の疲労-3'},{id:4,n:'早熟型',pr:80000,d:'60未満の能力は伸び+1'}];
const jb=(id,st)=>{const j=JK[id|0];return j&&j.st==st?.05:j&&j.id?.01:0};
function breed(a,b,name){const m=k=>cl(((a[k]||50)+(b[k]||50))/2*.9+rnd(9)-2,20,100),pk=k=>(Math.random()<.5?a:b)[k],pd=(x,k)=>(x.ped&&x.ped[k])||pn();
 return{n:String(name||pn()).slice(0,10),spd:m('spd'),sta:m('sta'),pow:m('pow'),gut:m('gut'),int:m('int'),fat:0,w:0,r:0,e:0,st:Math.random()<.5?a.st:b.st,sx:rnd(2)?'牡':'牝',tf:pk('tf')||'B',td:pk('td')||'B',wt:pk('wt')||'B',tn:pk('tn')||'B',pe:PE[rnd(7)],gt:pk('gt')||'普通',acc:m('acc'),men:m('men'),stab:m('stab'),gro:m('gro'),ln:pk('ln')||'a',tt:pk('tt')||'',ped:{f:a.n,m:b.n,ff:pd(a,'f'),fm:pd(a,'m'),mf:pd(b,'f'),mm:pd(b,'m')}}}
module.exports={cond,CLS,JK,TR,jb,breed,sanitize,npc,simulate,ovr,str,train,auto,price,sellp,market,TYN,mt,makeSims,packSims,odds};
