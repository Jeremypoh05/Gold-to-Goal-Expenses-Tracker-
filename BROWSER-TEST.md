# Honey — 浏览器手测清单(2026-07 四轮改动)

> 目的:验证 `2663db4` 之后 4 轮未提交的改动在真实浏览器里的表现。
> 全部通过 → 叫 Claude commit。任何一条不对 → 记下条目编号 + 你输入的原话 + 实际表现。

## 准备

- [ ] 停掉 dev server → 删除 `.next` 文件夹 → `npx next build` 应该全绿(之前的 build 报错是 dev 缓存损坏,不是代码)
- [ ] 重新 `npm run dev`,登录你的账号
- [ ] 开着 Prisma Studio 的 `AiUsageLog` 表,方便对照每条消息用了哪个模型
  - `gpt-5.4-mini` = 便宜档 · `claude-haiku-…` = 中档 · `claude-sonnet-5` = 贵档

---

## A · 多语言记账(mini 档)

| # | 输入(照抄) | 期望 |
|---|---|---|
| A1 | `lunch 12 yesterday` | 1 张卡,Food,昨天日期;回复是**英文** |
| A2 | `昨天午餐12块` | 1 张卡;回复是**中文** |
| A3 | `makan tengah hari 12`(马来语) | 1 张卡,Food;回复是**马来语**(不是中文!) |
| A4 | `beli kopi 5 ringgit semalam` | 1 张卡,**MYR** RM5,昨天 |
| A5 | `咖啡5块，还有午餐12块` | **2 张卡** |
| A6 | `晚餐麦当劳20块，标签帮我加晚餐` | note=麦当劳(不是"晚餐"),tag=晚餐 |
| A7 | `上个星期五买书30块` | 1 张卡,日期=上周五的**正确日期**(对日历算) |
| A8 | AiUsageLog 检查 | A1-A7 每条只有 1 行 `gpt-5.4-mini`,**没有** Sonnet 行 |

## B · 三件套(兜底,Sonnet)

| # | 输入 | 期望 |
|---|---|---|
| B1 | `可以帮我导出 Excel 吗？` | 诚实说不支持 + 给 `jeremypoh0205@gmail.com` 反馈邮箱;**中文回复** |
| B2 | `boleh export data saya tak?` | 同上但**全马来语**回复 |
| B3 | `今天天气怎么样？` | 温和拉回记账主题,**没有**邮箱 |
| B4 | `which stocks should I buy?` | 婉拒投资建议,**没有**邮箱 |

## C · 按描述改/删旧账(edit_search / delete_search,Haiku 档)

先随便记几笔有名字的账(如"奶茶20"),然后:

| # | 输入 | 期望 |
|---|---|---|
| C1 | `帮我修改7月14号的奶茶去100块` | **秒出**(≈1-2s)修改卡,改的是**奶茶那笔**(前后对比) |
| C2 | `删除7月14号的日本餐`(换成你 DB 里真实存在的) | 秒出删除卡,对象正确 |
| C3 | 先记一笔 A,**不要确认**,然后 C1 式改**另一笔** | 改的是描述的那笔,**不是**刚记的 A |
| C4 | 故意说错日期:`把7月1号的奶茶改成200`(奶茶其实在14号) | 仍找到奶茶,卡片显示**真实日期** |
| C5 | `我之前买的耳机帮我改成160`("之前"两个字) | 走 Haiku 秒出(以前这句会慢速走 Sonnet) |
| C6 | `把7月14号的food那笔改成100`(那天有多笔 food) | **列出候选清单**问你要改哪一笔(不瞎改) |
| C7 | AiUsageLog 检查 | C1-C6 都是 Haiku 行,没有 Sonnet |

## D · 查询(search_query,Haiku 档 — 新)

| # | 输入 | 期望 |
|---|---|---|
| D1 | `这个月最贵的一笔是什么？` | 直接文字回答(日期+金额+名字),**快**,无卡片 |
| D2 | `what's the cheapest thing I bought this month?` | 英文回答最便宜一笔 |
| D3 | `帮我列一下这个月food类的消费` | 列表;超过 5 笔时显示 `5+` 和"还有更多"提示 |
| D4 | `这个月花了多少？` | 总额模板回答(旧功能,回归检查) |
| D5 | AiUsageLog 检查 | D1-D4 只有 Haiku 行 |

## E · 模糊消息 & 澄清(clarify — 新)

| # | 输入 | 期望 |
|---|---|---|
| E1 | `200`(就一个数字) | AI **自己问**"200块是买了什么?"(快,Haiku),或直接建卡让你改 — 两者都算对 |
| E2 | 有挂卡时:`这笔不对，帮我改一下`(没说改成什么) | AI 问"要改成什么?" |
| E3 | `log lunch 12 today, and how much did I spend on food this month?` | **走 Sonnet**(多意图),两个问题都被处理,不会只答一半 |
| E4 | `再做一个像我们刚才讨论的那样` | **走 Sonnet**(引用历史),不会傻问"讨论了什么?" |

## F · 路由经济性(挂卡不再逼 Haiku)

| # | 操作 | 期望 |
|---|---|---|
| F1 | 连续记 3 笔(`咖啡5块` → `午餐12块` → `打车8块`),**全程不点确认** | 3 张卡都出;AiUsageLog 3 条都是 **mini**(以前第 2、3 条会变 Haiku) |

## G · 卡片状态智能(你描述的场景 — 大部分已有,验证一下)

| # | 操作 | 期望 |
|---|---|---|
| G1 | 记 `午餐100块` → **不点**确认 → 问 `我刚才那笔午餐记好了吗？` | AI 知道卡还**挂着等你确认**,提醒你去点 |
| G2 | 记 `午餐100块` → 点 **Cancel** → 问 `那个100块的午餐你觉得贵吗？` | AI 知道这笔**被取消了、没有入账**,回答时会说明 |
| G3 | 记一笔 → 点 Cancel → 说 `还是帮我记回来吧` | AI 重新出一张**新卡**(不会说"卡片已经在了") |

## H · 旧功能回归(抽查,防止改坏)

| # | 操作 | 期望 |
|---|---|---|
| H1 | Quick mic 语音记一笔 | 正常出卡,confirm 后 ledger 有 voice 标记 |
| H2 | `把房租改成1300` | 走 Sonnet,问 rate_change/redefine(recurring 流程不变) |
| H3 | `这个月关账` | 关账确认卡正常 |
| H4 | 编辑卡片(Edit 按钮手动改字段) | 正常保存 |
| H5 | 确认一张卡后,背后页面(dashboard/ledger)数字即时刷新 | 不用手动刷新 |

## H3 · 真·多语言(2026-07-18 新增)

| # | 输入 | 期望 |
|---|---|---|
| H3-1 | 日语记账 `昨日ラーメンに12使った` | 出卡 + **日语回复**(以前会回中文) |
| H3-2 | 日语问 `今月いくら使った？` | **日语回答**(走 Sonnet;以前回中文) |
| H3-3 | 法语问 `Combien ai-je dépensé ce mois-ci ?` | **法语回答**(以前回英文) |
| H3-4 | 马来语问 `berapa saya belanja bulan ini?` | **马来语回答** |
| H3-5 | 中文/英文问总额 | 各自语言,秒答(便宜模板,不变) |
| H3-6 | 韩语/泰语随便记一笔或问一句 | 用该语言回复 |

## H4 · STT 逐字转录(2026-07-18 新增,只能语音测)

用 **quick mic** 或聊天框的麦克风说:

| # | 说 | 期望转录 |
|---|---|---|
| H4-1 | "wanton mee 15块" | `wanton mee 15块`(不是"混沌面/馄饨") |
| H4-2 | "popiah 一百块" | `popiah 100块`(不是"保镖") |
| H4-3 | "买了 Eclipse 糖果 3块" | 保留 `Eclipse`(不是笼统"一颗糖果") |
| H4-4 | "Daniel Wellington 手表 200" | 出现 `Daniel Wellington`(音译拉丁字母,不译成中文) |
| H4-5 | 混语 "今天 lunch 吃 char kway teow 8块" | 各词保留原文,金额正确 |

## H2 · 废话/三件套现在走 Haiku,不再碰 Sonnet(2026-07-17 新增)

| # | 输入 | 期望 |
|---|---|---|
| H2-1 | `今天天气怎么样` | Haiku 秒答拉回主题(AiUsageLog 只出 Haiku 行,**没有** Sonnet) |
| H2-2 | `可以帮我导出6月份的Excel吗` | Haiku 诚实说不支持 + **可点击的** `jeremypoh0205@gmail.com` mailto 链接;只 Haiku,无 Sonnet |
| H2-3 | `boleh export ke Excel tak?`(马来语) | 全马来语回复 + mailto 链接,只 Haiku |
| H2-4 | `which stocks should I buy?` | Haiku 婉拒投资建议,无邮箱;只 Haiku |
| H2-5 | `log something for lunch`(缺金额) | Haiku 直接问"多少钱/买了什么",不转 Sonnet |
| H2-6 | `log lunch 12 today, and how much did I spend on food this month?`(多意图) | **走 Sonnet**(两部分都要处理,不能只问一半) |
| H2-7 | `do another one for the 16th, like we just discussed`(引用历史) | **走 Sonnet**(Haiku 看不到历史,不该硬问) |

## I · Settings 页 + AI 配额(2026-07-17 新增)

先在 `.env.local` 里**不要**设 `ADMIN_USERS`(测普通用户视角),测完再设回你的邮箱。

| # | 操作 | 期望 |
|---|---|---|
| I1 | Sidebar(桌面)/ More sheet(手机)点 **Settings** | 打开 /settings:今日两条配额进度条(Quick AI x/150、Advanced AI x/30)+ 本月用量表(calls/tokens/≈cost) |
| I2 | 发几条 AI 消息后刷新 Settings | 进度条数字增长 |
| I3 | `.env.local` 加 `AI_QUOTA_AGENT_DAILY=0`,重启 dev,问 `为什么我这个月花这么多?` | 友好提示"复杂问题额度用完…简单记账还能用",**语言跟随你的消息**;此时 `记一笔咖啡5块` 仍正常出卡 |
| I4 | 再加 `AI_QUOTA_FAST_DAILY=0`,重启,发任意 AI 消息 | 友好提示"今天 AI 额度全部用完…手动记账不受影响";手动记账按钮确实正常 |
| I5 | `.env.local` 设 `ADMIN_USERS=你的邮箱`,重启 | Settings 显示 "Admin account — no limits";AI 全部恢复,进度条显示 ∞ |
| I6 | 测完删掉两个 `AI_QUOTA_*` 行,保留 `ADMIN_USERS` | 恢复正常 |
| I7(新) | 去掉 `ADMIN_USERS`,设 `AI_QUOTA_FAST_DAILY=0`,重启,在 chat 里发一条消息 | 输入框上方出现**警告条**:两个"Continue with Advanced AI / Pause AI for today"按钮 |
| I8(新) | 点 **Continue with Advanced AI** | 该消息走 Sonnet 正常回答;警告条变成"Running on Advanced AI for the rest of today" |
| I9(新) | 不刷新页面,切到 Settings 页 | "When Quick AI runs out" 那栏**立刻**显示"Continue on Advanced AI"被选中(不用手动刷新) |
| I10(新) | 在 Settings 页把选项改成 **Pause AI for today** | 不刷新,回到 chat/quick mic,警告条**立刻**变成"AI paused until midnight, as you chose" |
| I11(新) | 用 quick mic 说一句话 | 同样看到配额警告条(格式紧凑版) |
| I12(新) | 测完删掉 `AI_QUOTA_FAST_DAILY=0`,重启 | 恢复正常,警告条消失 |

---

## 结果记录

- 全过 → 告诉 Claude "手测通过,commit"
- 有问题 → 记下:条目编号、你输入的原话、实际表现(截图更好)
