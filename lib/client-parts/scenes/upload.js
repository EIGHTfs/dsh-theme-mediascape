			function addWallpaper() {
				const input = document.createElement("input");
				input.type = "file";
				// accept 单一权威 = 服务端 config.js 的 ALLOWED_UPLOAD_EXT：
				// 先以 build 注入值（占位符，与 config.js 派生一致）为初始值，随后拉取
				// GET /config 用服务端最新值覆盖——改允许扩展名只改 lib/config.js 一处，
				// 选择器与服务端校验自动同步（异步返回前也有合理默认，不阻塞用户操作）。
				input.accept = /*__UPLOAD_ACCEPT_START__*/".png,.jpg,.jpeg,.webp,.mp4"/*__UPLOAD_ACCEPT_END__*/;
				fetch(WALLPAPER_API + "/config").then((r) => r.json()).then((cfg) => {
					if (cfg && cfg.ok && cfg.uploadAccept) input.accept = cfg.uploadAccept;
				}).catch(() => {});
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
						// traceId：一次上传一个 id，贯穿客户端→服务端日志，便于联排
						const traceId = (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : String(Date.now()).slice(-8));
						console.log(`[upload][${traceId}] begin file=${file.name} size=${file.size} kind=${kind}`);
						// 上传到服务器磁盘（raw body + ?name= 显示名），成功后用服务器 URL。
						// 服务端：落盘 = SHA-1 hash 名（内容寻址，同内容天然一份）；显示名存 .labels.json
						// （hash → 原始文件名去扩展名，名称永远取最新一次）；json 兼具重复判断——同 hash
						// 已存在即复用不重写盘（existing:true），换名再传同内容只更新显示名。
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
							console.error(`[upload][${traceId}] network error:`, e?.message ?? e);
						}
						if (!up || !up.ok) {
							console.warn(`[upload][${traceId}] failed status=${respStatus} body=${JSON.stringify(up ?? null)}`);
							failed++; continue; // 上传失败：提示在下方统一给出
						}
						console.log(`[upload][${traceId}] done existing=${up.existing} id=${up.id} label=${up.label} status=${respStatus}`);
						customKeys.add(key);
						if (up.existing) {
							// 同内容已存在：服务器复用了既有文件（未落新盘），列表用服务端原始名对齐。
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

			// 暴露景面板引用给后续片段（ambience.js 将氛围档位行嵌入面板；无面板则退化为 dock 内隐藏行）
			dock.__ffBgPanel = panel;
			btn.addEventListener("click", () => {
				panel.classList.toggle("open");
				if (panel.classList.contains("open")) {
					dock.__ffCenter(panel);
					// 打开面板即刷新自定义壁纸列表：其他设备新上传无需刷新网页即可看到（跨设备即时可见）。
					loadCustomWallpapers(true);
				}
				// 按钮高亮跟随面板开关：开=亮（强调），关=暗
				btn.classList.toggle("on", panel.classList.contains("open"));
			});
			// 二级面板点外自动收起：点面板/选择器外任意处即关闭（参照萤火氛围菜单 onDocClick 模式）。
			// 排除触发按钮自身（btn「景」）——它已 toggle panel，避免刚开就关。
			const onBgDocClick = (e) => {
				if (panel.contains(e.target) || picker.contains(e.target)) return;
				if (e.target === btn) return;
				closePanel();
				closePicker();
				btn.classList.remove("on");
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

