		// 2026-09-23 魔数命名化（审计 magic-number-smart）：文件级语义常量集中定义
		const FETCH_TIMEOUT_MS = 15000;          // fetch 默认超时（15s）
		// 反代媒体直连：DSH 反代对「无 token 且无会话 cookie」的 GET 一律 302 带 token 重定向，
		// HTMLMediaElement 跟随 302 会丢失 Range 语义 → 视频退化为全量下载而卡。
		// 媒体 URL 拼上 token 即被反代直接放行（Range 保留 206 流式）。
		// token 来源（按优先级）：①会话级缓存 ②当前页面 URL 的 ?token= ③插件服务端 API
		// /theme-mediascape-assets/media-token（服务端从 DSH 输出捕获，覆盖主界面 iframe 内
		// location.search 读不到 token 的场景）。都取不到则原样返回（无 token，与既有行为一致）。
		const LS_MEDIA_TOKEN = "mediascape-dsh-media-token"; // 会话级缓存键（sessionStorage，关页即清）// dsh-skip-sensitive（鉴权参数缓存键名，非泄露）
		let mediaTokenCache = null;                          // 内存缓存，优先于 sessionStorage 读取
		function readCachedMediaToken() {
			if (mediaTokenCache) return mediaTokenCache;
			try { mediaTokenCache = sessionStorage.getItem(LS_MEDIA_TOKEN) || null; } catch (e) { mediaTokenCache = null; }
			return mediaTokenCache;
		}
		function saveMediaToken(t) {
			mediaTokenCache = t;
			try { sessionStorage.setItem(LS_MEDIA_TOKEN, t); } catch (e) { /* sessionStorage 不可用时仅内存缓存 */ }
		}
		// 同步取 token（2026-10-09 加）：只读「内存 → sessionStorage → 当前页面 URL 的 ?token=」，
		//   这三者都是同步可得 ⇒ 供媒体赋值点在**赋值那一刻**就能拼上 token（不产生无 token 的 302 请求）。
		//   注意 DSH 主界面 iframe 内 location.search 常常读不到 token ⇒ 那种情况只能等异步 API（见 probeMediaToken）。
		function syncMediaToken() {
			const cached = readCachedMediaToken();
			if (cached) return cached;
			try {
				const inPage = new URLSearchParams(window.location.search).get("token"); // dsh-skip-sensitive（反代鉴权参数读取，非泄露）
				if (inPage) { saveMediaToken(inPage); return inPage; }
			} catch (e) { /* 无 location/异常：留给异步 API */ }
			return null;
		}
		// 获取反代 token：同步能拿到就直接用；否则问插件服务端（服务端在 DSH 进程内捕获输出流里的 token）。
		// 全程静默：任何失败都退回「无 token」，媒体照常加载。
		async function probeMediaToken() {
			const sync = syncMediaToken();
			if (sync) return sync;
			try {
				const resp = await fetch("/theme-mediascape-assets/media-token", { cache: "no-store" });
				const data = await resp.json();
				if (data && data.token) { saveMediaToken(data.token); return data.token; }
			} catch (e) { /* 取不到 token：媒体按无 token 加载，与既有行为一致 */ }
			return null;
		}
		// token 就绪后修正已挂载媒体的 src：把「无 token」的媒体换成带 token 版本（仅在确实变化时重设，
		// 避免无谓重新加载）。用于 token 晚于开屏/壁纸元素创建的场景。
		function refreshMediaTokens() {
			if (!readCachedMediaToken()) return;
			const sel = ".mediascape-dsh-boot video, .mediascape-dsh-boot img, .mediascape-dsh-bg video, .mediascape-dsh-bg img";
			document.querySelectorAll(sel).forEach((el) => {
				const cur = el.getAttribute("src") || "";
				if (!cur || cur.indexOf("token=") !== -1) return; // 无 src / 已带 token → 跳过
				// 2026-10-09 回退说明：曾试过「只重设尚未开始加载的元素（networkState===0）」以避免打断已缓冲的流，
				//   但实测用户报告"启动画面那个视频移交成壁纸后不连贯"——移交是**同一元素继续消费同一份流**（boot.js），
				//   若让无 token 的那条流继续播，302 退化（丢 Range）会一路带到壁纸层 ⇒ 反而更糟。
				//   故此处**保留重设**：token 一到就把媒体换成带 token 版本（短暂重载，换回 Range 直通），
				//   并在源头（boot 创建视频元素前 / 壁纸列表前）先把 token 拿到，尽量不触发这次重设。
				el.setAttribute("src", withMediaToken(cur));      // 带 token 重新请求（Range 直通）
			});
		}
		function withMediaToken(url) {
			if (!url || url.indexOf("?") !== -1) return url;
			try {
				const t = syncMediaToken(); // 2026-10-09：改用同步取值（内存/sessionStorage/URL），避免"赋值时还没 token ⇒ 先发 302 请求"
				if (t) return url + "?token=" + encodeURIComponent(t); // dsh-skip-sensitive（DSH 反代鉴权要求，非泄露）
			} catch (e) { /* 无 location/异常：原样返回 */ }
			return url;
		}

		const BYTES_PER_KB = 1024;
		const BYTES_PER_MB = 1048576;
		const SPEED_EMA_HISTORY = 0.55;             // 速度 EMA：历史占比
		const SPEED_EMA_INSTANT = 0.45;             // 速度 EMA：瞬时占比
		const UPLOAD_FAIL_KEEP_MS = 1500;           // 上传失败行标红保留时长
		const SKIP_KEEP_MS = 2500;                  // 「已跳过」提示行保留时长（2026-09-2x 加）
		const PICKER_GUARD_TIMEOUT_MS = 90000;    // 文件选择器降载守卫的兜底恢复超时（与缓存无关，别再用 IDB 之名）

		// 2026-09-23 加：带超时的 fetch（健壮性——外部请求无超时会永久挂起）。
		// 默认 15s；传 timeoutMs:0 表示不限；保留原有 signal（可与超时组合）。
		async function apiFetch(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
			if (!timeoutMs) return fetch(url, opts);
			// 2026-09-23 修：opts.signal 存在时原代码把两个 signal 组数组传给 fetch（fetch 不认数组，
			// TypeError → 调用方静默降级，后台缓存等依赖 signal 的链路全挂）。改为 AbortSignal.any
			// 组合（浏览器支持）；不支持时仅用超时（原 signal 语义受限但不崩，超时兜底仍在）。
			let signal;
			if (opts.signal) {
				signal = typeof AbortSignal.any === 'function'
					? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)])
					: AbortSignal.timeout(timeoutMs);
			} else {
				signal = AbortSignal.timeout(timeoutMs);
			}
			return fetch(url, { ...opts, signal });
		}

		// 2026-09-23 拆（审计）：上传 HUD 行管理的顶层工具/工厂（startUploadHud 只做组装）。
		function fmtBytes(n) { return n >= BYTES_PER_MB ? (n / BYTES_PER_MB).toFixed(1) + " MB" : (n / BYTES_PER_KB).toFixed(0) + " KB"; }
		function fmtSpeed(bps) { return bps >= BYTES_PER_MB ? (bps / BYTES_PER_MB).toFixed(1) + " MB/s" : (bps / BYTES_PER_KB).toFixed(0) + " KB/s"; }
		// 行 DOM 创建（不依赖 rows/refresh——由 createRowOps 持有并挂载）
		function createRowOps(rows, refresh) {
			return {
				rowFor(key) {
					let r = rows.get(key);
					if (r) return r;
					const built = buildUploadRowEl();
					const row = { ...built, lastLoaded: 0, lastTs: Date.now(), speedEma: null, doneTimer: null, onPause: null, onCancel: null };
					rows.set(key, row);
					refresh();
					return row;
				},
				rowSetLoaded(r, key, loaded) {
					if (!rows.has(key) || r.paused) return;
					const now = Date.now();
					// 2026-09-23 修速度失真：瞬时差分 + dt clamp 到 1ms → progress 事件间隔不均
					// （25ms~708ms）时读数乱跳/严重低估（实测真实 92MB/s 显示 21MB/s）。
					// 改为 EMA 平滑（0.55 历史 + 0.45 瞬时），dt 用真实间隔（不 clamp 到 1）。
					const dt = Math.max(now - r.lastTs, 1);
					const inst = (loaded - r.lastLoaded) * 1000 / dt; // B/s 瞬时
					r.speedEma = r.speedEma === null ? inst : r.speedEma * SPEED_EMA_HISTORY + inst * SPEED_EMA_INSTANT;
					r.lastLoaded = loaded;
					r.lastTs = now;
					const pct = r.total > 0 ? Math.min(100, (loaded / r.total) * 100) : 0;
					r.bar.style.width = pct.toFixed(1) + "%";
					r.meta.textContent = `${fmtBytes(loaded)} / ${fmtBytes(r.total)} · ${fmtSpeed(r.speedEma)}`;
				},
				rowSetPaused(r, key, paused) {
					if (!rows.has(key)) return;
					r.paused = paused;
					r.pauseBtn.textContent = paused ? "▶" : "⏸";
					r.pauseBtn.title = paused ? "继续" : "暂停";
					r.el.classList.toggle("mediascape-dsh-upload-paused", paused);
				},
				rowDone(r, key, ok) {
					if (!rows.has(key)) return;
					r.el.classList.toggle("mediascape-dsh-upload-fail", !ok);
					if (ok) {
						rows.delete(key);
						r.el.remove();
						refresh();
						return;
					}
					// 失败：标红短暂保留（1.5s）让用户看清，再移除
					r.el.querySelector(".mediascape-dsh-upload-name").textContent = "✗ " + r.name;
					if (r.doneTimer) clearTimeout(r.doneTimer);
					r.doneTimer = setTimeout(() => { rows.delete(key); r.el.remove(); refresh(); }, UPLOAD_FAIL_KEEP_MS);
				},
			};
		}

		// 2026-09-2x 删 SHA-1 工具（sha1Hex + 常量）：上传去重已定为「文件名+大小」比较，
		// 前端不再计算任何内容指纹（浏览器端纯 JS SHA-1 为废弃设计，无调用方）。

		// ── 媒体缓存门面（localForage 单后端）──
		// 2026-10-09 定稿：**只保留 localForage 一条后端**。原先并存的自写 IndexedDB 门面
		//   （idbOpen/idbGetAll/idbPut/idbDelete + wallpapers/music/covers 三张表）整体删除——
		//   实测写入调用点为 0（`lfaPut(`/`idbPut(` 无任何调用），读取返回空也**不触发**兜底
		//   （`.catch` 只在报错时生效）⇒ 是 2026-09-23 移除媒体持久缓存时留下的死代码。
		//   localForage 不可用时**整体静默降级为「不缓存」** ✓，不再回落到另一套存储
		//   （两套后端并存最容易出现"一侧写、另一侧读"的分家 ✗）。
		// 命名空间：key = "<store>:<id>"（store 例：coverart —— 见 music-extract 的封面缓存）。
		// 容量：累计字节预算（默认 8MiB）+ 逐条 lastUsed ⇒ 超限按最久未用逐出（LRU）。
		//   ⚠️ 只缓存**小图**：音频与壁纸视频一律不进前端缓存——2026-09-23 的「命中切 blob /
		//   缓存写入中止产生竞态」事故就出在把大媒体塞进前端缓存；壁纸走 HTTP Range + ETag 已足够 ✓。
		const CACHE_PREFIX = "mc:";                        // localForage 内部键前缀（DB/store 已隔离，仍留前缀便于排查）
		const CACHE_META_KEY = CACHE_PREFIX + "__meta";    // { total, items: { "<store>:<id>": [bytes, lastUsed] } }
		const CACHE_MAX_BYTES = 8 * 1024 * 1024;           // 8MiB 预算（只装小图，足够几百张封面）
		function lfaAvailable() {
			try {
				const lf = typeof globalThis.localforage === "object" ? globalThis.localforage : null;
				// 隔离到独立 DB/store：避免与其它同样用 localForage 默认库的页面互踩。
				// localforage.config 对**默认实例**生效，且必须在首次读写前调用 ⇒ 这里懒执行一次。
				if (lf && typeof lf.config === "function" && !lf.__mediascapeConfigured) {
					lf.config({ name: "dsh-theme-mediascape", storeName: "media" });
					lf.__mediascapeConfigured = true;
				}
				return lf;
			} catch (e) { return null; }
		}
		function cacheKey(store, id) { return CACHE_PREFIX + store + ":" + id; }
		/** 读元数据（容量/逐出用）；任何失败都当作空 ⇒ 退化为不缓存，不影响功能。 */
		function readCacheMeta() {
			const lf = lfaAvailable();
			if (!lf) return Promise.resolve({ total: 0, items: {} });
			return lf.getItem(CACHE_META_KEY)
				.then((m) => (m && typeof m === "object" && m.items ? m : { total: 0, items: {} }))
				.catch(() => ({ total: 0, items: {} }));
		}
		function writeCacheMeta(meta) {
			const lf = lfaAvailable();
			if (!lf) return Promise.resolve();
			return lf.setItem(CACHE_META_KEY, meta).catch(() => { /* 元数据写失败：只影响逐出精度 */ });
		}
		/** 单条读（缓存的主用接口：按 store+id 精确取，避免全量读把大对象一次性拉进内存）。 */
		function lfaGet(store, id) {
			const lf = lfaAvailable();
			if (!lf) return Promise.resolve(null);
			return lf.getItem(cacheKey(store, id)).catch(() => null);
		}
		/** 命中时刷新 lastUsed（LRU 排序用）。 */
		function lfaTouch(store, id) {
			return readCacheMeta().then((meta) => {
				const k = store + ":" + id;
				if (!meta.items[k]) return;
				meta.items[k][1] = Date.now();
				return writeCacheMeta(meta);
			}).catch(() => {});
		}
		/** 读全部（仅供"启动时把某 store 全部装入内存"这类场景；键数大时改用 lfaGet 按需读 ✓）。 */
		function lfaGetAll(store) {
			const lf = lfaAvailable();
			if (!lf) return Promise.resolve([]);
			const prefix = cacheKey(store, "");
			return lf.keys().then((keys) => Promise.all(
				keys.filter((k) => String(k).indexOf(prefix) === 0)
					.map((k) => lf.getItem(k).then((v) => (v ? Object.assign({}, v) : null)))
			)).then((rows) => rows.filter(Boolean)).catch(() => []);
		}
		/** 写一条（超预算即按 lastUsed 最旧逐出；逐出失败只影响容量，不影响功能）。 */
		function lfaPut(store, record) {
			if (!record || !record.id) return Promise.resolve();
			const lf = lfaAvailable();
			if (!lf) return Promise.resolve();
			const k = store + ":" + record.id;
			const bytes = Number(record.cover && record.cover.size) || Number(record.bytes) || 0;
			return readCacheMeta().then((meta) => {
				const prev = meta.items[k] ? Number(meta.items[k][0]) || 0 : 0;
				meta.total = Math.max(0, Number(meta.total) || 0) - prev + bytes;
				meta.items[k] = [bytes, Date.now()];
				// 逐出：按 lastUsed 升序删到预算内（保留刚写入这条）
				const evicted = [];
				if (meta.total > CACHE_MAX_BYTES) {
					const order = Object.keys(meta.items).filter((x) => x !== k).sort((a, b) => meta.items[a][1] - meta.items[b][1]);
					for (const victim of order) {
						if (meta.total <= CACHE_MAX_BYTES) break;
						meta.total -= Number(meta.items[victim][0]) || 0;
						delete meta.items[victim];
						evicted.push(victim);
					}
				}
				return Promise.all(evicted.map((v) => lf.removeItem(CACHE_PREFIX + v).catch(() => {})))
					.then(() => lf.setItem(cacheKey(store, record.id), record).catch(() => {}))
					.then(() => writeCacheMeta(meta));
			}).catch(() => { /* 任何失败：放弃这条缓存（缓存是增强非必需）*/ });
		}
		/** 删一条（含元数据）。 */
		function lfaRemove(store, id) {
			const lf = lfaAvailable();
			if (!lf) return Promise.resolve();
			const k = store + ":" + id;
			return readCacheMeta().then((meta) => {
				if (meta.items[k]) {
					meta.total = Math.max(0, (Number(meta.total) || 0) - (Number(meta.items[k][0]) || 0));
					delete meta.items[k];
				}
				return writeCacheMeta(meta);
			}).then(() => lf.removeItem(cacheKey(store, id)).catch(() => {})).catch(() => {});
		}

		// ── 文件选择器降载守卫（壁纸/音乐/封面三处共用，模块级供所有 start* 访问）──
		// 安卓已知崩溃：打开系统文件选择器（SAF）时浏览器生成页面快照，大面积
		// backdrop-filter（毛玻璃）的 blur 合成瞬间内存/GPU 峰值，低内存设备渲染
		// 进程被系统杀 → 页面闪退（壁纸/音乐/封面三处选择器都触发；平板不崩）。
		// 打开前给 html 挂 .mediascape-dsh-picker-open（identity.js 禁用全局 backdrop-filter），
		// 取消/选完/超时后移除恢复。返回 restore 供调用方在合适时机调用。
		// ⚠️ 2026-09-22 毛玻璃已全部移除（identity.js 的 backdrop-filter 行注释保留）——本守卫失去
		//    禁用对象但仍保留：①upload.js / music-player.js 多处调用，删除会引用崩溃；
		//    ②若恢复毛玻璃需同步取消 identity.js 的 picker-open 规则注释，守卫即重新生效。
		//    （挂 .mediascape-dsh-picker-open 类本身无害，无样式响应。）
		// ⚠️ 作用域坑（2026-09-21 实测）：曾定义在 startWallpaper 函数体内，startMusic
		//    内部调用 PickerGuard() 抛 ReferenceError → 音乐「＋添加/封面」点击无反应
		//    （事件监听器异常静默失败，不弹文件选择器）。必须在模块级定义。
		function PickerGuard() {
			const html = document.documentElement;
			html.classList.add("mediascape-dsh-picker-open");
			let restored = false;
			const restore = () => {
				if (restored) return;
				restored = true;
				html.classList.remove("mediascape-dsh-picker-open");
			};
			// 兜底：选择器异常/长时间挂起，90s 后恢复毛玻璃（不死锁视觉效果）
			setTimeout(restore, PICKER_GUARD_TIMEOUT_MS);
			return restore;
		}
