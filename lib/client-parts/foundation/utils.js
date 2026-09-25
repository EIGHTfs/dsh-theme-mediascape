		// 2026-09-23 魔数命名化（审计 magic-number-smart）：文件级语义常量集中定义
		const FF_FETCH_TIMEOUT_MS = 15000;          // fetch 默认超时（15s）
		// 2026-09-2x 反代媒体直连：DSH 反代（30800）对无 token 请求 302 + token 重定向——HTMLMediaElement
		// 跟随 302 时可能丢 Range 头 → 视频退化为全量下载而卡（实机开屏 auto 实测）。媒体 URL 直接拼
		// 页面 URL 的 ?token= 绕开 302（带 token 反代放行、Range 保留 206 流式）；无 token（预览/本地
		// 直连）原样返回。媒体 src（开屏/壁纸视频/音乐）统一经此函数。
		function withMediaToken(url) {
			if (!url || url.indexOf("?") !== -1) return url;
			try {
				const t = new URLSearchParams(window.location.search).get("token");
				if (t) return url + "?token=" + encodeURIComponent(t);
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
		function buildUploadRowEl() {
			const el = document.createElement("div");
			el.className = "mediascape-dsh-upload-row";
			const nameEl = document.createElement("span");
			nameEl.className = "mediascape-dsh-upload-name";
			const barWrap = document.createElement("span");
			barWrap.className = "mediascape-dsh-upload-bar-wrap";
			const bar = document.createElement("span");
			bar.className = "mediascape-dsh-upload-bar";
			barWrap.appendChild(bar);
			const meta = document.createElement("span");
			meta.className = "mediascape-dsh-upload-meta";
			// 2026-09-23 保留暂停：行尾按钮 = 「⏸ 暂停」「✕ 取消」；暂停 abort 当前请求，
			// 服务端保留已收部分为 .part（暂停快照）；继续 = 重新新请求从头传（无断点续传）。
			const ctl = document.createElement("span");
			ctl.className = "mediascape-dsh-upload-ctl";
			const pauseBtn = document.createElement("button");
			pauseBtn.type = "button";
			pauseBtn.className = "mediascape-dsh-upload-btn";
			pauseBtn.textContent = "⏸";
			pauseBtn.title = "暂停";
			const cancelBtn = document.createElement("button");
			cancelBtn.type = "button";
			cancelBtn.className = "mediascape-dsh-upload-btn";
			cancelBtn.textContent = "✕";
			cancelBtn.title = "取消";
			ctl.append(pauseBtn, cancelBtn);
			el.append(nameEl, barWrap, meta, ctl);
			return { el, bar, meta, pauseBtn, cancelBtn };
		}
		// 上传行状态机：共享 rows/refresh 闭包，提供 rowFor/setLoaded/done
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

		// ── 上传进度 HUD（2026-09-22：壁纸/音乐/封面三处共用，模块级单例挂 window）──
		// 上传进行时右下角悬浮窗：每任务一行 = 文件名 + 进度条 + 叠加「当前大小/总大小/速度」，
		// 多任务动态多行且各列对齐（grid 固定列宽）；任务完成自动移除该行，无任务时 HUD 整体隐藏。
		// 2026-09-23 保留暂停（去断点续传）：每行右侧「⏸ 暂停」「✕ 取消」。暂停 → abort 当前请求
		// （服务端保留已收部分为 .part）；继续 → 重新新请求从头传（不做 slice 续传）。
		// 调用方（upload.js / music-player.js）经 window.__mediascapeDshUploadHud 获取单例：
		//   hud.begin(key, name, size, { onPause, onCancel })
		//     → 添加一行，返回 { setLoaded(bytes), done(ok), setPaused(bool) }
		//   setLoaded：XHR upload.onprogress 回调里更新进度条/大小/速度
		//   setPaused(true)：行进入暂停态（进度冻结、按钮变「继续」）；setPaused(false) 恢复
		//   done(ok)：上传结束（成功 ok=true 移除行；失败 ok=false 标红后短暂保留再移除）
		// 速度用滑动窗口（上次快照 → 本次 loaded 差 / 时间差），实时 MB/s。
		// 2026-09-23 改：上传进度 = dock 二级面板（对齐「景/声/字」模式，startUploadHud(dock) 同
		// startFont(dock) 由启动段调用）——dock 加「传」按钮，点击打开统一上传选择器（视频/图片/音乐）；
		// 上传进行时面板自动弹出显示进度（dock.__mediascapeDshCenter 定位靠 dock，无需拖动）。
		function startUploadHud(dock) {
			const dockEl = dock;
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "mediascape-dsh-upload-toggle mediascape-dsh-dock-btn";
			btn.textContent = "传";
			btn.title = "上传";
			dockEl.appendChild(btn);
			const panel = document.createElement("div");
			panel.className = "mediascape-dsh-upload-panel";
			panel.innerHTML = '<div class="mediascape-dsh-bg-title">上传</div>';
			if (dockEl) dockEl.appendChild(panel);
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				// 2026-09-23 改：点「传」直接打开统一上传选择器（视频/图片/音乐），不再 toggle 面板；
				// 面板仅在上传进行时自动弹出显示进度（begin 时 open + center）。
				const openPicker = window.__mediascapeDshOpenUploadPicker;
				if (typeof openPicker === "function") openPicker();
			});
			// 点外自动收起（对齐景面板 onBgDocClick 模式；排除自身按钮）。
			// 2026-09-23 修：上传中有活动行（rows.size>0）时禁止点外收起——否则点击面板外/滚动
			// 面板被关、上传仍继续（setLoaded 不触发 refresh 重开）→ 进度面板莫名消失。
			const rows = new Map(); // key(traceId) → { el, bar, meta, cancelBtn, ... }
			const onDocClick = (e) => {
				if (panel.contains(e.target)) return;
				if (e.target === btn) return;
				if (rows.size > 0) return; // 上传中保持面板显示
				panel.classList.remove("open");
			};
			document.addEventListener("click", onDocClick);
			const root = document.createElement("div");
			root.className = "mediascape-dsh-upload-hud";
			root.style.display = "none";
			panel.appendChild(root);
			function refresh() {
				root.style.display = rows.size ? "flex" : "none";
				// 2026-09-23：上传中「传」按钮亮（有活动行）；无行时熄灭 + 面板收起
				btn.classList.toggle("on", rows.size > 0);
				if (rows.size > 0) {
					panel.classList.add("open");
					if (dockEl && dockEl.__mediascapeDshCenter) dockEl.__mediascapeDshCenter(panel);
				} else {
					panel.classList.remove("open");
				}
			}
			// 2026-09-23 拆（审计）：行管理状态机顶层化（createRowOps），此处只做组装
			const ops = createRowOps(rows, refresh);
			function begin(key, name, total, controls = {}) {
				const r = ops.rowFor(key);
				// rowFor 创建的 el 未挂 root——begin 时挂载（createRowOps 不持 root 引用）
				if (!r.el.parentNode) root.appendChild(r.el);
				r.name = name;
				r.total = total;
				r.el.querySelector(".mediascape-dsh-upload-name").textContent = name;
				r.el.classList.remove("mediascape-dsh-upload-fail");
				// 按钮回调（2026-09-23 保留暂停）：⏸ 暂停（abort 当前请求）/ ✕ 取消；继续由暂停态点击触发
				r.onPause = typeof controls.onPause === "function" ? controls.onPause : null;
				r.onCancel = typeof controls.onCancel === "function" ? controls.onCancel : null;
				r.pauseBtn.style.display = "inline-block";
				if (r.onCancel) r.cancelBtn.style.display = "inline-block"; else r.cancelBtn.style.display = "none";
				r.pauseBtn.onclick = (e) => {
					e.stopPropagation();
					if (r.paused) { // 暂停态按钮=「继续」：调用方 onResume 发 ?offset= 续传（从 .part 追加，不重传已传部分）
						if (typeof controls.onResume === "function") controls.onResume();
					} else if (r.onPause) { r.onPause(); }
				};
				r.cancelBtn.onclick = (e) => { e.stopPropagation(); if (r.onCancel) r.onCancel(); };
				refresh();
				return {
					setLoaded(loaded) { ops.rowSetLoaded(r, key, loaded); },
					setPaused(paused) { ops.rowSetPaused(r, key, paused); },
					done(ok) { ops.rowDone(r, key, ok); },
				};
			}
			// 挂真实单例：业务代码（upload.js/music-player.js）经 window.__mediascapeDshUploadHud 取用
			window.__mediascapeDshUploadHud = {
				begin,
				// 2026-09-2x 加：去重「已跳过」提示行——灰字无进度条，短暂保留后自动移除
				skip(name) {
					const key = "SKIP-" + (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : String(Date.now()).slice(-8));
					const r = ops.rowFor(key);
					if (!r.el.parentNode) root.appendChild(r.el);
					r.name = name;
					r.el.classList.add("mediascape-dsh-upload-skip");
					r.el.querySelector(".mediascape-dsh-upload-name").textContent = "⏭ 已跳过 · " + name;
					r.el.querySelector(".mediascape-dsh-upload-bar-wrap").style.display = "none";
					r.el.querySelector(".mediascape-dsh-upload-meta").style.display = "none";
					r.el.querySelector(".mediascape-dsh-upload-ctl").style.display = "none";
					refresh();
					setTimeout(() => { rows.delete(key); r.el.remove(); refresh(); }, SKIP_KEEP_MS);
				},
				dispose: () => {
					document.removeEventListener("click", onDocClick);
					btn.remove();
					panel.remove();
					window.__mediascapeDshUploadHud = null;
				},
			};
			return window.__mediascapeDshUploadHud;
		}
		// 兜底 no-op：HUD 未创建（startUploadHud 未调用/调用前业务早访）时给出无副作用对象
		if (!window.__mediascapeDshUploadHud) {
			window.__mediascapeDshUploadHud = { begin: () => ({ setLoaded() {}, done() {}, setPaused() {} }), skip() {} };
		}


		// 2026-09-23 拆（审计 max-cyclomatic 36）+ 改：单次上传 XHR 提为模块级——
	// 2026-09-2x 恢复续传语义（「继续从 part 续传」）：body 可为 file.slice(offset)
	// （续传剩余部分），URL 带 ?offset= 让服务端对 <正式名>.part 追加续写。
	// 创建 XMLHttpRequest + 全部事件回调，返回 { promise, abort }。
	// onProgress(loaded) 上报进度；onload resolve { status, text }；其余异常路径 resolve null。
	// 不设 xhr.timeout（整体超时会误杀大文件慢速上传）。
	function runUploadXhr(url, body, onProgress) {
		let xhr = null;
		const promise = new Promise((resolveDone) => {
			xhr = new XMLHttpRequest();
			xhr.open("POST", url);
			xhr.upload.onprogress = (e) => { if (e) onProgress(e.loaded); };
			xhr.onload = () => resolveDone({ status: xhr.status, text: xhr.responseText });
			xhr.onerror = () => resolveDone(null);
			xhr.ontimeout = () => resolveDone(null);
			xhr.onabort = () => resolveDone(null); // 用户取消触发
			xhr.send(body);
		});
		return {
			promise,
			abort() { try { if (xhr) xhr.abort(); } catch (e) { /* XHR 已结束：abort 抛错可忽略 */ } },
		};
	}

		// 2026-09-2x 拆+改（「上传中途不落盘 part，暂停落盘 part，继续从 part 续传」）：
		// 单文件上传：XHR 整文件 POST（常规不落盘）→ 暂停 abort（服务端把已收部分落盘
		// <正式名>.part）→ 继续 = file.slice(offset) + ?offset= 从 .part 续传（不重传已传部分）；
		// 取消 = abort + DELETE /upload/part 清理服务端 .part 快照。串行调用：一次只占一条
		// 连接（浏览器同源并发上限 6），每个请求完成即释放引用（上传完释放连接）。
		// onProgress(loaded) 上报本次请求进度（累计 = offset + loaded）。
		function uploadOneFileXhr(file, kind) {
			const traceId = "F" + (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : String(Date.now()).slice(-8));
			let offset = 0;     // 已传字节（续传起点，= 暂停时服务端 .part 快照大小）
			let loaded = 0;     // 当前请求已传
			let userPaused = false;
			let userCancelled = false;
			let currentReq = null;
			const hud = (window.__mediascapeDshUploadHud || { begin: () => ({ setLoaded() {}, done() {}, setPaused() {} }) })
				.begin(traceId, file.name, file.size || 0, {
					// 暂停：abort 当前请求（服务端保留 .part 快照）；HUD 行进暂停态
					onPause() { userPaused = true; if (currentReq) currentReq.abort(); hud.setPaused(true); },
					// 继续（暂停态按钮变「▶」后点击）：从 .part 续传（offset = 已累计字节）
					onResume() {
						userPaused = false;
						offset += loaded; // 续传起点 = 累计已传（服务端 .part 快照大小）
						hud.setPaused(false);
						hud.setLoaded(offset);
						run();
					},
					// 取消：abort + 清理服务端 .part 快照（不留残留）
					onCancel() {
						userCancelled = true;
						if (currentReq) currentReq.abort();
						ffFetch("/theme-mediascape-assets/upload/part?name=" + encodeURIComponent(file.name)).catch(() => { /* 清理失败静默（孤儿清理兜底） */ });
						hud.done(false);
					},
				});
			const run = () => {
				const body = offset > 0 ? file.slice(offset) : file; // 续传只发剩余部分
				const { promise, abort } = runUploadXhr(
					(kind === "music" ? "/theme-mediascape-assets/music/upload" : "/theme-mediascape-assets/upload") +
						"?name=" + encodeURIComponent(file.name) + (offset > 0 ? "&offset=" + offset : ""),
					body,
					(l) => { loaded = l; hud.setLoaded(offset + l); },
				);
				currentReq = { abort };
				return promise;
			};
			return (async () => {
				try {
					const result = await run();
					currentReq = null; // 上传完释放连接（浏览器同源连接数限制 6）
					if (userPaused || userCancelled) return { up: null, respStatus: 0, interrupted: true };
					let up = null, respStatus = 0;
					if (result && result.status) respStatus = result.status;
					try { up = result && result.text ? JSON.parse(result.text) : null; } catch { up = null; }
					const ok = !!(up && up.ok);
					if (!userPaused && !userCancelled) hud.done(ok);
					return { up, respStatus, interrupted: false };
				} catch (e) {
					console.error(`[upload][${traceId}] network error:`, e?.message ?? e);
					hud.done(false);
					return { up: null, respStatus: 0, interrupted: false };
				}
			})();
		}

		// ── 2026-09-2x 上传/移除公共函数（壁纸/音乐统一）──
		// 上传统一：按「文件名后缀」识别类型（壁纸 png/jpg/jpeg/webp/mp4，音乐 mp3/ogg/m4a/wav/flac），
		// 不再按浏览器 MIME 分流；开始前/结束后各刷新一次对应 list（内置在公共函数内）；
		// 预检「文件名+大小」去重，重复的走 HUD「已跳过」行（不请求）；串行 XHR 上传
		// （暂停落 .part / 继续 offset 续传 / 取消清 .part）；上传完释放连接（串行不占满
		// 浏览器同源 6 连接），全部完成后刷新列表。移除统一：同一份删除+前后 list 刷新逻辑。
		const UPLOAD_EXT_WALLPAPER = new Set(["png", "jpg", "jpeg", "webp", "mp4", "webm"]); // 壁纸：图片 + 浏览器原生视频（mp4/webm）
		const UPLOAD_EXT_MUSIC = new Set(["mp3", "ogg", "m4a", "wav", "flac"]);
		function classifyUploadFile(f) {
			const ext = (f.name.split(".").pop() || "").toLowerCase();
			if (UPLOAD_EXT_WALLPAPER.has(ext)) return "wallpaper";
			if (UPLOAD_EXT_MUSIC.has(ext)) return "music";
			return null;
		}
		// 2026-09-2x 统一「真实可用」判断：上传去重基准与移除目标只认真实存在的素材项——
		// 服务端列表 stat 失败（文件被外部移动/删除）已剔除；前端依据「file/name + size 数字」判定可用，
		// 失效项不参与去重（避免误判重复导致传不进去）、不发起删除。壁纸/音乐同一份逻辑。
		function isItemUsable(item) {
			return !!(item && (item.file || item.name) && typeof item.size === "number" && item.size >= 0);
		}
		// 统一 list 刷新（壁纸 loadCustomWallpapers(true) 重建 / 音乐 fillList 重建），
		// 由 startWallpaper/startMusic 挂 window 钩子提供（闭包内函数无法直接访问）。
		async function refreshList(kind) {
			try {
				const fn = kind === "music" ? window.__mediascapeDshRefreshMusic : window.__mediascapeDshRefreshWallpapers;
				if (typeof fn === "function") await fn();
			} catch (e) { /* 列表刷新失败不阻塞上传/移除主流程 */ }
		}
		// 统一上传入口（dock「传」按钮 → uploadFiles）：壁纸/音乐同一份逻辑——
		// 按后缀分流 → 开始前刷新 list → 预检去重（重复走 HUD「已跳过」）→ 串行上传 → 结束后刷新 list。
		async function uploadFiles(files) {
			if (!files || !files.length) return;
			const hud = window.__mediascapeDshUploadHud;
			const byKind = { wallpaper: [], music: [] };
			for (const f of files) {
				const kind = classifyUploadFile(f);
				if (kind) byKind[kind].push(f);
				else if (hud && hud.skip) hud.skip(f.name); // 非壁纸/非音乐后缀：跳过提示
			}
			for (const kind of ["wallpaper", "music"]) {
				const group = byKind[kind];
				if (!group.length) continue;
				// ① 开始前刷新对应 list（保证去重基准最新）
				await refreshList(kind);
				// ② 预检「文件名+大小」去重：重复 → HUD「已跳过」行（不请求，服务端 existing 兜底）
				// 去重基准只认可用项（isItemUsable：file/name + size 数字 = 磁盘真实存在）
				const items = kind === "music"
					? (typeof window.__mediascapeDshMusicItems === "function" ? window.__mediascapeDshMusicItems() : [])
					: (typeof window.__mediascapeDshWallpaperItems === "function" ? window.__mediascapeDshWallpaperItems() : []);
				const dup = new Set(items.filter(isItemUsable).map((x) => (x.file || x.name) + ":" + (x.size ?? 0)));
				const toUpload = [], skipped = [];
				for (const f of group) {
					if (dup.has(f.name + ":" + f.size)) skipped.push(f);
					else toUpload.push(f);
				}
				for (const f of skipped) if (hud && hud.skip) hud.skip(f.name);
				// ③ 串行上传（一次一个请求，不占满浏览器同源 6 连接；每个完成即释放连接）
				let lastUp = null;
				for (const f of toUpload) {
					const { up, interrupted } = await uploadOneFileXhr(f, kind);
					if (interrupted) continue;
					if (up && up.ok) lastUp = up;
				}
				// ④ 结束后刷新 list（服务端落盘后列表记录最新），再执行类型特定落地（切壁纸/可播放）
				await refreshList(kind);
				const after = kind === "music" ? window.__mediascapeDshAfterMusicUpload : window.__mediascapeDshAfterWallpaperUpload;
				if (typeof after === "function") { try { after(lastUp); } catch (e) { console.warn("[upload] after 钩子异常:", e?.message ?? e); } }
			}
		}
		// 统一移除（壁纸/音乐同一份逻辑）：开始前/结束后各刷新一次对应 list（内置），
		// 逐个 DELETE 服务端文件（音乐封面由服务端 handleMusicDelete 一并删）。
		// items: [{ id, kind:'wallpaper'|'music', data/url }]；返回 { removed, kind }。
		async function removeItems(items) {
			if (!items || !items.length) return { removed: 0, kind: null };
			// 只删除真实可用的项（isItemUsable：失效项不发起删除）
			const usable = items.filter(isItemUsable);
			if (!usable.length) return { removed: 0, kind: null };
			const kind = usable[0].kind === "music" ? "music" : "wallpaper";
			await refreshList(kind); // ① 开始前刷新 list（删除基于最新列表记录）
			let removed = 0;
			// ② 逐个删除服务端文件（串行：一次只占一条连接——视频壁纸播放时浏览器同源 6 连接
			// 被 Range 流占用，并发 DELETE 会叠加排队延迟；串行保证每条必完成，2026-09-2x 改）
			for (const it of usable) {
				const ok = await deleteServerFile(it);
				if (ok) removed++;
			}
			await refreshList(kind); // ③ 结束后刷新 list（被删项不再出现）
			return { removed, kind };
		}
		// 删除单个服务端素材文件（data/url = /theme-mediascape-assets/{wallpaper|music}/<file>）
		function deleteServerFile(item) {
			const m = /\/theme-mediascape-assets\/(wallpaper|music)\/([^?]+)$/.exec(item.data || item.url || "");
			if (!m) return Promise.resolve(false);
			// 2026-09-2x 删除请求不带超时（ffFetch 第 3 参传 0 = 无 timeout signal）：
			// 视频壁纸播放时 DELETE 被连接排队 10s+（实测 12.3s），默认 15s 超时险象环生、
			// 排队更长直接超时失败 → 实测「音乐和封面都没删」。删除是短操作，
			// 等浏览器调度完成必成功，超时反而造成假失败。
			return ffFetch("/theme-mediascape-assets/" + m[1] + "/" + m[2], { method: "DELETE" }, 0)
				.then((r) => r.ok)
				.catch(() => false);
		}

		// 2026-09-2x「传」统一上传入口（上传按文件名后缀天然识别壁纸还是音乐，
		// accept 合并壁纸+音乐后缀，选完统一走公共 uploadFiles——去重跳过/串行/前后 list 刷新内置）。
