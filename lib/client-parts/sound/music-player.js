			function fmt(t) {
				if (!isFinite(t) || t < 0) t = 0;
				t = Math.floor(t);
				const min = Math.floor(t / 60), sec = t % 60;
				return min + ":" + (sec < 10 ? "0" : "") + sec;
			}
			function setCoverImage(url) { coverEl.style.backgroundImage = 'url("' + url + '")'; lblEl.style.display = "none"; }
			function setCoverFallback(item) {
				coverEl.style.backgroundImage = "";
				lblEl.style.display = "";
				const t = (item && (item.label || item.id)) || "♪";
				lblEl.textContent = (t.trim().charAt(0) || "♪");
			}
			function updateDisc(item) {
				const cached = item ? coverCache.get(item.id) : null;
				if (cached) setCoverImage(cached);
				else setCoverFallback(item);
				if (item && !coverCache.has(item.id)) {
					resolveCover(item).then(() => {
						if (list[current] === item) {
							const cached = coverCache.get(item.id);
							if (cached) setCoverImage(cached);
						}
					});
				}
			}
			function refresh() {
				btn.classList.toggle("on", playing);
				playBtn.textContent = playing ? "⏸" : "▶";
				modeBtn.textContent = MODES[mode];
				modeBtn.title = "循环模式：" + MODES[mode] + "（点击切换）";
				discEl.classList.toggle("playing", playing);
				const song = list[current];
				titleEl.textContent = song ? "♪ " + (song.label || song.id) : "—";
				updateDisc(song);
			}

			function loadAndPlay(i) {
				if (list.length === 0) return;
				current = ((i % list.length) + list.length) % list.length;
				const song = list[current];
				seekEl.value = "0";
				timeCur.textContent = "0:00";
				timeDur.textContent = "0:00";
				audio.src = withMediaToken(song.url || song.data);
				audio.loop = mode === "single";
				audio.play().then(() => { playing = true; refresh(); }).catch(() => { playing = false; refresh(); });
				if (song.id) localStorage.setItem(LS_MUSIC_ID, song.id);
				refresh();
			}

			function expandCard() {
				card.style.display = "flex";
				dock.__mediascapeDshCenter(card);
			}
			function collapseMini() {
				card.style.display = "none";
				closePicker();
			}
			function openPicker() {
				if (picker.classList.contains("open")) { closePicker(); return; }
				selected.clear();
				buildPicker();
				picker.classList.add("open");
				dock.__mediascapeDshCenter(picker);
			}
			function closePicker() { picker.classList.remove("open"); }

			function toggle() {
				if (list.length === 0) { openPicker(); return; }
				if (!audio.src) {
					let start = 0;
					const saved = localStorage.getItem(LS_MUSIC_ID);
					if (saved) { const idx = list.findIndex((m) => m.id === saved); if (idx >= 0) start = idx; }
					expandCard();
					loadAndPlay(start);
					return;
				}
				if (audio.paused) {
					audio.play().then(() => { playing = true; refresh(); }).catch(() => {});
				} else {
					audio.pause();
					playing = false;
					refresh();
				}
			}

			function shuffleCandidates() {
				if (randomPool.size === 0) return list;
				return list.filter((s) => randomPool.has(s.id));
			}
			function next() {
				if (list.length === 0) return;
				if (mode === "shuffle") {
					const arr = shuffleCandidates();
					if (arr.length === 0) return;
					let n = list.indexOf(arr[Math.floor(Math.random() * arr.length)]);
					if (arr.length > 1) {
						let guard = 0;
						while (n === current && guard++ < 40) n = list.indexOf(arr[Math.floor(Math.random() * arr.length)]);
					}
					loadAndPlay(n);
				} else {
					loadAndPlay(current + 1);
				}
			}
			function prev() { if (list.length === 0) return; loadAndPlay(current > 0 ? current - 1 : list.length - 1); }

			function cycleMode() {
				mode = mode === "single" ? "list" : mode === "list" ? "shuffle" : "single";
				localStorage.setItem(LS_MUSIC_MODE, mode);
				audio.loop = mode === "single";
				refresh();
			}
			function setMode(modeValue) {
				mode = modeValue;
				localStorage.setItem(LS_MUSIC_MODE, mode);
				audio.loop = mode === "single";
				refresh();
				if (mode === "shuffle" && list.length > 0) next();
			}

			function updatePickerActions() {
				const n = selected.size;
				pickerRemove.disabled = n === 0;
				pickerRemove.textContent = n > 0 ? "移除(" + n + ")" : "移除";
			}
			function buildPicker() {
				pickerList.innerHTML = "";
				if (list.length === 0) {
					const el = document.createElement("div");
					el.className = "mediascape-dsh-ms-empty";
					el.textContent = "暂无歌曲，点「＋添加」导入本机音乐";
					pickerList.appendChild(el);
					updatePickerActions();
					return;
				}
				list.forEach((item, i) => {
					const row = document.createElement("div");
					row.className = "mediascape-dsh-ms-item" + (selected.has(item.id) ? " checked" : "") + (i === current ? " active" : "");
					const cb = document.createElement("input");
					cb.type = "checkbox";
					cb.className = "mediascape-dsh-ms-check";
					cb.checked = selected.has(item.id);
					cb.title = "勾选后可用下方「移除」";
					cb.addEventListener("click", (e) => {
						e.stopPropagation();
						if (cb.checked) selected.add(item.id); else selected.delete(item.id);
						row.classList.toggle("checked", cb.checked);
						updatePickerActions();
					});
					const t = document.createElement("span");
					t.className = "ttl";
					t.textContent = (item.custom ? "★ " : "") + (item.label || item.id);
					row.appendChild(cb);
					row.appendChild(t);
					row.addEventListener("click", () => { loadAndPlay(i); closePicker(); });
					pickerList.appendChild(row);
				});
				updatePickerActions();
			}
			async function removeSelectedSongs() {
				const ids = [...selected];
				if (ids.length === 0) return;
				const removed = new Set(ids);
				const playingId = list[current] ? list[current].id : null;
				selected.clear();
				// 收集待删项（统一走公共 removeItems：开始前/结束后各一次 list 刷新 + 逐个 DELETE 服务端文件，
				// 封面由服务端 handleMusicDelete 一并删除）。带上 file/size（isItemUsable 校验需要）；
				// 音乐列表项 URL 字段是 url（非 data）——传 data: s.url 供 deleteServerFile 提取路径。
				const items = list.filter((s) => removed.has(s.id)).map((s) => ({ id: s.id, kind: "music", data: s.url, file: s.file, size: s.size }));
				for (const id of removed) randomPool.delete(id);
				saveIdSet(LS_MUSIC_RANDOM, randomPool);
				for (const id of removed) {
					const cc = coverCache.get(id);
					if (cc && /^blob:/.test(cc)) URL.revokeObjectURL(cc);
					coverCache.delete(id);
				}
				await removeItems(items);
				// 播放状态收尾（list 已被公共函数内 fillList 重建）
				if (list.length === 0) {
					audio.pause();
					audio.removeAttribute("src");
					audio.load();
					current = -1;
					playing = false;
					refresh();
				} else {
					const idx = playingId ? list.findIndex((s) => s.id === playingId) : -1;
					if (idx >= 0) current = idx;
					else if (playingId) { current = 0; loadAndPlay(0); } // 当前播放被删 → 从第一首继续
					else { current = Math.min(Math.max(current, 0), list.length - 1); refresh(); }
				}
				if (picker.classList.contains("open")) buildPicker();
			}

			// 2026-09-2x 删「＋添加」独立实现（addSong / __mediascapeDshAddMusicFiles）：
			// 上传入口统一收归 dock「传」→ 公共 uploadFiles（按后缀分流 + 去重跳过 + 串行 +
			// 前后 list 刷新内置）；音乐封面保留原设计（setCover 独立路径，自动按音乐重命名）。

			function setCover() {
				// 降载守卫：打开选择器前禁全局毛玻璃（安卓 SAF 崩溃，三处共用）
				const restoreGuard = PickerGuard();
				const song = list[current];
				if (!song) { restoreGuard(); return; }
				const input = document.createElement("input");
				input.type = "file";
				input.accept = "image/jpeg,image/png,image/webp";
				// 必须挂载 DOM 再 click（安卓静默拦截修复，与壁纸/音乐同款）
				input.style.display = "none";
				// 2026-09-22 上传不关闭面板修复：input.click() 冒泡到 document 会被「点外关闭」误判（同壁纸修复）
				input.addEventListener("click", (e) => e.stopPropagation(), true);
				document.body.appendChild(input);
				input.addEventListener("cancel", () => { input.remove(); restoreGuard(); });
				input.addEventListener("change", async () => {
					input.remove();
					restoreGuard();
					const file = input.files && input.files[0];
					if (!file) return;
					const ext = (file.name.split(".").pop() || "png").toLowerCase();
					// 真实落盘（2026-09-21 改）：fetch POST → 服务端落盘 music/<文件名去扩展名><ext>
					// + music.json[<文件名去扩展名>].cover 记录；resolveCover 优先读服务端同名封面 URL。
					try {
						// 2026-09-22 上传进度 HUD（封面上传，XHR onprogress）
						const hud = (window.__mediascapeDshUploadHud || { begin: () => ({ setLoaded() {}, done() {} }) })
							.begin("CV" + (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : String(Date.now()).slice(-8)), "封面 · " + file.name, file.size || 0);
						const xhr = new XMLHttpRequest();
						xhr.open("POST", "/theme-mediascape-assets/music/cover?id=" + encodeURIComponent(song.id) + "&ext=" + encodeURIComponent(ext));
						xhr.timeout = 120000;
						xhr.upload.onprogress = (e) => { if (e) hud.setLoaded(e.loaded, e.timeStamp); };
						const done = new Promise((resolve) => {
							xhr.onload = () => resolve(xhr.responseText);
							xhr.onerror = () => resolve(null);
							xhr.ontimeout = () => resolve(null);
							xhr.onabort = () => resolve(null);
						});
						xhr.send(file);
						const text = await done;
						const j = text ? JSON.parse(text) : null;
						hud.done(!!(j && j.ok));
						if (!j || !j.ok) { console.warn("[music] 封面上传失败:", j?.error || "no response"); return; }
						coverCache.set(song.id, j.url); // 直接用服务端 URL（稳定可寻址，跨刷新不失效）
						await fillList(); // 重新拉列表（cover 字段同步），resolveCover 命中服务端封面
						setCoverImage(j.url);
						btn.title = "已设置封面";
					} catch (e) { console.warn("[music] 封面上传异常:", e?.message ?? e); }
				});
				input.click();
			}

			audio.addEventListener("loadedmetadata", () => {
				seekEl.max = String(audio.duration || 0);
				timeDur.textContent = fmt(audio.duration);
			});
			audio.addEventListener("timeupdate", () => {
				if (!seeking) seekEl.value = String(audio.currentTime || 0);
				timeCur.textContent = fmt(audio.currentTime);
			});
			seekEl.addEventListener("input", () => { seeking = true; timeCur.textContent = fmt(parseFloat(seekEl.value)); });
			seekEl.addEventListener("change", () => { audio.currentTime = parseFloat(seekEl.value); seeking = false; });

			audio.addEventListener("ended", () => { if (!audio.loop) next(); });
			// 「乐」按钮状态机（2026-09-21 定）：
			//   面板关 + 点乐 → 开面板 + 播放（首次载入；暂停中恢复；播放中保持亮不变）
			//   面板开 + 播放中 → 暂停（面板保持开，不关）
			//   面板开 + 暂停   → 继续播放（面板保持开）
			//   点外面关面板不碰播放状态（见 onDocClick）
			btn.addEventListener("click", () => {
				if (list.length === 0) { openPicker(); return; }
				const panelOpen = card.style.display === "flex";
				if (!audio.src) {
					// 首次播放：开面板 + 载入并播放
					expandCard();
					let start = 0;
					const saved = localStorage.getItem(LS_MUSIC_ID);
					if (saved) { const idx = list.findIndex((m) => m.id === saved); if (idx >= 0) start = idx; }
					loadAndPlay(start);
					return;
				}
				if (!panelOpen) {
					// 面板关：开面板；若暂停则恢复播放（播放中保持亮不变）
					expandCard();
					if (audio.paused) audio.play().then(() => { playing = true; refresh(); }).catch(() => {});
					return;
				}
				// 面板开：播放中 → 暂停；暂停 → 继续播放（面板均不关）
				if (playing) { audio.pause(); playing = false; refresh(); }
				else { audio.play().then(() => { playing = true; refresh(); }).catch(() => {}); }
			});
			discEl.addEventListener("click", () => { if (list.length === 0) { openPicker(); return; } if (audio.src) toggle(); });
			card.querySelector('[data-act="prev"]').addEventListener("click", prev);
			playBtn.addEventListener("click", () => {
				if (list.length === 0) { openPicker(); return; }
				if (playing) { audio.pause(); playing = false; refresh(); }
				else { audio.play().then(() => { playing = true; refresh(); }).catch(() => {}); }
			});
			card.querySelector('[data-act="next"]').addEventListener("click", next);
			modeBtn.addEventListener("click", cycleMode);
			card.querySelector(".mediascape-dsh-music-close").addEventListener("click", collapseMini);
			shrinkBtn.title = "收起音乐面板"; shrinkBtn.addEventListener("click", collapseMini);
			card.querySelector('[data-act="select"]').addEventListener("click", openPicker);
			// 2026-09-23 删「＋添加」绑定：上传入口统一收归 dock「传」按钮
			card.querySelector('[data-act="cover"]').addEventListener("click", setCover);
			picker.querySelector(".mediascape-dsh-bg-close").addEventListener("click", closePicker);
			pickerRemove.addEventListener("click", removeSelectedSongs);

			// 二级面板点外自动收起：点音乐面板/歌单选择器外任意处即关闭面板。
			// 排除触发按钮自身（btn「乐」toggle、select「选择」openPicker）——它们各自处理，避免刚开就关。
			// 参照壁纸面板 onBgDocClick 同一语义。
			const onDocClick = (e) => {
				if (card.contains(e.target) || picker.contains(e.target)) return;
				if (e.target === btn || e.target === card.querySelector('[data-act="select"]')) return;
				closePicker();
				if (card.style.display === "flex") collapseMini();
			};
			document.addEventListener("click", onDocClick);

			ffIdbGetAll("covers").then((recs) => {
				for (const r of recs) if (r && r.id && r.cover) customCovers.set(r.id, URL.createObjectURL(r.cover));
				refresh();
			});
			ffIdbGetAll("music").then((recs) => {
				for (const r of recs) {
					if (!r || !r.file) continue;
					const url = URL.createObjectURL(r.file);
					list.push({ id: r.id, mime: r.file.type || "audio/mpeg", data: url, label: r.label || r.id, custom: true, file: r.file });
				}
				buildPicker();
				refresh();
			});

			refresh();
			// 异步拉取服务端音乐列表并填充（按钮/面板已同步挂载，不阻塞 dock 渲染）
			fillList();
			// ESC 收起：关闭展开的音乐面板
			dock.__mediascapeDshMusicEscape = () => { if (card.style.display === "flex") collapseMini(); };
			return () => {
				audio.pause();
				audio.src = "";
				document.removeEventListener("click", onDocClick);
				delete dock.__mediascapeDshMusicEscape;
				btn.remove();
				card.remove();
				picker.remove();
			};
		}

