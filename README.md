# 星期

一个把发薪、重要事项和天气放在一起，适合个人长期使用的 `PWA`，用于管理：

- 每月发薪日
- 到期提醒
- 30 天时间线
- 天气速览
- 本地日历导出与数据备份
- iPhone / PWA 工资与自定义事项通知（Web Push）
- 手机号密码登录与跨设备自动同步（仅校验号码格式，不发送验证码）

## 项目结构

项目现在就是单层正式结构，没有多包一层源码目录：

- [assets](assets): 图标与静态资源
- [scripts](scripts): 模块化业务逻辑
- [styles](styles): 设计系统与页面样式
- [index.html](index.html): 应用入口
- [manifest.webmanifest](manifest.webmanifest): PWA 配置
- [sw.js](sw.js): 离线缓存
- [functions](functions): Cloudflare Pages Functions 接口
- [cloudflare/d1-schema.sql](cloudflare/d1-schema.sql): 推送、账号与同步表结构
- [workers/salary-notifier](workers/salary-notifier): 定时发送发薪提醒的独立 Worker

## 提醒通知架构

这个仓库现在支持 `方案 A` 的实现方式：

- 前端 PWA 负责：
  - 申请通知权限
  - 注册 push subscription
  - 同步发薪日、推送时刻和自定义事项规则
- Cloudflare Pages Functions 负责：
  - 提供 VAPID 公钥
  - 保存 / 关闭设备订阅
- Cloudflare D1 负责：
  - 存储每台设备的工资和自定义事项提醒规则
  - 按账号保存工资与事项快照
- 独立 Cloudflare Worker + Cron 负责：
  - 每 5 分钟按北京时间检查到期的工资和自定义事项；在设定时刻所在小时内可自动补发一次
  - 按月循环发送工资 Web Push，并按单次事项发送提醒

## Cloudflare 配置

### 1. Pages 项目

在 `Pages -> Settings -> Functions` 或对应项目配置里添加：

- D1 绑定名：`DB`
- 环境变量：`VAPID_PUBLIC_KEY`

### 2. D1 建表

把 [`cloudflare/d1-schema.sql`](cloudflare/d1-schema.sql) 导入同一个 D1 数据库。

新建数据库时只导入该文件。已有数据库先执行 [`cloudflare/migrations/0002-accounts.sql`](cloudflare/migrations/0002-accounts.sql) 一次；如果曾出现 `duplicate column name: user_id`，说明推送列已创建，此时只执行 [`cloudflare/migrations/0003-create-account-tables.sql`](cloudflare/migrations/0003-create-account-tables.sql)。

### 本地测试账号功能

不要用 `python -m http.server`、Live Server 或直接双击 `index.html` 测试登录：它们只会提供静态文件，`/api/auth/*` 必然返回 404/501。

在项目根目录执行一次本地建表，再启动 Cloudflare Pages 本地服务：

```bash
npx wrangler d1 execute DB --local --file=cloudflare/d1-schema.sql
npx wrangler pages dev . --d1=DB
```

终端显示的本地网址（通常是 `http://localhost:8788`）才支持注册、登录和同步测试。要测试真实线上 D1，请直接打开 Cloudflare Pages 已部署的网址；不要在静态预览地址测试账号功能。

### 3. 定时 Worker

进入 [`workers/salary-notifier`](workers/salary-notifier)：

```bash
cd workers/salary-notifier
npm install
cp wrangler.example.toml wrangler.toml
```

然后在 `wrangler.toml` 里填：

- `database_name`
- `database_id`
- `APP_URL`
- `VAPID_SUBJECT`

再配置 secrets：

```bash
wrangler secret put VAPID_PUBLIC_KEY
wrangler secret put VAPID_PRIVATE_KEY
```

最后部署：

```bash
npm run deploy
```

## VAPID 密钥

需要一对 Web Push VAPID 密钥：

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

可以在 [`workers/salary-notifier`](workers/salary-notifier) 目录里执行：

```bash
npx web-push generate-vapid-keys
```

这对密钥必须同时给：

- Pages Functions
- salary notifier Worker

## iPhone 使用前提

想在 iPhone 上真正收到工资或事项提醒，用户必须：

- 用 Safari 打开站点
- 选择“添加到主屏幕”
- 从主屏幕图标再次打开
- 在应用内点击“开启通知并同步”
- 允许通知权限

另外注意：

- 首次使用时输入 11 位手机号；系统会自动进入登录或创建账号流程
- 手机号仅用于识别账号，不发送验证码；密码暂不支持找回，遗失后旧数据无法恢复
- 新设备用同一手机号和密码登录后，会在启动、回到前台和修改数据后自动同步
- “保存发薪设置”不会自动开启系统通知；首次请点击“开启通知并同步”授权
- 创建事项时可选择是否推送、提前几天，以及推送整点；开启一次通知权限后会自动同步
- 可以先点一次“发送测试通知”，确认当前 iPhone 的 PWA 通知权限本身正常
- 定时 Worker 会在设置时刻附近发送；若单次 Cron 延迟，会在该小时内自动补发一次。请尽量在提醒时刻前保存并同步事项

## PWA 更新

应用会在联网打开和重新回到前台时检查新版 Service Worker。新版本接管后页面会自动刷新一次，不需要删除主屏幕图标；本机数据和通知订阅不会因为代码更新或“刷新应用资源”而被清空。

## 更新方式

如果你的 Cloudflare Pages 已连接 Git 仓库，后续更新就是：

```bash
git status
git add .
git commit -m "refine payroll desk"
git push origin main
```

推送后，Cloudflare 会自动重新部署。

## 发薪日期维护

发薪日期按中国大陆实际工作日向前回退，日历覆盖范围、年度更新和本地测试见[发薪日历维护记录](docs/payday-calendar.md)。前端与Worker必须同步发布，缺少年份时不推算日期。

## 循环事项（REM-007）

支持每天、每周多选、每月、每年、工作日，以及自定义每N天/周/月。自定义可选固定周期或完成后间隔；循环时间统一使用北京时间。每天一次保留分钟；固定周期可选择“时段内每小时”，如08:00—21:00含两端共14次，仍保留一条当前事项。

- 时段内每小时只支持同日2—24个连续整点，提前天数固定为0。工作日按所选日历核验；中国实际工作日包括调休工作日，缺少年份时暂停排期。列表始终投影下一时点；当天时段结束后显示下一符合规则日期的首个时点。
- 多时点的“完成当天”只记录一天历史、不取消后续提醒；“跳过当天”取消所选日剩余提醒。仅当天编辑标题、分类、备注或通知开关；日期和提醒时段通过整个系列修改。停用、恢复仍统一作用于整条系列。
- 固定周期按时间自动继续，不依赖完成；过提醒时刻显示下一次提醒或无通知计划。完成只记录历史；跳过只取消所选期次。缺少对应日期时跳过，不堆积历史欠账。
- 完成后间隔从实际完成日起计算；跳过从操作当天计算，不记作实际完成。
- 停用循环移至第四筛选“已停用”，旧暂停/结束记录也在此处。停用项可编辑，保存仍停用；完成历史不可重新启用。删除循环保留独立历史记录。
- 重新启用先显示下一安排：固定周期沿原节奏接未来；完成后间隔选择首次事项日期，并验证实际提醒（含提前天数）晚于现在。结束日期已过、无未来计划或工作日日历缺年时先编辑/更新，不假装启用成功。停用期间不补发，同一计划日已发送的提醒不重复发送。
- “仅本次”保留后续规则及模板；“整个系列”只影响当前未完成项和未来。停用项只编辑整个系列，不能在停用中取消重复后意外恢复为普通待办。
- 账号同步后由Worker独立读取计划，不依赖应用保持打开。沿用5分钟调度、计划时刻后60分钟补发窗口；每账号/系列/计划日/设备占位去重。多时点额外按原计划时点去重；只在当天设定时段内补发，最后时点所在分钟结束后停止补发（21:00:59内可补发，21:01起不补发），每台设备发送前再次核对。通知实际送达仍需设备验收，5分钟Cron或网络延迟可能导致末时点漏过截止。

日内多次使用repeat v3/times及cap3保护；旧客户端不能覆盖、删除或降级含v3数据的账号快照，需要更新后再编辑。旧v1/v2单时点行为和投递键保持。v3多时点复用投递表的TEXT键，以计划日期加时点区分，不需要D1迁移；此次必须协调Worker与Pages/Functions一起发布。先发布兼容Worker，再发布前端及同步保护；出现v3数据后不可直接回滚至不理解v3的旧版本。当前仅本地候选，未获得本次发布授权，不可直接从本分支推送到自动部署远端。

本地验证：`node --test tests/*.test.mjs`。`tests/repeat-browser.mjs`和`tests/occurrence-browser.mjs`使用虚构账号、模拟接口并拦截外部请求；通过`WEEKDAY_PLAYWRIGHT_PATH`和`WEEKDAY_BROWSER_EXECUTABLE`指定现有运行时，不发送真实通知。
