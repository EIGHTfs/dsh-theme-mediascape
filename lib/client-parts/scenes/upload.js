			// ── 文件选择器降载守卫（共用）→ 已提升到 foundation/utils.js 模块级 ──
			// 原定义在此（startWallpaper 函数体内）时，startMusic 内 addSong/setCover 调用
			// PickerGuard() 抛 ReferenceError（作用域不可见）→ 音乐「＋添加/封面」点击无反应。
			// 2026-09-21 修复：定义移往 utils.js 模块级，startWallpaper 与 startMusic 共用。

			// 2026-09-23 魔数命名化（审计 magic-number-smart）
		// 2026-09-2x 删 XHR 整体超时（UPLOAD_XHR_TIMEOUT_MS 120s）：大文件/慢速上传超过整体超时会被
		// xhr.ontimeout 掐断 → 服务端落 .part 快照（实测 470MB 火花 PV 就是被 120s 超时中断）。
		// 上传中进度流动就不该中断；连接断开由 onerror/onabort 兜底，挂起可由用户暂停/取消。
		// 2026-09-2x 改：壁纸/音乐上传统一公共函数 uploadFiles（下方定义）——暂停落 .part、
		// 继续 offset 续传、取消清 .part、去重「文件名+大小」预检走 HUD「已跳过」、前后 list 刷新内置。
		const ADDED_PREFIX = "已添加 "; // 批量上传结果提示前缀（壁纸 after 钩子用）

			window.__mediascapeDshOpenUploadPicker = () => {
				const restoreGuard = PickerGuard();
				const input = document.createElement("input");
				input.type = "file";
				input.multiple = true;
				input.style.display = "none";
				input.addEventListener("click", (e) => e.stopPropagation(), true); // 防「点外关闭」误判（同壁纸修复）
				document.body.appendChild(input);
				// accept：服务端壁纸允许扩展名 + 音乐音频扩展名（单一权威源合并，按后缀过滤）
				const wallAccept = (/*__UPLOAD_ACCEPT_START__*/".png,.jpg,.jpeg,.webp,.mp4"/*__UPLOAD_ACCEPT_END__*/);
				input.accept = wallAccept + ",.mp3,.ogg,.m4a,.wav,.flac";
				input.addEventListener("cancel", () => { input.remove(); restoreGuard(); });
				input.addEventListener("change", async () => {
					input.remove();
					restoreGuard();
					const files = Array.from(input.files || []);
					if (!files.length) return;
					await uploadFiles(files);
				});
				input.click();
			};

			// 暴露景面板引用给后续片段（ambience.js 将氛围档位行嵌入面板；无面板则退化为 dock 内隐藏行）
			dock.__mediascapeDshBgPanel = panel;
			// 壁纸开/关（2026-09-22 景/开屏改造）：面板新增「壁纸：开/关」按钮行，
			// 控制整个壁纸层启停（不铺任何媒体，恢复宿主默认底）。「景」dock 高亮跟随本开关，不再跟面板开合。
			// 面板行与 dock 按钮状态同步：开=亮（强调）/关=暗。
			function syncBgEnabledUI() {
				btn.classList.toggle("on", bgEnabled);
				// 注意：btn.title 由 renderLayers 维护（「视频：x / 图片：x / 壁纸（已关闭）」），此处不覆盖
				const bgLineBtn = panel.querySelector("[data-bg-enabled]");
				if (bgLineBtn) {
					bgLineBtn.classList.toggle("active", bgEnabled);
					bgLineBtn.textContent = bgEnabled ? "开" : "关";
					bgLineBtn.title = bgEnabled ? "当前：壁纸开启" : "当前：壁纸关闭";
				}
			}
			function setBgEnabled(on) {
				if (bgEnabled === !!on) return;
				bgEnabled = !!on;
				try { localStorage.setItem(LS_BG_ENABLED, bgEnabled ? "1" : "0"); } catch (e) { /* localStorage 异常（配额/隐私模式）可忽略 */ }
				renderLayers();
				syncBgEnabledUI();
				logSwitch({ event: "enabled", on: bgEnabled }); // 开关日志（wallpaper.log 可查证）
			}
			btn.addEventListener("click", () => {
				panel.classList.toggle("open");
				if (panel.classList.contains("open")) {
					dock.__mediascapeDshCenter(panel);
					// 打开面板即刷新自定义壁纸列表：其他设备新上传无需刷新网页即可看到（跨设备即时可见）。
					loadCustomWallpapers(true);
				}
				// 按钮高亮不再跟随面板开关（V2 改造）：dock .on 只表示壁纸启用状态，由 syncBgEnabledUI 维护
			});
			// 二级面板点外自动收起：点面板/选择器外任意处即关闭（参照萤火氛围菜单 onDocClick 模式）。
			// 排除触发按钮自身（btn「景」）——它已 toggle panel，避免刚开就关。
			const onBgDocClick = (e) => {
				if (panel.contains(e.target) || picker.contains(e.target)) return;
				if (e.target === btn) return;
				closePanel();
				closePicker();
				// 不再 remove("on")：dock 高亮 = 壁纸启用状态，与面板开合无关
			};
			document.addEventListener("click", onBgDocClick);
			panel.querySelector("[data-bg-enabled]").addEventListener("click", () => setBgEnabled(!bgEnabled)); // 壁纸总开关：开=渲染壁纸层，关=恢复宿主默认底
			videoToggleBtn.addEventListener("click", () => toggleVideo(!videoOn)); // 暗=图片，高亮=视频，点击切换
			// 2026-09-22 三按钮合一：单按钮点击按 循环→顺序→随机 循环切换（MODE_CYCLE 定义在 wallpaper.js 片段）
			modeCycleBtn.addEventListener("click", () => {
				const next = MODE_CYCLE[(MODE_CYCLE.indexOf(mode) + 1) % MODE_CYCLE.length] || "single";
				setMode(next);
			});
			intervalInput.addEventListener("change", () => setIntervalMinutes(intervalInput.value));
			panel.querySelector(".mediascape-dsh-bg-ok").addEventListener("click", closePanel);
			// 2026-09-23 删「＋添加壁纸」绑定（按钮已移除）：上传入口统一收归 dock「传」按钮
			panel.querySelector(".mediascape-dsh-bg-pick").addEventListener("click", openPicker);
			picker.querySelector(".mediascape-dsh-bg-close").addEventListener("click", closePicker);
			pickerRemove.addEventListener("click", removeSelected);
			// 2026-09-22 去掉随机按钮：原 pickerRandom.addEventListener("click", applyRandomPool); 已移除

			// 初始化 UI
			intervalInput.value = interval;
			syncModeBtn(); // 单按钮文字/高亮跟随当前 mode（替代三按钮三处 toggle）
			updateIntervalLine();

			// 恢复上次壁纸（双层语义 2026-09-21 改）：
			//   图片层常驻：优先 LS_BG（图片 id）→ 默认壁纸（Default* 图片）→ imgs[0]
			//   视频层可选：LS_BG_VIDEO=="1" 且 LS_BG_VID 有效 → 开视频层并恢复该视频；否则关
			function defaultWallpaper() {
				const list = imgs; // 双层改：默认壁纸只从图片层找（图片常驻基底）
				return list.find((w) => /(^|[-_ ])default([-_ ]|$)/i.test(w.id))
					|| null;
			}

			async function initWallpaper() {
				await loadCustomWallpapers();
				// 图片层（常驻）：LS_BG → 默认 → 第一张
				let imgItem = null;
				const savedImg = localStorage.getItem(LS_BG);
				if (savedImg) {
					const found = imgs.find((w) => w.id === savedImg);
					if (found) imgItem = found;
				}
				if (!imgItem) imgItem = defaultWallpaper() || imgs[0] || null;
				if (imgItem) imgIndex = Math.max(0, imgs.indexOf(imgItem));
				// 视频层（覆盖）：LS_BG_VIDEO=="1" 且能恢复 LS_BG_VID → 开
				videoOn = localStorage.getItem(LS_BG_VIDEO) === "1";
				if (videoOn) {
					const savedVid = localStorage.getItem(LS_BG_VID);
					const found = savedVid ? vids.find((w) => w.id === savedVid) : null;
					if (found) vidIndex = Math.max(0, vids.indexOf(found));
					else if (vids.length) vidIndex = 0;
					else videoOn = false; // 无视频可恢复 → 关视频层
				}
				renderLayers();
				// 上次是随机模式则恢复自动切换（作用于当前层：视频开→ended 驱动；关→图片分钟定时）
				if (mode === "random") scheduleRandom();
			}
			initWallpaper();
			// 开屏 file:"auto" 移交就绪回调（2026-09-22 用户新机制）：boot finish 挂出同一份流式 video 后触发，
			// 壁纸层 renderLayers 接走（目标视频 id 匹配 → 复用元素保留 src，不重新发 Range 请求，流式数据同一份）
			window.__mediascapeDshBootVideoReady = () => { renderLayers(); };
			// pending 变更通知（boot 解析完 auto 后触发）：壁纸层可能已先自建同 URL video（初始渲染早于 boot fetch），
			// 收到通知立即重渲染 → 移除自建、改等移交（防止自建视频 ended→switch 把 id 切走，消费不掉移交）
			window.__mediascapeDshBootVideoPendingChanged = () => { renderLayers(); };

			return () => {
				clearRandom();
				document.removeEventListener("click", onBgDocClick);
				bg.remove(); shade.remove(); btn.remove(); panel.remove(); picker.remove();
			};
		}

