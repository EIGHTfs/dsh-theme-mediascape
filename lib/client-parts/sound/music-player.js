			function fmt(t) {
				if (!isFinite(t) || t < 0) t = 0;
				t = Math.floor(t);
				const m = Math.floor(t / 60), s = t % 60;
				return m + ":" + (s < 10 ? "0" : "") + s;
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
							const c = coverCache.get(item.id);
							if (c) setCoverImage(c);
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
				const item = list[current];
				titleEl.textContent = item ? "♪ " + (item.label || item.id) : "—";
				updateDisc(item);
			}

			function loadAndPlay(i) {
				if (list.length === 0) return;
				current = ((i % list.length) + list.length) % list.length;
				const item = list[current];
				seekEl.value = "0";
				timeCur.textContent = "0:00";
				timeDur.textContent = "0:00";
				audio.src = item.url || item.data;
				audio.loop = mode === "single";
				audio.play().then(() => { playing = true; refresh(); }).catch(() => { playing = false; refresh(); });
				if (item.id) localStorage.setItem(LS_MUSIC_ID, item.id);
				refresh();
			}

			function expandCard() {
				if (mini.contains(discWrap)) {
					card.insertBefore(discWrap, transportRow);
					card.insertBefore(seekRow, transportRow);
				}
				mini.classList.remove("open");
				card.style.display = "flex";
				dock.__ffCenter(card);
			}
			function collapseMini() {
				card.style.display = "none";
				closePicker();
				const anchor = miniBar;
				if (!mini.contains(discWrap)) mini.insertBefore(discWrap, anchor);
				if (!mini.contains(seekRow)) mini.insertBefore(seekRow, anchor);
				mini.classList.add("open");
			}
			function openPicker() {
				if (picker.classList.contains("open")) { closePicker(); return; }
				selected.clear();
				buildPicker();
				picker.classList.add("open");
				dock.__ffCenter(picker);
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
			function setMode(m) {
				mode = m;
				localStorage.setItem(LS_MUSIC_MODE, mode);
				audio.loop = mode === "single";
				refresh();
				if (mode === "shuffle" && list.length > 0) next();
			}

			function updatePickerActions() {
				const n = selected.size;
				pickerRemove.disabled = n === 0;
				pickerRandom.disabled = n === 0;
				pickerRemove.textContent = n > 0 ? "移除(" + n + ")" : "移除";
				pickerRandom.textContent = n > 0 ? "随机(" + n + ")" : "随机";
			}
			function buildPicker() {
				pickerList.innerHTML = "";
				if (list.length === 0) {
					const d = document.createElement("div");
					d.className = "ff-ms-empty";
					d.textContent = "暂无歌曲，点「＋添加」导入本机音乐";
					pickerList.appendChild(d);
					updatePickerActions();
					return;
				}
				list.forEach((item, i) => {
					const row = document.createElement("div");
					row.className = "ff-ms-item" + (selected.has(item.id) ? " checked" : "") + (i === current ? " active" : "");
					const cb = document.createElement("input");
					cb.type = "checkbox";
					cb.className = "ff-ms-check";
					cb.checked = selected.has(item.id);
					cb.title = "勾选后可用下方「移除 / 随机」";
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
			function removeSelectedSongs() {
				const ids = [...selected];
				if (ids.length === 0) return;
				const removed = new Set(ids);
				const curId = list[current] ? list[current].id : null;
				const kept = [];
				for (const item of list) {
					if (removed.has(item.id)) {
						if (item.custom) ffIdbDelete("music", item.id);
						else hidden.add(item.id);
						randomPool.delete(item.id);
						if (item.data && /^blob:/.test(item.data)) URL.revokeObjectURL(item.data);
						const cc = coverCache.get(item.id);
						if (cc && /^blob:/.test(cc)) URL.revokeObjectURL(cc);
						coverCache.delete(item.id);
					} else {
						kept.push(item);
					}
				}
				list.length = 0;
				Array.prototype.push.apply(list, kept);
				saveIdSet(LS_MUSIC_HIDDEN, hidden);
				saveIdSet(LS_MUSIC_RANDOM, randomPool);
				selected.clear();
				if (list.length === 0) {
					audio.pause();
					audio.removeAttribute("src");
					audio.load();
					current = -1;
					playing = false;
					refresh();
				} else {
					const still = curId && list.some((s) => s.id === curId);
					current = still ? list.findIndex((s) => s.id === curId) : 0;
					if (!still) loadAndPlay(current);
					else refresh();
				}
				if (picker.classList.contains("open")) buildPicker();
			}
			function applyRandomPool() {
				if (selected.size === 0) return;
				randomPool.clear();
				for (const id of selected) if (list.some((s) => s.id === id)) randomPool.add(id);
				saveIdSet(LS_MUSIC_RANDOM, randomPool);
				selected.clear();
				closePicker();
				setMode("shuffle");
			}

			function addSong() {
				const input = document.createElement("input");
				input.type = "file";
				input.multiple = true;
				input.accept = "audio/*,.mp3,.ogg,.m4a,.wav,.flac";
				input.addEventListener("change", async () => {
					const files = Array.from(input.files || []);
					if (!files.length) return;
					const mimeMap = { mp3: "audio/mpeg", ogg: "audio/ogg", m4a: "audio/mp4", wav: "audio/wav", flac: "audio/flac" };
					for (const file of files) {
						const ext = (file.name.split(".").pop() || "").toLowerCase();
						if (!/^audio\//.test(file.type) && !mimeMap[ext]) continue;
						// 内容寻址 id：纯 JS SHA-1（http 下 crypto.subtle 不可用），40 位 hex 作键。
						// 同内容歌曲自动去重：已存在则只更新名字（label），不重复入库。
						const id = sha1Hex(await file.arrayBuffer());
						const url = URL.createObjectURL(file);
						const label = file.name.replace(/\.[^.]+$/, "");
						const existing = list.find((x) => x.id === id);
						if (existing) {
							existing.label = label;
							await ffIdbPut("music", { id, file, label });
							btn.title = "已重命名歌曲：" + file.name;
							continue;
						}
						list.push({ id, mime: file.type || mimeMap[ext], data: url, label, custom: true, file });
						await ffIdbPut("music", { id, file, label });
						btn.title = "已添加歌曲：" + file.name;
					}
					buildPicker();
					refresh();
					if (!audio.src && list.length) loadAndPlay(0);
				});
				input.click();
			}

			function setCover() {
				const item = list[current];
				if (!item) return;
				const input = document.createElement("input");
				input.type = "file";
				input.accept = "image/jpeg,image/png,image/webp";
				input.addEventListener("change", async () => {
					const file = input.files && input.files[0];
					if (!file) return;
					const url = URL.createObjectURL(file);
					await ffIdbPut("covers", { id: item.id, cover: file });
					const old = customCovers.get(item.id);
					if (old && /^blob:/.test(old)) URL.revokeObjectURL(old);
					customCovers.set(item.id, url);
					coverCache.set(item.id, url);
					setCoverImage(url);
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
			card.querySelector(".ff-music-close").addEventListener("click", collapseMini);
			shrinkBtn.title = "收起为迷你播放器（保留唱片与进度）"; shrinkBtn.addEventListener("click", collapseMini);
			miniExpand.addEventListener("click", expandCard);
			miniDiscToggle.addEventListener("click", () => {
				const compact = mini.classList.toggle("compact");
				miniDiscToggle.textContent = compact ? "显示封面" : "隐藏封面";
				miniDiscToggle.title = compact ? "显示唱片与封面" : "隐藏唱片与封面，只保留进度条";
			});
			card.querySelector('[data-act="select"]').addEventListener("click", openPicker);
			card.querySelector('[data-act="add"]').addEventListener("click", addSong);
			card.querySelector('[data-act="cover"]').addEventListener("click", setCover);
			picker.querySelector(".ff-bg-close").addEventListener("click", closePicker);
			pickerRemove.addEventListener("click", removeSelectedSongs);
			pickerRandom.addEventListener("click", applyRandomPool);

			// 二级面板点外自动收起：点音乐面板/歌单选择器外任意处即收起为迷你播放器。
			// 排除触发按钮自身（btn「乐」toggle、select「选择」openPicker）——它们各自处理，避免刚开就关。
			// 参照萤火氛围菜单 onDocClick 模式 + 壁纸面板 onBgDocClick 同一语义。
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
			// ESC 收起：只把「展开面板」折叠成迷你播放器，不关闭迷你播放器
			dock.__ffMusicEscape = () => { if (card.style.display === "flex") collapseMini(); };
			return () => {
				audio.pause();
				audio.src = "";
				document.removeEventListener("click", onDocClick);
				delete dock.__ffMusicEscape;
				btn.remove();
				card.remove();
				picker.remove();
				mini.remove();
			};
		}

