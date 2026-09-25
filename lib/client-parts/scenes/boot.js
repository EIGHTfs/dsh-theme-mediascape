// ═══════════ 4. 开屏动画（立即插入去黑屏 * 不 build 注入素材，完全按运行时 boot.json；gif/图片/视频多画面轮换；file:"auto" 联动视频壁纸同一份流移交）═══════════
// 运行时配置：boot/boot.json（{file 或 files, title, sub, durationMs, durations, loop}）。
// 2026-09-22 设计变更：不再 build 注入预置首图（GIF_DATA 恒 null）——「初始加载先显示一张图」的预留
// 黑框画面时间不保留，开屏内容完全按运行时 boot.json 的 file/files 决定（改配置刷新即生效，无需 build）。
// file/files 支持 .gif/.png/.webp（<img>）与 .mp4（<video muted loop autoplay>，启动画面无声音）；
// files 数组按每段对应时长顺序轮换播放（durations 数组与 files 一一对应；缺省/越界/非法回退单值 durationMs），播完整个集合后自动淡出；
// loop:true 则循环整个集合直到点击跳过；无 files / 空数组 → 回退 file → 纯色占位（浮层仍立即插入，不黑屏）。
// 去黑屏：playTransformIntro 同步建编浮层并 append（不等 boot.json fetch），配置后台取回后重建素材/文案与轮换队列。
let bootGifUrl = GIF_DATA;   // 恒 null（2026-09-22 移除 build 注入）：立即插入阶段仅纯色占位，媒体由配置取回后补建
let bootFiles = null;        // 运行时 files 数组（已拼同源绝对 URL）；null = 未配置（走单画面原行为）
let bootDurations = null;    // 运行时 durations 数组（与 files 一一对应，毫秒）；null = 每段统一用 bootDurationMs
let bootLoop = false;        // loop:true → 播完整个集合循环播放（直到点击跳过），否则播完自动淡出
let bootTitle = "";
let bootSub = "";
const BOOT_FALLBACK_MS = 3000; // 无配置时默认单画面时长
const BOOT_MIN_MS = 3000; // 时长下限（2026-09-23 定稿）：boot.json durationMs/durations 可写更低，
	// 但代码读取时钳制最小 3000ms——开屏再短也保证可读/防误配闪屏
		const BOOT_FADE_OUT_MS = 520;   // 开屏浮层淡出移除
		const BOOT_MEDIA_READY_MS = 5000; // 等媒体首帧/加载超时（实机反代+主实例路径首帧约 2s，2000ms 会误判黑屏，放宽到 5000ms）
		let bootDurationMs = BOOT_FALLBACK_MS;
let bootAutoVideo = null;    // file:"auto" 解析结果 {id,url}：当前视频壁纸（与壁纸层同一份流式数据）
// file 支持 "auto"（2026-09-22 新机制）：自动取当前启用的视频壁纸做开屏（走既有 Range 流式通道），
// 开屏播完把 video 元素移交给壁纸层继续消费（同一 URL 同一元素，不重复加载）。
async function resolveAutoBootVideo(listData) {
  try {
    // 入参 listData：loadBootGifConfig 并行 fetch 时已取回的 wallpaper/list 数据（避免二次请求）；
    // 缺省/失败时自行 fetch（向后兼容独立调用）。
    let items = null;
    if (listData) items = (listData.items) || [];
    else {
      const r = await ffFetch("/theme-mediascape-assets/wallpaper/list");
      if (!r.ok) return null;
      items = (await r.json()).items || [];
    }
    const vids = items.filter((w) => w.kind === "video");
    if (!vids.length) return null;
    // 当前启用视频壁纸：LS_BG_VID 命中优先（与壁纸层当前选择一致），否则第一个视频兜底
    let saved = null;
    try { saved = localStorage.getItem(LS_BG_VID); } catch (e) { saved = null; }
    const pick = (saved && vids.find((w) => w.id === saved)) || vids[0];
    return { id: pick.id, url: pick.url, etag: pick.etag || null };
  } catch { return null; }
}
async function loadBootGifConfig() {
  try {
    // loading 占位（2026-09-22 新机制）：同步段先挂「开屏可能是 auto」标记，
    // 让壁纸层在 auto 解析完成前一律不自建 video（否则壁纸层会先自建同 URL video → 多余一次 Range 请求）。
    // 解析完按 id 匹配/不匹配决定。
    try { window.__mediascapeDshBootVideoPending = { loading: true }; } catch (e) { /* localStorage 异常（配额/隐私模式）可忽略 */ }
    // 并行 fetch（2026-09-22 优化）：boot.json 与 wallpaper/list 同时发出——file:"auto" 时
    // 两路取回即用（boot 无需串行等 list，提前拿到 video URL 建 media → 缩短首帧等待）；
    // 非 auto 时 list 结果弃用（一次无谓请求可接受，换取 auto 场景省一次 RTT）。
    const [bootResp, listResp] = await Promise.all([
      ffFetch("/theme-mediascape-assets/boot/boot.json"),
      ffFetch("/theme-mediascape-assets/wallpaper/list"),
    ]);
    if (!bootResp.ok) return;
    const cfg = await bootResp.json();
    let listData = null;
    try { if (listResp.ok) listData = await listResp.json(); } catch (e) { listData = null; }
    const base = "/theme-mediascape-assets/boot/";
    // file:"auto"（2026-09-22 新机制）：开屏=当前视频壁纸，流式数据与壁纸层同一份
    if (cfg.file === "auto") {
      const auto = await resolveAutoBootVideo(listData);
      if (auto) {
        bootAutoVideo = auto;
        bootFiles = [auto.url]; // 使用壁纸目录绝对 URL（不经 boot base 拼接）
        // pending 升级为具体 id：告知壁纸层「开屏正在播这个视频、稍后移交」——同 id 跳过自建，
        // 不同 id（壁纸选择已切走）壁纸层正常自建自己的。
        try { window.__mediascapeDshBootVideoPending = { id: auto.id, url: auto.url }; } catch (e) { /* localStorage 异常（配额/隐私模式）可忽略 */ }
        // 主动通知壁纸层重渲染（wallpaper.js）：boot 解析可能在壁纸层首次渲染之后完成，
        // 必须在它把同 URL 自建 video 播完（ended→switch 切走）之前让它移除自建、改等移交。
        if (typeof window.__mediascapeDshBootVideoPendingChanged === "function") window.__mediascapeDshBootVideoPendingChanged();
      } else {
        // auto 解析失败（无视频壁纸/网络问题）→ 清占位，壁纸层恢复正常自建
        window.__mediascapeDshBootVideoPending = null;
        if (typeof window.__mediascapeDshBootVideoPendingChanged === "function") window.__mediascapeDshBootVideoPendingChanged();
      }
    } else {
      // 非 auto 开屏：清占位，壁纸层不受影响正常自建
      window.__mediascapeDshBootVideoPending = null;
      if (typeof window.__mediascapeDshBootVideoPendingChanged === "function") window.__mediascapeDshBootVideoPendingChanged();
      if (Array.isArray(cfg.files) && cfg.files.length) {
        bootFiles = cfg.files.filter((f) => typeof f === "string" && f).map((f) => base + encodeURIComponent(f));
      } else if (typeof cfg.file === "string" && cfg.file) {
        bootFiles = [base + encodeURIComponent(cfg.file)];
      }
    }
    if (Array.isArray(cfg.durations) && cfg.durations.length) {
      bootDurations = cfg.durations.map((d) => (Number.isFinite(+d) && +d > 0 ? Math.max(BOOT_MIN_MS, +d) : null)); // 钳制下限 3000
    }
    if (typeof cfg.loop === "boolean") bootLoop = cfg.loop;
    if (typeof cfg.title === "string") bootTitle = cfg.title;
    if (typeof cfg.sub === "string") bootSub = cfg.sub;
    if (Number.isFinite(+cfg.durationMs) && +cfg.durationMs > 0) bootDurationMs = Math.max(BOOT_MIN_MS, +cfg.durationMs); // 钳制下限 3000
  } catch {
    // 网络/解析失败：清占位，壁纸层恢复正常自建；开屏保留默认，不影响
    try { window.__mediascapeDshBootVideoPending = null; } catch (e) { /* localStorage 异常（配额/隐私模式）可忽略 */ }
    if (typeof window.__mediascapeDshBootVideoPendingChanged === "function") window.__mediascapeDshBootVideoPendingChanged();
  }
}
// ── 开屏渲染（2026-09-22 重新设计定稿：总共就两个元素）──
// 元素1 → .mediascape-dsh-boot：全屏深色浮层，playTransformIntro 同步立即插入盖住 DSH 界面（防界面先出黑窗）。
// 元素2 → .mediascape-dsh-gif：媒体占位，CSS 默认 opacity:0（浮层透出深色背景，无「黑框」观感）；媒体首帧
//         就绪后加 .ready → transition 0.6s 渐变淡入（opacity 0→1、scale 0.95→1）。视频真实出现靠渐变调不透明度。
// 无素材 / 配置失败 / 媒体超时 → 浮层深色背景展示 durationMs 后自动淡出（界面呈现，无黑框先行）。
// 配置取回后：补标题/副标题 → 建媒体元素（video 或 img）插入浮层 → 等首帧 → .ready 渐变淡入 → 多画面轮换/定时结束。
function buildBootOverlay() {
	// 元素1：全屏深色浮层——背景 #03070f 完全实色不透明（防透出下方 DSH 界面），只含 skip 按钮
	//（媒体占位由 playTransformIntro 配置取回后补建插入）。
	const ov = document.createElement("div");
	ov.className = "mediascape-dsh-boot";
	// 等待期「昼光萤引」氛围层（装饰，pointer-events:none 不阻挡交互、不抢媒体视觉）：
	// 中央呼吸光圈 + 24 粒萤火星尘缓慢上升（颜色/位置/动画均随机，素材就绪后浮层 .media-ready 一起淡出）
	const pulse = document.createElement("div");
	pulse.className = "mediascape-dsh-boot-pulse";
	ov.appendChild(pulse);
	const stardust = document.createElement("div");
	stardust.className = "mediascape-dsh-stardust";
	for (let i = 0; i < 24; i++) {
		const s = document.createElement("i");
		s.style.left = (Math.random() * 96 + 2) + "%";
		s.style.setProperty("--dur", (5 + Math.random() * 5).toFixed(2) + "s");
		s.style.setProperty("--delay", (-Math.random() * 8).toFixed(2) + "s");
		s.style.setProperty("--rise", (80 + Math.random() * 90).toFixed(0) + "px");
		s.style.setProperty("--dx", ((Math.random() * 70 - 35)).toFixed(0) + "px");
		stardust.appendChild(s);
	}
	ov.appendChild(stardust);
	// 结束过渡全屏渐变闪光层（.ending 时 opacity 0→1，覆盖在星尘/媒体之上，见 identity.js）
	const flash = document.createElement("div");
	flash.className = "mediascape-dsh-boot-flash";
	ov.appendChild(flash);
	// 文案为空字符串则不渲染对应元素（默认全空，只显示媒体本身）
	// 2026-09-23 删「点击跳过」按钮（定稿：点画面即可跳过，进度保护——媒体就绪前点画面
	// 也由 waitBootMediaReady 超时兜底自动结束，不依赖按钮）。标题/副标题顺序 append 保持层级。
	if (bootTitle) { const t = document.createElement("div"); t.className = "mediascape-dsh-title"; t.textContent = bootTitle; ov.appendChild(t); }
	if (bootSub) { const s = document.createElement("div"); s.className = "mediascape-dsh-sub"; s.textContent = bootSub; ov.appendChild(s); }
	return ov;
}

// 2026-09-22 拆分：原 playTransformIntro（127 行）按职责拆为
//   finishBootIntro（结束过渡+auto 移交）/ bootRotateTo（单帧切换）/ bootStartRotate（轮换调度）
//   三个模块级辅助（共享 boot* 模块变量，行为等价；重构直接删旧代码）
/** 开屏结束过渡 + auto 视频移交壁纸层。st = { done, timer } 可变引用。 */
function finishBootIntro(ov, st) {
	if (st.done) return;
	// 2026-09-23 定稿「流式视频数据出来前不能跳过」：开屏可能是 auto 视频（file:"auto" 开屏=视频壁纸）
	// 时，在「auto 解析完成 + 视频首帧就绪」之前点击画面/自动结束都不生效——否则视频壁纸还没移交就提前
	// 结束，壁纸层因 pending 未解析而丢失视频壁纸（中断/从头播回归根因之一）。守卫覆盖两个阶段：
	//   ① pending 占位期（配置 fetch 未回，auto 与否未知）——一律等解析完；
	//   ② bootAutoVideo 已解析但媒体未就绪（readyState<1，首帧数据未出来）——等首帧。
	// 非 auto（图片开屏/无媒体）不受限，照常结束。
	const pendingPhase = window.__mediascapeDshBootVideoPending && !bootAutoVideo;
	if (pendingPhase || bootAutoVideo) {
		const m0 = ov.querySelector(".mediascape-dsh-gif");
		const mediaReady = m0 && (m0.tagName !== "VIDEO" || m0.readyState >= 1);
		if (!mediaReady) return; // auto 未解析完 或 视频首帧未就绪：保持开屏等数据
	}
	st.done = true;
	if (st.timer) clearTimeout(st.timer);
	// 结束（2026-09-22 定稿）：不做放大动画（已作废额外 0.38s/0.9s 放大），媒体维持大小不变，
	// 直接移交（auto 视频移给壁纸层继续消费同一份流）→ .gone 淡出 → 移除。
	// ⚠️ 顺序必须「先移交后 gone」：auto 场景若先 gone（浮层整体淡出、媒体随浮层消失），
	// 壁纸层再接管会拿到已隐藏元素 → 视觉闪断。先移交（媒体被壁纸层 renderLayers 接走挂到 bg 层，
	// 浮层剩余部分再淡出移除）→ 无缝。
	// auto 视频壁纸：开屏结束不减媒体 —— 元素移交壁纸层继续消费同一份流式数据
	//（同 URL 同元素，不重新发起 Range 请求）；壁纸层 renderLayers 检测到挂载点后接走。
	const media = ov.querySelector(".mediascape-dsh-gif");
	if (bootAutoVideo && media && media.tagName === "VIDEO") {
		// 移交对象带 id/url：壁纸层按 id 匹配接管（同一份流式数据同一元素，不重新发 Range 请求）
		window.__mediascapeDshBootVideo = { el: media, id: bootAutoVideo.id, url: bootAutoVideo.url };
		// 已移交 → 清 pending（壁纸层不再跳过自建，改为接管这份移交元素）
		window.__mediascapeDshBootVideoPending = null;
		if (typeof window.__mediascapeDshBootVideoReady === "function") window.__mediascapeDshBootVideoReady();
	}
	ov.classList.add("gone");
	setTimeout(() => ov.remove(), BOOT_FADE_OUT_MS);
}

/** 轮换切换单帧：同类型换 src；video⇄img 类型不匹配先重建元素
 *（video 元素加载 png 会失败定住 → 必须先重建，不能用同元素换 src）。 */
function bootRotateTo(ov, urls, index, st) {
	const url = urls[index];
	if (!url) { finishBootIntro(ov, st); return; }
	const wantVideo = /\.mp4$/i.test(url);
	const media = ov.querySelector(".mediascape-dsh-gif");
	if (!media || (wantVideo && media.tagName !== "VIDEO") || (!wantVideo && media.tagName !== "IMG")) {
		const el = document.createElement(wantVideo ? "video" : "img");
		el.className = "mediascape-dsh-gif";
		if (wantVideo) { el.muted = true; el.loop = true; el.autoplay = true; el.setAttribute("playsinline", ""); el.setAttribute("preload", "auto"); }
		el.src = url;
		el.classList.add("ready"); // 轮换画面直接显示（已是就绪媒体/同源流式续播，不再等首帧）
		if (media) media.replaceWith(el);
		else ov.insertBefore(el, ov.querySelector(".mediascape-dsh-title")); // 无标题 → null=append 末尾
		if (wantVideo) { const pr = el.play(); if (pr && pr.catch) pr.catch(() => { /* 自动播放被拒（浏览器策略）预期，忽略 */ }); }
		return;
	}
	if (media.tagName === "VIDEO") {
		media.src = url;
		media.load();
		const pr = media.play();
		if (pr && pr.catch) pr.catch(() => { /* 自动播放被拒（浏览器策略）预期，忽略 */ });
	} else {
		media.src = url;
	}
}

/** 轮换队列调度：单画面/空列表 → durationMs 兜底自动淡出；多画面 → 各段 duration 顺序轮换，播完淡出（loop:true 循环）。 */
function bootStartRotate(ov, urls, st) {
	if (!Array.isArray(urls) || !urls.length) { setTimeout(() => finishBootIntro(ov, st), bootDurationMs); return; }
	const total = urls.length;
	let idx = 0;
	// 每段展示时长：durations[index] 与 files 一一对应；缺省/越界/非法 → 回退单值 bootDurationMs
	const segMs = (i) => {
		if (bootDurations && Number.isFinite(bootDurations[i]) && bootDurations[i] > 0) return bootDurations[i];
		return bootDurationMs;
	};
	const step = () => {
		if (st.done) return;
		idx += 1;
		if (idx >= total) {
			if (bootLoop) { idx = 0; bootRotateTo(ov, urls, 0, st); st.timer = setTimeout(step, segMs(0)); }
			else finishBootIntro(ov, st);
			return;
		}
		bootRotateTo(ov, urls, idx, st);
		st.timer = setTimeout(step, segMs(idx));
	};
	st.timer = setTimeout(step, segMs(0));
}

function playTransformIntro() {
	if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	// 元素1：深色浮层同步立即插入（不等 boot.json fetch）——先盖住界面，无黑屏窗口
	const ov = buildBootOverlay();
	document.body.appendChild(ov);
	const st = { done: false, timer: null }; // 结束/轮换共享状态（辅助函数经此读写）
	// 2026-09-23 删 skip 按钮后：点浮层画面即跳过（e.target===ov 排除点媒体/按钮误触）
	ov.addEventListener("click", (e) => { if (e.target === ov) finishBootIntro(ov, st); });
	// 配置后台取回（并行 fetch boot.json + wallpaper/list，file:"auto" 时 list 复用）→ 补元素2 → 首帧就绪淡入
	loadBootGifConfig().then(() => {
		if (st.done) return;
		// 补标题/副标题（配置取回后被填充，默认空字符串不渲染）
		if (bootTitle && !ov.querySelector(".mediascape-dsh-title")) {
			const t = document.createElement("div");
			t.className = "mediascape-dsh-title";
			t.textContent = bootTitle;
			ov.appendChild(t);
		}
		if (bootSub && !ov.querySelector(".mediascape-dsh-sub")) {
			const s = document.createElement("div");
			s.className = "mediascape-dsh-sub";
			s.textContent = bootSub;
			ov.appendChild(s);
		}
		const urls = bootFiles || [];
		if (!urls.length) { bootStartRotate(ov, urls, st); return; } // 无素材：深色背景展示 durationMs 后淡出
		// 元素2：媒体占位（CSS opacity:0 默认；video 加 preload="auto" 尽早 Range 缓冲缩短首帧等待）
		const isVideo = /\.mp4$/i.test(urls[0]);
		const mediaEl = document.createElement(isVideo ? "video" : "img");
		mediaEl.className = "mediascape-dsh-gif";
		if (isVideo) {
			mediaEl.muted = true; mediaEl.loop = true; mediaEl.autoplay = true;
			mediaEl.setAttribute("playsinline", "");
			mediaEl.setAttribute("preload", "auto");
		}
		mediaEl.src = urls[0]; // 网络流式（auto=壁纸视频同一份流；服务端 HTTP 缓存覆盖重播）
		// 2026-09-23 媒体持久缓存已整体移除（需求「彻底移除缓存、只保留流式」——IndexedDB
		// 缓存代码的命中切 blob 曾引起 boot 移交视频中断/从头播放的回归）——开屏媒体一律网络流式。
		ov.insertBefore(mediaEl, ov.querySelector(".mediascape-dsh-title")); // 无标题 → null=append 末尾
		if (isVideo) { const pr = mediaEl.play(); if (pr && pr.catch) pr.catch(() => { /* 自动播放被拒（浏览器策略）预期，忽略 */ }); }
		// 首帧就绪 → 浮层 .media-ready（星尘/光圈 0.5s 淡出，视觉上「萤火聚成画面」）+ 媒体 .ready
		// → CSS transition 0.6s 渐变淡入（视频真实出现）；超时/失败 → 保持占位深色，展示后淡出
		waitBootMediaReady(mediaEl, BOOT_MEDIA_READY_MS).then((ok) => {
			if (st.done) return;
			if (ok) {
				ov.classList.add("media-ready");
				mediaEl.classList.add("ready");
			}
			bootStartRotate(ov, urls, st);
		});
	}).catch(() => { bootStartRotate(ov, bootFiles || [], st); });
}

// 等待媒体首帧就绪：video 至少 readyState≥2（canplay）；img loaded 或 complete。timeoutMs 内未就绪 → false。
function waitBootMediaReady(el, timeoutMs) {
	return new Promise((resolve) => {
		// 超时（ok=null）→ 最后复查真实就绪状态：实机慢环境（反代+主实例）视频首帧约 2s，
		// 可能 canplay/loadeddata 事件已错过或就绪晚于超时——视频其实已就绪时不能误判黑屏。
		const timer = setTimeout(() => cleanup(true, null), timeoutMs || BOOT_MEDIA_READY_MS);
		function isReadyNow() {
			if (el.tagName === "VIDEO") return el.readyState >= 2;
			return el.complete && el.naturalWidth > 0;
		}
		function cleanup(clear, ok) {
			clearTimeout(timer);
			if (el.tagName === "VIDEO") {
				el.removeEventListener("canplay", onOk);
				el.removeEventListener("loadeddata", onOk);
				el.removeEventListener("error", onErr);
			} else {
				el.removeEventListener("load", onOk);
				el.removeEventListener("error", onErr);
			}
			if (!clear) return;
			if (ok === null) ok = isReadyNow(); // 超时：视频已就绪则不误判
			resolve(ok);
		}
		function onOk() { cleanup(true, true); }
		function onErr() { cleanup(true, false); }
		if (isReadyNow()) { cleanup(true, true); return; }
		if (el.tagName === "VIDEO") {
			// canplay 之外补 loadeddata（首帧数据）——任一触发即认为可显示，防事件漏捕竞态
			el.addEventListener("canplay", onOk);
			el.addEventListener("loadeddata", onOk);
			el.addEventListener("error", onErr);
		} else {
			el.addEventListener("load", onOk);
			el.addEventListener("error", onErr);
		}
	});
}

// ── 旧实现参考（2026-09-22 重新设计后不再调用，注释保留备选）────────────────
// 曾为「媒体首帧就绪后：一次插入带内容的开屏浮层，并启动多画面轮换/定时淡出/auto 移交」。
// 缺陷：浮层在首帧就绪前不存在 → DSH 界面先露出；被 playTransformIntro（浮层立即插入 + 媒体
// opacity 渐变淡入）取代。若需回退此方案，取消下面 /* */ 注释即可。
/*
function showBootOverlay(mediaEl, urls) {
	let done = false; // 本函数自有的淡出标记（模块级函数不共享 playTransformIntro 的 done 局部变量）
	const ov = document.createElement("div");
	ov.className = "mediascape-dsh-boot";
	const titleHtml = bootTitle ? '<div class="mediascape-dsh-title">' + bootTitle + '</div>' : "";
	const subHtml = bootSub ? '<div class="mediascape-dsh-sub">' + bootSub + '</div>' : "";
	ov.innerHTML = titleHtml + subHtml + '<button class="mediascape-dsh-skip" type="button">点击跳过</button>';
	ov.insertBefore(mediaEl, ov.querySelector(".mediascape-dsh-title") || ov.querySelector(".mediascape-dsh-skip"));
	document.body.appendChild(ov);
	if (mediaEl.tagName === "VIDEO") { const p = mediaEl.play(); if (p && p.catch) p.catch(() => {}); }
	let rotateTimer = null;
	const timers = [];
	const finish = () => {
		if (done) return;
		done = true;
		if (rotateTimer) clearTimeout(rotateTimer);
		timers.forEach(clearTimeout);
		// auto 视频壁纸：开屏结束不移除 video —— 元素移交壁纸层继续消费同一份流式数据
		//（同 URL 同元素，不重新发起 Range 请求）；壁纸层 renderLayers 检测到挂载点后接走。
		const media = ov.querySelector(".mediascape-dsh-gif");
		if (bootAutoVideo && media && media.tagName === "VIDEO") {
			// 移交对象带 id/url：壁纸层按 id 匹配接管（同一份流式数据同一元素，不重新发 Range 请求）
			window.__mediascapeDshBootVideo = { el: media, id: bootAutoVideo.id, url: bootAutoVideo.url };
			// 已移交 → 清 pending（壁纸层不再跳过自建，改为接管这份移交元素）
			window.__mediascapeDshBootVideoPending = null;
			if (typeof window.__mediascapeDshBootVideoReady === "function") window.__mediascapeDshBootVideoReady();
		}
		ov.classList.add("gone");
		setTimeout(() => ov.remove(), BOOT_FADE_OUT_MS);
	};
	ov.querySelector(".mediascape-dsh-skip").addEventListener("click", finish);
	ov.addEventListener("click", (e) => { if (e.target === ov) finish(); });
	// 换源（按扩展名重建元素类型：video⇄img 互切——video 元素加载 png 会失败定住，必须先重建；
	// 同类型复用：video load()+play() 保持流式，img 换 src）——多画面顺序轮换
	function rotateTo(index, urls2) {
		const url = urls2[index];
		if (!url) { finish(); return; }
		const wantVideo = /\.mp4$/i.test(url);
		const media = ov.querySelector(".mediascape-dsh-gif");
		if (!media || (wantVideo && media.tagName !== "VIDEO") || (!wantVideo && media.tagName !== "IMG")) {
			// 类型不匹配/无媒体 → 重建元素（video 元素加载 png 解码失败 → 画面定住无图）
			const el = document.createElement(wantVideo ? "video" : "img");
			el.className = "mediascape-dsh-gif";
			if (wantVideo) { el.muted = true; el.loop = true; el.autoplay = true; el.setAttribute("playsinline", ""); }
			el.src = url;
			if (media) media.replaceWith(el);
			else ov.insertBefore(el, ov.querySelector(".mediascape-dsh-title") || ov.querySelector(".mediascape-dsh-skip"));
			if (wantVideo) { const p = el.play(); if (p && p.catch) p.catch(() => {}); }
			return;
		}
		if (media.tagName === "VIDEO") {
			media.src = url;
			media.load();
			const p = media.play();
			if (p && p.catch) p.catch(() => {});
		} else {
			media.src = url;
		}
	}
	// 启动轮换队列（或单画面时仅用 durationMs 兜底自动淡出，向后兼容旧行为）
	// 每段时间取 durations[index]（与 files 一一对应）；缺省/越界/非法 → 回退单值 bootDurationMs
	function segMs(index) {
		if (bootDurations && Number.isFinite(bootDurations[index]) && bootDurations[index] > 0) return bootDurations[index];
		return bootDurationMs;
	}
	function startRotate(urls2) {
		if (!Array.isArray(urls2) || !urls2.length) { timers.push(setTimeout(finish, bootDurationMs)); return; }
		const total = urls2.length;
		let idx = 0;
		const step = () => {
			if (done) return;
			idx += 1;
			if (idx >= total) {
				if (bootLoop) { idx = 0; rotateTo(0, urls2); rotateTimer = setTimeout(step, segMs(0)); }
				else finish();
				return;
			}
			rotateTo(idx, urls2);
			rotateTimer = setTimeout(step, segMs(idx));
		};
		// 首画面已就绪显示（媒体元素在插入浮层前已等首帧）：从第 1 帧开始计时轮换（多画面时长 = 各段 durations 之和）
		rotateTimer = setTimeout(step, segMs(0));
	}
	startRotate(urls);
}
*/