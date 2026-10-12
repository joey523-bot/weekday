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

## 循环事项（REM-007本地候选）

事项中的“重复”支持每天、每周多选、每月、每年、工作日，以及自定义每N天/周/月。自定义可选固定周期或完成后间隔；循环时间统一使用北京时间，保留分钟。

- 列表只展示当前未处理期次；完成或跳过后保留历史并接续一期。固定周期不因晚完成顺延、不堆积欠账；缺少对应日期时跳过。
- 跳过完成后间隔事项以操作当天为起点，不记作实际完成。暂停期间不补发；恢复时保留尚未到期的当前期次或接续未来计划，完成后间隔保留未完成项。
- “仅本次”保留后续规则及模板；“整个系列”只影响当前未完成项和未来。历史不可恢复成第二个并行期次。
- 法定工作日日历缺年时保留规则并显示待更新；补齐共享日历后可从详情恢复，不能用普通周一至周五冒充法定工作日。
- 账号同步后由Worker独立读取当前期次，不依赖应用保持打开。沿用5分钟调度、计划时刻后60分钟补发窗口；每账号/系列/计划日/设备占位去重。推送网络结果不明时不盲重发，真实送达仍需设备验收。

本候选尚未发布。发布需另行授权，先执行新增迁移[`0007-recurring-reminders.sql`](cloudflare/migrations/0007-recurring-reminders.sql)，再协调Functions、前端缓存与Worker版本，并保留71030fb回滚证据。已包含循环事项的账号会拒绝旧客户端覆盖同步，旧设备需刷新应用。

本地验证：`node --test tests/*.test.mjs`。浏览器测试`tests/repeat-browser.mjs`和`tests/occurrence-browser.mjs`使用虚构账号、模拟接口并拦截外部请求；通过环境变量`WEEKDAY_PLAYWRIGHT_PATH`和`WEEKDAY_BROWSER_EXECUTABLE`指定现有运行时。测试不发送真实通知。
