			function addWallpaper() {
				const input = document.createElement("input");
				input.type = "file";
				input.accept = "image/jpeg,image/png,image/webp,video/mp4";
				input.multiple = true; // Windows 文件窗：可一次框选/按住 Ctrl 多选
				input.addEventListener("change", async () => {
					const files = Array.from(input.files || []);
					if (files.length === 0) return;
					let last = null, added = 0, failed = 0;
					for (const file of files) {
						const okType = /^image\/(jpeg|png|webp)$/.test(file.type) || /^video\/mp4$/.test(file.type);
						if (!okType) { failed++; continue; }
						const key = file.name + ":" + file.size;
						if (customKeys.has(key)) continue; // 同名同大小视为重复，跳过
						const kind = file.type.startsWith("video") ? "video" : "image";
						// 上传到服务器磁盘（raw body + ?name= 文件名），成功后用服务器 URL。
						// 注意：customKeys.add 在成功后才执行——失败不占位，用户可重试同一文件。
						let up;
						let respStatus = 0;
						try {
							// 120s 超时中断：大文件(数百MB)上传若因网络/后端卡住，不再无限挂起
							const ctrl = new AbortController();
							const timer = setTimeout(() => ctrl.abort(), 120000);
							try {
								const resp = await fetch(WALLPAPER_API + "/upload?name=" + encodeURIComponent(file.name), {
									method: "POST",
									body: file,
									signal: ctrl.signal,
								});
								respStatus = resp.status;
								up = await resp.json();
							} finally {
								clearTimeout(timer);
							}
						} catch (e) {
							up = null;
						}
						if (!up || !up.ok) { failed++; continue; } // 上传失败：提示在下方统一给出
						customKeys.add(key);
						if (up.existing) {
							// 同内容已存在：服务器复用了既有文件（未落新盘），仅把文件名映射改为本次名。
							// 列表就地改名并对齐服务器结果，不重复 push 一条（服务器 hash 键是去重权威）。
							const arr = (up.kind || kind) === "video" ? vids : imgs;
							const hit = arr.find((x) => x.id === up.id);
							if (hit) { hit.label = up.label || file.name; last = hit; }
							else {
								const item = { id: up.id, kind: up.kind || kind, data: up.url, label: up.label || file.name, custom: true };
								arr.push(item);
								last = item;
							}
							added++;
							continue;
						}
						const item = { id: up.id, kind: up.kind || kind, data: up.url, label: up.label || file.name, custom: true };
						if (item.kind === "video") vids.push(item); else imgs.push(item);
						last = item;
						added++;
					}
					typeBtns.video.disabled = vids.length === 0;
					typeBtns.image.disabled = imgs.length === 0;
					if (last) {
						if (last.kind === "video") { activeType = "video"; showByIndex("video", vids.indexOf(last)); }
						else { activeType = "image"; showByIndex("image", imgs.indexOf(last)); }
						btn.title = added > 1 ? "已添加 " + added + " 张壁纸" : "已添加壁纸：" + last.label;
					}
					if (failed > 0) {
						btn.title = added > 0 ? ("已添加 " + added + "，失败 " + failed + "（服务器不可达或类型不支持）") : ("添加失败 " + failed + " 个文件");
					}
				});
				input.click();
			}

			btn.addEventListener("click", () => {
				panel.classList.toggle("open");
				if (panel.classList.contains("open")) dock.__ffCenter(panel);
			});
			// 二级面板点外自动收起：点面板/选择器外任意处即关闭（参照萤火氛围菜单 onDocClick 模式）。
			// 排除触发按钮自身（btn「景」）——它已 toggle panel，避免刚开就关。
			const onBgDocClick = (e) => {
				if (panel.contains(e.target) || picker.contains(e.target)) return;
				if (e.target === btn) return;
				closePanel();
				closePicker();
			};
			document.addEventListener("click", onBgDocClick);
			typeBtns.video.addEventListener("click", () => pickType("video"));
			typeBtns.image.addEventListener("click", () => pickType("image"));
			modeBtns.single.addEventListener("click", () => setMode("single"));
			modeBtns.switch.addEventListener("click", () => setMode("switch"));
			modeBtns.random.addEventListener("click", () => setMode("random"));
			intervalInput.addEventListener("change", () => setIntervalMinutes(intervalInput.value));
			panel.querySelector(".ff-bg-ok").addEventListener("click", closePanel);
			panel.querySelector(".ff-bg-add").addEventListener("click", addWallpaper);
			panel.querySelector(".ff-bg-pick").addEventListener("click", openPicker);
			picker.querySelector(".ff-bg-close").addEventListener("click", closePicker);
			pickerRemove.addEventListener("click", removeSelected);
			pickerRandom.addEventListener("click", applyRandomPool);

			// 初始化 UI
			intervalInput.value = interval;
			modeBtns.single.classList.toggle("active", mode === "single");
			modeBtns.switch.classList.toggle("active", mode === "switch");
			modeBtns.random.classList.toggle("active", mode === "random");

			// 恢复上次壁纸；首次安装（无记录）时优先「默认壁纸」（Default*），否则第一张可用
			function defaultWallpaper() {
				const list = vids.concat(imgs);
				return list.find((w) => /(^|[-_ ])default([-_ ]|$)/i.test(w.id) && w.kind === "image")
					|| list.find((w) => /(^|[-_ ])default([-_ ]|$)/i.test(w.id))
					|| null;
			}

			async function initWallpaper() {
				await loadCustomWallpapers();
				let startItem = defaultWallpaper() || vids[0] || imgs[0] || null;
				const saved = localStorage.getItem(LS_BG);
				if (saved) {
					const found = vids.concat(imgs).find((w) => w.id === saved);
					if (found) startItem = found;
				}
				if (startItem) {
					if (startItem.kind === "video") vidIndex = Math.max(0, vids.indexOf(startItem));
					else imgIndex = Math.max(0, imgs.indexOf(startItem));
				}
				render(startItem);
				// 上次是随机模式则恢复自动切换
				if (mode === "random") scheduleRandom();
			}
			initWallpaper();

			return () => {
				clearRandom();
				document.removeEventListener("click", onBgDocClick);
				bg.remove(); shade.remove(); btn.remove(); panel.remove(); picker.remove();
			};
		}

