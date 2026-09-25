		// 2026-09-23 魔数命名化（审计 magic-number-smart）：文件级语义常量集中定义
		const FF_FETCH_TIMEOUT_MS = 15000;          // fetch 默认超时（15s）
		// 2026-09-2x 反代媒体直连：DSH 反代（30800）对无 token 请求 302 + token 重定向——HTMLMediaElement // dsh-skip-sensitive（反代鉴权机制说明）
		// 跟随 302 时可能丢 Range 头 → 视频退化为全量下载而卡（实机开屏 auto 实测）。媒体 URL 直接拼
		// 页面 URL 的 ?token= 绕开 302（带 token 反代放行、Range 保留 206 流式）；无 token（预览/本地 // dsh-skip-sensitive（反代鉴权机制说明）
		// 直连）原样返回。媒体 src（开屏/壁纸视频/音乐）统一经此函数。
		function withMediaToken(url) {
			if (!url || url.indexOf("?") !== -1) return url;
			try {
				const t = new URLSearchParams(window.location.search).get("token"); // dsh-skip-sensitive（反代鉴权参数读取，非泄露）
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
		async function ffFetch(url, opts = {}, timeoutMs = FF_FETCH_TIMEOUT_MS) {
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
		const FF_DB_NAME = "dsh-theme-mediascape";
		const FF_DB_VERSION = 2;
		function ffIdbOpen() {
			return new Promise((resolve, reject) => {
				if (typeof indexedDB === "undefined") return reject(new Error("no idb"));
				const req = indexedDB.open(FF_DB_NAME, FF_DB_VERSION);
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
		function ffIdbGetAll(store) {
			return ffIdbOpen().then((db) => new Promise((resolve) => {
				const req = db.transaction(store, "readonly").objectStore(store).getAll();
				req.onsuccess = () => { db.close(); resolve(req.result || []); };
				req.onerror = () => { db.close(); resolve([]); };
			})).catch(() => []);
		}
		function ffIdbPut(store, record) {
			return ffIdbOpen().then((db) => new Promise((resolve) => {
				const tx = db.transaction(store, "readwrite");
				tx.objectStore(store).put(record);
				tx.oncomplete = () => { db.close(); resolve(); };
				tx.onerror = () => { db.close(); resolve(); };
			})).catch(() => { /* IDB 操作失败可忽略（缓存是增强非必需） */ });
		}
		function ffIdbDelete(store, key) {
			return ffIdbOpen().then((db) => new Promise((resolve) => {
				const tx = db.transaction(store, "readwrite");
				tx.objectStore(store).delete(key);
				tx.oncomplete = () => { db.close(); resolve(); };
				tx.onerror = () => { db.close(); resolve(); };
			})).catch(() => { /* IDB 操作失败可忽略（缓存是增强非必需） */ });
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
