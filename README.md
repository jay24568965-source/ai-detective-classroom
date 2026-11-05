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

可选环境变量：`PORT=3080`。

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
3. **WASD / 方向键** 移动，**E** 调查或交谈（触屏有虚拟键）。
4. 调查物品 → 证据板；问询 5 名嫌疑人（界面标注 **演示问答（Mock）**）。
5. 在工作台做计算/笔记；投票开启后回大厅/指挥室找 **调查主持人** 提交 **唯一一次** 最终指认（证据 + 依据）。
6. 提交后只显示「已提交，等待揭晓」；揭晓后显示 **合格 / 不合格 / 未提交**。

## 案件配置

- `cases/physics.json` — 正式内容（道路勘查区 + 调查指挥室，E01–E12，E13–E15 为计算字段，答案=前车司机 A）。
- `cases/chemistry.json` — 可玩骨架（大厅/走廊/厨房/浴室，答案=周姨；多处 TODO）。

两案共用同一套移动、调查、问询、投票、日志系统。

## AI 问询

- 当前仅 **Mock 预设问答**，无需 API Key，可离线演示。
- 前端 `public/js/ai-adapter.js` 为可替换适配层；未来 Convai 应走 **服务端代理**，禁止把密钥放进前端或 `localStorage`。

## 已知限制

- 地图为 CSS/Canvas 占位，非组员手绘资产（故意避开 `D:/WeChat...` 路径）。
- 内存教室状态，进程重启后课堂消失（令牌失效需新建）。
- 化学案证据/人物为骨架，科学争议处见 `CONFLICTS_OR_TODOS.md`。
- 无第二轮投票、排除名单、选错补发线索（按课堂规则取消）。
- 多标签页同组：共用服务端进度；本地画布位置以最后同步为准。

## 目录

```
server.js              Express + 内存课堂
public/                静态前端
cases/                 案件 JSON
tests/acceptance.js    API 验收脚本
TEST_RESULTS.md
CONFLICTS_OR_TODOS.md
KEYWORDS.txt           需求来源摘要
```

## 分享给老师（不用装 Node）

临时公网演示可用 Cloudflare Tunnel 指向正在运行的 `npm start`（进程关掉链接就失效，课堂状态也在内存里）。

长期固定链接：把仓库部署到 [Render](https://dashboard.render.com) Web Service（`npm install` / `npm start`），选不休眠的实例；仓库里可有 `render.yaml` / `Dockerfile` / `fly.toml` 作参考。

角色形象为自绘马里奥风格剪影，非正式任天堂素材。
