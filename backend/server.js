const path=require('path'),http=require('http'),crypto=require('crypto');
const express=require('express'),{WebSocketServer}=require('ws'),jwt=require('jsonwebtoken'),{Redis}=require('@upstash/redis');
const R=require('./race');
const SECRET=process.env.JWT_SECRET;if(!SECRET)throw new Error('JWT_SECRET is required');
const redis=Redis.fromEnv(),app=express();
app.use(express.json({limit:'50kb'}));app.disable('x-powered-by');app.use(express.static(path.join(__dirname,'../frontend'),{maxAge:'1h'}));
const hash=(p,s)=>crypto.scryptSync(p,s,32).toString('hex'),uid=()=>crypto.randomBytes(8).toString('hex');
const sign=pid=>jwt.sign({pid},SECRET,{expiresIn:'30d'});
async function limit(key,max,sec){const n=await redis.incr(key);if(n==1)await redis.expire(key,sec);return n<=max}
const rl=async(q,s,n)=>{try{if(!await limit('rl:'+q.ip,60,10))return s.status(429).json({error:'rate'});n()}catch(e){s.status(503).json({error:'store'})}};
app.use('/api',rl);
const okName=n=>typeof n=='string'&&/^[\w぀-ヿ一-龥ー]{2,12}$/.test(n),okPw=p=>typeof p=='string'&&p.length>=6&&p.length<=64;
app.post('/api/auth/register',async(q,s)=>{try{const{name,password}=q.body||{};if(!okName(name)||!okPw(password))return s.status(400).json({error:'invalid'});
 const id=uid(),salt=crypto.randomBytes(16).toString('hex');
 if(!await redis.set('user:'+name.toLowerCase(),{id,salt,hash:hash(password,salt)},{nx:true}))return s.status(409).json({error:'exists'});
 await redis.set('player:'+id,{name,m:100000,hs:[R.npc(46)],imported:false,w:0,r:0,pts:1000});s.json({token:sign(id)})}catch(e){s.status(500).json({error:'server'})}});
app.post('/api/auth/login',async(q,s)=>{try{const{name,password}=q.body||{};if(!okName(name)||!okPw(password))return s.status(400).json({error:'invalid'});
 const u=await redis.get('user:'+name.toLowerCase());if(!u)return s.status(401).json({error:'auth'});
 const a=Buffer.from(hash(password,u.salt)),b=Buffer.from(u.hash);if(a.length!=b.length||!crypto.timingSafeEqual(a,b))return s.status(401).json({error:'auth'});s.json({token:sign(u.id)})}catch(e){s.status(500).json({error:'server'})}});
const auth=(q,s,n)=>{try{q.pid=jwt.verify((q.headers.authorization||'').replace('Bearer ',''),SECRET).pid;n()}catch(e){s.status(401).json({error:'auth'})}};
app.get('/api/player',auth,async(q,s)=>{const p=await redis.get('player:'+q.pid),note=roll(p);if(note)await redis.set('player:'+q.pid,p);s.json({...p,note,season:seasonId()})});
// MVP: 単体版セーブの初回インポート(1回のみ・値は範囲制限)。本番は育成もサーバー側APIに移すこと
app.post('/api/player/import',auth,async(q,s)=>{const p=await redis.get('player:'+q.pid);if(!p||p.imported)return s.status(409).json({error:'already'});
 const hs=(Array.isArray(q.body.hs)?q.body.hs:[]).slice(0,10).map(R.sanitize);if(!hs.length)return s.status(400).json({error:'no horses'});
 p.hs=hs;p.m=Math.min(Math.max(0,+q.body.m||0),1e6);p.imported=true;await redis.set('player:'+q.pid,p);s.json(p)});
app.get('/api/rankings',async(q,s)=>{const z=await redis.zrange(q.query.horse?'rank:h':q.query.season?'rank:s:'+seasonId():'rank:pts',0,19,{rev:true,withScores:true});const o=[];for(let i=0;i<z.length;i+=2)o.push({name:z[i],pts:z[i+1]});s.json(o)});
app.get('/healthz',(q,s)=>s.send('ok'));

// ---- サーバー権威の育成・売買(クライアント値は使わない) ----
async function mut(q,s,fn){const lk='lock:'+q.pid;if(!await redis.set(lk,1,{nx:true,ex:3}))return s.status(429).json({error:'busy'});
 try{const p=await redis.get('player:'+q.pid);if(!p)return s.status(404).json({error:'none'});const r=fn(p);await redis.set('player:'+q.pid,p);s.json({result:r,player:p})}
 catch(e){s.status(400).json({error:e.message})}finally{await redis.del(lk).catch(()=>{})}}
const hor=(p,q)=>{const h=p.hs[parseInt(q.params.i,10)];if(!h)throw new Error('no horse');return h};
app.post('/api/horses/:i/train',auth,(q,s)=>mut(q,s,p=>{(p.tut=p.tut||{}).tr=(p.tut.tr|0)+1;return R.train(hor(p,q),String(q.body.k),p.tr|0,p.fac)}));
app.post('/api/horses/:i/auto',auth,(q,s)=>mut(q,s,p=>{(p.tut=p.tut||{}).tr=(p.tut.tr|0)+1;return R.auto(hor(p,q),p.tr|0,p.fac)}));
app.post('/api/horses/:i/sell',auth,(q,s)=>mut(q,s,p=>{const h=hor(p,q);if(p.hs.length<2)throw new Error('last horse');p.hs.splice(p.hs.indexOf(h),1);p.m+=R.sellp(h);return'sold'}));
app.get('/api/market',auth,async(q,s)=>{const p=await redis.get('player:'+q.pid);if(!p.mkt){p.mkt=R.market();await redis.set('player:'+q.pid,p)}s.json(p.mkt.map(h=>({...h,price:R.price(h)})))});
app.post('/api/market/:i/buy',auth,(q,s)=>mut(q,s,p=>{p.mkt=p.mkt||R.market();const i=parseInt(q.params.i,10),h=p.mkt[i];if(!h)throw new Error('no horse');if(p.hs.length>=10)throw new Error('full');if(p.m<R.price(h))throw new Error('money');p.m-=R.price(h);p.hs.push(h);p.mkt.splice(i,1);return'bought'}));
const W=p=>(p.w|0)+(p.sw|0);
const ACH=[['初出走',p=>(p.tut&&p.tut.race>=1)||p.r>0],['初勝利',p=>W(p)>=1],['10勝',p=>W(p)>=10],['100勝',p=>W(p)>=100],['初G1',p=>p.g1>=1],['G1 3勝',p=>p.g1>=3],['10連勝',p=>p.bs>=10],['賞金100万',p=>p.tot>=1e6],['賞金1000万',p=>p.tot>=1e7],['10頭所有',p=>p.hs.length>=10],['名馬育成(総合80)',p=>p.hs.some(h=>R.ovr(h)>=80)],['初オンライン勝利',p=>p.w>=1],['オンライン10勝',p=>p.w>=10],['馬券初的中',p=>p.bw>=1],['万馬券(100倍以上)',p=>p.bo>=100],['殿堂入り馬',p=>(p.stud||[]).some(h=>h.w>=3)],['初繁殖',p=>p.bred>=1],['フレンド登録',p=>(p.fr||[]).length>=1],['地下脱出',p=>p.wk&&p.wk.c>=1],['1200pt到達',p=>p.pts>=1200]],
TT=[['新米馬主',()=>1],['勝ち馬主',p=>W(p)>=10],['ベテラン馬主',p=>W(p)>=30],['万馬券職人',p=>p.bo>=100],['G1馬主',p=>p.g1>=1],['名馬主',p=>p.hs.some(h=>R.ovr(h)>=85)],['地下脱出者',p=>p.wk&&p.wk.c>=1],['オンライン王者',p=>p.pts>=1500],['伝説の馬主',p=>W(p)>=100]];
app.get('/api/achievements',auth,async(q,s)=>{const p=await redis.get('player:'+q.pid);s.json({ach:ACH.map(([n,f])=>({n,ok:!!f(p)})),title:TT.filter(([,f])=>f(p)).pop()[0]})});

// ---- 引退・繁殖・ショップ・スタッフ・フレンド・イベント・シーズン・地下労働 ----
const seasonId=()=>{const d=new Date();return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')};
const EVS=[{id:'winter',m:[12,1,2],n:'冬の雪見杯',skin:'e_winter'},{id:'spring',m:[3,4,5],n:'春の桜花フェス',skin:'e_spring'},{id:'summer',m:[6,7,8],n:'夏の海風カップ',skin:'e_summer'},{id:'autumn',m:[9,10,11],n:'秋の紅葉ステークス',skin:'e_autumn'}];
const curEv=()=>EVS.find(e=>e.m.includes(new Date().getUTCMonth()+1)),evKey=e=>e.id+new Date().getUTCFullYear();
function grant(p,id){p.sk=p.sk||[];if(p.sk.includes(id))return 0;p.sk.push(id);return 1}
function roll(p){const sn=seasonId();p.sp=p.sp||{s:sn,pts:0};if(p.sp.s==sn)return null;const old=p.sp;p.sp={s:sn,pts:0};if(old.pts>=30){p.m+=50000;grant(p,'t_season');return`前シーズン(${old.s})の報酬：賞金¥50,000と限定勝負服を獲得!`}return null}
const SKN=[['h_gray','h','芦毛','#bfc5c9',20000],['h_white','h','白毛','#f2f2f2',50000],['h_black','h','青毛','#17171a',20000],['h_gold','h','ゴールド','#e0b030',150000],['h_neon','h','ネオン','#35f0c8',150000],['h_fire','h','炎','#e8541e',150000],
['s_samurai','s','勝負服:武士','#9b1c1c',30000],['s_cyber','s','勝負服:サイバー','#00e5ff',30000],['s_knight','s','勝負服:騎士','#7c8aa5',30000],['c_night','c','競馬場:夜','night',40000],['c_sakura','c','競馬場:桜','sakura',40000],['c_snow','c','競馬場:雪','snow',40000],
['e_spring','s','限定:桜花賞の勝負服','#f06292',0],['e_summer','h','限定:海風の毛色','#27b3d6',0],['e_autumn','h','限定:紅葉毛','#c0541e',0],['e_winter','s','限定:雪見の勝負服','#e3f2fd',0],['t_season','s','限定:シーズン王者の勝負服','#ffd400',0],['e_trophy','s','限定:大会王者の勝負服','#ff9800',0],['h_kuri','h','栗毛','#b5651d',10000],['h_kage','h','黒鹿毛','#3a2418',10000],['h_silver','h','銀','#c0c0c8',100000],['h_thunder','h','雷','#ffe94a',150000],['h_legend','h','レジェンド','#b388ff',300000],
['s_racer','s','勝負服:レーサー','#ff1744',30000],['s_festival','s','勝負服:夏祭り','#ffca28',30000],['s_halloween','s','勝負服:ハロウィン','#ff6f00',30000],['s_xmas','s','勝負服:クリスマス','#2e7d32',30000],
['c_fire','c','競馬場:花火','fireworks',50000],['c_neon','c','競馬場:ネオン','neonc',50000],
['m_crown','m','エンブレム:王冠','crown',10000],['m_shoe','m','エンブレム:蹄鉄','shoe',10000],['m_star','m','エンブレム:星','star',10000],['m_heart','m','エンブレム:ハート','heart',10000],['m_clover','m','エンブレム:四つ葉','clover',10000],['m_flame','m','エンブレム:炎','flame',20000],
['n_wood','n','看板:木彫り','wood',15000],['n_gold','n','看板:金','gold',40000],['n_neon','n','看板:ネオン','neon',40000],
['d_flag','d','装飾:旗','flag',8000],['d_flower','d','装飾:花壇','flower',8000],['d_lantern','d','装飾:提灯','lantern',12000],['d_fountain','d','装飾:噴水','fountain',30000],['d_statue','d','装飾:名馬の像','statue',50000],
['h_tsuki','h','月毛','#e6c27a',20000],['h_aoka','h','青鹿毛','#2b1d16',20000],['h_ice','h','氷','#9be7ff',120000],['h_sakura','h','桜','#ffb7c5',120000],['h_jade','h','翡翠','#3ddc97',120000],['h_night','h','夜空','#1a237e',150000],['h_rainbow','h','虹(七色に光る)','rainbow',400000],
['s_wa','s','勝負服:和柄','#c2185b',30000],['s_royal','s','勝負服:ロイヤル','#4527a0',30000],['s_ocean','s','勝負服:海','#0277bd',30000],['s_sun','s','勝負服:太陽','#ff8f00',30000],['s_forest','s','勝負服:森','#1b5e20',30000],['e_streak','s','限定:皆勤の勝負服','#00e676',0],
['g_crown','g','馬具:王冠','x',80000],['g_wing','g','馬具:天使の翼','x',100000],['g_flame','g','馬具:炎エフェクト','x',80000],
['c_future','c','競馬場:未来都市','future',50000],['c_ancient','c','競馬場:古代競技場','ancient',50000],
['m_moon','m','エンブレム:月','moon',10000],['m_bolt','m','エンブレム:稲妻','bolt',10000],['m_sakura','m','エンブレム:桜','sakura',10000],
['d_tree','d','装飾:桜の木','tree',20000],['d_torii','d','装飾:鳥居','torii',30000],['d_trophy','d','装飾:トロフィー','trophy',40000],
['h_c0','h','鋼','#78909c',30000],['h_c1','h','青銅','#a1662f',30000],['h_c2','h','クリーム','#f5e6c8',20000],['h_c3','h','ルビー','#c2185b',100000],['h_c4','h','サファイア','#1565c0',100000],['h_c5','h','エメラルド','#2e7d32',100000],['h_c6','h','琥珀','#ff8f00',80000],['h_c7','h','黒曜','#101015',60000],['h_c8','h','真珠','#f3eef8',80000],['h_c9','h','菫','#6a1b9a',80000],['h_c10','h','溶岩','#bf360c',100000],['h_c11','h','深海','#01579b',80000],['h_c12','h','黄金の鬣','#c9a227',120000],['h_c13','h','白銀の月','#dfe6ee',120000],['p_1','p','模様:流星',1,20000],['p_2','p','模様:星',2,20000],['p_3','p','模様:白靴下',3,20000],['p_4','p','模様:ブチ',4,20000],['p_5','p','模様:流星+靴下',5,20000],['p_6','p','模様:まだら',6,20000],['p_7','p','模様:ゼブラ縞',7,20000],['p_8','p','模様:ヒョウ柄',8,20000],['p_9','p','模様:白面',9,20000],['p_10','p','模様:背線',10,20000],['p_11','p','模様:尻星',11,20000],['p_0','p','模様なし',0,5000],['g_war','g','馬具:軍馬(重装)','x',120000],['g_knight','g','馬具:騎士の馬','x',120000],['g_cyber','g','馬具:サイバーパンク','x',150000],['g_dragon','g','馬具:ドラゴン','x',200000],['g_unicorn','g','馬具:ユニコーン','x',200000],['g_undead','g','馬具:アンデッド','x',150000],['g_mecha','g','馬具:メカ','x',200000],['g_samurai','g','馬具:武者の馬','x',120000],['f_thunder','f','エフェクト:雷','thunder',150000],['f_flame','f','エフェクト:炎','flame',120000],['f_blue','f','エフェクト:青い炎','blue',180000],['f_plasma','f','エフェクト:プラズマ','plasma',180000],['f_aura','f','エフェクト:オーラ','aura',100000],['f_mist','f','エフェクト:闇の霧','mist',100000],['f_petal','f','エフェクト:花びら','petal',80000],['f_ice','f','エフェクト:氷晶','ice',120000],['f_gold','f','エフェクト:金の粒','gold',120000],['j_knight','j','騎手:騎士の鎧','knight',60000],['j_samurai','j','騎手:武者の兜','samurai',60000],['j_cyber','j','騎手:サイバーバイザー','cyber',60000],['j_wizard','j','騎手:魔法使い','wizard',60000],['j_king','j','騎手:王の冠','king',100000],['s_army','s','勝負服:軍','#556b2f',30000],['s_dragon','s','勝負服:竜','#b71c1c',30000],['s_mage','s','勝負服:魔導','#512da8',30000],['s_void','s','勝負服:虚空','#212121',30000],['s_aurora','s','勝負服:オーロラ','#26a69a',30000],['s_blood','s','勝負服:緋','#880e4f',30000],['c_dragonvale','c','競馬場:竜の谷','dragonvale',60000],['c_skycastle','c','競馬場:天空の城','skycastle',60000],['c_cybercity','c','競馬場:サイバーシティ','cybercity',60000],['g_blink','g','馬具:ブリンカー','x',15000],['g_mask','g','馬具:メンコ','x',15000],['g_shadow','g','馬具:シャドーロール','x',15000],['g_spark','g','馬具:星屑エフェクト','x',60000],['b_wa','b','厩舎:和風','wa',40000],['b_sei','b','厩舎:西洋','sei',40000],['b_ou','b','厩舎:王宮','ou',60000],['b_sf','b','厩舎:SF','sf',40000],['b_neon','b','厩舎:ネオン','neon',40000],['b_retro','b','厩舎:レトロ','retro',40000]].map(([id,t,n,val,pr])=>({id,t,n,val,pr,ev:pr?0:1}));
app.get('/api/shop',auth,async(q,s)=>{const p=await redis.get('player:'+q.pid);s.json({items:SKN.map(x=>({...x,own:(p.sk||[]).includes(x.id)})),eq:p.eq||{}})});
app.post('/api/shop/buy',auth,(q,s)=>mut(q,s,p=>{const x=SKN.find(y=>y.id==q.body.id);if(!x||x.ev)throw new Error('not for sale');if((p.sk||[]).includes(x.id))throw new Error('owned');if(p.m<x.pr)throw new Error('money');p.m-=x.pr;grant(p,x.id);return'bought'}));
app.post('/api/shop/equip',auth,(q,s)=>mut(q,s,p=>{const{t,id}=q.body,x=id&&SKN.find(y=>y.id==id);if(id&&(!x||x.t!=t||!(p.sk||[]).includes(id)))throw new Error('not owned');
 if(t=='h'||t=='g'||t=='p'||t=='f'){const h=p.hs[parseInt(q.body.i,10)];if(!h)throw new Error('no horse');const f=({h:'skin',g:'gear',p:'pat',f:'fx'})[t];if(id)h[f]=(t=='p'||t=='f')?x.val:id;else delete h[f]}else if(t=='s'||t=='c'||t=='b'||t=='m'||t=='n'||t=='j'){p.eq=p.eq||{};p.eq[({s:'silk',c:'course',b:'barn',m:'emblem',n:'sign',j:'rider'})[t]]=id||null}else if(t=='d'){p.eq=p.eq||{};let d=p.eq.dec||[];if(q.body.rm)d=d.filter(x=>x!=q.body.rm);else if(id&&!d.includes(id)){if(d.length>=3)throw new Error('装飾は3つまで');d.push(id)}p.eq.dec=d}else throw new Error('bad');return'ok'}));
app.get('/api/staff',auth,async(q,s)=>{const p=await redis.get('player:'+q.pid);s.json({jk:R.JK,tr:R.TR,fac:p.fac||{tr:0,rest:0},cur:{jk:p.jk|0,tr:p.tr|0}})});
app.post('/api/staff/hire',auth,(q,s)=>mut(q,s,p=>{const k=q.body.kind=='jk'?'jk':q.body.kind=='tr'?'tr':null,x=k&&(k=='jk'?R.JK:R.TR).find(y=>y.id==q.body.id);if(!x)throw new Error('bad');if((p[k]|0)==x.id)throw new Error('already');if(p.m<x.pr)throw new Error('money');p.m-=x.pr;p[k]=x.id;return'hired'}));
app.post('/api/horses/:i/retire',auth,(q,s)=>mut(q,s,p=>{const h=hor(p,q);p.stud=p.stud||[];if(h.r<5)throw new Error('5戦以上で引退できます');if(p.hs.length<2)throw new Error('last horse');if(p.stud.length>=20)throw new Error('stud full');p.hs.splice(p.hs.indexOf(h),1);p.stud.push(h);return h.w>=3?'hall':'retired'}));
app.post('/api/breed',auth,(q,s)=>mut(q,s,p=>{const st=p.stud||[],i=parseInt(q.body.s,10),j=parseInt(q.body.d,10),a=st[i],b=st[j];if(!a||!b||i==j)throw new Error('parents');if((a.sx||'牡')!='牡'||b.sx!='牝')throw new Error('父は牡・母は牝を選んでください');if(p.hs.length>=10)throw new Error('full');if(p.m<50000)throw new Error('money');p.m-=50000;p.hs.push(R.breed(a,b,q.body.name));p.bred=(p.bred|0)+1;return'foal'}));
app.post('/api/friends/add',auth,async(q,s)=>{try{const u=await redis.get('user:'+String(q.body.name||'').toLowerCase());if(!u||u.id==q.pid)return s.status(404).json({error:'not found'});const[me,fr]=await Promise.all([redis.get('player:'+q.pid),redis.get('player:'+u.id)]);if(!fr)return s.status(404).json({error:'not found'});
 me.fr=me.fr||[];fr.fr=fr.fr||[];if(!me.fr.includes(fr.name)&&me.fr.length<50)me.fr.push(fr.name);if(!fr.fr.includes(me.name)&&fr.fr.length<50)fr.fr.push(me.name);await Promise.all([redis.set('player:'+q.pid,me),redis.set('player:'+u.id,fr)]);s.json({ok:1})}catch(e){s.status(500).json({error:'server'})}});
app.get('/api/friends',auth,async(q,s)=>{const me=await redis.get('player:'+q.pid),o=[];for(const n of me.fr||[]){const u=await redis.get('user:'+n.toLowerCase());if(!u)continue;const[on,rm]=await Promise.all([redis.get('on:'+u.id),redis.get('pr:'+u.id)]);o.push({name:n,online:!!on,room:rm||null})}s.json(o)});
app.get('/api/event',auth,async(q,s)=>{const p=await redis.get('player:'+q.pid),e=curEv(),sn=seasonId();s.json({ev:e?{id:e.id,n:e.n}:null,season:sn,w:e&&p.ev&&p.ev.id==evKey(e)?p.ev.w:0,pts:p.sp&&p.sp.s==sn?p.sp.pts:0})});
// 地下労働(破産時のみ・1回6秒以上・1日上限あり・サーバーで検証)
app.post('/api/work/start',auth,(q,s)=>mut(q,s,p=>{if(p.m>=4800)throw new Error('not bankrupt');p.wk=p.wk||{};p.wk.t=Date.now();return'started'}));
app.post('/api/work/finish',auth,(q,s)=>mut(q,s,p=>{const day=new Date().toISOString().slice(0,10),w=p.wk=p.wk||{};if(p.m>=4800)throw new Error('not bankrupt');if(!w.t||Date.now()-w.t<6000)throw new Error('too fast');if(w.d!=day){w.d=day;w.n=0}if(w.n>=12000)throw new Error('daily limit');w.t=0;p.m+=3000;w.n+=3000;w.c=(w.c|0)+1;return'+3000'}));

// ---- ランク・集計・ソロレース(サーバー権威) ----
const CAP=[55,65,75,85,95,100],TI=pts=>pts<900?0:pts<1100?1:pts<1300?2:pts<1500?3:pts<1800?4:5;
const findOrMk=(mode,tier)=>[...rooms.values()].find(x=>x.mode==mode&&x.st=='WAITING'&&x.pl.size<8&&(mode!='ranked'||x.tier==tier))||mkRoom(mode,null,tier);
function tally(p,pos,prize,hits,solo,g1){p.tot=(p.tot||0)+prize;if(solo&&pos==0)p.sw=(p.sw|0)+1;if(g1&&pos==0)p.g1=(p.g1|0)+1;if(pos==0){p.stk=(p.stk|0)+1;p.bs=Math.max(p.bs|0,p.stk)}else if(pos>0)p.stk=0;for(const o of hits)if(o){p.bw=(p.bw|0)+1;p.bo=Math.max(p.bo||0,o)}}
app.post('/api/solo/prepare',auth,async(q,s)=>{try{const p=await redis.get('player:'+q.pid),i=parseInt(q.body.i,10),ci=parseInt(q.body.cls,10),h=p.hs[i],c=R.CLS[ci];if(!h||!c)return s.status(400).json({error:'bad'});if((h.w|0)<c.w)return s.status(400).json({error:'locked'});const fee=Math.round(c.b*.08);if(p.m<fee)return s.status(400).json({error:'money'});
 const cond=Object.assign(R.cond(),{big:ci>=4}),dist=[1200,1600,2000,2400][Math.floor(Math.random()*4)],hh=R.sanitize(h);hh.skin=h.skin;hh.gear=h.gear;hh.pat=h.pat;hh.fx=h.fx;hh.jr=p.eq&&p.eq.rider;hh.silk=p.eq&&p.eq.silk;hh.jb=R.jb(p.jk,h.st);
 const en=[{pid:q.pid,name:h.n,owner:p.name,h:hh}];for(let k=0;k<7;k++){const n=R.npc(c.r);en.push({pid:null,name:n.n,owner:'NPC',h:n})}en.sort(()=>Math.random()-.5);
 const sims=R.makeSims(en,dist,cond),ow=en.map((x,k)=>R.odds(sims,'win',[k])),pop=ow.map(o=>ow.filter(z=>z<o).length+1),pk=R.packSims(sims);
 await redis.set('solo:'+q.pid,{i,ci,fee,dist,cond,en,sims:pk},{ex:600});
 s.json({type:'odds',solo:1,dist,cond,cls:c.n,secs:600,fee,entries:en.map((x,k)=>({name:x.name,owner:x.owner,st:x.h.st,win:ow[k],pop:pop[k]})),sims:pk})}catch(e){s.status(500).json({error:'server'})}});
app.post('/api/solo/run',auth,async(q,s)=>{const lk='lock:'+q.pid;if(!await redis.set(lk,1,{nx:true,ex:5}))return s.status(429).json({error:'busy'});
 try{const[p,sr]=await Promise.all([redis.get('player:'+q.pid),redis.get('solo:'+q.pid)]);if(!p||!sr)return s.status(400).json({error:'expired'});await redis.del('solo:'+q.pid);
  const sims=[];for(let k=0;k+2<sr.sims.length;k+=3)sims.push([+sr.sims[k],+sr.sims[k+1],+sr.sims[k+2]]);
  const bets=(Array.isArray(q.body.bets)?q.body.bets:[]).slice(0,20).map(b=>({t:b.t,sel:(Array.isArray(b.sel)?b.sel:[]).map(Number),a:Math.floor(+b.a)})).filter(b=>R.TYN[b.t]&&b.sel.length==R.TYN[b.t]&&new Set(b.sel).size==b.sel.length&&b.sel.every(i=>i>=0&&i<8)&&b.a>=100&&b.a<=100000);
  const stake=bets.reduce((a,b)=>a+b.a,0);if(p.m<sr.fee+stake)return s.status(400).json({error:'money'});p.m-=sr.fee+stake;
  const en=sr.en,sim=R.simulate(en,sr.dist,sr.cond),c=R.CLS[sr.ci],pos=sim.order.indexOf(en.findIndex(x=>x.pid)),prize=Math.round(c.b*PZ[pos]);let bp=0;
  const hits=bets.map(b=>{if(R.mt(b.t,b.sel,sim.order)){const o=R.odds(sims,b.t,b.sel);bp+=Math.round(b.a*o);return o}return 0});p.m+=prize+bp;
  const h=p.hs[sr.i];if(h){h.r++;h.e=(h.e||0)+prize;if(!pos)h.w++;h.fat=Math.min(100,h.fat+18+Math.floor(Math.random()*8));const k=['spd','sta','pow','gut','int'][Math.floor(Math.random()*5)];h[k]=Math.min(100,h[k]+(pos?1:2));await redis.zadd('rank:h',{score:h.e,member:p.name+'/'+h.n})}
  tally(p,pos,prize,hits,1,sr.ci==5);p.tut=p.tut||{};p.tut.race=(p.tut.race|0)+1;if(!pos)p.tut.win=(p.tut.win|0)+1;await redis.set('player:'+q.pid,p);
  s.json({result:{raceId:'solo-'+Date.now(),dist:sr.dist,cond:sr.cond,order:sim.order,pay:{[p.name]:{prize,bet:bp,stake}},entries:en.map((x,k)=>({name:x.name,owner:x.owner,st:x.h.st,skin:x.h.skin||null,gear:x.h.gear||null,pat:x.h.pat??null,fx:x.h.fx||null,jr:x.h.jr||null,silk:x.h.silk||null,...sim.anim[k]}))},player:p})}
 catch(e){console.error(e);s.status(500).json({error:'server'})}finally{await redis.del(lk).catch(()=>{})}});

// ---- ログインボーナス・厩舎設備 ----
app.post('/api/daily/claim',auth,(q,s)=>mut(q,s,p=>{const day=new Date().toISOString().slice(0,10),y=new Date(Date.now()-864e5).toISOString().slice(0,10),d=p.dl||{d:'',s:0};if(d.d==day)throw new Error('本日は受取済みです');const st=d.d==y?d.s+1:1,r=10000+Math.min(st,7)*5000;p.m+=r;p.dl={d:day,s:st};if(st%7==0)grant(p,'e_streak');return{r,st}}));
app.post('/api/facility/up',auth,(q,s)=>mut(q,s,p=>{const k=q.body.k=='tr'?'tr':q.body.k=='rest'?'rest':null;if(!k)throw new Error('bad');p.fac=p.fac||{tr:0,rest:0};const lv=p.fac[k]|0;if(lv>=5)throw new Error('最大レベルです');const c=100000*(lv+1);if(p.m<c)throw new Error('資金が足りません');p.m-=c;p.fac[k]=lv+1;return'up'}));

// ---- オークション(入札額は預かり・手数料5%・終了1分前の入札で延長) ----
const Y=n=>'¥'+Math.round(n).toLocaleString(),inbox=(p,t)=>{p.inbox=[t,...(p.inbox||[])].slice(0,10)};
async function withLocks(keys,fn){const got=[];try{for(const k of[...new Set(keys)].sort()){if(!await redis.set('lock:'+k,1,{nx:true,ex:5}))throw new Error('busy');got.push(k)}return await fn()}finally{for(const k of got)await redis.del('lock:'+k).catch(()=>{})}}
async function settle(id){const a=await redis.get('auc:'+id);if(!a)return redis.srem('auc:ids',id);if(a.end>Date.now())return;
 await withLocks(['auc'+id,a.seller,a.bidder].filter(Boolean),async()=>{const b=await redis.get('auc:'+id);if(!b||b.end>Date.now())return;const sp=await redis.get('player:'+b.seller),back=(p,h)=>{if(p.hs.length<10)p.hs.push(h);else(p.stud=p.stud||[]).push(h)};
  if(sp){sp.ac=Math.max(0,(sp.ac|0)-1);const bp=b.bidder&&await redis.get('player:'+b.bidder);
   if(bp&&bp.hs.length<10){bp.hs.push(b.horse);sp.m+=Math.round(b.bid*.95);inbox(bp,`🎉 ${b.horse.n}を${Y(b.bid)}で落札しました`);inbox(sp,`💰 ${b.horse.n}が${Y(b.bid)}で落札されました(手数料5%差引)`);await redis.set('player:'+b.bidder,bp)}
   else{if(bp){bp.m+=b.bid;inbox(bp,`${b.horse.n}は厩舎が満杯のため落札できず返金されました`);await redis.set('player:'+b.bidder,bp)}back(sp,b.horse);inbox(sp,b.bidder?`${b.horse.n}は取引不成立で戻りました`:`${b.horse.n}は入札がなく戻りました`)}
   await redis.set('player:'+b.seller,sp)}
  await redis.del('auc:'+id);await redis.srem('auc:ids',id)})}
async function sweep(){try{for(const id of await redis.smembers('auc:ids'))await settle(id).catch(()=>{})}catch(e){}}
setInterval(sweep,30000);
app.get('/api/auction',auth,async(q,s)=>{try{await sweep();const o=[];for(const id of await redis.smembers('auc:ids')){const a=await redis.get('auc:'+id);if(a)o.push({id:a.id,sname:a.sname,mine:a.seller==q.pid,horse:a.horse,bid:a.bid,min:a.min,bname:a.bname,end:a.end,top:a.bidder==q.pid})}o.sort((x,y)=>x.end-y.end);const p=await redis.get('player:'+q.pid);s.json({list:o,inbox:p.inbox||[],now:Date.now()})}catch(e){s.status(500).json({error:'server'})}});
app.post('/api/auction/list',auth,async(q,s)=>{try{const i=parseInt(q.body.i,10),price=Math.floor(+q.body.price),mins=[10,30,60].includes(+q.body.mins)?+q.body.mins:30;if(!(price>=10000&&price<=1e7))return s.status(400).json({error:'価格は1万〜1000万'});
 await withLocks([q.pid],async()=>{const p=await redis.get('player:'+q.pid),h=p.hs[i];if(!h)throw new Error('no horse');if(p.hs.length<2)throw new Error('最後の1頭は出品できません');if((p.ac|0)>=5)throw new Error('出品は5件までです');
  p.hs.splice(i,1);p.ac=(p.ac|0)+1;const id='a'+uid();await redis.set('auc:'+id,{id,seller:q.pid,sname:p.name,horse:h,min:price,bid:0,bidder:null,bname:null,end:Date.now()+mins*60000});await redis.sadd('auc:ids',id);await redis.set('player:'+q.pid,p);s.json({ok:1,player:p})})}catch(e){s.status(400).json({error:e.message})}});
app.post('/api/auction/bid',auth,async(q,s)=>{try{const id=String(q.body.id),amt=Math.floor(+q.body.amount),a0=await redis.get('auc:'+id);if(!a0)throw new Error('終了しました');
 await withLocks(['auc'+id,q.pid,a0.bidder].filter(Boolean),async()=>{const a=await redis.get('auc:'+id);if(!a||a.end<=Date.now())throw new Error('終了しました');if(a.bidder!=a0.bidder)throw new Error('もう一度お試しください');if(a.seller==q.pid)throw new Error('自分の出品には入札できません');if(a.bidder==q.pid)throw new Error('すでに最高額です');
  const need=a.bid?a.bid+Math.max(1000,Math.round(a.bid*.05)):a.min;if(!(amt>=need))throw new Error('最低入札額は'+Y(need));const p=await redis.get('player:'+q.pid);if(p.hs.length>=10)throw new Error('厩舎が満杯です');if(p.m<amt)throw new Error('資金が足りません');
  if(a.bidder){const o=await redis.get('player:'+a.bidder);if(o){o.m+=a.bid;inbox(o,`${a.horse.n}に、より高い入札が入りました(返金${Y(a.bid)})`);await redis.set('player:'+a.bidder,o)}}
  p.m-=amt;a.bid=amt;a.bidder=q.pid;a.bname=p.name;if(a.end-Date.now()<60000)a.end+=60000;await redis.set('auc:'+id,a);await redis.set('player:'+q.pid,p);s.json({ok:1,player:p})})}catch(e){s.status(400).json({error:e.message})}});
app.post('/api/auction/cancel',auth,async(q,s)=>{try{const id=String(q.body.id);await withLocks(['auc'+id,q.pid],async()=>{const a=await redis.get('auc:'+id);if(!a||a.seller!=q.pid)throw new Error('not found');if(a.bidder)throw new Error('すでに入札があります');const p=await redis.get('player:'+q.pid);if(p.hs.length<10)p.hs.push(a.horse);else(p.stud=p.stud||[]).push(a.horse);p.ac=Math.max(0,(p.ac|0)-1);await redis.del('auc:'+id);await redis.srem('auc:ids',id);await redis.set('player:'+q.pid,p);s.json({ok:1,player:p})})}catch(e){s.status(400).json({error:e.message})}});

// ---- オンラインルーム(単一インスタンス前提・状態はRedisにも保存) ----
const server=http.createServer(app),wss=new WebSocketServer({server,path:'/ws'}),rooms=new Map(),PZ=[1,.4,.2,.1,.05,.03,.02,.01],PT=[30,18,10,5,0,-3,-5,-8];
const send=(w,d)=>{if(w&&w.readyState==1)w.send(JSON.stringify(d))};
function view(r){return{type:'room',id:r.id,st:r.st,dist:r.dist,mode:r.mode,cond:r.cond,tier:r.tier,round:r.round,players:[...r.pl.values()].map(p=>({name:p.name,horse:p.horse?p.horse.n:null,ready:p.ready,online:!!p.ws})),npc:Math.max(0,8-[...r.pl.values()].filter(p=>p.horse).length)}}
function cast(r,d){const m=d||view(r);r.pl.forEach(p=>send(p.ws,m));redis.set('room:'+r.id,{st:r.st,dist:r.dist,res:r.res||null},{ex:600}).catch(()=>{})}
function mkRoom(mode,id,tier){const r={tier,cond:Object.assign(R.cond(),{big:mode=='ranked'||mode=='tour'}),round:0,tp:{},id:id||crypto.randomBytes(2).toString('hex').toUpperCase(),mode,st:'WAITING',dist:[1200,1600,2000,2400][Math.floor(Math.random()*4)],pl:new Map()};rooms.set(r.id,r);r.timer=setTimeout(()=>start(r),['quick','ranked','tour'].includes(mode)?25000:120000);return r}
async function start(r){clearTimeout(r.timer);if(r.st!='WAITING')return;if(r.round){r.cond=Object.assign(R.cond(),{big:1});r.dist=[1200,1600,2000,2400][Math.floor(Math.random()*4)]}const hum=[...r.pl.entries()].filter(([,p])=>p.horse);
 if(!hum.length){r.timer=setTimeout(()=>start(r),20000);return}
 const avg=Math.round(hum.reduce((a,[,p])=>a+R.ovr(p.horse),0)/hum.length),en=hum.map(([pid,p])=>({pid,name:p.horse.n,owner:p.name,h:p.horse}));
 while(en.length<8){const n=R.npc(avg);en.push({pid:null,name:n.n,owner:'NPC',h:n})}
 en.sort(()=>Math.random()-.5);r.en=en;r.sims=R.makeSims(en,r.dist,r.cond);r.bets=[];r.done=new Set();r.st='BETTING';
 const ow=en.map((x,i)=>R.odds(r.sims,'win',[i])),pop=ow.map(o=>ow.filter(q=>q<o).length+1);
 r.oddsMsg={type:'odds',id:r.id,dist:r.dist,secs:25,cond:r.cond,round:r.round,tour:r.mode=='tour',entries:en.map((x,i)=>({name:x.name,owner:x.owner,st:x.h.st,win:ow[i],pop:pop[i]})),sims:R.packSims(r.sims)};
 cast(r,r.oddsMsg);r.timer=setTimeout(()=>run(r),25000)}
async function run(r){clearTimeout(r.timer);if(r.st!='BETTING')return;r.st='RACING';cast(r);const en=r.en,sim=R.simulate(en,r.dist,r.cond),raceId=r.id+'-'+Date.now(),pay={};
 const pids=new Set([...en.filter(x=>x.pid).map(x=>x.pid),...r.bets.map(b=>b.pid)]);
 for(const pid of pids){const idx=en.findIndex(x=>x.pid==pid),pos=idx<0?-1:sim.order.indexOf(idx),prize=pos<0?0:Math.round(100000*PZ[pos]*(curEv()?1.5:1)),mine=r.bets.filter(b=>b.pid==pid),bp=mine.reduce((a,b)=>a+(R.mt(b.t,b.sel,sim.order)?Math.round(b.a*b.o):0),0);
  try{if(!await redis.set(`paid:${raceId}:${pid}`,1,{nx:true,ex:86400}))continue;// 二重報酬防止(賞金+払戻を1回で処理)
   const p=await redis.get('player:'+pid);if(!p)continue;p.m+=prize+bp;tally(p,pos,prize,mine.map(b=>R.mt(b.t,b.sel,sim.order)?b.o:0),0,0);
   if(pos>=0){p.r++;if(!pos)p.w++;if(r.mode=='ranked')p.pts=Math.max(0,(p.pts||1000)+PT[pos]);const h=p.hs.find(y=>y.n==en[idx].name);if(h){h.r++;if(!pos)h.w++;h.fat=Math.min(100,h.fat+20);h.e=(h.e||0)+prize;await redis.zadd('rank:h',{score:h.e,member:p.name+'/'+h.n})}await redis.zadd('rank:pts',{score:p.pts,member:p.name});roll(p);p.sp.pts+=[10,7,5,3,2,1,0,0][pos];await redis.zadd('rank:s:'+p.sp.s,{score:p.sp.pts,member:p.name});const ev=curEv();if(ev){const key=evKey(ev);p.ev=p.ev&&p.ev.id==key?p.ev:{id:key,w:0};if(!pos){p.ev.w++;if(p.ev.w>=3)grant(p,ev.skin)}}}
   if(pos>=0){p.rv=p.rv||{};for(const o of en)if(o.pid&&o.pid!=pid){const kk=o.owner+'/'+o.name,v=p.rv[kk]=p.rv[kk]||{n:0,w:0};v.n++;if(pos<sim.order.indexOf(en.indexOf(o)))v.w++}const ks=Object.keys(p.rv);if(ks.length>40)ks.slice(0,ks.length-40).forEach(x=>delete p.rv[x])}await redis.set('player:'+pid,p);pay[p.name]={prize,bet:bp,stake:mine.reduce((a,b)=>a+b.a,0)}}catch(e){console.error(e)}}
 const res={raceId,dist:r.dist,cond:r.cond,order:sim.order,pay,entries:en.map((x,i)=>({name:x.name,owner:x.owner,st:x.h.st,skin:x.h.skin||null,gear:x.h.gear||null,pat:x.h.pat??null,fx:x.h.fx||null,jr:x.h.jr||null,silk:x.h.silk||null,...sim.anim[i]}))};r.res=res;
 r.st='RESULT';
 if(r.mode=='tour'){r.round++;sim.order.forEach((i,k)=>{const x=en[i];if(x.pid)r.tp[x.owner]=(r.tp[x.owner]||0)+[10,7,5,3,2,1,0,0][k]});res.tour={round:r.round,table:Object.entries(r.tp).sort((a,b)=>b[1]-a[1])}}
 cast(r,{type:'result',...res});
 if(r.mode=='tour'&&r.round<3){r.timer=setTimeout(()=>{r.st='WAITING';r.res=null;start(r)},45000);return}
 if(r.mode=='tour'){const w=res.tour.table[0],e=w&&[...r.pl.entries()].find(([,p])=>p.name==w[0]);if(e)redis.get('player:'+e[0]).then(p=>{if(p){p.m+=200000;grant(p,'e_trophy');return redis.set('player:'+e[0],p)}}).catch(()=>{})}
 r.pl.forEach((p,pid)=>redis.del('pr:'+pid).catch(()=>{}));
 setTimeout(()=>{r.st='FINISHED';rooms.delete(r.id)},60000)}
wss.on('connection',async(ws,q)=>{let pid;try{pid=jwt.verify(new URL(q.url,'http://x').searchParams.get('token'),SECRET).pid}catch(e){return ws.close(4001)}
 const me=await redis.get('player:'+pid);if(!me)return ws.close(4001);let msgs=0;const t=setInterval(()=>msgs=0,5000);redis.set('on:'+pid,1,{ex:60}).catch(()=>{});const pi=setInterval(()=>redis.set('on:'+pid,1,{ex:60}).catch(()=>{}),30000);ws.on('close',()=>{clearInterval(t);clearInterval(pi);redis.del('on:'+pid).catch(()=>{});const r=rooms.get(cur()?.id);if(r){const p=r.pl.get(pid);if(p){p.ws=null;if(!p.horse)r.pl.delete(pid);cast(r)}}});
 const cur=()=>[...rooms.values()].find(r=>r.pl.has(pid));
 const rr=cur();if(rr){rr.pl.get(pid).ws=ws;send(ws,rr.st=='RESULT'&&rr.res?{type:'result',...rr.res}:rr.st=='BETTING'&&rr.oddsMsg?rr.oddsMsg:view(rr))}// 再接続
 ws.on('message',async raw=>{if(++msgs>20)return;let d;try{d=JSON.parse(raw)}catch(e){return}let r=cur();
  if(d.type=='join'&&!r){if(!(me.r>0||(me.tut&&me.tut.win>=1)))return send(ws,{type:'error',msg:'オンラインはソロレースで初勝利すると解放されます'});r=d.mode=='room'?mkRoom('room'):d.mode=='code'?rooms.get(String(d.code||'').toUpperCase()):['ranked','tour'].includes(d.mode)?findOrMk(d.mode,TI(me.pts)):findOrMk('quick');
   if(!r||r.st!='WAITING'||r.pl.size>=8)return send(ws,{type:'error',msg:'参加できません'});r.pl.set(pid,{name:me.name,ws,horse:null,ready:false});redis.set('pr:'+pid,r.id,{ex:900}).catch(()=>{});cast(r)}
  else if(r&&r.st=='WAITING'){const p=r.pl.get(pid);
   if(d.type=='pick'){const p2=await redis.get('player:'+pid),h=p2&&p2.hs[d.idx|0];if(h){if(r.mode=='ranked'&&R.ovr(h)>CAP[r.tier])return send(ws,{type:'error',msg:'このランクでは総合'+CAP[r.tier]+'までの馬が出走できます'});p.horse=R.sanitize(h);p.horse.skin=h.skin;p.horse.gear=h.gear;p.horse.pat=h.pat;p.horse.fx=h.fx;p.horse.jr=p2.eq&&p2.eq.rider;p.horse.silk=p2.eq&&p2.eq.silk;p.horse.jb=R.jb(p2.jk,h.st);p.ready=false;cast(r)}}// 能力はサーバー保存値を使用
   else if(d.type=='ready'&&p.horse){p.ready=true;cast(r);if([...r.pl.values()].filter(x=>x.horse).every(x=>x.ready)&&r.mode=='room'&&r.pl.size>=1&&d.go)start(r);else if(['quick','ranked','tour'].includes(r.mode)&&r.pl.size>=8&&[...r.pl.values()].every(x=>x.ready))start(r)}
   else if(d.type=='leave'){r.pl.delete(pid);redis.del('pr:'+pid).catch(()=>{});if(!r.pl.size){clearTimeout(r.timer);rooms.delete(r.id)}else cast(r)}}
  else if(r&&r.st=='BETTING'){
   if(d.type=='bet'){const need=R.TYN[d.t],sel=Array.isArray(d.sel)?d.sel.map(Number):[],a=Math.floor(+d.a);
    if(!need||sel.length!=need||new Set(sel).size!=need||sel.some(i=>!(i>=0&&i<8))||!(a>=100&&a<=100000))return send(ws,{type:'error',msg:'馬券が不正です'});
    const lk='lock:'+pid;if(!await redis.set(lk,1,{nx:true,ex:3}))return send(ws,{type:'error',msg:'処理中です'});
    try{const p=await redis.get('player:'+pid);if(!p||p.m<a)return send(ws,{type:'error',msg:'資金が足りません'});p.m-=a;await redis.set('player:'+pid,p);r.bets.push({pid,t:d.t,sel,a,o:R.odds(r.sims,d.t,sel)});
     send(ws,{type:'bet_ok',m:p.m,bets:r.bets.filter(b=>b.pid==pid).map(({t,sel,a,o})=>({t,sel,a,o}))})}catch(e){console.error(e)}finally{await redis.del(lk).catch(()=>{})}}
   else if(d.type=='betsdone'){r.done.add(pid);if([...r.pl.entries()].filter(([,x])=>x.ws).every(([id])=>r.done.has(id)))run(r)}}
  })});
const PORT=process.env.PORT||3000;server.listen(PORT,()=>console.log('listening',PORT));
