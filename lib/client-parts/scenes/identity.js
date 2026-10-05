		// dsh-skip-func-length（identityCSS 巨型函数 248 行，函数级拆分列为后续优化项，本次仅文件级拆分）
		// ═══════════ 3. 身份层 CSS ═══════════
		// 胶囊配方数据（build 注入）：来自 theme-studio/capsules.json（配色网站「宿主元素配色」区读写同一文件）。
		// 结构 = rules[]，每条 { key, selector, desc, bg:{type,alpha,value?}, radius, padding, extra[], extraRules[], enabled }。
		// enabled:false → 该条胶囊不输出 CSS（关闭开关，配色盘胶囊 tab 可切换）；缺省视为 true。
		// parent（可选）：所属层级父规则 key（如 flowItem/older 挂在 chatColumn 下），配色盘按此分组展示层级。
		// build 失败/缺失时注入 []（无胶囊规则，主题降级为无边饰，不崩溃）。
		const CAPSULES_DATA = /*__CAPSULES_START__*/[]/*__CAPSULES_END__*/;
		// 2026-09-2x 自动注册元素（build 注入）：来自 theme-studio/json/theme-register.json——
		// 配色区/胶囊区元素由 POST /api/theme-register-element 自动注册。结构 = rules[]，
		// 每条 { key, selector, zone:'color'|'capsule', label?, hex?, alpha?, anchor? }。
		// zone=color：selector 应用底色（--dsw-specific-<kebab-key> 变量，默认色 rgba 构建期内嵌）；
		// zone=capsule：由 capsules.json 走胶囊机制（本数组不含）。
		const REGISTER_RULES = /*__REGISTER_START__*/[]/*__REGISTER_END__*/;
		// 注册元素底色应用（zone=color）：只上底色不加胶囊配方；selector 来自注册（类名尾缀
		// [class*='_xxx'] 或 data 锚点覆盖）；var 缺省 = 注册默认色（build 即生效，apply 后变量覆盖）。
		function registerColorCSS() {
			return (REGISTER_RULES || [])
				.filter((r) => r.zone === 'color' && r.key && r.selector)
				.map((r) => {
					const varName = '--dsw-specific-' + String(r.key).toLowerCase().replace(/[^a-z0-9-]/g, '-');
					return r.selector + ' { background: var(' + varName + ', ' + (r.rgba || 'transparent') + ') !important; }';
				});
		}
		// ⚠️ 2026-09-22 息屏恢复防丢：layer 型胶囊背景改为「构建期展开的字面 rgb」而非运行期 CSS 变量。
		// 现象：平板息屏过段时间后会话区胶囊全消失（其他样式都在），刷新恢复——根因是运行期
		// rgba(var(--mediascape-dsh-theme-bg-layer), α) 在渲染层重建时变量未就绪 → 声明整体 invalid → 背景透明。
		// 方案 1：build.cjs 注入当前 bgLayer 的 rgb 字面值（与身份层 --mediascape-dsh-theme-bg-layer 同源），
		// capsuleCSS 直接拼 rgba(字面, α)——渲染层重建也能画出来，不依赖变量存活。
		const CAPSULE_BG_LAYER_RGB = /*__CAPSULE_BG_LAYER_START__*/"54, 42, 86"/*__CAPSULE_BG_LAYER_END__*/;
		// 渲染胶囊 CSS 数组：把外置配方拼成 identityCSS() 里的字符串行。
		// 规则逐条生成（同键可追加额外声明/附加规则），输出与 2026-09-21 之前写死字符串语义一致。
		// 2026-09-22 层级注入：按 parent 拓扑排序（父先子后）——外层（父级）先注入、内层（子级）后注入，
		// 同特异性选择器后写覆盖先写 → 子级自然覆盖父级（层级视觉正确）。同层保持原数组顺序（稳定）。
		function capsuleCSS() {
			// 拓扑排序：深度优先，父级先入队；parent 缺省/未知视为根。
			const order = [];
			const visited = new Set();
			const byKey = new Map();
			for (const r of CAPSULES_DATA) byKey.set(r.key, r);
			function visit(r) {
				if (!r || visited.has(r.key)) return;
				visited.add(r.key);
				// 先访问父（parent 存在且在本集合内 → 父先注入）
				if (r.parent && byKey.has(r.parent) && !visited.has(r.parent)) visit(byKey.get(r.parent));
				order.push(r);
			}
			for (const r of CAPSULES_DATA) visit(r);
			const lines = [];
			for (const r of order) {
				if (r.enabled === false) continue; // 关闭开关：该条胶囊不渲染
				let bg = "";
				if (r.bg) {
					if (r.bg.type === "layer") bg = "rgba(" + CAPSULE_BG_LAYER_RGB + ", " + r.bg.alpha + ")";
					else if (r.bg.type === "solid") bg = "rgba(" + (r.bg.value || "124, 120, 190") + ", " + r.bg.alpha + ")";
				}
				const props = [];
				if (bg) props.push("background: " + bg + " !important");
				if (r.radius) props.push("border-radius: " + r.radius + " !important");
				if (r.padding) props.push("padding: " + r.padding + " !important");
				for (const e of r.extra || []) props.push(e);
				// 声明都以「;」结尾（对齐纯手写产物单行格式，逐字一致校验用）
				lines.push(r.selector + " { " + props.join("; ") + "; }");
				for (const xr of r.extraRules || []) {
					lines.push(xr.selector + " { " + (xr.declarations || []).join("; ") + "; }");
				}
			}
			return lines;
		}
		// 2026-09-23 拆（审计）：tokenLines（主题 token → CSS 变量声明行）提到顶层，
		// CSS_BASE 里 body 块以 tokenLines 元素引用它（与拆分前语义一致，CSS 顺序不变）。
		const tokenLines = Object.entries(TOKENS)
			.map(([name, value]) => "  " + name + ": " + value + " !important;")
			.join("\n");
		const CSS_BASE = [
				// 中间背景不改：html 不再用主题纯色铺满（去雾），透明让壁纸层 .mediascape-dsh-bg 透出；兜底深色只在无壁纸时可见
				"html { color-scheme: dark !important; background: #0a0c12 !important;",
"  /* ── 基底主题变量（壁纸联动皮肤命名空间 --mediascape-dsh-theme-*；值=一键应用配色，动态取色覆盖）── */",
"  /* 一键应用 知更鸟·晴歌：主文字 #E8F4FA / 次文字 #A9C9B9 / 主按钮 #7CC8E8 / 次按钮 #3B89C4 / 金色高亮 #FFD93B / 状态胶囊 #F5F7FA */",
"  --mediascape-dsh-theme-bg: 62, 47, 102;",
"  --mediascape-dsh-theme-bg-soft: 42, 33, 72;",
"  --mediascape-dsh-theme-bg-layer: 54, 42, 86;",
"  --mediascape-dsh-theme-accent: 124, 200, 232;",
"  --mediascape-dsh-theme-accent-soft: 59, 137, 196;",
"  --mediascape-dsh-theme-text: 232, 244, 250;",
"  --mediascape-dsh-theme-text-dim: 169, 201, 185;",
"  --mediascape-dsh-theme-border: 255, 217, 59;",
"}",
				"body {",
				"  background-color: transparent !important;",
				"  color: rgb(var(--mediascape-dsh-theme-text));",
				"  --dsw-font-family: 'MiSans', 'PingFang SC', 'Microsoft YaHei', -apple-system, 'Segoe UI', sans-serif;",
				"  --ds-font-family-code: 'SF Mono', 'JetBrains Mono', Consolas, Menlo, 'PingFang SC', monospace;",
				tokenLines,
				"}",
				// 全局文字轻描边：中间画面全透明后文字直接叠在壁纸上，黑色描边保证任何壁纸下可读
				// （轻描边：下方 1px + 四周微晕；具体元素可覆盖，见 .mediascape-dsh-music-lbl/.mediascape-dsh-title 的辉光叠加）
				// 2026-09-22 全局描边移除（小字如侧边栏 localBuildTitle 12px 被四方向 shadow 糊掉；
				// 以后做精细化描边——只对需要的元素加局部描边）。注释保留可恢复。
				// "* { text-shadow: 0 1px 1px rgba(0, 0, 0, 0.5), 0 0 2px rgba(0, 0, 0, 0.75), 1px 0 1px rgba(0, 0, 0, 0.45), -1px 0 1px rgba(0, 0, 0, 0.45) !important; }",
				// 中间会话窗口轻毛玻璃（只消息列表 + 轻 blur 6px）：DSH 主会话容器
				// 加 backdrop-filter 背景模糊 + 微半透明，壁纸透出但文字清晰；不动 bg-base 的透明策略
				// 2026-09-22 起毛玻璃全部移除（删页面毛玻璃）。以下 backdrop-filter 行注释保留（comment-not-delete），
				// 需要时可取消注释恢复。背景半透明保留（壁纸透出但文字有衬底）。
				"[class*='_float_'] { background-color: rgba(10, 12, 18, 0.22) !important; }",
				// 备选（毛玻璃，已移除）：
				// "[class*='_float_'] { backdrop-filter: blur(6px) saturate(130%); -webkit-backdrop-filter: blur(6px) saturate(130%); background-color: rgba(10, 12, 18, 0.22) !important; }",
				// 文件选择器降载：打开系统文件选择器（SAF）前由 PickerGuard（upload.js）给 html 挂
				// .mediascape-dsh-picker-open，本规则禁用全局 backdrop-filter——安卓低内存设备上大面积 blur 的
				// 合成在选择器打开瞬间内存峰值，渲染进程被系统杀（壁纸/音乐/封面三处都触发，平板不崩）。
				// 2026-09-22 毛玻璃已移除，此禁用规则失去作用对象，注释保留（若恢复毛玻璃需同步取消注释）。
				// "html.mediascape-dsh-picker-open, html.mediascape-dsh-picker-open * { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }",
				// 模态遮罩去模糊：打开设置/弹层时覆盖全屏的 _mask 层（背景 var(--dsw-alias-bg-mask-1) +
				// backdrop-filter var(--dsw-mask-blur)），关掉其背景模糊并保持透明，壁纸全屏透出；
				// mask 颜色透明化已在 tokens（0.25），这里处理宿主注入的 blur 默认值（去模糊保留——不是毛玻璃，是透出壁纸）
				"[class*='_mask_'] { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; background-color: rgba(10, 12, 18, 0.18) !important; }",
				// 2026-09-22 毛玻璃移除补漏：宿主 _dockScrim_（dockkit 浮动面板遮罩 blur 6px）与
				// _onboardingMask_（启动引导遮罩 blur 2px）自带 backdrop-filter——主题此前未覆盖，
				// 实测「毛玻璃删了但还有」来自这两处。一并去模糊（blur none 保留注释可恢复）。
				"[class*='_dockScrim_'], [class*='_onboardingMask_'] { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }",
				// 中间会话区正文放大：正文读宿主 --dsh-content-font-size（font.js 按档位设置 14px×系数，
				// 驱动 AI 回复正文与原生文本）；此处 float 容器（DockView 浮窗）随 --mediascape-dsh-font-size 变量，
				// 让浮窗内文字与正文档位保持一致
				"[class*='_float_'] { font-size: var(--mediascape-dsh-font-size, 16px) !important; font-weight: 500 !important; }",
				"[class*='_float_'] [class*='_'] { line-height: var(--mediascape-dsh-font-line, 26px) !important; }",
				// ── 宿主元素胶囊/面板规则：**已外置**（theme-studio/capsules.json，build 注入 CAPSULES_DATA）──
				// 胶囊配方的选择器/背景源/透明度/圆角/padding/额外声明全部在 JSON 里，此处 capsuleCSS()
				// 渲染成 CSS 数组；配色网站「宿主元素配色」区读写同一文件，改完 build 生效。
				// 各锚点设计背景（为何选此选择器、hash 避坑、:not 排除项）见 capsules.json 每条 desc 与
				// docs/官方宿主元素修改记录.md 覆盖表。
				// ⚠️ 不要用 data-pending-steering 做排队气泡样式：该属性标记的正是用户消息气泡
				// 本身（MessageItem.tsx UserStyleBubble pending 态），会给用户刚发的消息加胶囊
				// （发消息时出现、落地后消失），曾误伤。排队提示若需视觉区分须另选稳定锚点。
				...capsuleCSS(),
				// 2026-09-2x 自动注册元素应用（theme-register.json zone=color，见 registerColorCSS）
				...registerColorCSS(),
		];
		const CSS_CAPSULE = [
				// ── 品牌区单独控制（2026-09-22）：lPcGpa_brand（左侧边栏顶部品牌组）──
				// 稳定锚点：CSS Modules hash 前缀（lPcGpa）随构建变，尾缀 _brand/_brandName 稳定（dsh-theme-host-element-locate 规律）。
				// 层级注入：sidebar-left（整体，--dsw-specific-sidebar-fill）先注入 → 此处品牌区后注入 → 品牌区底覆盖整体底；
				// 背景 + 品牌名文字一体由 sidebar-brand 键驱动（--dsw-specific-sidebar-brand / -text 令牌）。
				"[class$='_brand'] { background: var(--dsw-specific-sidebar-brand, transparent) !important; border-radius: 10px !important; padding: 6px 10px !important; align-self: stretch !important; }",
				"[class$='_brand'] [class*='_brandName'] { color: var(--dsw-specific-sidebar-brand-text, inherit) !important; }",

				// ── 右侧边栏「文件」tab 文件树 body 底色（2026-09-2x）：panelBody 键驱动 ──
				// 稳定锚点 data-files-body（宿主 SidebarFiles 文件树容器，不随 hash 变；类名 _620KBG_body 会变）。
				// 配色盘「配色」区可调（--dsw-specific-files-body 来自 panelBody 键），只上底色、不加胶囊配方。
				"[data-files-body] { background: var(--dsw-specific-files-body, transparent) !important; }",

				// ── 右侧边栏「文档预览」tab 纯文本容器底色（2026-09-2x）：textDocument 键驱动 ──
				// 稳定锚点 data-textpreview-plain（ui-sidebar-documentpreview TextBody 根容器，不随 hash 变；
				// 宿主类 K5p42G_textDocument 会变）。配色盘「配色」区可调（--dsw-specific-text-document）。
				"[data-textpreview-plain] { background: var(--dsw-specific-text-document, transparent) !important; }",

				// 壁纸背景层（z -2）+ 可读性遮罩（z -1）
				".mediascape-dsh-bg { position: fixed; inset: 0; z-index: -2; pointer-events: none; overflow: hidden;",
				"  background-color: transparent; background-position: center; background-size: cover; background-repeat: no-repeat; }",
				".mediascape-dsh-bg video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }",

				"::selection { background: rgba(var(--mediascape-dsh-theme-accent),  0.25); color: rgb(var(--mediascape-dsh-theme-text)); }",

				// 萤火氛围粒子（分档：关/星点/曳光/流萤，数量渐变）
				".mediascape-dsh-amb { position: fixed; inset: 0; pointer-events: none; z-index: 60; overflow: hidden; }",
				".mediascape-dsh-amb i { position: absolute; bottom: -14px; left: 0; opacity: 0;",
				"  transition: opacity 0.9s ease;",
				"  animation: ffFloat var(--dur, 20s) linear var(--delay, -5s) infinite;",
				"  will-change: transform, opacity; }",
				".mediascape-dsh-amb i.on { opacity: 1; }",
				".mediascape-dsh-amb i span { display: block; border-radius: 50%; background: rgb(var(--mediascape-dsh-theme-accent));",
				"  box-shadow: 0 0 8px 2px rgba(var(--mediascape-dsh-theme-border), 0.55); opacity: var(--op, 0.6);",
				"  animation: ffTwinkle 3.2s ease-in-out infinite; }",
				"@keyframes ffTwinkle { 0%, 100% { opacity: calc(var(--op, 0.6) * 0.45); } 50% { opacity: var(--op, 0.6); } }",
				"@keyframes ffFloat { 0% { transform: translate3d(0, 0, 0); }",
				"  100% { transform: translate3d(var(--drift, 24px), -110vh, 0); } }",
				// 右下角可拖动工具条（毛玻璃竖条圆角，位置记忆；竖排：字/景/声/乐）
				".mediascape-dsh-dock { position: fixed; right: 12px; bottom: 12px; z-index: 90; display: flex; flex-direction: column; align-items: center; gap: 7px;",
				"  padding: 6px 8px; border-radius: 14px; background: var(--dsw-specific-dock-bar);",
				"  border: 1px solid rgba(var(--mediascape-dsh-theme-border),  0.28); box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);",
				// 2026-09-22 毛玻璃移除（dock 竖条 blur14 备选注释保留，可恢复）：
				// "  backdrop-filter: blur(14px) saturate(150%); -webkit-backdrop-filter: blur(14px) saturate(150%);",
				"  cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none; }",
				".mediascape-dsh-dock.dragging { cursor: grabbing; }",
				// ── 2026-09-23 会话头部（txgHvq_header = 宿主 .header 容器：会话层级 crumbs/模式+后台任务/更多操作/右侧栏/对话·轨迹 tabs）──
				// 类名尾缀 [class*='_header']（docs 写法无尾下划线）+ :has([data-slot^='conversation.session.header'])
				// 收窄——提问面板 QuestionComposer 也有同名 <header>，裸类名会误伤。底色 = --dsw-specific-session-header（#362A56 深紫同 dock/sidebar）。
				"[class*='_header']:has([data-slot^='conversation.session.header']) { background: var(--dsw-specific-session-header, rgba(54, 42, 86, 0.5)) !important;",
				"  border-radius: 12px !important; padding: 8px 20px !important; margin: 0 0 6px 0 !important; }",
				".mediascape-dsh-dock-btn { width: 30px; height: 30px; border-radius: 50%; font-size: 13px; line-height: 1;",
				"  color: rgba(var(--mediascape-dsh-theme-text-dim),  0.75); background: rgba(var(--mediascape-dsh-theme-bg-layer),  0.5);",
				"  border: 1px solid rgba(var(--mediascape-dsh-theme-border),  0.35); cursor: pointer; opacity: 0.55; padding: 0;",
				"  transition: opacity 0.15s ease, color 0.15s ease, background 0.15s ease; }",
				".mediascape-dsh-dock-btn:hover { opacity: 1; }",
				".mediascape-dsh-music-toggle.on, .mediascape-dsh-bg-toggle.on, .mediascape-dsh-font-toggle.on { opacity: 1; color: rgb(var(--mediascape-dsh-theme-accent)); box-shadow: 0 0 10px rgba(var(--mediascape-dsh-theme-accent),  0.4); }",
				".mediascape-dsh-snd-toggle.on { opacity: 1; color: rgb(var(--mediascape-dsh-theme-accent)); box-shadow: 0 0 10px rgba(var(--mediascape-dsh-theme-accent),  0.4); }",
				".mediascape-dsh-snd-menu { position: absolute; z-index: 92; display: none; flex-direction: column;",
				"  gap: 8px; min-width: 188px; background: rgba(var(--mediascape-dsh-theme-bg-layer), 0.9); border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.35);",
				// 2026-09-22 毛玻璃移除（snd-menu blur6 注释保留，可恢复）：
				// "  border-radius: 10px; padding: 10px 12px; box-shadow: 0 6px 24px rgba(0,0,0,0.4); backdrop-filter: blur(6px); }",
				"  border-radius: 10px; padding: 10px 12px; box-shadow: 0 6px 24px rgba(0,0,0,0.4); }",
				".mediascape-dsh-snd-menu.open { display: flex; }",
				".mediascape-dsh-snd-line { display: flex; align-items: center; gap: 8px; }",
				".mediascape-dsh-snd-label { font-size: 12px; color: rgba(var(--mediascape-dsh-theme-text-dim), 0.75); min-width: 60px; }",
				".mediascape-dsh-snd-toggle-box { position: relative; width: 34px; height: 18px; border-radius: 999px; cursor: pointer;",
				"  background: rgba(var(--mediascape-dsh-theme-accent), 0.14); border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.4); transition: background 0.15s ease; }",
				".mediascape-dsh-snd-toggle-box::after { content: \"\"; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px;",
				"  border-radius: 50%; background: rgba(var(--mediascape-dsh-theme-text-dim), 0.8); transition: transform 0.15s ease, background 0.15s ease; }",
				".mediascape-dsh-snd-toggle-box.on { background: rgba(var(--mediascape-dsh-theme-accent), 0.45); }",
				".mediascape-dsh-snd-toggle-box.on::after { transform: translateX(16px); background: rgb(var(--mediascape-dsh-theme-text)); }",
				".mediascape-dsh-snd-vol { flex: 1; height: 26px; min-width: 0; accent-color: rgb(var(--mediascape-dsh-theme-accent)); cursor: pointer; }",
				".mediascape-dsh-snd-vol-ico { width: 22px; height: 22px; border-radius: 50%; border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.35);",
				"  background: rgba(var(--mediascape-dsh-theme-accent), 0.07); color: rgba(var(--mediascape-dsh-theme-text), 0.9); cursor: pointer; font-size: 13px; line-height: 20px;",
				"  padding: 0; text-align: center; transition: background 0.15s ease; opacity: 0.75; }",
				".mediascape-dsh-snd-vol-ico:hover { background: rgba(var(--mediascape-dsh-theme-accent), 0.18); opacity: 1; }",
				".mediascape-dsh-snd-vol-ico.on { opacity: 1; color: rgb(var(--mediascape-dsh-theme-accent)); box-shadow: 0 0 10px rgba(var(--mediascape-dsh-theme-accent),  0.4); }",
				// 2026-09-22 打字音色选择（清脆/柔和）按钮
				".mediascape-dsh-snd-style { flex: 1; height: 22px; border-radius: 5px; border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.35);",
				"  background: rgba(var(--mediascape-dsh-theme-accent), 0.07); color: rgba(var(--mediascape-dsh-theme-text), 0.85); cursor: pointer; font-size: 11px;",
				"  transition: background 0.15s ease; }",
				".mediascape-dsh-snd-style.on { background: rgba(var(--mediascape-dsh-theme-accent), 0.28); color: rgb(var(--mediascape-dsh-theme-text));",
				"  box-shadow: 0 0 8px rgba(var(--mediascape-dsh-theme-accent), 0.35); }",
				// 2026-09-22 字体按钮改单循环（去菜单），以下 font-menu/font-opt 样式不再被引用——注释保留（comment-not-delete），
				// 若恢复菜单形态可取消注释：
				// ".mediascape-dsh-font-menu { position: absolute; z-index: 92; display: none; flex-direction: column;",
				// "  gap: 5px; background: rgba(var(--mediascape-dsh-theme-bg-layer), 0.88); border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.35);",
				// "  border-radius: 10px; padding: 7px; box-shadow: 0 6px 24px rgba(0,0,0,0.4); }",
				// ".mediascape-dsh-font-menu.open { display: flex; }",
				// ".mediascape-dsh-font-opt { min-width: 64px; height: 26px; border-radius: 6px; border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.25);",
				// "  background: rgba(var(--mediascape-dsh-theme-accent), 0.07); color: rgba(var(--mediascape-dsh-theme-text), 0.88); cursor: pointer; font-size: 12px; padding: 0 8px; }",
				// ".mediascape-dsh-font-opt:hover { background: rgba(var(--mediascape-dsh-theme-accent), 0.16); }",
				// ".mediascape-dsh-font-opt.active { background: rgba(var(--mediascape-dsh-theme-accent), 0.22); color: rgb(var(--mediascape-dsh-theme-accent)); border-color: rgba(var(--mediascape-dsh-theme-border), 0.55); }",
				".mediascape-dsh-bg-panel { position: absolute; z-index: 92; display: none; flex-direction: column;",
				"  gap: 8px; min-width: 212px; background: rgba(var(--mediascape-dsh-theme-bg-layer), 0.9); border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.35);",
				// 2026-09-22 毛玻璃移除（bg-panel blur6 注释保留，可恢复）：
				// "  border-radius: 10px; padding: 10px 12px; box-shadow: 0 6px 24px rgba(0,0,0,0.4); backdrop-filter: blur(6px); }",
				"  border-radius: 10px; padding: 10px 12px; box-shadow: 0 6px 24px rgba(0,0,0,0.4); }",
				".mediascape-dsh-bg-panel.open { display: flex; }",
				".mediascape-dsh-bg-title { font-size: 12px; letter-spacing: 2px; color: rgba(var(--mediascape-dsh-theme-text-dim), 0.85); }",
				".mediascape-dsh-bg-line { display: flex; align-items: center; gap: 6px; }",
				".mediascape-dsh-amb-line .mediascape-dsh-amb-cycle { flex: 0 0 auto; white-space: nowrap; padding: 0 10px; min-width: 0; }",
				".mediascape-dsh-bg-label { font-size: 12px; color: rgba(var(--mediascape-dsh-theme-text-dim), 0.7); min-width: 52px; }",
				".mediascape-dsh-bg-seg { flex: 1; height: 26px; border-radius: 6px; border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.25);",
				"  background: rgba(var(--mediascape-dsh-theme-accent), 0.07); color: rgba(var(--mediascape-dsh-theme-text), 0.88); cursor: pointer; font-size: 12px; padding: 0 6px; }",
				".mediascape-dsh-bg-seg:hover { background: rgba(var(--mediascape-dsh-theme-accent), 0.16); }",
				".mediascape-dsh-bg-seg.active { background: rgba(var(--mediascape-dsh-theme-accent), 0.24); color: rgb(var(--mediascape-dsh-theme-accent)); border-color: rgba(var(--mediascape-dsh-theme-border), 0.55); }",
				".mediascape-dsh-bg-seg:disabled { opacity: 0.32; cursor: not-allowed; }",
				".mediascape-dsh-bg-interval { flex: 1; height: 26px; min-width: 0; border-radius: 6px; border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.25);",
				"  background: rgba(var(--mediascape-dsh-theme-accent), 0.07); color: rgba(var(--mediascape-dsh-theme-text), 0.95); font-size: 12px; padding: 0 8px; }",
				".mediascape-dsh-bg-unit { font-size: 12px; color: rgba(var(--mediascape-dsh-theme-text-dim), 0.7); }",
				".mediascape-dsh-bg-ok { height: 28px; border-radius: 6px; border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.4);",
				"  background: rgba(var(--mediascape-dsh-theme-accent), 0.16); color: #c9ffe0; cursor: pointer; font-size: 13px; }",
				".mediascape-dsh-bg-ok:hover { background: rgba(var(--mediascape-dsh-theme-accent), 0.26); }",
				".mediascape-dsh-bg-add { height: 28px; border-radius: 6px; border: 1px dashed rgba(var(--mediascape-dsh-theme-border), 0.45);",
				"  background: transparent; color: rgba(var(--mediascape-dsh-theme-text), 0.85); cursor: pointer; font-size: 13px; }",
				".mediascape-dsh-bg-add:hover { background: rgba(var(--mediascape-dsh-theme-accent), 0.12); }",
				".mediascape-dsh-bg-row2 { display: flex; justify-content: space-between; gap: 8px; }",
				".mediascape-dsh-bg-row2 .mediascape-dsh-bg-add, .mediascape-dsh-bg-row2 .mediascape-dsh-bg-pick { flex: 0 0 auto; }",
				".mediascape-dsh-bg-pick { height: 28px; border-radius: 6px; border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.4);",
				"  background: rgba(var(--mediascape-dsh-theme-accent), 0.12); color: rgba(var(--mediascape-dsh-theme-text), 0.9); cursor: pointer; font-size: 13px; }",
				".mediascape-dsh-bg-pick:hover { background: rgba(var(--mediascape-dsh-theme-accent), 0.22); }",
				".mediascape-dsh-bg-picker { position: absolute; z-index: 93; display: none; flex-direction: column;",
				"  gap: 8px; width: 430px; max-width: calc(100vw - 24px); max-height: calc(100vh - 80px); background: rgba(var(--mediascape-dsh-theme-bg-layer), 0.95);",
				"  border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.35); border-radius: 10px; padding: 10px; box-shadow: 0 6px 24px rgba(0,0,0,0.45); }",
				".mediascape-dsh-bg-picker.open { display: flex; }",
				".mediascape-dsh-bg-picker-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }",
				".mediascape-dsh-bg-picker-title { font-size: 12px; letter-spacing: 2px; color: rgba(var(--mediascape-dsh-theme-text-dim), 0.85); }",
				".mediascape-dsh-bg-close { width: 20px; height: 20px; border-radius: 5px; border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.3);",
				"  background: rgba(var(--mediascape-dsh-theme-accent), 0.08); color: rgba(var(--mediascape-dsh-theme-text), 0.85); cursor: pointer; font-size: 12px; line-height: 1; padding: 0; }",
				".mediascape-dsh-bg-close:hover { background: rgba(var(--mediascape-dsh-theme-accent), 0.2); color: rgb(var(--mediascape-dsh-theme-text)); }",
				".mediascape-dsh-bg-picker-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; align-content: start;",
				"  max-height: min(690px, calc(100vh - 210px)); overflow-y: auto; overscroll-behavior: contain; padding-right: 2px;",
				"  scrollbar-width: thin; scrollbar-color: rgba(var(--mediascape-dsh-theme-accent), 0.35) rgba(255,255,255,0.04); }",
				".mediascape-dsh-bg-picker-list::-webkit-scrollbar { width: 8px; }",
				".mediascape-dsh-bg-picker-list::-webkit-scrollbar-track { background: rgba(255,255,255,0.04); border-radius: 8px; }",
				".mediascape-dsh-bg-picker-list::-webkit-scrollbar-thumb { background: rgba(var(--mediascape-dsh-theme-accent), 0.35); border-radius: 8px; }",
				".mediascape-dsh-bg-picker-list::-webkit-scrollbar-thumb:hover { background: rgba(var(--mediascape-dsh-theme-accent), 0.55); }",
				".mediascape-dsh-bg-picker-empty { grid-column: 1 / -1; text-align: center; color: rgba(var(--mediascape-dsh-theme-text-dim), 0.55); font-size: 12px; padding: 30px 0; }",
				".mediascape-dsh-bg-picker-item { position: relative; display: flex; flex-direction: column; gap: 4px; align-items: center; background: transparent;",
				"  min-width: 0; border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.2); border-radius: 8px; padding: 4px; cursor: pointer;",
				"  color: rgba(var(--mediascape-dsh-theme-text), 0.85); font-size: 11px; transition: border-color 0.15s ease, background 0.15s ease; }",
				".mediascape-dsh-bg-picker-item:hover { border-color: rgba(var(--mediascape-dsh-theme-border), 0.55); background: rgba(var(--mediascape-dsh-theme-accent), 0.1); }",
				".mediascape-dsh-bg-picker-item.checked { border-color: rgb(var(--mediascape-dsh-theme-accent)); background: rgba(var(--mediascape-dsh-theme-accent), 0.14); box-shadow: 0 0 10px rgba(var(--mediascape-dsh-theme-accent), 0.2); }",
				".mediascape-dsh-bg-picker-item img, .mediascape-dsh-bg-picker-item video { width: 100%; height: auto; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 5px; background: rgb(var(--mediascape-dsh-theme-bg)); }",
				".mediascape-dsh-bg-picker-item span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 14px; height: 14px; }",
				".mediascape-dsh-bg-check { position: absolute; top: 6px; right: 6px; width: 16px; height: 16px; margin: 0; cursor: pointer;",
				"  accent-color: rgb(var(--mediascape-dsh-theme-accent-soft)); z-index: 2; }",
				".mediascape-dsh-bg-picker-actions { display: flex; gap: 8px; }",
		];
		const CSS_UPLOADHUD = [
				// ── 上传进度 HUD（2026-09-22）：右下角悬浮窗，多任务多行、左右每行完全对齐 ──
				// grid 三列固定宽（文件名 130px / 进度条 1fr / 元信息 150px），任意多行同宽同列对齐；
				// 无任务时整体隐藏（display:none）。行内进度条叠加显示「已传/总 · 速度」。
				// 2026-09-23 改：上传进度面板（dock 二级面板，对齐景面板模式）
				".mediascape-dsh-upload-panel { position: absolute; z-index: 92; display: none; flex-direction: column; gap: 8px;",
				"  min-width: 260px; background: var(--dsw-specific-dock-bar); border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.28);",
				"  border-radius: 10px; padding: 10px 12px; box-shadow: 0 6px 24px rgba(0,0,0,0.4); }",
				".mediascape-dsh-upload-panel.open { display: flex; }",
				".mediascape-dsh-upload-hud { flex-direction: column; gap: 6px; font-size: 11px; color: rgba(var(--mediascape-dsh-theme-text), 0.92); }",
				".mediascape-dsh-upload-row { display: grid; grid-template-columns: 130px minmax(120px, 1fr) 150px 44px; align-items: center; gap: 8px; }",
				".mediascape-dsh-upload-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(var(--mediascape-dsh-theme-text), 0.95); }",
				".mediascape-dsh-upload-bar-wrap { height: 6px; border-radius: 999px; background: rgba(255,255,255,0.1); overflow: hidden; padding: 8px 0; background-clip: content-box; cursor: pointer; }",
				".mediascape-dsh-upload-bar { display: block; height: 100%; width: 0; border-radius: 999px;",
				"  background: linear-gradient(90deg, rgb(var(--mediascape-dsh-theme-accent-soft)), rgb(var(--mediascape-dsh-theme-accent)));",
				"  transition: width 0.15s linear; }",
				".mediascape-dsh-upload-meta { text-align: right; white-space: nowrap; color: rgba(var(--mediascape-dsh-theme-text-dim), 0.85); font-variant-numeric: tabular-nums; }",
				// 2026-09-22 断点续传配套：行尾暂停/继续 + 取消按钮；暂停态行降透明度+虚线边
				".mediascape-dsh-upload-ctl { display: flex; gap: 4px; justify-content: flex-end; }",
				".mediascape-dsh-upload-btn { width: 18px; height: 18px; padding: 0; border-radius: 4px; font-size: 10px; line-height: 1; cursor: pointer;",
				"  border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.35); background: rgba(var(--mediascape-dsh-theme-accent), 0.1);",
				"  color: rgba(var(--mediascape-dsh-theme-text), 0.85); display: inline-block; }",
				".mediascape-dsh-upload-btn:hover { background: rgba(var(--mediascape-dsh-theme-accent), 0.25); }",
				".mediascape-dsh-upload-row.mediascape-dsh-upload-paused { opacity: 0.65; border: 1px dashed rgba(var(--mediascape-dsh-theme-border), 0.5); border-radius: 6px; padding: 2px 4px; }",
				".mediascape-dsh-upload-row.mediascape-dsh-upload-fail .mediascape-dsh-upload-name { color: #ffb3c0; }",
				".mediascape-dsh-upload-row.mediascape-dsh-upload-fail .mediascape-dsh-upload-bar { background: linear-gradient(90deg, #ff8fa3, #ff5f7e); }",
				// 2026-09-2x 加：去重「已跳过」提示行（灰字无进度条，短暂保留）
				".mediascape-dsh-upload-row.mediascape-dsh-upload-skip .mediascape-dsh-upload-name { color: rgba(var(--mediascape-dsh-theme-text-dim), 0.7); }",
				".mediascape-dsh-upload-row.mediascape-dsh-upload-skip { grid-template-columns: 1fr; opacity: 0.9; }",
				".mediascape-dsh-bg-act { flex: 1; height: 28px; border-radius: 6px; border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.35);",
				"  background: rgba(var(--mediascape-dsh-theme-accent), 0.1); color: rgba(var(--mediascape-dsh-theme-text), 0.9); cursor: pointer; font-size: 12px; }",
				".mediascape-dsh-bg-act:hover:not(:disabled) { background: rgba(var(--mediascape-dsh-theme-accent), 0.22); }",
				".mediascape-dsh-bg-act:disabled { opacity: 0.35; cursor: not-allowed; }",
				".mediascape-dsh-bg-act.mediascape-dsh-bg-remove { color: #ffb3c0; border-color: rgba(255,93,122,0.4); background: rgba(255,93,122,0.1); }",
				".mediascape-dsh-bg-act.mediascape-dsh-bg-remove:hover:not(:disabled) { background: rgba(255,93,122,0.22); }",
				".mediascape-dsh-music-card { position: absolute; z-index: 91; width: 252px; max-width: calc(100vw - 24px);",
				"  background: rgba(var(--mediascape-dsh-theme-bg-layer), 0.85); border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.35); border-radius: 10px;",
				"  padding: 10px 12px; box-sizing: border-box; display: flex; flex-direction: column; gap: 8px;",
				// 2026-09-22 毛玻璃移除（music-card blur6 注释保留，可恢复）：
				// "  box-shadow: 0 6px 24px rgba(0,0,0,0.4); backdrop-filter: blur(6px); }",
				"  box-shadow: 0 6px 24px rgba(0,0,0,0.4); }",
				".mediascape-dsh-music-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }",
				".mediascape-dsh-music-title { font-size: 12px; color: rgba(var(--mediascape-dsh-theme-text), 0.92); white-space: nowrap; overflow: hidden;",
				"  text-overflow: ellipsis; flex: 1; }",
				".mediascape-dsh-music-close { background: transparent; border: none; color: rgba(var(--mediascape-dsh-theme-text-dim), 0.7); cursor: pointer;",
				"  font-size: 14px; line-height: 1; padding: 0 2px; }",
				".mediascape-dsh-music-close:hover { color: rgb(var(--mediascape-dsh-theme-text)); }",
				".mediascape-dsh-music-row { display: flex; gap: 6px; }",
				".mediascape-dsh-music-btn { flex: 1; height: 28px; border-radius: 6px; border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.3);",
				"  background: rgba(var(--mediascape-dsh-theme-accent), 0.08); color: rgba(var(--mediascape-dsh-theme-text), 0.9); cursor: pointer; font-size: 13px;",
				"  line-height: 1; padding: 0; }",
				".mediascape-dsh-music-btn:hover { background: rgba(var(--mediascape-dsh-theme-accent), 0.18); }",
				".mediascape-dsh-music-mode { flex: 1.4; font-size: 11px; }",
		];
		const CSS_PLAYER = [
				// ── 播放器：旋转唱片 / 进度条 / 歌单选择 / 封面 ──
				".mediascape-dsh-music-shrink { background: transparent; border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.3); color: rgba(var(--mediascape-dsh-theme-text-dim), 0.75);",
				"  cursor: pointer; font-size: 11px; line-height: 1; padding: 3px 5px; border-radius: 5px; }",
				".mediascape-dsh-music-shrink:hover { color: rgb(var(--mediascape-dsh-theme-text)); background: rgba(var(--mediascape-dsh-theme-accent), 0.12); }",
				".mediascape-dsh-music-disc-wrap { position: relative; width: 150px; height: 150px; margin: 0 auto; }",
				".mediascape-dsh-music-disc { position: absolute; inset: 0; border-radius: 50%; cursor: pointer;",
				"  background:",
				"    radial-gradient(circle at 50% 50%, rgba(var(--mediascape-dsh-theme-accent), 0.05) 0%, rgba(var(--mediascape-dsh-theme-accent), 0) 58%),",
				"    repeating-radial-gradient(circle at 50% 50%, #101a2c 0 2px, #0a1322 3px 5px);",
				"  box-shadow: 0 6px 22px rgba(0,0,0,0.55), 0 0 0 1px rgba(var(--mediascape-dsh-theme-border), 0.12), 0 0 24px rgba(var(--mediascape-dsh-theme-accent), 0.12);",
				"  animation: ffSpin 8s linear infinite; animation-play-state: paused; }",
				".mediascape-dsh-music-disc.playing { animation-play-state: running; }",
				"@keyframes ffSpin { to { transform: rotate(360deg); } }",
				".mediascape-dsh-music-cover { position: absolute; left: 18%; top: 18%; width: 64%; height: 64%; border-radius: 50%;",
				"  background-size: cover; background-position: center; background-color: #0a1322;",
				"  display: flex; align-items: center; justify-content: center; overflow: hidden;",
				"  box-shadow: inset 0 0 14px rgba(0,0,0,0.65);",
				"  background-image: radial-gradient(circle at 50% 38%, rgba(var(--mediascape-dsh-theme-accent), 0.30), rgba(0,230,118,0.06) 62%, transparent 80%),",
				"    linear-gradient(160deg, #123a28, #072013); }",
				".mediascape-dsh-music-lbl { font-size: 30px; font-weight: 800; color: rgba(var(--mediascape-dsh-theme-text), 0.92);",
				"  text-shadow: 0 0 14px rgba(var(--mediascape-dsh-theme-border), 0.8), 0 1px 1px rgba(0, 0, 0, 0.5), 0 0 2px rgba(0, 0, 0, 0.75) !important; pointer-events: none; line-height: 1; }",
				".mediascape-dsh-music-hub { position: absolute; left: 50%; top: 50%; width: 12px; height: 12px; margin: -6px 0 0 -6px;",
				"  border-radius: 50%; background: rgb(var(--mediascape-dsh-theme-bg)); box-shadow: inset 0 0 0 2px rgba(var(--mediascape-dsh-theme-text), 0.9), 0 0 6px rgba(var(--mediascape-dsh-theme-accent), 0.6); }",
				".mediascape-dsh-music-seek-row { display: flex; align-items: center; gap: 6px; }",
				".mediascape-dsh-music-time { font-size: 10px; color: rgba(var(--mediascape-dsh-theme-text-dim), 0.72); font-variant-numeric: tabular-nums;",
				"  min-width: 30px; text-align: center; }",
				".mediascape-dsh-music-seek { flex: 1; -webkit-appearance: none; appearance: none; height: 4px; border-radius: 2px;",
				"  background: rgba(var(--mediascape-dsh-theme-border), 0.18); outline: none; cursor: pointer; }",
				".mediascape-dsh-music-seek::-webkit-slider-thumb { -webkit-appearance: none; width: 10px; height: 10px; border-radius: 50%;",
				"  background: rgb(var(--mediascape-dsh-theme-accent)); box-shadow: 0 0 6px rgba(var(--mediascape-dsh-theme-accent), 0.7); }",
				".mediascape-dsh-music-seek::-moz-range-thumb { width: 10px; height: 10px; border: none; border-radius: 50%;",
				"  background: rgb(var(--mediascape-dsh-theme-accent)); box-shadow: 0 0 6px rgba(var(--mediascape-dsh-theme-accent), 0.7); }",
		];
		const CSS_PICKER = [
				// ── 歌单选择面板（勾选后移除 / 随机，类似壁纸选择器）──
				".mediascape-dsh-ms-picker { position: absolute; z-index: 93; display: none; flex-direction: column;",
				"  gap: 8px; width: 320px; max-width: calc(100vw - 24px); max-height: calc(100vh - 80px); background: rgba(var(--mediascape-dsh-theme-bg-layer), 0.95);",
				"  border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.35); border-radius: 10px; padding: 10px; box-shadow: 0 6px 24px rgba(0,0,0,0.45); }",
				".mediascape-dsh-ms-picker.open { display: flex; }",
				".mediascape-dsh-ms-picker-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }",
				".mediascape-dsh-ms-picker-title { font-size: 12px; letter-spacing: 2px; color: rgba(var(--mediascape-dsh-theme-text-dim), 0.85); }",
				".mediascape-dsh-ms-picker-list { display: flex; flex-direction: column; gap: 4px; align-content: start;",
				"  max-height: min(400px, calc(100vh - 210px)); overflow-y: auto; overscroll-behavior: contain; padding-right: 2px;",
				"  scrollbar-width: thin; scrollbar-color: rgba(var(--mediascape-dsh-theme-accent), 0.35) rgba(255,255,255,0.04); }",
				".mediascape-dsh-ms-picker-list::-webkit-scrollbar { width: 8px; }",
				".mediascape-dsh-ms-picker-list::-webkit-scrollbar-track { background: rgba(255,255,255,0.04); border-radius: 8px; }",
				".mediascape-dsh-ms-picker-list::-webkit-scrollbar-thumb { background: rgba(var(--mediascape-dsh-theme-accent), 0.35); border-radius: 8px; }",
				".mediascape-dsh-ms-picker-list::-webkit-scrollbar-thumb:hover { background: rgba(var(--mediascape-dsh-theme-accent), 0.55); }",
				".mediascape-dsh-ms-item { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 6px; cursor: pointer;",
				"  min-width: 0; border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.15); background: rgba(var(--mediascape-dsh-theme-accent), 0.05); color: rgba(var(--mediascape-dsh-theme-text), 0.9);",
				"  font-size: 12px; transition: border-color 0.15s ease, background 0.15s ease; }",
				".mediascape-dsh-ms-item:hover { border-color: rgba(var(--mediascape-dsh-theme-border), 0.55); background: rgba(var(--mediascape-dsh-theme-accent), 0.1); }",
				".mediascape-dsh-ms-item.checked { border-color: rgb(var(--mediascape-dsh-theme-accent)); background: rgba(var(--mediascape-dsh-theme-accent), 0.14); box-shadow: 0 0 10px rgba(var(--mediascape-dsh-theme-accent), 0.2); }",
				".mediascape-dsh-ms-item.active { border-color: rgba(var(--mediascape-dsh-theme-border), 0.6); color: rgb(var(--mediascape-dsh-theme-accent)); }",
				".mediascape-dsh-ms-check { width: 16px; height: 16px; margin: 0; cursor: pointer; accent-color: rgb(var(--mediascape-dsh-theme-accent-soft)); flex: none; }",
				".mediascape-dsh-ms-item .ttl { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }",
				".mediascape-dsh-ms-empty { font-size: 11px; color: rgba(var(--mediascape-dsh-theme-text-dim), 0.55); text-align: center; padding: 20px 4px; }",
				".mediascape-dsh-ms-picker-actions { display: flex; gap: 8px; }",

				// ═══ 开屏动画（GIF）═══
				// 2026-09-22：浮层底色还原为深色（#03070f），保持开屏沉稳的深色观感；
				// 曾尝试「主题氛围渐变」方案（见下方注释行），观感偏亮、与壁纸主题抢视觉，注释保留备选。
				// 媒体元素默认 opacity:0 占位（浮层为深色背景，无黑框观感）；媒体首帧就绪后加 .ready →
				// transition 0.6s 渐变淡入（opacity 0→1，scale 0.95→1）。旧 ffGifIn 动画为「插入即淡入」，
				// 对未就绪媒体不合适（黑底会提前露出），已由 transition + .ready 取代，动画注释保留备选。
				".mediascape-dsh-boot { position: fixed; inset: 0; z-index: 99999; background: #03070f; overflow: hidden;",
				"  display: flex; flex-direction: column; align-items: center; justify-content: center;",
				"  opacity: 1; transition: opacity 0.5s ease; }",
				// 备选：主题氛围渐变底（替代上面 background: #03070f，开屏加载期呈现主题色而非深黑）
				// "  background: linear-gradient(168deg, rgba(var(--mediascape-dsh-theme-bg-soft), 0.98) 0%, rgba(var(--mediascape-dsh-theme-bg), 0.96) 45%, rgba(var(--mediascape-dsh-theme-bg-layer), 0.9) 100%); }",
				".mediascape-dsh-boot.gone { opacity: 0; pointer-events: none; }",
				".mediascape-dsh-boot::before { content: ''; position: absolute; inset: 0; pointer-events: none;",
				"  background: radial-gradient(70% 55% at 50% 42%, rgba(var(--mediascape-dsh-theme-accent), 0.13), transparent 70%); }",
				".mediascape-dsh-boot .mediascape-dsh-gif { position: relative; max-width: min(94vw, 1000px); max-height: min(70vh, 562px);",
				"  width: auto; height: auto; object-fit: contain; background: #000;",
				"  border-radius: 14px; box-shadow: 0 0 70px rgba(var(--mediascape-dsh-theme-accent), 0.35), 0 0 160px rgba(var(--mediascape-dsh-theme-accent), 0.16);",
				"  opacity: 0; transform: scale(0.95); transition: opacity 0.6s ease, transform 0.6s ease; }",
				".mediascape-dsh-boot .mediascape-dsh-gif.ready { opacity: 1; transform: scale(1); }",
				// 备选：插入即淡入动画（不等待首帧就绪，未就绪媒体会提前露出黑底）
				// "  opacity: 0; transform: scale(0.95); animation: ffGifIn 0.5s ease forwards; }",
		];
		const CSS_AMBIENCE = [
				// "@keyframes ffGifIn { to { opacity: 1; transform: scale(1); } }",
				// ═══ 等待期「昼光萤引」氛围层（2026-09-22 设计）：浮层立即盖住界面后不等死深色发呆 ──
				// 中央呼吸光圈（accent 径向光晕 1.6s pulse）+ 萤火星尘（24 粒 i 元素缓慢上升飘散）。
				// 媒体首帧就绪 → 浮层加 .media-ready → 星尘/光圈 0.5s 淡出（视觉上「萤火聚成画面」），
				// 星尘为纯装饰层，不动「浮层 + 媒体」两元素功能骨架、不抢媒体视觉。
				".mediascape-dsh-boot .mediascape-dsh-stardust { position: absolute; inset: 0; overflow: hidden; pointer-events: none;",
				"  transition: opacity 0.5s ease; opacity: 1; }",
				".mediascape-dsh-boot.media-ready .mediascape-dsh-stardust { opacity: 0; }",
				".mediascape-dsh-boot .mediascape-dsh-stardust i { position: absolute; bottom: -8px; width: 4px; height: 4px;",
				"  border-radius: 50%; background: rgba(var(--mediascape-dsh-theme-accent), 0.85);",
				"  box-shadow: 0 0 6px rgba(var(--mediascape-dsh-theme-accent), 0.9);",
				"  animation: ffStardust var(--dur, 7s) linear var(--delay, 0s) infinite; }",
				"@keyframes ffStardust { 0% { transform: translate3d(0, 0, 0) scale(0.5); opacity: 0; }",
				"  20% { opacity: 0.8; } 80% { opacity: 0.35; }",
				"  100% { transform: translate3d(var(--dx, -30px), calc(-1 * var(--rise, 110px)), 0) scale(1); opacity: 0; } }",
				".mediascape-dsh-boot .mediascape-dsh-boot-pulse { position: absolute; left: 50%; top: 50%; width: 240px; height: 240px;",
				"  margin: -120px 0 0 -120px; border-radius: 50%; pointer-events: none;",
				"  background: radial-gradient(circle, rgba(var(--mediascape-dsh-theme-accent), 0.16), transparent 68%);",
				"  animation: ffBootPulse 1.6s ease-in-out infinite; transition: opacity 0.5s ease; opacity: 1; }",
				".mediascape-dsh-boot.media-ready .mediascape-dsh-boot-pulse { opacity: 0; }",
				"@keyframes ffBootPulse { 0%, 100% { transform: scale(0.94); opacity: 0.45; } 50% { transform: scale(1.06); opacity: 0.9; } }",
				// ═══ 结束（2026-09-22 定稿）：放大动画已作废（维持媒体大小不变直接结束），
				// 不再有 .ending 类触发 —— 浮层直接 .gone 淡出移除。媒体保持卡片原尺寸，交给壁纸层无缝续播。
				".mediascape-dsh-boot.media-ready .mediascape-dsh-gif { transition: opacity 0.6s ease, transform 0.6s ease; }",
				".mediascape-dsh-title { position: relative; margin-top: 30px; font-size: 32px; font-weight: 800; letter-spacing: 14px;",
				"  color: rgb(var(--mediascape-dsh-theme-text)); text-shadow: 0 0 18px rgba(var(--mediascape-dsh-theme-border), 0.9), 0 0 60px rgba(var(--mediascape-dsh-theme-accent), 0.5), 0 1px 1px rgba(0, 0, 0, 0.5), 0 0 2px rgba(0, 0, 0, 0.75) !important;",
				"  opacity: 0; animation: ffFadeIn 0.7s 0.4s ease forwards; }",
				".mediascape-dsh-sub { position: relative; margin-top: 12px; font-size: 14px; letter-spacing: 6px;",
				"  color: rgba(var(--mediascape-dsh-theme-text-dim), 0.85); opacity: 0; animation: ffFadeIn 0.7s 0.7s ease forwards; }",
				"@keyframes ffFadeIn { to { opacity: 1; } }",
				".mediascape-dsh-skip { position: absolute; right: 18px; bottom: 14px; padding: 6px 14px; font-size: 12px;",
				"  letter-spacing: 2px; color: rgba(var(--mediascape-dsh-theme-text-dim), 0.8); background: rgba(var(--mediascape-dsh-theme-border), 0.08);",
				"  border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.35); border-radius: 6px; cursor: pointer; }",
				".mediascape-dsh-skip:hover { background: rgba(var(--mediascape-dsh-theme-border), 0.16); }",

				"@media (max-width: 640px) {",
				"  .mediascape-dsh-title { font-size: 22px; letter-spacing: 8px; }",
				"  .mediascape-dsh-sub { font-size: 12px; }",
				"}",
				"@media (prefers-reduced-motion: reduce) { .mediascape-dsh-amb { display: none; } .mediascape-dsh-music-disc { animation: none; } }"
		];
		function identityCSS() {
			// 2026-09-23 拆：tokenLines 已在顶层定义（CSS_BASE 内 body 块引用），此处不再重复
			return CSS_BASE.concat(CSS_CAPSULE, CSS_UPLOADHUD, CSS_PLAYER, CSS_PICKER, CSS_AMBIENCE).join("\n");
		}

