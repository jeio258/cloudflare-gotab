# Gotab-cf 项目功能说明与实施报告

> 把官方 gotab-personal（新标签页）**前端原样搬上 Cloudflare Pages**，后端重写为**同一项目的 Pages Functions 精简实现**。功能覆盖：多账号与注册、云同步、资料编辑、公告、默认主页、最小管理后台、挂件、只读分享页、搜索联想同源代理。
>
> 线上地址：**https://gotab-cf.pages.dev**

---

## 1. 项目概述

| 项 | 说明 |
|---|---|
| 前端 | 官方 `gotab-personal/web`（Vite 构建产物，React SPA，兼作 Chrome MV3 扩展页面），原样部署并做静态预处理 |
| 后端 | 与前端同一 Cloudflare Pages 项目内的 Pages Functions（同域同源，无 CORS） |
| 存储 | Cloudflare D1（users / user_data / notices / default_data / default_data_history） |
| 鉴权 | 登录签发 JWT(HMAC-SHA256)，请求头 `Authorization: <token>`；口令 scrypt 哈希 |
| 注册 | 无验证码开放注册，仅用户名唯一性约束；内置 isolate 内存限流（login/register/findPassword，20 次/60s，形状校验后计数），生产精确兑底见 §9 WAF 建议 |
| 角色 | 支持多账号（管理员 userType=1 / 普通 0），后台仅管理员可用 |
| 仓库 | `/home/lyxy/pi/gotab-cf` |

`dist/` 由 `npm run prepare` 生成，是 Pages 部署目录（静态 + functions + overrides），不入库。

---

## 2. 架构与部署拓扑

```
gotab-cf（一个 Cloudflare Pages 项目，自动域名 *.pages.dev）
├── 静态资源   = web 构建产物（index.html 占位符已替换 + overrides 注入 + 搜索URL同源替换）
├── functions/ = 后端 API（见 §3）
├── D1         = gotab-cf-db
└── Secrets    = JWT_SECRET（Pages secret）
```

请求顺序（已验证）：Functions 命中 `/api/*` 已实现路由 → 静态资源 → `_redirects` SPA 回退（`/* /index.html 200`）。
未实现的 `/api/*` 由兜底函数统一返回 `{code:404,msg:'接口不存在'}`（HTTP 200），前端按业务错误静默降级。

---

## 3. 已实现后端接口

### 认证与账号
| 接口 | 说明 |
|---|---|
| `POST /api/login` | 用户名/密码登录（用户名或邮箱），禁用账号返回 403 |
| `GET /api/user/getUserInfo` | 当前用户信息（需 token） |
| `GET /api/user/logout` | 退出 |
| `POST /api/user/changePassword` | 修改密码 |
| `POST /api/user/editUserInfo` | 资料编辑：昵称/性别/手机/生日/用户名 → 完整 userInfo |
| `POST /api/register` | 注册（用户名唯一、普通用户） |
| `POST /api/findPassword` | 重置密码（需原密码） |
| `GET /api/user/isAdmin` | 管理员（userType=1 且未禁用）返回 200+true，其余 403/401 |

### 云同步（每账号整份快照）
| 接口 | 说明 |
|---|---|
| `POST /api/user/push` | 上传快照 `{data,timestamp,baseTimestamp}`；并发冲突 HTTP 409 `code:409 云端数据已更新` |
| `GET /api/user/pullWT` | 拉取快照 `{timestamp,data}` |

### 公告与默认主页
| 接口 | 鉴权 | 说明 |
|---|---|---|
| `GET /api/getNotice` | 公开 | 最新已发布公告 `{title,content,timeCode}` |
| `GET /api/getDefaultData` | 公开 | 当前默认主页 `{data,created_at}` |
| `GET /api/getDefaultDataTime` | 公开 | 当前默认主页时间（ISO 串） |
| `POST /api/console/setDefaultData` | 管理员 | 保存默认主页（同时写入历史快照） |
| `console/getNoticeList/addNotice/editNotice/deleteNotice` | 管理员 | 公告管理（add 为待确认状态） |
| `console/confirmNotice/rejectNotice` | 管理员 | 二次确认发布 / 驳回删除 |
| `console/getDefaultDataList` | 管理员 | 默认主页历史分页 |
| `console/enableDefaultData/disableDefaultData/deleteDefaultData/clearDefaultData` | 管理员 | 快照启用/停用/删除/清理（保留 10 条） |

### 用户管理（最小后台）
| 接口 | 说明 |
|---|---|
| `console/getAwaitingApprovalUserAppellationList` | 官方命名，实为全量用户分页列表（含搜索） |
| `console/addUser` | 后台建号 |
| `console/setUserType` | 设/撤管理员（不可改自己） |
| `console/enableUser / disableUser / deleteUser` | 启/停/删除（删除级联云数据，不可操作自己） |

### 工具 / 分享 / 挂件 / 搜索
| 接口 | 说明 |
|---|---|
| `POST /api/tools/getWebsiteInfo` | 抓网页标题/描述；图标取 uapis 解析的 favicon_url（无图标/退化 `data:,` 时前端回落内置 `/icons/bookmark.svg`）；抓取失败降级不报错 |
| `GET /api/getShareData` | 只读分享：`path`=share_id 或用户名 → `{shareData}`；未命中 null；被禁账号 data:3 |
| `GET /api/search-suggest?wd=&cb=` | 搜索联想 JSONP（`cb({g:[{q}]})`），服务端转百度 sugrec |
| `GET /api/getCityList` | 41 城坐标表 |
| `GET /api/getWeather?city=` | Open-Meteo；无 city 按 IP 定位 |
| `GET /api/getHotEvents?type=` | weibo/百度可用，其余平台空数组 |
| `GET /api/yiyan?types=` | hitokoto + 兜底 |
| `GET /api/exchange-rate` | frankfurter(ECB) + 静态兜底 |

前端解析契约要点（易踩坑，已适配）：
- 天气响应双层 `data:{data:{city,weather}}`；`weather_icon_id` 必须是字符串（前端 `0||''` 会吞掉数字 0）
- 城市列表/热搜 `data` 为数组；一言 `data={content}`；汇率 `data={rates,CNY:1}`
- 分享 `data` 对象 `{shareData}` / 数字 2=已停止 / 3=无权限 / null=无效

---

## 4. 前端界面处理（prepare 注入，不动 dist 源码）

- **已启用/可用**：注册入口与"找回密码"恢复可见（功能已实现）
- **仍隐藏**：绑定邮箱、申请称号（无邮件/无审核流）
- **抽屉菜单隐藏**：个性分享（分享页改为直达 `/s/<用户名>`）、版本说明、捐赠打赏、关于我们；**保留**迁移备份/重置回退
- **上传类**：头像上传器、卡片/壁纸纯"上传"按钮隐藏（无 R2）；图标取 uapis favicon_url、壁纸走外部 URL 填址
- **卡片"推送收录"开关**：siteConfig `cardPush='close'` 关闭
- **搜索联想同源化**：前端直连 `baidu.com/sugrec` 的 URL 在 prepare 阶段替换为 `/api/search-suggest?wd=`

实施载体：`scripts/prepare.mjs` + `scripts/overrides.css` / `overrides.js` + `dist/siteConfig.js`。

---

## 5. 支持功能总表

### ✅ 可用
- 登录 / 注册 / 找回密码 / 退出 / 修改密码 / 资料编辑（昵称/性别/手机/生日）
- 多账号；云同步自动推送/拉取/409 冲突弹窗/手动推拉；游客本地数据
- 添加网址卡片、"获取信息"（uapis 图标解析，无图标回落内置书签图标）、外部图标/壁纸 URL
- 公告（首页弹层）+ 管理员发布/二次确认
- 默认主页：管理员"编辑默认数据"→ 游客按更新时间获取
- 最小管理后台 `/console`：用户管理、默认主页历史、公告管理
- 只读分享页 `/s/<share_id 或用户名>`
- 资源库/壁纸库浏览（直连官方 web.gotab.cn）
- 本地设置全套、迁移备份/重置回退（本地）
- 纯本地小组件（时钟/日历/倒数日/记事本/人民币大写/iframe/股票）
- 挂件：天气、热搜(微博/百度)、一言、汇率
- 搜索联想（同源代理，不再直连百度）

### ❌ 不可用（入口已隐藏或静默降级）
- 绑定邮箱 / QQ 登录 / 注销账号 / 上传（头像/壁纸/图标/图片，无 R2）
- 提交到资源库 / 推荐 App / 称号申报
- `/console` 其余页面（仪表盘/审核/资源库/壁纸/上传/配置等）
- 依赖官方运营的其它能力

### ⚠️ 边界
- 热搜：weibo/百度可用；bilibili/知乎在 CF 侧风控/需登录 → 空列表
- 天气：免费源无 AQI/生活 tips（字段留空）
- 分享页公开只读：任何激活账号的主页都可通过其用户名/share_id 公开访问
- robots.txt / sitemap.xml 已同源化至部署域名（prepare 时取 `CF_PAGES_URL`，绑定自定义域名后需带该环境变量重新构建）

---

## 6. 数据与账号

- 表：`users(status,share_id,share_enabled,…)`、`user_data`、`notices`、`default_data`(当前)、`default_data_history`
- 管理员建号/改密（CLI）：
  ```bash
  node scripts/create-account.mjs --remote --username <账号> --password <密码>
  ```
  新注册用户为普通用户（userType=0）；要设管理员请在 `/console` 用户管理操作

---

## 7. 工程使用

### 常用命令
| 命令 | 作用 |
|---|---|
| `npm run prepare` | 生成 `dist/`（模板替换/站点配置/overrides/搜索URL替换/拷贝 functions） |
| `npm run dev` | 本地预览（127.0.0.1:8799，含本地 D1） |
| `npm run deploy` | 部署到 Pages 生产分支（gotab-cf.pages.dev） |
| `npm run db:migrate` / `db:migrate:local` | D1 **全新库完整建表**（幂等，含全部列/表/索引；远程/本地） |
| `npm run typecheck` | TS 类型检查（`tsc --noEmit`） |
| `npm run db:migrate:batch1`…`batch3`（+`:local`） | 各期迁移 |
| `npm run account:create` | 建号/改密（加 `--remote` 写远程） |
| `npm test` | 运行 `tests/e2e.mjs`（需先起本地预览；远程用环境变量，见下） |

### 测试
```bash
# 本地（首次需建本地 D1 完整 schema）
npm run db:migrate:local
wrangler pages dev --port 8799 &
node tests/e2e.mjs
# 远程
GOTAB_BASE_URL=https://gotab-cf.pages.dev GOTAB_USER=<账号> GOTAB_PASS=<密码> node tests/e2e.mjs
```
覆盖：静态/兜底、登录(错/对/禁用)、注册(无验证码)、找回、资料编辑、同步与 409、isAdmin、公告(含二次确认)、默认主页、console 用户管理、挂件 5 接口、搜索联想、分享页、真实 UI 登录（无 console 报错）。测试自动清理其注册的测试用户。

### 关键目录
```
functions/api/*          接口路由（含 [[path]].ts 兜底）
functions/lib/*          handler(统一鉴权/body/错误)/auth/db/account/contract + 领域库(weather/hot/cities/defaultData/upstream)
migrations/batch*.sql    分阶段 DDL
scripts/prepare.mjs      dist 生成
scripts/overrides.{css,js}  界面隐藏补丁
scripts/create-account.mjs  建号脚本
tests/e2e.mjs            端到端回归
schema.sql               D1 基础 DDL
```

---

## 8. 实施报告

| 阶段 | 内容 | 验证 |
|---|---|---|
| 一期 | 可行性分析 + 脚手架 + 登录/云同步/getWebsiteInfo + D1 + 部署 | 本地 25 项 + 远程 23 项全过 |
| 二期-1 | 死入口清理（siteConfig 开关 + overrides 注入） | headless 截图核对 + console 零报错 |
| 二期-2 | 挂件 5 接口（天气/城市/热搜/一言/汇率） | 契约级解析复现 + 远程 5/5 |
| 二期-3 | 挂件断言并入 e2e | 本地 39 项 + 远程全过 |
| 三期-1 | 多账号 + 注册(邀请码)/找回 + 资料编辑 | e2e + UI 注册→登录全链路 |
| 三期-2 | 公告 + 默认主页 | e2e（公告确认发布、默认主页读写） |
| 三期-3 | 最小后台（用户管理/默认主页历史/公告管理） | e2e + console 三页真实渲染零报错 |
| 三期-4 | 只读分享页 + 搜索联想同源代理 | e2e（JSONP/产物替换/分享命中） |

最终状态：全部阶段本地与远程 headless e2e **ALL PASSED**，已上线 gotab-cf.pages.dev。

## 9. 已知限制与待办

- `/console` 其余页面（仪表盘/审核/资源库/壁纸/上传/配置）未实现，进入会提示"接口不存在"
- 上传类（R2）、绑定邮箱（SMTP/QQ）、称号审核等未做
- 天气 AQI/tips 字段缺失（免费源限制）
- robots/sitemap 同源化依赖 prepare 时的 `CF_PAGES_URL`，绑定自定义域名后需带该变量重新构建
- 前端"每日宝藏"等能力直连官方 web.gotab.cn 推荐接口（跨域），官方策略变更会静默失效
- 第三方 API 例外：汇率用 `api.frankfurter.app`、搜索联想用百度 `sugrec`（经同源代理）；其余均走 uapis.cn
- 找回密码现要求**原密码**（安全收敛）；无邮件服务前不宜作为"忘记密码"使用
- 分享页需 `share_enabled=1` 才可读（未开启返回 `2`＝已停止分享），避免隐私越权
- 登录/找回/注册内置 isolate 内存限流（20 次/60s/路由/IP，形状校验后计数，多 isolate 下阈值近似放大）——防爆破够用，非精确计量；如需精确阈值，在 Cloudflare dashboard 配 WAF Rate Limiting（免费 1 条）：名称 `gotab-auth-ratelimit`，表达式 `(http.request.uri.path matches "/api/(login|register|findPassword)")`，速率 20 次/60s，动作 Block
- 旧库升级：全新库用 `db:migrate`；历史库按 `migrations/batch1~3` 增量执行
