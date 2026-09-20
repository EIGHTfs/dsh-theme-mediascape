		// ═══════════ 5. 壁纸系统（类型选择 + 切换/随机 + 随机间隔）═══════════
		function startWallpaper(dock) {
			const all = Array.isArray(WALLPAPERS) ? WALLPAPERS : [];
			const LS_BG_HIDDEN = "ff_bg_hidden";
			const LS_BG_RANDOM = "ff_bg_random";
			function loadIdSet(key) {
				try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); }
				catch (e) { return new Set(); }
			}
			function saveIdSet(key, set) {
				try { localStorage.setItem(key, JSON.stringify([...set])); } catch (e) {}
			}
			const hidden = loadIdSet(LS_BG_HIDDEN);     // 内置壁纸「移除」后的隐藏名单
			const randomPool = loadIdSet(LS_BG_RANDOM); // 随机展示的勾选池（空=全部）
			const vids = all.filter((w) => w.kind === "video" && !hidden.has(w.id));
			const imgs = all.filter((w) => w.kind === "image" && !hidden.has(w.id));

			const bg = document.createElement("div");
			bg.className = "ff-bg";
			const shade = document.createElement("div");
			shade.className = "ff-bg-shade";
			document.body.append(bg, shade);

			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "ff-bg-toggle ff-dock-btn";
			btn.textContent = "景";
			btn.title = "壁纸设置";
			dock.appendChild(btn);

			const panel = document.createElement("div");
			panel.className = "ff-bg-panel";
			panel.innerHTML =
				'<div class="ff-bg-title">壁纸设置</div>' +
				'<div class="ff-bg-line"><span class="ff-bg-label">类型</span>' +
					'<button class="ff-bg-seg" data-type="video" type="button">动态</button>' +
					'<button class="ff-bg-seg" data-type="image" type="button">静态</button></div>' +
				'<div class="ff-bg-line"><span class="ff-bg-label">模式</span>' +
					'<button class="ff-bg-seg" data-mode="single" type="button">单曲</button>' +
					'<button class="ff-bg-seg" data-mode="switch" type="button">顺序</button>' +
					'<button class="ff-bg-seg" data-mode="random" type="button">随机</button></div>' +
				'<div class="ff-bg-line"><span class="ff-bg-label">随机间隔</span>' +
					'<input class="ff-bg-interval" type="number" min="1" max="1440" step="1">' +
					'<span class="ff-bg-unit">分钟</span></div>' +
				'<button class="ff-bg-add" type="button">＋ 添加壁纸</button>' +
				'<button class="ff-bg-pick" type="button">选择壁纸</button>' +
				'<button class="ff-bg-ok" type="button">确定</button>';
			dock.appendChild(panel);

			// 壁纸选择器（点击「选择」弹出，缩略图网格点选，支持勾选后移除/随机）
			const picker = document.createElement("div");
			picker.className = "ff-bg-picker";
			picker.innerHTML =
				'<div class="ff-bg-picker-head">' +
					'<div class="ff-bg-picker-title">选择壁纸</div>' +
					'<button class="ff-bg-close" type="button" title="收起">—</button>' +
				'</div>' +
				'<div class="ff-bg-picker-list"></div>' +
				'<div class="ff-bg-picker-actions">' +
					'<button class="ff-bg-act ff-bg-remove" type="button">移除</button>' +
					'<button class="ff-bg-act ff-bg-random" type="button">随机</button>' +
				'</div>';
			dock.appendChild(picker);
			const pickerTitle = picker.querySelector(".ff-bg-picker-title");
			const pickerList = picker.querySelector(".ff-bg-picker-list");
			const pickerRemove = picker.querySelector(".ff-bg-remove");
			const pickerRandom = picker.querySelector(".ff-bg-random");

			const typeBtns = {
				video: panel.querySelector('[data-type="video"]'),
				image: panel.querySelector('[data-type="image"]'),
			};
			const modeBtns = {
				single: panel.querySelector('[data-mode="single"]'),
				switch: panel.querySelector('[data-mode="switch"]'),
				random: panel.querySelector('[data-mode="random"]'),
			};
			const intervalInput = panel.querySelector(".ff-bg-interval");

			// 无视频/无图片时禁用对应类型按钮（避免点了没反应）
			if (vids.length === 0) typeBtns.video.disabled = true;
			if (imgs.length === 0) typeBtns.image.disabled = true;

			let vidIndex = 0, imgIndex = 0, activeType = "image";
			let mode = localStorage.getItem(LS_BG_MODE) || "switch";
			let interval = parseInt(localStorage.getItem(LS_BG_INTERVAL) || "5", 10) || 5;
			let randomTimer = null;
			let currentId = null;
			const selected = new Set();      // 选择面板里的勾选（移除/随机 共用的临时选择）
			const customKeys = new Set();    // 运行时壁纸去重：name:size

			function render(item) {
				if (!item) return;
				bg.innerHTML = "";
				bg.style.backgroundImage = "none";
				if (item.kind === "video") {
					const video = document.createElement("video");
					const vol = typeof window.__ffSoundVol === "function" ? window.__ffSoundVol() : 80;
					const muted = typeof window.__ffSoundMuted === "function" ? window.__ffSoundMuted() : true;
					// 动态壁纸播放模式对齐音乐三档：
					//   single → loop 单视频循环（旧默认行为，最简）；
					//   switch/random → 不 loop，ended 驱动按模式（顺序/随机）切换。
					video.autoplay = true; video.loop = mode === "single"; video.muted = muted; video.playsInline = true;
					video.volume = vol / 100;
					video.src = item.url || item.data;
					bg.appendChild(video);
					video.addEventListener("ended", onVideoEnded);
					video.play().catch(() => {});
				} else {
					bg.style.backgroundImage = 'url("' + (item.url || item.data) + '")';
				}
				activeType = item.kind;
				currentId = item.id || null;
				if (item.id) localStorage.setItem(LS_BG, item.id);
				btn.title = "壁纸：" + (item.label || item.id);
				typeBtns.video.classList.toggle("active", activeType === "video");
				typeBtns.image.classList.toggle("active", activeType === "image");
			}

			function showByIndex(kind, idx) {
				const arr = kind === "video" ? vids : imgs;
				if (arr.length === 0) return;
				const i = ((idx % arr.length) + arr.length) % arr.length;
				if (kind === "video") vidIndex = i; else imgIndex = i;
				render(arr[i]);
			}

			function pickType(kind) {
				if (kind === "video") showByIndex("video", vidIndex);
				else showByIndex("image", imgIndex);
				// 类型切换后按新类型重调度：video → 由 ended 驱动（分钟定时自动停）；image → 恢复分钟兜底
				if (mode === "random") scheduleRandom();
			}

			function activeArr() { return activeType === "video" ? vids : imgs; }

			function showItem(item) {
				if (!item) return;
				const list = item.kind === "video" ? vids : imgs;
				const i = list.indexOf(item);
				if (i < 0) return;
				if (item.kind === "video") vidIndex = i; else imgIndex = i;
				render(item);
			}

			function doSwitch() {
				if (activeType === "video") showByIndex("video", vidIndex + 1);
				else showByIndex("image", imgIndex + 1);
			}

			// 动态壁纸「播放完毕」回调：由 render 里的 video ended 事件触发。
			// 语义对齐音乐播放：single=单曲循环（loop 由 video.loop 承担，本不触发 ended，防御残留）；
			// switch=顺序（vids 列表循环下一段）、random=随机（池内不重复当前）。
			function onVideoEnded() {
				if (activeType !== "video") return; // 旧元素 ended（类型已切走）直接忽略
				if (mode === "single") return;      // 单曲循环不切换
				if (mode === "random") doRandom();
				else doSwitch();
			}

			function randomCandidates() {
				const arr = activeArr();
				if (randomPool.size === 0) return arr;
				return arr.filter((it) => randomPool.has(it.id));
			}

			function doRandom() {
				const arr = randomCandidates();
				if (arr.length === 0) return;
				const cur = arr.findIndex((it) => it.id === currentId);
				let n = cur;
				if (arr.length > 1) while (n === cur) n = Math.floor(Math.random() * arr.length);
				showItem(arr[n]);
			}

			function clearRandom() { if (randomTimer) { clearTimeout(randomTimer); randomTimer = null; } }

			function scheduleRandom() {
				clearRandom();
				if (mode !== "random") return;
				// 动态壁纸由视频 ended 驱动（播完即切，不按分钟打断）；分钟定时仅兜底静态图
				if (activeType === "video") return;
				randomTimer = setTimeout(() => { doRandom(); scheduleRandom(); }, Math.max(1, interval) * 60000);
			}

			function setMode(m) {
				mode = m;
				localStorage.setItem(LS_BG_MODE, mode);
				modeBtns.single.classList.toggle("active", mode === "single");
				modeBtns.switch.classList.toggle("active", mode === "switch");
				modeBtns.random.classList.toggle("active", mode === "random");
				if (mode === "random") {
					doRandom();
					scheduleRandom();
				} else {
					clearRandom();
				}
				// 模式切换同步已渲染视频的 loop：single=单曲循环，其它=播完切换（ended 驱动）
				const v = bg.querySelector("video");
				if (v) v.loop = mode === "single";
			}

			function setIntervalMinutes(v) {
				const n = parseInt(v, 10);
				interval = n > 0 ? n : 5;
				localStorage.setItem(LS_BG_INTERVAL, String(interval));
				if (mode === "random") scheduleRandom();
			}

			function closePanel() { panel.classList.remove("open"); }

			// ── 选择面板：勾选 → 移除 / 随机；点卡片本体 → 应用该壁纸 ──
			function closePicker() { picker.classList.remove("open"); }

			function updatePickerActions() {
				const n = selected.size;
				pickerRemove.disabled = n === 0;
				pickerRandom.disabled = n === 0;
				pickerRemove.textContent = n > 0 ? "移除(" + n + ")" : "移除";
				pickerRandom.textContent = n > 0 ? "随机(" + n + ")" : "随机";
			}

			function buildPicker() {
				const arr = activeArr();
				pickerTitle.textContent = "选择壁纸（" + (activeType === "video" ? "动态" : "静态") + "）";
				pickerList.innerHTML = "";
				if (arr.length === 0) {
					pickerList.innerHTML = '<div class="ff-bg-picker-empty">暂无壁纸</div>';
					updatePickerActions();
					return;
				}
				arr.forEach((item) => {
					const cell = document.createElement("div");
					cell.className = "ff-bg-picker-item" + (selected.has(item.id) ? " checked" : "");
					if (item.kind === "video") {
						const v = document.createElement("video");
						v.src = item.url || item.data; v.muted = true; v.preload = "metadata"; v.playsInline = true;
						cell.appendChild(v);
					} else {
						const img = document.createElement("img");
						img.src = item.url || item.data;
						img.draggable = false;
						cell.appendChild(img);
					}
					const lab = document.createElement("span");
					lab.textContent = item.label || item.id;
					cell.appendChild(lab);

					const cb = document.createElement("input");
					cb.type = "checkbox";
					cb.className = "ff-bg-check";
					cb.checked = selected.has(item.id);
					cb.title = "勾选后可用下方「移除 / 随机」";
					cb.addEventListener("click", (e) => {
						e.stopPropagation();
						if (cb.checked) selected.add(item.id); else selected.delete(item.id);
						cell.classList.toggle("checked", cb.checked);
						updatePickerActions();
					});
					cell.appendChild(cb);

					cell.addEventListener("click", () => {
						showItem(item);
						closePicker();
					});
					pickerList.appendChild(cell);
				});
				updatePickerActions();
			}

			// 打开选择器（再次点击「选择壁纸」或「收起」关闭）。只挑壁纸，不改播放模式。
			function openPicker() {
				if (picker.classList.contains("open")) { closePicker(); return; }
				selected.clear();
				buildPicker();
				picker.classList.add("open");
				dock.__ffCenter(picker);
			}

			// 移除勾选的壁纸：内置→隐藏名单(localStorage)；运行时→删除 IndexedDB
			function removeSelected() {
				const ids = [...selected];
				if (ids.length === 0) return;
				const removed = new Set(ids);
				for (const id of ids) {
					const item = vids.concat(imgs).find((w) => w.id === id);
					if (!item) continue;
					if (item.custom) {
						// 删除服务器上的壁纸文件（item.data = /theme-mediascape-assets/wallpapers/<file>）
						const m = /\/theme-mediascape-assets\/wallpapers\/([^?]+)$/.exec(item.data || "");
						if (m) {
							fetch(WALLPAPER_API + "/wallpapers/" + m[1], { method: "DELETE" }).catch(() => {});
						}
					} else {
						hidden.add(id);
					}
					randomPool.delete(id);
					const list = item.kind === "video" ? vids : imgs;
					const idx = list.indexOf(item);
					if (idx >= 0) list.splice(idx, 1);
				}
				selected.clear();
				saveIdSet(LS_BG_HIDDEN, hidden);
				saveIdSet(LS_BG_RANDOM, randomPool);
				typeBtns.video.disabled = vids.length === 0;
				typeBtns.image.disabled = imgs.length === 0;
				// 若当前展示壁纸被移除，切到可用的第一张
				if (removed.has(currentId)) {
					if (vids.length) { activeType = "video"; showByIndex("video", 0); }
					else if (imgs.length) { activeType = "image"; showByIndex("image", 0); }
					else { bg.innerHTML = ""; bg.style.backgroundImage = "none"; currentId = null; }
				}
				if (picker.classList.contains("open")) buildPicker();
			}

			// 随机：以勾选的壁纸作为随机池，并立即进入随机模式
			function applyRandomPool() {
				if (selected.size === 0) return;
				randomPool.clear();
				for (const id of selected) {
					if (vids.concat(imgs).some((w) => w.id === id)) randomPool.add(id);
				}
				saveIdSet(LS_BG_RANDOM, randomPool);
				selected.clear();
				closePicker();
				setMode("random");
			}

			// ── 用户上传壁纸（服务器持久化：$DSH_HOME/theme-mediascape/wallpapers/）──
			// 上传/删除走 HTTP API（fetch），不再用 IndexedDB：
			// 浏览器 IndexedDB 有版本冲突/配额静默失败问题，且换浏览器/清数据即丢；
			// 服务器磁盘才是真持久化，刷新/重启/换浏览器都在。
			const WALLPAPER_API = "/theme-mediascape-assets";

			async function loadCustomWallpapers(refresh) {
				try {
					const resp = await fetch(WALLPAPER_API + "/wallpapers/list");
					if (!resp.ok) return;
					const data = await resp.json();
					// refresh 模式（打开面板时触发）：清空已加载的自定义列表再重载，
					// 使其他设备新上传的壁纸无需手动刷新网页即可出现在本机（跨设备即时可见）。
					if (refresh) {
						const keep = new Set(vids.concat(imgs).map((x) => x.id));
						vids.length = 0; imgs.length = 0;
						for (const r of (data.items || [])) {
							const item = { id: r.id, kind: r.kind, data: r.url, label: r.label || r.id, custom: true };
							if (r.kind === "video") vids.push(item); else imgs.push(item);
						}
						typeBtns.video.disabled = vids.length === 0;
						typeBtns.image.disabled = imgs.length === 0;
						return;
					}
					for (const r of (data.items || [])) {
						const item = { id: r.id, kind: r.kind, data: r.url, label: r.label || r.id, custom: true };
						if (r.kind === "video") vids.push(item); else imgs.push(item);
					}
					typeBtns.video.disabled = vids.length === 0;
					typeBtns.image.disabled = imgs.length === 0;
				} catch (e) { /* 服务器不可达则忽略（内置壁纸照常） */ }
			}

