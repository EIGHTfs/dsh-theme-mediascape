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
		// 获取反代 token：页面 URL 有则直接用；否则问插件服务端（服务端在 DSH 进程内捕获输出流里的 token）。
		// 全程静默：任何失败都退回「无 token」，媒体照常加载。
		async function probeMediaToken() {
			const cached = readCachedMediaToken();
			if (cached) return cached;
			try {
				const inPage = new URLSearchParams(window.location.search).get("token"); // dsh-skip-sensitive（反代鉴权参数读取，非泄露）
				if (inPage) { saveMediaToken(inPage); return inPage; }
			} catch (e) { /* 无 location/异常：继续走服务端 API */ }
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
				el.setAttribute("src", withMediaToken(cur));      // 带 token 重新请求（Range 直通）
			});
		}
		function withMediaToken(url) {
			if (!url || url.indexOf("?") !== -1) return url;
			try {
				const t = readCachedMediaToken() || new URLSearchParams(window.location.search).get("token"); // dsh-skip-sensitive（反代鉴权参数读取，非泄露）
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
		const IDB_WRITE_TIMEOUT_MS = 90000;         // IndexedDB 写入恢复重试间隔

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

		// ── 共享 IndexedDB（壁纸 / 音乐 / 封面 三张表，v2 起）──
		const DB_NAME = "dsh-theme-mediascape";
		const DB_VERSION = 2;
		function idbOpen() {
			return new Promise((resolve, reject) => {
				if (typeof indexedDB === "undefined") return reject(new Error("no idb"));
				const req = indexedDB.open(DB_NAME, DB_VERSION);
				req.onupgradeneeded = () => {
					const db = req.result;
					["wallpapers", "music", "covers"].forEach((s) => {
						if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
					});
				};
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			});
		}
		function idbGetAll(store) {
			return idbOpen().then((db) => new Promise((resolve) => {
				const req = db.transaction(store, "readonly").objectStore(store).getAll();
				req.onsuccess = () => { db.close(); resolve(req.result || []); };
				req.onerror = () => { db.close(); resolve([]); };
			})).catch(() => []);
		}
		function idbPut(store, record) {
			return idbOpen().then((db) => new Promise((resolve) => {
				const tx = db.transaction(store, "readwrite");
				tx.objectStore(store).put(record);
				tx.oncomplete = () => { db.close(); resolve(); };
				tx.onerror = () => { db.close(); resolve(); };
			})).catch(() => { /* IDB 操作失败可忽略（缓存是增强非必需） */ });
		}
		function idbDelete(store, key) {
			return idbOpen().then((db) => new Promise((resolve) => {
				const tx = db.transaction(store, "readwrite");
				tx.objectStore(store).delete(key);
				tx.oncomplete = () => { db.close(); resolve(); };
				tx.onerror = () => { db.close(); resolve(); };
			})).catch(() => { /* IDB 操作失败可忽略（缓存是增强非必需） */ });
		}

		// ── localForage 媒体缓存门面（2026-10-05：localforage 优先 + 自写 idb 兜底）──
		// 背景：localForage 自动选 IndexedDB/WebSQL/localStorage，容量大、支持 Blob（媒体缓存用）；
		// 运行时库 localforage-bundle.js 由 build 注入挂 globalThis.localforage；加载/调用失败静默降级 idb。
		// 命名空间：key = "<store>:<id>"（store = wallpapers/music/covers，与 idb store 同名，便于对照）。
		function lfaAvailable() {
			try { return typeof globalThis.localforage === "object" && globalThis.localforage; } catch (e) { return null; }
		}
		// 读全部（localforage 遍历 store 前缀 keys；降级 idbGetAll）
		function lfaGetAll(store) {
			const lf = lfaAvailable();
			if (!lf) return idbGetAll(store);
			const prefix = store + ":";
			return lf.keys().then((keys) => Promise.all(
				keys.filter((k) => String(k).indexOf(prefix) === 0)
					.map((k) => lf.getItem(k).then((v) => (v ? Object.assign({}, v) : null)))
			)).then((rows) => rows.filter(Boolean)).catch(() => idbGetAll(store));
		}
		// 写一条（key = store:id；降级 idbPut）
		function lfaPut(store, record) {
			if (!record || !record.id) return Promise.resolve();
			const lf = lfaAvailable();
			if (!lf) return idbPut(store, record);
			return lf.setItem(store + ":" + record.id, record).catch(() => idbPut(store, record));
		}
		// 删一条（降级 idbDelete）
		function lfaRemove(store, id) {
			const lf = lfaAvailable();
			if (!lf) return idbDelete(store, id);
			return lf.removeItem(store + ":" + id).catch(() => idbDelete(store, id));
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
			setTimeout(restore, IDB_WRITE_TIMEOUT_MS);
			return restore;
		}
