		// ═══════════ 上传进度 HUD + 上传/移除公共函数（2026-09-2x 从 utils.js 拆出）═══════════
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

		// 与 utils.js 同工厂作用域拼接（build.cjs PART_ORDER：utils.js → utils-upload.js）：
		// 共享 utils.js 的常量/ffFetch/fmt*/createRowOps 等，本片段只含上传/移除相关实现。
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
		// 2026-09-2x 拆（审计 max-function-length/复杂度）：startUploadHud 的「按钮创建」与
		// 「行按钮绑定」提为纯 helper（行为不变）——主函数只做组装。
		// dock「传」按钮：点击直接打开统一上传选择器（视频/图片/音乐），面板仅上传进行时自动弹出
		// 2026-09-2x 拆（审计 max-function-length）：startUploadHud 的 begin/skip/dispose 提为模块级工厂
		// begin：创建/挂载进度行 + 绑定按钮回调，返回 { setLoaded, setPaused, done }
		function makeUploadBegin(ops, root, refresh) {
			return (key, name, total, controls = {}) => {
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
				bindRowButtons(r, controls);
				refresh();
				return {
					setLoaded(loaded) { ops.rowSetLoaded(r, key, loaded); },
					setPaused(paused) { ops.rowSetPaused(r, key, paused); },
					done(ok) { ops.rowDone(r, key, ok); },
				};
			};
		}

		// 去重「已跳过」提示行：灰字无进度条，短暂保留后自动移除
		function makeUploadSkip(ops, root, rows, refresh) {
			return (name) => {
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
			};
		}

		// 卸载：移除点外监听 + 按钮/面板 DOM + 清单例
		function makeUploadDispose(btn, panel, onDocClick) {
			return () => {
				document.removeEventListener("click", onDocClick);
				btn.remove();
				panel.remove();
				window.__mediascapeDshUploadHud = null;
			};
		}

		function createUploadToggle(dockEl) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "mediascape-dsh-upload-toggle mediascape-dsh-dock-btn";
			btn.textContent = "传";
			btn.title = "上传";
			dockEl.appendChild(btn);
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				const openPicker = window.__mediascapeDshOpenUploadPicker;
				if (typeof openPicker === "function") openPicker();
			});
			return btn;
		}

		// 行按钮回调绑定：⏸ 暂停（abort 当前请求）/ 暂停态=「继续」（onResume 发 ?offset= 续传）/ ✕ 取消
		function bindRowButtons(r, controls) {
			r.pauseBtn.onclick = (e) => {
				e.stopPropagation();
				if (r.paused) {
					if (typeof controls.onResume === "function") controls.onResume();
				} else if (r.onPause) { r.onPause(); }
			};
			r.cancelBtn.onclick = (e) => { e.stopPropagation(); if (r.onCancel) r.onCancel(); };
		}

		function startUploadHud(dock) {
			const dockEl = dock;
			const btn = createUploadToggle(dockEl);
			const panel = document.createElement("div");
			panel.className = "mediascape-dsh-upload-panel";
			panel.innerHTML = '<div class="mediascape-dsh-bg-title">上传</div>';
			if (dockEl) dockEl.appendChild(panel);
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
			// 2026-09-2x 拆（审计 max-function-length）：begin / skip / dispose 提为模块级
			// 工厂（makeUploadBegin/makeUploadSkip），主函数只做组装
			const begin = makeUploadBegin(ops, root, refresh);
			const skip = makeUploadSkip(ops, root, rows, refresh);
			// 挂真实单例：业务代码（upload.js/music-player.js）经 window.__mediascapeDshUploadHud 取用
			window.__mediascapeDshUploadHud = {
				begin,
				skip,
				dispose: makeUploadDispose(btn, panel, onDocClick),
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
		// 2026-09-2x 拆（审计 max-cyclomatic）：uploadOneFileXhr 的「响应收尾」提为纯 helper——
		// 解析服务端返回（up/respStatus），标记 HUD 完成；被暂停/取消时返回中断标记
		function settleUpload(uploadResult, userPaused, userCancelled, hud) {
			if (userPaused || userCancelled) return { up: null, respStatus: 0, interrupted: true };
			let uploadResp = null, respStatus = 0;
			if (uploadResult && uploadResult.status) respStatus = uploadResult.status;
			try { uploadResp = uploadResult && uploadResult.text ? JSON.parse(uploadResult.text) : null; } catch { uploadResp = null; }
			const ok = !!(uploadResp && uploadResp.ok);
			if (!userPaused && !userCancelled) hud.done(ok);
			return { up: uploadResp, respStatus, interrupted: false };
		}

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
					const uploadResult = await run();
					currentReq = null; // 上传完释放连接（浏览器同源连接数限制 6）
					return settleUpload(uploadResult, userPaused, userCancelled, hud);
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
		// 2026-09-2x 拆（审计 max-cyclomatic）：uploadFiles 的「类型分组」与「去重预检」提为纯 helper
		// 类型分组：按后缀分类；非素材后缀（非壁纸/非音乐）给 HUD「已跳过」提示
		function groupUploadByKind(files, hud) {
			const byKind = { wallpaper: [], music: [] };
			for (const f of files) {
				const kind = classifyUploadFile(f);
				if (kind) byKind[kind].push(f);
				else if (hud && hud.skip) hud.skip(f.name);
			}
			return byKind;
		}

		// 去重预检：「文件名+大小」与现有列表比对，重复 → skipped（HUD「已跳过」，不请求）；
		// 去重基准只认可用项（isItemUsable：file/name + size 数字 = 磁盘真实存在）
		function dedupeByFileSize(files, kind, hud) {
			const items = kind === "music"
				? (typeof window.__mediascapeDshMusicItems === "function" ? window.__mediascapeDshMusicItems() : [])
				: (typeof window.__mediascapeDshWallpaperItems === "function" ? window.__mediascapeDshWallpaperItems() : []);
			const dup = new Set(items.filter(isItemUsable).map((x) => (x.file || x.name) + ":" + (x.size ?? 0)));
			const toUpload = [], skipped = [];
			for (const f of files) {
				if (dup.has(f.name + ":" + f.size)) skipped.push(f);
				else toUpload.push(f);
			}
			for (const f of skipped) if (hud && hud.skip) hud.skip(f.name);
			return { toUpload, skipped };
		}

		async function uploadFiles(files) {
			if (!files || !files.length) return;
			const hud = window.__mediascapeDshUploadHud;
			const byKind = groupUploadByKind(files, hud);
			for (const kind of ["wallpaper", "music"]) {
				const group = byKind[kind];
				if (!group.length) continue;
				// ① 开始前刷新对应 list（保证去重基准最新）
				await refreshList(kind);
				// ② 预检「文件名+大小」去重：重复 → HUD「已跳过」行（不请求，服务端 existing 兜底）
				const { toUpload } = dedupeByFileSize(group, kind, hud);
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
