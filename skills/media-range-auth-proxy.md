---
name: media-range-auth-proxy
description: 鉴权代理下媒体（视频壁纸/开屏）加载不出来的根因与解法——代理对未携带 token 的 Range 请求返回 302，媒体元素跟随 302 会丢失 Range 语义、退化为整文件下载，于是首帧长时间卡住；本插件在服务端从 DSH 启动输出捕获 token、经 API 下发给前端，所有媒体赋值点统一拼 token 直连，恢复 206 分段流式。
whenToUse: 处理「视频壁纸/开屏加载不出来」「只有第一次打开慢、第二次正常」「媒体首帧卡住/黑屏」「Range 请求被 302 或 401」「鉴权代理下媒体直连」「媒体 URL 拼 token」类问题时加载。
generatedBy: deepseek-v4.1-flash
---

# 鉴权代理下的媒体 Range 直连（media-range-auth-proxy）

## 先记住我

- 本 skill 描述 **dsh-theme-mediascape** 插件的一个真实线上问题与实现方案：媒体（视频壁纸/开屏动画）在**有鉴权代理**的部署下加载不出来。
- 核心结论一句话：**媒体元素跟随 302 重定向会丢失 `Range` 语义 → 分段拉流退化为整文件下载 → 大视频首帧卡住**；解法是**让媒体 URL 一开始就带上鉴权 token**。
- 权威实现在插件项目内：`lib/media-token.js`（服务端捕获+下发）、`lib/client-parts/foundation/utils.js`（`withMediaToken` 等）、`lib/index.js`（API 路由）、`lib/client-parts/scenes/*`（媒体赋值点）。

## 一、现象

- **首次**打开时：视频壁纸或开屏动画长时间黑屏、甚至一直不出画面。
- 刷新或第二次打开：恢复正常。
- 用 `curl` 直接取同一个媒体文件很快（几百 MB/s），看起来"服务端没问题"，但页面里就是加载不出来。

## 二、根因：为什么视频加载不了

1. **鉴权代理的拦截规则**：当 DSH 前面部署了要求 `?token=` 的鉴权代理时，代理会对「**GET 且 URL 不带 token 且没有会话 cookie**」的请求返回 **302**，重定向到带 token 的同一个地址（用于首次自动认证）。
2. **媒体元素受害点**：`<video>` / `<audio>` 加载媒体时发的是 **`Range` 请求**（分段拉流，响应 206）。
   浏览器跟随 302 时**会丢弃 `Range` 请求头**，于是重定向后的请求变成**从头整文件下载**。
3. **后果**：几百 MB 的壁纸视频要**全部下载完**才能出首帧 → 表现为「卡住 / 加载不出来 / 开屏黑屏很久」。
4. **为什么只有第一次**：第一次访问会完成一次 token 认证并建立会话 cookie；此后请求都带 cookie，代理不再重定向，媒体恢复正常——所以现象是「**只有第一次慢/加载不出来**」。
5. **为什么 `curl` 测不出来**：命令行 `curl -L` 默认会**保留 Range 头**跟随重定向，所以测出来很快；只有 HTMLMediaElement 的行为才会丢 Range。

## 三、解决方案（本插件已实现）

### 3.1 服务端捕获 token（`lib/media-token.js`）

- DSH 的 web 入口启动时会打印形如 `dsh web: http://127.0.0.1:<port>/?token=xxx` 的访问地址。
- 插件与 DSH **同一进程**，无法重新读取已被消费的 stdout 管道；但**插件启动（apply）早于该打印**，
  因此在 apply 阶段**包装 `process.stdout.write`**，在打印的瞬间用
  `/token=([A-Za-z0-9_-]{20,})/` 抓取 token——**只读取输出分片、原样透传，不改变任何既有日志行为**。
- **兜底**：若插件加载晚于打印（例如宿主先起 web 再装载插件），回读 `dsh-proxy.log`（路径按
  `DSH_PROXY_LOG` / `DSH_HOME` 推导，不硬编码），用同一正则取最近一次匹配。

### 3.2 下发给前端（`lib/index.js`）

- 新增 `GET /theme-mediascape-assets/media-token` → `{ token }`（取不到返回**空串**，前端按无 token 处理）。

### 3.3 前端把 token 拼到媒体 URL（`lib/client-parts/foundation/utils.js`）

- `probeMediaToken()`：token 来源优先级 = **①会话缓存（sessionStorage）②当前页面 URL 的 `?token=` ③服务端 API**。
- `withMediaToken(url)`：URL 无 query 时拼 `?token=...`；**所有媒体赋值点统一调用它**：
  - 开屏图片 / 开屏视频（boot 层）
  - 壁纸视频 `video.src`
  - **壁纸图片背景 `background-image`**（最容易被漏掉的一处）
  - 预载 `video` / `img`
  - 音乐封面 `background-image`
- `refreshMediaTokens()`：token 就绪**晚于**媒体元素创建时，修正已挂载元素的 `src`
  （**仅在确实变化时重设**，避免无谓重新加载）。

## 四、验证方法（可复现）

1. 服务端：`curl http://127.0.0.1:<dsh端口>/theme-mediascape-assets/media-token` → 应返回 `{"token":"..."}`。
2. 前端：用无 cookie 的全新浏览器上下文打开页面，抓网络日志——媒体请求应显示 **带 token 且 200/206**；
   修复前是无 token（会被 302）。
3. 反面对照：把 `peerDependencies` 之类无关项不动，仅**临时去掉媒体赋值点的 `withMediaToken`**，
   应能复现"图片/视频请求无 token"的行为，证明覆盖面完整。
4. `node build.cjs` 必须全绿（本项目 client.js 由 `lib/client-parts/` 拼接生成，**不要手改产物**）。

## 五、坑与边界

- **只覆盖视频是不够的**：图片壁纸走的是 `background-image`（不是 `img.src`），音乐封面同理——
  漏掉它们会出现"视频好了、图片仍被 302"。
- **不要给已带 query 的 URL 再拼 token**（`withMediaToken` 里 `indexOf("?") !== -1` 直接返回），否则会破坏原参数。
- **token 会被导航消费**：页面地址栏上的 `?token=` 在认证完成后可能被清理，因此**不能只依赖 `location.search`**，
  要保留会话缓存与服务端 API 两条来源。
- **无鉴权代理的环境行为必须不变**：取不到 token 时 URL 原样使用（本地直连、预览服务都属此类）。
- **hook 依赖启动顺序**：插件启动早于"打印访问地址"时 hook 才能抓到；反之靠日志兜底，两者缺一不可。

## 六、配套

- 服务端 token 捕获与下发：`lib/media-token.js`、`lib/index.js`
- 前端门面与修正：`lib/client-parts/foundation/utils.js`、`lib/client-parts/apply.js`
- 媒体赋值点：`lib/client-parts/scenes/boot.js`、`lib/client-parts/scenes/wallpaper.js`、`lib/client-parts/sound/music-player.js`
- 面向用户的说明：README「媒体加载与鉴权代理（视频/开屏加载不出来时看这里）」

## 修改记录

- 2026-10：首次固化。来源为插件 1.1.1 的实际修复（服务端 stdout 捕获 + API 下发 + 全媒体赋值点拼 token）。

## 相关

- 版本记录见 `CHANGELOG.md` 的 1.1.1 条目。
- 若后续新增媒体类型（新的 `<video>`/`<img>`/背景图赋值），**必须一并经 `withMediaToken`**，否则同类问题会以"某个资源加载不出来"的形式再次出现。
