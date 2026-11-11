# AI侦探课堂（MVP）

INT6066 小组项目 · 网页与测试交付（苏俊华）  
可运行课堂闭环：教师建房 → 小组加入 → 探索/搜证/Mock 问询/科学分析 → 单轮投票 → 统一揭晓 → 导出日志。

## 启动

```bash
cd /workspace/ai-detective-classroom
npm install
npm start
```

浏览器打开：<http://127.0.0.1:3080>

可选环境变量：`PORT=3080`。嫌疑人问询另见下方 **AI 问询**（`DEEPSEEK_API_KEY`）。

自动化验收：

```bash
npm test
```

## 角色流程

### 教师
1. 打开「教师控制台」，选择 **物理《意外的急刹车》** 或 **化学《台风夜老宅》**，创建课堂。
2. 将 **课堂码** 发给学生。
3. 按教学推进 **第一/二/三幕**（解锁对应证据）。
4. 可发送辅助提示、暂停调查。
5. 调查结束后 **开启最终投票** → 各组提交后 **关闭投票** → **统一揭晓**。
6. 导出 **JSON / CSV** 学习记录。

教师令牌保存在本机 `localStorage`（`ai-detective-teacher`），刷新可「恢复上次」。  
标准答案与合格判定只在服务端；揭晓前学生接口不含正确答案。

### 学生 / 小组
1. 打开「学生端」，输入课堂码、自定小组 ID（如 `G1`）与显示名后加入。
2. 同组共用一个侦探角色；令牌保存在 `localStorage`（`ai-detective-student`），刷新点「用本机令牌重连」。
3. **点击或轻触地面**移动侦探；**点击线索、人物或门**会先走过去再调查或交谈（已经站在旁边则立刻打开）。手机和平板同样点按，不再使用 WASD 或虚拟方向键。
4. 调查物品 → 证据板；问询 5 名嫌疑人。未配置 DeepSeek 时界面标注 **演示问答（Mock）**；某次提问由 DeepSeek 成功作答后改为 **真实AI（DeepSeek）**。
5. 在工作台做计算/笔记；投票开启后回大厅/指挥室找 **调查主持人** 提交 **唯一一次** 最终指认（证据 + 依据）。
6. 提交后只显示「已提交，等待揭晓」；揭晓后显示 **合格 / 不合格 / 未提交**。

## 语言 / Language

首页、教师端、学生端右上角有 **简体 | 繁體 | EN**。默认简体中文。选择写在本机 `localStorage` 键 `ai-detective-lang`（`zh`、`zh-TW` 或 `en`）。以前保存的 `zh` / `en` 仍然有效。三个页面共用，刷新后仍在。

切换会立刻更新界面文案，以及案件标题、背景、简报、嫌疑人姓名/人物卡/问答、证据、计算题、投票题、主持人台词和揭晓说明。不需要重建课堂。英文在 `cases/*.json` 的 `i18n.en`，繁體中文在 `i18n.zh-TW`。课堂码和 `caseId` 不变。马里奥风格剪影的 `sprite` 字段不翻译。

接口默认仍返回简体中文。英文公开案件加 `?lang=en` 或请求头 `x-lang: en`；繁體加 `?lang=zh-TW` 或 `x-lang: zh-TW`（`zh-tw` 也可以）。成绩码（合格 / 不合格 / 未提交）和导出的 CSV 仍用简体中文，界面上会按当前语言显示。

## 案件配置

- `cases/physics.json` — 正式内容（道路勘查区 + 调查指挥室，E01–E12，E13–E15 为计算字段，答案=前车司机 A）。
- `cases/chemistry.json` — 可玩骨架（大厅/走廊/厨房/浴室，答案=周姨；多处 TODO）。

两案共用同一套移动、调查、问询、投票、日志系统。

## AI 问询

嫌疑人提问（预设按钮或自由输入）都走服务端 `POST /api/student/:code/interview`。

- **未设置 `DEEPSEEK_API_KEY`**：使用案件里的 **Mock 预设问答**，可离线演示。界面保持「演示问答（Mock）」/「示範問答（Mock）」/「Demo Q&A (Mock)」。
- **已设置密钥**：服务端用 [DeepSeek](https://api.deepseek.com) 的 OpenAI 兼容接口 `POST /chat/completions`。提示词按课堂当前幕次研读剧本：该人物的人物卡与预设问答，加上本幕及更早幕已解锁证据的学生可见事实（简体 / 繁體 / English 跟随 `?lang=` 或 `x-lang`）。稍后才解锁的测量不会写进更早幕的提示。标准答案、揭晓摘要、教师注释，以及计算结果类证据（终局重建数字）始终不进入提示。成功时响应为 `mode: "live"`，`adapter.provider` 为 `deepseek`，界面改为「真实AI（DeepSeek）」/「真實 AI（DeepSeek）」/「Live AI (DeepSeek)」。
- **超时、4xx/5xx 或空回复**：这一问退回 Mock，仍返回答案，界面保持 Mock 文案。默认超时约 16 秒。
- 模型名可选，环境变量 `DEEPSEEK_MODEL`，默认 `deepseek-chat`。
- 密钥只放在运行环境里。不要写进前端、案件 JSON、git 或 `localStorage`。本地可复制 `.env.example` 为 `.env`（`.env` 已被忽略）。

Render 自动部署 `main` 时，在 Web Service 的 **Environment** 里新增 `DEEPSEEK_API_KEY`（`render.yaml` 里该变量为 `sync: false`，值只存在仪表盘）。不填则线上继续是 Mock。可选再设 `DEEPSEEK_MODEL=deepseek-chat`。

前端 `public/js/ai-adapter.js` 只把问题和服务器返回的 `mode` 交给页面，不保存密钥。

## 已知限制

- 场景用 Canvas 绘制（道路夜雨 / 台风老宅），不是组员手绘资产（故意避开 `D:/WeChat...` 路径）。
- 内存教室状态，进程重启后课堂消失（令牌失效需新建）。
- 化学案证据/人物为骨架，科学争议处见 `CONFLICTS_OR_TODOS.md`。
- 无第二轮投票、排除名单、选错补发线索（按课堂规则取消）。
- 多标签页同组：共用服务端进度；本地画布位置以最后同步为准。

## 目录

```
server.js              Express + 内存课堂
lib/deepseek.js        DeepSeek Chat Completions（仅服务端）
lib/ai-interview.js    人物提示词与 Mock 回退
public/                静态前端
cases/                 案件 JSON
tests/acceptance.js    API 验收（无密钥，Mock）
tests/deepseek-interview.js  桩 fetch 的 live / 回退测试
TEST_RESULTS.md
CONFLICTS_OR_TODOS.md
KEYWORDS.txt           需求来源摘要
.env.example           空的 DEEPSEEK_API_KEY 样例
```

## 分享给老师（不用装 Node）

临时公网演示可用 Cloudflare Tunnel 指向正在运行的 `npm start`（进程关掉链接就失效，课堂状态也在内存里）。

长期固定链接：把仓库部署到 [Render](https://dashboard.render.com) Web Service（`npm install` / `npm start`），选不休眠的实例；仓库里可有 `render.yaml` / `Dockerfile` / `fly.toml` 作参考。

角色形象为自绘马里奥风格剪影，非正式任天堂素材。
