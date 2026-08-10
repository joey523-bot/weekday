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

新建数据库时只导入该文件。已有数据库只执行 [`cloudflare/migrations/0002-accounts.sql`](cloudflare/migrations/0002-accounts.sql) 一次；不要在同一个数据库重复执行两份 SQL。

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
