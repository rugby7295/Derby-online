# DERBY DYNASTY ONLINE

育てた馬を最大8頭立てのオンラインレースへ。不足枠はNPC補充、レース結果はサーバーが確定。

## 構成
- `frontend/index.html` … 単体版ゲーム(育成・レース・馬券・実況・設定)
- `backend/` … Express + WebSocket サーバー(認証・保存・マッチング・サーバー側レース計算・ランキング)
- Upstash Redis … ユーザー/プレイヤー保存、ルーム状態、レート制限、ランキング、二重報酬防止

## ローカル起動
```
cp .env.example backend/.env   # 値を設定(.envはGit管理しない)
cd backend && npm install
export $(cat .env | xargs) && npm run dev
```
http://localhost:3000 を開く。

## Upstash
1. https://console.upstash.com で Redis を作成
2. REST URL / REST TOKEN を `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` に設定

## GitHub → Render
1. このフォルダをGitHubへpush
2. Render で New → Blueprint(`render.yaml`)を選択
3. Render側の環境変数に Upstash の2値を設定(JWT_SECRETは自動生成)
4. push するたびに自動デプロイ。**インスタンスは1台**で運用(ルームはメモリ保持のため)

## API
| | |
|--|--|
| POST /api/auth/register, /login | `{name,password}` → `{token}` |
| GET /api/player | 要 `Authorization: Bearer` |
| POST /api/player/import | 単体版の馬を初回のみ取り込み(値は範囲制限) |
| GET /api/rankings | 上位20 |
| POST /api/horses/:i/train `{k}` / :i/auto / :i/sell | サーバー権威の育成・売却(排他ロックあり) |
| GET /api/market, POST /api/market/:i/buy | 馬市場(プレイヤー別) |
| GET /api/achievements | 実績と称号 |
| POST /api/horses/:i/retire, /api/breed | 引退(5戦以上)・繁殖(血統を継承、¥50,000) |
| GET /api/shop, POST /api/shop/buy, /equip | 見た目スキン(馬・勝負服・競馬場)。能力には影響なし |
| GET /api/staff, POST /api/staff/hire | 騎手(脚質適性+5%)・調教師(育成ボーナス) |
| GET /api/friends, POST /api/friends/add | フレンド(相互登録・オンライン状態・ルームコード) |
| GET /api/event, GET /api/rankings?season=1 | 季節イベント(賞金1.5倍・限定スキン)・月次シーズン |
| POST /api/work/start, /finish | 地下労働(破産時のみ・6秒以上・1日¥12,000まで) |

## WebSocket `/ws?token=...`
送信: `{type:'bet',t,sel,a}`(馬券。BETTING中のみ)/`{type:'betsdone'}`/`{type:'join',mode:'quick'|'room'|'code',code?}` / `{type:'pick',idx}` / `{type:'ready',go?}` / `{type:'leave'}`
受信: `odds`(オッズ表と確率シミュレーション。馬券受付25秒)/`bet_ok`/`room`(状態: WAITING→BETTING→RACING→RESULT。馬券は単勝〜3連単、自分/他人/NPCの馬に購入可。購入額はサーバー残高から即時控除し、払戻は賞金と同時に1回だけ付与)、`result`(order と各馬のアニメーション係数 T,c,a。クライアントは単体版と同じ式で再生)、`error`
切断してもレースは進行し、再接続すると状態/結果が復元されます。

## 未実装・要対応(正直ベース)
- 本リポジトリのコードは実行テスト未実施(構文確認のみ)。デプロイ後に複数ブラウザで確認してください
- フロントのオンライン画面(登録/ログイン・クイックマッチ・ルーム・馬選択・結果再生・ランキング)は実装済みだが未検証
- 登録時にサーバー側で初期馬を付与。育成・売買・購入はサーバーAPIで行う(オンライン画面)。単体版との取り込みは初回のみ・クライアント値を範囲制限して受け入れる暫定仕様(完全にチートを防ぐなら取り込みを廃止)
- `/api/player/import` は初回のみクライアント値を受け入れる暫定仕様。育成/売買/購入をサーバーAPI化すると完全なチート対策になります
- ランクマッチ(今回は見送り)、大会は未実装。フレンド追加は相手の承認なしで相互登録される簡易仕様

## デプロイ手順(GitHub → Render、Web Service方式)
1. GitHubに新規リポジトリを作り、このフォルダをpush(`.env` は含めない)
2. Upstash: Redisを作成 → REST URL と REST TOKEN をコピー
3. Render: New → Web Service → リポジトリを選択
   - Build Command: `cd backend && npm install`
   - Start Command: `cd backend && npm start`
   - Environment: `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` / `JWT_SECRET`(長いランダム文字列) / `NODE_ENV=production`
   - インスタンス数は1(ルームがメモリ保持のため)
4. 以降はpushするたびに自動デプロイ。無料プランは無操作でスリープするため、初回アクセスに時間がかかります
