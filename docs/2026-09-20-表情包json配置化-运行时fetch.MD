# GIF 素材配置化与表情包停用（运行时 fetch）

- 日期：2026-09-20
- 状态：方案定稿（用户已确认最终决策），待实现
- 关联：1.0.1 在线资源下载（同为「配置驱动、不硬编码」风格）

## 一、决策沿革

1. **原计划「表情包 json 配置化」已废弃**：最初拟把表情包「关键词→GIF」触发规则
   外置为 `GIF/表情包/emotes.json`（运行时 fetch）。用户审阅实际使用后决定
   **表情包功能整体停用**——代码保留为死代码（不删除）、运行不再引用、
   `GIF/表情包/` 文件保留（防误删，不随主题分发也不引用）。
2. **开屏动画（启动页）改为 json 配置**：现状是 build.cjs 取 `GIF/` 目录**第一个**
   .gif 注入 `GIF_DATA`。用户要求改成显式 json 配置指定启动页 gif
   （即保留的 `4bfecb05<...>.gif`），不再隐式依赖「目录第一个」。

## 二、最终方案

### 2.1 表情包停用（死代码保留）

- `build.cjs`：3.5 表情包注入段整体注释为死代码（附恢复指引），不再扫描
  `GIF/表情包/`、不再注入 `EMOTES`。
- `lib/client.template.js`：
  - `startEmotes()` 函数体保留（死代码），`apply` 中调用行注释掉；
  - `EMOTES` 常量保留（build 不再注入 → 恒为空数组），标注已停用；
  - `.ff-emote` 相关 CSS 保留（死代码）。
- `GIF/表情包/*.gif` 文件保留在仓库（不删除）。

### 2.2 开屏动画 json 配置化

- 新增配置文件 `GIF/boot.json`：显式指定启动页 gif 文件名与播放时长：

```json
{
  "_comment": "开屏启动页动画配置。file=GIF/ 目录下的 gif 文件名；durationMs=自动淡出时长（毫秒，默认 10000）。改配置刷新即生效，无需重新 build。",
  "file": "4bfecb05efaf200d824e5bfc1d32c81d_3933947712892826932.gif",
  "durationMs": 10000
}
```

- `build.cjs` 第 2 节：改为**优先读 `GIF/boot.json` 的 file** 生成 gifUri（回退取
  目录第一个 gif），注入 `GIF_DATA` 作为**构建期默认值**（离线兜底）。
- `lib/client.template.js`：
  - `playTransformIntro()` 改为运行时先 **fetch `/theme-mediascape-assets/GIF/boot.json`**
    拿 file → 拼 URL；fetch 失败回退 `GIF_DATA`（build 注入默认）；
  - 播放时长取配置 `durationMs`（缺省 10000）；
  - 开屏在 apply 时异步触发，同源 fetch 快、延迟可忽略。

## 三、数据流

```
GIF/boot.json（配置，随主题分发）
   │ apply 后 playTransformIntro() 运行时
   ▼
fetch('/theme-mediascape-assets/GIF/boot.json')
   ├ 成功 → bootGif = /theme-mediascape-assets/GIF/<file>
   └ 失败 → 回退 GIF_DATA（build 注入默认）
   ▼
buildBootOverlay() → 全屏遮罩 + <img class="ff-gif"> + 标题
   ▼
durationMs 后淡出（.gone → 移除）｜ 点击跳过/遮罩空白立即结束
```

## 四、改动文件

| 文件 | 改动 |
|---|---|
| `GIF/boot.json` | 新增：启动页 gif 配置（file + durationMs） |
| `build.cjs` | 2 节：读 boot.json 指定 gif（回退目录第一个）；3.5 表情包注入段注释为死代码 |
| `lib/client.template.js` | playTransformIntro 运行时 fetch boot.json；EMOTES/startEmotes 标注停用、apply 不再调用 |
| `lib/index.js` | MIME 表补 `.json: application/json`（GIF/ 下 boot.json 静态服务规范类型） |
| `preview/start-preview.mjs` | 预览静态服务已放行 GIF/，补 .json MIME（服务端半与预览端一致） |
| `README.md` | 开屏说明改为 json 配置版；删除表情包相关描述；目录结构、自定义素材节同步 |
| `docs/` | 本方案文档（工作留痕） |

## 五、验证计划

1. `node --check` client.template.js / build.cjs
2. `node build.cjs --clean` 重新构建：确认 boot gif 来自 boot.json、无 emotes 注入
3. `node build.cjs`（完整构建）同样正常
4. 重启预览服务器，playwright 打开：
   - 开屏出现（img.ff-gif src 指向 boot.json 指定的 gif 文件）
   - 控制台无 fetch 报错、无表情相关报错
   - SAM 重播开屏仍可用
5. 改 boot.json 换 file/durationMs → 刷新生效（免 rebuild 证明）
6. code_audit 复查（conv 措辞规则：本 md 不写对话记录）
7. 预览验收 → git 提交推送

## 六、任务看板

- [ ] 更新本方案文档
- [ ] 新增 GIF/boot.json（启动页 gif 配置）
- [ ] build.cjs：2 节读 boot.json + 3.5 表情包段注释为死代码
- [ ] client.template.js：playTransformIntro 运行时 fetch + EMOTES/startEmotes 停用标注
- [ ] index.js / start-preview.mjs MIME 补 .json
- [ ] README：开屏 json 配置说明 + 删除表情包描述
- [ ] 重新 build + 预览验证（含改配置免 build 生效）
- [ ] code_audit + 提交推送