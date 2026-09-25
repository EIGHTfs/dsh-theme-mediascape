		// ═══════════ 5. 壁纸系统（类型选择 + 切换/随机 + 随机间隔）═══════════
		function startWallpaper(dock) {
			const all = Array.isArray(WALLPAPERS) ? WALLPAPERS : [];
			const LS_BG_RANDOM = "mediascape-dsh-bg-random";
			// 壁纸启用状态（2026-09-22 V2 景/开屏改造）：dock「景」高亮跟随本开关（不再跟面板开合）。
			// localStorage 持久化，缺省=开（老行为不变）；关 = 不铺任何壁纸媒体，恢复宿主默认底。
			const LS_BG_ENABLED = "mediascape-dsh-bg-enabled";
			let bgEnabled = localStorage.getItem(LS_BG_ENABLED) !== "0";
			function loadIdSet(key) {
				try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); }
				catch (e) { return new Set(); }
			}
			function saveIdSet(key, set) {
				try { localStorage.setItem(key, JSON.stringify([...set])); } catch (e) { /* localStorage 异常（配额/隐私模式）可忽略 */ }
			}
			// 2026-09-2x 删 hidden 死代码：壁纸移除=真实删除服务端文件（列表来自服务端扫描，
			// 删除后自然消失），不再有「内置隐藏名单」机制（loadCustomWallpapers 重建时也不过滤）。
			const randomPool = loadIdSet(LS_BG_RANDOM); // 随机展示的勾选池（空=全部）
			const vids = all.filter((w) => w.kind === "video");
			const imgs = all.filter((w) => w.kind === "image");

			const bg = document.createElement("div");
			bg.className = "mediascape-dsh-bg";
			// 蒙雾层 .mediascape-dsh-bg-shade 已移除：中间背景不铺主题色，壁纸原样透出（组件仍随主题换色）
			document.body.append(bg);

			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "mediascape-dsh-bg-toggle mediascape-dsh-dock-btn";
			btn.textContent = "景";
			btn.title = "壁纸设置";
			dock.appendChild(btn);

			const panel = document.createElement("div");
			panel.className = "mediascape-dsh-bg-panel";
			panel.innerHTML =
				'<div class="mediascape-dsh-bg-title">壁纸设置</div>' +
				'<div class="mediascape-dsh-bg-line"><span class="mediascape-dsh-bg-label">壁纸</span>' +
					'<button class="mediascape-dsh-bg-seg" data-bg-enabled type="button">开</button></div>' +
				'<div class="mediascape-dsh-bg-line"><span class="mediascape-dsh-bg-label">模式</span>' +
					'<button class="mediascape-dsh-bg-seg" data-video-toggle type="button">视频</button></div>' +
				'<div class="mediascape-dsh-bg-line"><span class="mediascape-dsh-bg-label">模式</span>' +
					// 2026-09-22 三按钮合一：循环/顺序/随机 → 单按钮，点击循环切换，文字显示当前模式
					'<button class="mediascape-dsh-bg-seg" data-mode-cycle type="button" title="点击切换模式">循环</button></div>' +
				'<div class="mediascape-dsh-bg-line" id="mediascape-dsh-bg-interval-line"><span class="mediascape-dsh-bg-label">间隔</span>' +
					'<input class="mediascape-dsh-bg-interval" type="number" min="1" max="1440" step="1">' +
					'<span class="mediascape-dsh-bg-unit">分钟</span></div>' +
				'<div class="mediascape-dsh-bg-row2">' +
					// 2026-09-23 删「＋ 添加壁纸」：上传入口统一收归 dock「传」按钮（视频/图片/音乐一次多选）
					'<button class="mediascape-dsh-bg-pick" type="button">选择壁纸</button>' +
				'</div>' +
				'<button class="mediascape-dsh-bg-ok" type="button">确定</button>';
			dock.appendChild(panel);

			// 壁纸选择器（点击「选择」弹出，缩略图网格点选，支持勾选后移除/随机）
			const picker = document.createElement("div");
			picker.className = "mediascape-dsh-bg-picker";
			picker.innerHTML =
				'<div class="mediascape-dsh-bg-picker-head">' +
					'<div class="mediascape-dsh-bg-picker-title">选择壁纸</div>' +
					'<button class="mediascape-dsh-bg-close" type="button" title="收起">—</button>' +
				'</div>' +
				'<div class="mediascape-dsh-bg-picker-list"></div>' +
				'<div class="mediascape-dsh-bg-picker-actions">' +
					// 2026-09-22 去掉随机按钮（选择壁纸只保留移除）；随机模式走面板顶部模式按钮
					// '随机' 按钮原在移除旁：'<button class="mediascape-dsh-bg-act mediascape-dsh-bg-random" type="button">随机</button>' +
					'<button class="mediascape-dsh-bg-act mediascape-dsh-bg-remove" type="button">移除</button>' +
				'</div>';
			dock.appendChild(picker);
			const pickerTitle = picker.querySelector(".mediascape-dsh-bg-picker-title");
			const pickerList = picker.querySelector(".mediascape-dsh-bg-picker-list");
			const pickerRemove = picker.querySelector(".mediascape-dsh-bg-remove");
			// 2026-09-22 去掉随机按钮：原 const pickerRandom = picker.querySelector(".mediascape-dsh-bg-random"); 已移除

			// 「视频壁纸」开关（单个按钮，暗=图片模式 / 高亮=视频覆盖模式）：
			// 点击在两种模式间切换——视频开则加载视频覆盖图片显示，关则只显示图片层。
			const videoToggleBtn = panel.querySelector('[data-video-toggle]');
			// 2026-09-22 三按钮合一：single/switch/random → 单按钮（data-mode-cycle），点击循环切换
			const modeBtns = {
				single: panel.querySelector('[data-mode-cycle]'),
				switch: panel.querySelector('[data-mode-cycle]'),
				random: panel.querySelector('[data-mode-cycle]'),
			};
			const modeCycleBtn = panel.querySelector('[data-mode-cycle]');
			// 单按钮模式：文字显示当前模式，点击按 循环→顺序→随机 循环切换。
			// 2026-09-22 改命名：视频模式 single 叫「循环」（视频循环播放）；图片模式 single 叫「固定」
			// （固定显示该图不切换）。文案随当前媒体类型动态取。
			const MODE_LABELS = { single: "循环", switch: "顺序", random: "随机" };
			const MODE_LABELS_IMG = { single: "固定", switch: "顺序", random: "随机" }; // 图片模式 single 改叫「固定」
			const MODE_CYCLE = ["single", "switch", "random"];
			function syncModeBtn() {
				const labels = videoOn ? MODE_LABELS : MODE_LABELS_IMG;
				modeCycleBtn.textContent = labels[mode] || labels.single;
				modeCycleBtn.classList.toggle("active", true); // 单按钮常显高亮（当前模式即按钮自身）
				modeCycleBtn.title = "当前：" + (labels[mode] || labels.single) + "（点击切换）";
			}
			const intervalInput = panel.querySelector(".mediascape-dsh-bg-interval");
			const intervalLine = panel.querySelector("#mediascape-dsh-bg-interval-line");

			// 间隔（分钟）显示规则（2026-09-22 更正）：图片模式仅「固定」隐藏间隔行，
			// 顺序/随机都显示（顺序按间隔轮换、随机按间隔随机）；视频模式恒隐藏（视频由播完驱动 ended 切，
			// 不按分钟打断）。
			function updateIntervalLine() {
				intervalLine.style.display = (!videoOn && mode !== "single") ? "flex" : "none";
			}

			function updateVideoToggle() {
				// 高亮 = 视频模式开启（视频覆盖）；暗 = 图片模式
				videoToggleBtn.classList.toggle("active", videoOn);
				videoToggleBtn.disabled = vids.length === 0; // 无视频素材时不可切到视频模式
				// 按钮标题跟随状态（亮=视频 / 暗=图片，2026-09-22 改）：标题在「视频」「图片」两词间切换
				videoToggleBtn.textContent = videoOn ? "视频" : "图片";
				videoToggleBtn.title = videoOn ? "当前：视频壁纸" : "当前：图片壁纸";
			}

			let vidIndex = 0, imgIndex = 0, videoOn = false;
			let mode = localStorage.getItem(LS_BG_MODE) || "switch";
			let interval = parseInt(localStorage.getItem(LS_BG_INTERVAL) || "5", 10) || 5;
			let randomTimer = null;
			let currentImgId = null; // 图片层当前 id（常驻层，LS_BG）
			let currentVidId = null; // 视频层当前 id（覆盖层，LS_BG_VID）
			const selected = new Set();      // 选择面板里的勾选（移除/随机 共用的临时选择）
			// 2026-09-23 去重简化为「上传前查服务端列表（文件名+大小双比较）」——不再用本地 customKeys
			// 持久化（删除文件后残留 key 会误判重复导致传不进去）。详见 upload.js 公共函数 uploadFiles。

			// ── 双层渲染：图片层常驻（background-image），视频覆盖层可选（<video> 绝对定位盖其上）──
			// 2026-09-21 设计改：图片壁纸一直存在（无「类型」切换按钮）；视频开关决定是否加载视频，
			// 加载则视频覆盖图片显示——图片仍渲染在背景上，只是被视频完全挡住。
			// 持久化：LS_BG=图片层 id / LS_BG_VIDEO=视频开关 / LS_BG_VID=视频层 id。
			// 2026-09-22 加切换日志：每次 renderLayers 上报一行到 /wallpaper/log（运行态 logs/wallpaper.log），
			// 记录 kind（video/image）、mode、当前层 id——AI/预览页可查证「是否发生了切换」（api-verifiable-frontend）。
			function logSwitch(extra) {
				try {
					const cur = videoOn ? currentVidId : currentImgId;
					const kind = videoOn ? "video" : "image";
					const body = Object.assign({
						event: "switch",
						kind,
						mode,
						...(cur ? { toId: cur } : {}),
					}, extra || {});
					ffFetch("/theme-mediascape-assets/wallpaper/log", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					}).catch(() => {});
				} catch (e) { /* 日志上报失败静默 */ }
			}
			// 2026-09-23 媒体持久缓存已整体移除（定稿：彻底移除缓存、只保留流式）——
			// 视频壁纸播放中断/从头播放的回归根因在 IndexedDB 缓存代码（命中切 blob、cacheKeepOnly
			// 中止下载产生竞态）。壁纸图片/视频一律走网络流式 + 服务端 HTTP 缓存（serveStream ETag/If-Range），
			// 不再有前端完整文件缓存。
			const MS_PER_MINUTE = 60000; // 随机间隔（分钟）→ 毫秒
		// 2026-09-23 拆（审计 max-function-length renderLayers 182 行）：
			// 移除旧 video 必须停播（只 remove 不暂停 → 后台播完触发 ended → doSwitch 换回，实测踩坑）
			function disposeVideoEl(el) {
				if (!el) return;
				try { el.pause(); el.removeAttribute("src"); el.load(); } catch (e) { /* 停播失败可忽略（元素已分离） */ }
			}
			// 图片层常驻渲染（含缓存优先 + 后台缓存）
			function renderImageLayer() {
				const img = imgs[imgIndex] || imgs[0] || null;
				if (img) {
					imgIndex = imgs.indexOf(img);
					// note: 运行时 item 用 data 字段存 URL（url 恒缺省），统一取 url || data
					bg.style.backgroundImage = 'url("' + (img.url || img.data) + '")'; // 网络流式（服务端 HTTP 缓存覆盖重播）
					currentImgId = img.id;
					if (img.id) localStorage.setItem(LS_BG, img.id);
				} else {
					bg.style.backgroundImage = "none";
					currentImgId = null;
				}
				return img;
			}
			// 视频覆盖层渲染（开才挂；含开屏 auto 移交逻辑——原 renderLayers 内整段搬入）
			function renderVideoLayer() {
				// 移除旧 video 前必须停播：只 remove() 元素不会停止媒体播放，
				// 后台继续播完会触发 ended → onVideoEnded → doSwitch 把已切走的视频换回来（auto 移交场景实测踩坑）
				const oldVideo = bg.querySelector("video");
				disposeVideoEl(oldVideo);
				if (oldVideo) oldVideo.remove();
				if (!videoOn) { currentVidId = null; return; }
				const v = vids[vidIndex] || vids[0] || null;
				if (!v) { currentVidId = null; return; }
				vidIndex = vids.indexOf(v);
				const vol = typeof window.__mediascapeDshSoundVol === "function" ? window.__mediascapeDshSoundVol() : 80;
				const muted = typeof window.__mediascapeDshSoundMuted === "function" ? window.__mediascapeDshSoundMuted() : true;
				// 开屏 file:"auto" 同一份流（2026-09-22 用户新机制）：
				//   pending（boot 已解析同 id）或开屏浮层正在播同 URL → 壁纸层不自建 video（画面由开屏呈现），
				//   等 boot finish 移交后 ready 回调 renderLayers 接管同一元素（takeOver 分支）——不重复发 Range 请求。
				const handoff = window.__mediascapeDshBootVideo || null;
				const pending = window.__mediascapeDshBootVideoPending || null;
				const takeOver = handoff && handoff.id === v.id;
				// 移交元素与当前视频不匹配（已切换走/开屏播的是别的视频）→ 丢弃残留引用
				//（元素仍在开屏 overlay 里，overlay 淡出移除时一并销毁；不残留引用避免误接管）
				if (handoff && !takeOver) window.__mediascapeDshBootVideo = null;
				const bootEl = document.querySelector(".mediascape-dsh-boot video");
				const bootSameUrl = bootEl && (bootEl.getAttribute("src") === (v.url || v.data));
				// loading 占位（boot 尚未解析出 auto 的目标 id）也跳过自建：宁可多等一拍让 boot 解析完
				// 再按 id 匹配决定（匹配→等移交；不匹配→正常自建自己的）。避免竞态窗口内多一次 Range 请求。
				const skipSelfBuild = (pending && (pending.loading || pending.id === v.id)) || (bootSameUrl && !handoff);
				if (skipSelfBuild) {
					// 开屏持有同一份流：仅记录状态，不挂 video；竞态下已自建的同 URL video 移除（等移交接管）
					// 注意必须停播再移除：否则后台继续播完触发 ended→doSwitch（2026-09-22 实测踩坑）
					const dup = bg.querySelector("video");
					disposeVideoEl(dup);
					if (dup) dup.remove();
					currentVidId = v.id;
					if (v.id) localStorage.setItem(LS_BG_VID, v.id);
					return;
				}
				const video = takeOver ? handoff.el : document.createElement("video");
				if (takeOver) {
					window.__mediascapeDshBootVideo = null;
					video.classList.remove("mediascape-dsh-gif"); // 清开屏居中约束，让壁纸层 full-cover 生效
				}
				// 视频层播放模式对齐音乐三档：
				//   single → loop 单视频循环；switch/random → 不 loop，ended 驱动按模式切换。
				// 启动播放策略（theme-studio/playback.json → PLAYBACK_CONFIG）：videoAutoPlay=false 时不 autoplay 不 play，
				// 视频层仅挂载首帧（画面仍显示），点击「视频」按钮后才开始播。
				video.autoplay = PLAYBACK_CONFIG.videoAutoPlay; video.loop = mode === "single"; video.muted = muted; video.playsInline = true;
				video.volume = vol / 100;
				if (!takeOver) {
					// note: 运行时 item 用 data 字段存 URL（url 恒缺省），统一取 url || data
					video.src = withMediaToken(v.url || v.data); // 网络 Range 流式（服务端 HTTP 缓存覆盖重播）
				} else if (v.url || v.data) {
					// 移交元素保持原流（不干预——2026-09-23 修复「移交中断重播」：
					// 对移交元素做任何二次播放操作都可能触发真实浏览器重载重播）
				}
				bg.appendChild(video);
				video.addEventListener("ended", onVideoEnded);
				// 2026-09-23 修：假视频/损坏视频（改后缀 .mp4 的随机字节）播放报错（error code=4
				// DEMUXER_ERROR）→ 不再黑屏卡死，自动跳下一段（循环模式也跳——坏视频无法播放）。
				video.addEventListener("error", onVideoError);
				if (PLAYBACK_CONFIG.videoAutoPlay) {
					video.play().catch(() => {
						// 自动播放被浏览器策略拒绝（有声媒体需用户交互，如 LS_MUTED="0" 时）→
						// 静音重试保底：自动播放永远成立（画面不黑）。
						video.muted = true;
						video.play().catch(() => {});
						// 2026-09-23「流式切换/boot 移交无声」修复：自动切换（ended 驱动/随机轮换）或
						// 首次加载时页面无手势，有声 play() 被 autoplay 策略拒绝 → 上方静音保底。
						// 声音面板开着（期望有声）→ 播放中直接取消静音（Chromium 策略只拦有声播放
						// 启动，不拦播放中取消静音）；被拒绝则静音保持，页面任意手势后由下方全局
						// pointerdown 恢复。⚠️ 仅对新建元素（!takeOver）尝试：移交元素已在连续
						// 播放，任何二次 play/muted 操作都可能触发真实浏览器重载重播（2026-09-23
						// 修复「移交中断重播」——移交元素零干扰，静音保底保证连续，手势后恢复有声）。
						if (!takeOver && muted === false) {
							const soundMuted = (typeof window.__mediascapeDshSoundMuted === "function") ? window.__mediascapeDshSoundMuted() : true;
							if (!soundMuted) {
								const unmute = () => {
									try {
										if (video.muted) { video.muted = false; if (video.paused) { const pr = video.play(); if (pr && pr.catch) pr.catch(() => {}); } }
									} catch (e) { /* 取消静音失败可忽略 */ }
								};
								unmute();
								setTimeout(unmute, 600); // muted 播放真正起来后再取消静音更稳（播放启动有延迟）
							}
						}
					});
				}
				currentVidId = v.id;
				if (v.id) localStorage.setItem(LS_BG_VID, v.id);
			}
			function renderLayers() {
				// 壁纸总开关（2026-09-22 景/开屏改造）：关 = 不铺任何壁纸媒体（清背景 + 移除视频层），
				// 恢复宿主默认底（html 兜底深色由 identity 提供）；开 = 正常渲染图片/视频层。
				if (!bgEnabled) {
					bg.style.backgroundImage = "none";
					const oldVideo = bg.querySelector("video");
					if (oldVideo) oldVideo.remove();
					currentImgId = null; currentVidId = null;
					btn.title = "壁纸（已关闭）";
					updateVideoToggle();
					updateIntervalLine();
					syncBgEnabledUI(); // dock .on 熄灭 + 面板「壁纸」按钮变「关」
					return;
				}
				// 2026-09-23 拆（审计）：图片层/视频层各自独立函数（renderImageLayer/renderVideoLayer）
				const img = renderImageLayer();
				renderVideoLayer();
				// dock 按钮标题跟随当前层（2026-09-22 改）：视频开只显示视频标题，关只显示图片标题，
				// 不再同时出现「视频… / 图…」两个标题
				btn.title = videoOn
					? "视频：" + (vids[vidIndex]?.label || vids[vidIndex]?.id || "")
					: (img ? "图片：" + (img.label || img.id) : "壁纸");
				updateVideoToggle();
				updateIntervalLine();
				syncBgEnabledUI(); // dock .on = 壁纸启用状态（不再跟面板开合）
				logSwitch(); // 切换日志（图片/视频层每次重渲染都记录）
			}

			// 2026-09-23「boot 移交后视频无声」兜底恢复：移交元素从开屏浮层移到壁纸层（DOM 移除
			// 再插入）会被浏览器自动暂停；无手势时有声 play() 被 autoplay 策略拒绝 → 静音保底。
			// 此处页面任意一次手势（pointerdown）后按声音面板状态恢复 bg 视频声音与播放——
			// 用户刷新后点一下页面（任意处，不限于声音面板）视频立即有声。幂等：已按预期状态
			// 不产生效果；与声音面板自身的 applyVideoSound（typesound）互补，两者同源同一状态。
			document.addEventListener("pointerdown", () => {
				try {
					const soundMuted = (typeof window.__mediascapeDshSoundMuted === "function") ? window.__mediascapeDshSoundMuted() : true;
					const soundVol = (typeof window.__mediascapeDshSoundVol === "function") ? window.__mediascapeDshSoundVol() : 80;
					bg.querySelectorAll("video").forEach((el) => {
						el.volume = soundVol / 100;
						el.muted = soundMuted;
						if (el.paused) { const pr = el.play(); if (pr && pr.catch) pr.catch(() => {}); }
					});
				} catch (e) { /* 手势恢复失败静默（静音保底仍在，不崩溃） */ }
			});

			function showByIndex(kind, idx) {
				const arr = kind === "video" ? vids : imgs;
				if (arr.length === 0) return;
				const i = ((idx % arr.length) + arr.length) % arr.length;
				if (kind === "video") vidIndex = i; else imgIndex = i;
				renderLayers();
			}

			// 视频覆盖开关：on=true 加载视频层（覆盖图片显示）；off=false 只显示图片层。
			// 图片层常驻（无「类型」切换）；视频层由开关决定是否叠加。
			function toggleVideo(on) {
				if (on && vids.length === 0) return; // 无视频素材不能开视频层
				videoOn = !!on;
				localStorage.setItem(LS_BG_VIDEO, videoOn ? "1" : "0");
				renderLayers();
				// 媒体类型切换刷新模式按钮文案（视频「循环」/ 图片「固定」）与间隔行显示
				syncModeBtn();
				updateIntervalLine();
				// 开关切换后重调度：video 开 → 由 ended 驱动（分钟定时自动停）；关/toggleVideo 回图 → 图片层恢复分钟调度
				scheduleRandom();
			}

			function activeArr() { return videoOn ? vids : imgs; }

			function showItem(item) {
				if (!item) return;
				const list = item.kind === "video" ? vids : imgs;
				const i = list.indexOf(item);
				if (i < 0) return;
				if (item.kind === "video") { vidIndex = i; videoOn = true; localStorage.setItem(LS_BG_VIDEO, "1"); }
				else imgIndex = i;
				renderLayers();
			}

			function doSwitch() {
				// 随机/顺序作用于「最上层」：视频开→视频内顺序切；关→图片层顺序切
				if (videoOn) showByIndex("video", vidIndex + 1);
				else showByIndex("image", imgIndex + 1);
			}

			// 动态壁纸「播放完毕」回调：由 renderLayers 里的 video ended 事件触发。
			// 语义对齐音乐播放：single=单曲循环（loop 由 video.loop 承担，本不触发 ended，防御残留）；
			// switch=顺序（vids 列表循环下一段）、random=随机（池内不重复当前）。
			function onVideoEnded() {
				if (!videoOn) return; // 旧元素 ended（视频层已关）直接忽略
				logSwitch({ event: "video-ended" }); // 日志：视频播完（随后会切换，另有一条 switch）
				if (mode === "single") return;      // 单曲循环不切换
				if (mode === "random") doRandom();
				else doSwitch();
			}

			// 2026-09-23：损坏/假视频（改后缀 .mp4 的随机字节等）解码失败触发 error → 自动跳过，
			// 避免视频层黑屏卡死。循环模式也跳（坏视频无法播放，不能原地空转）。
			function onVideoError() {
				if (!videoOn) return; // 旧元素 error（视频层已关）忽略
				const v = bg.querySelector("video");
				const code = v && v.error ? v.error.code : "?";
				console.warn(`[wallpaper] video error code=${code} → 自动跳过当前视频`);
				logSwitch({ event: "video-error", extra: { code } });
				if (mode === "random") doRandom();
				else doSwitch(); // 顺序/循环/固定在视频层下都切下一段（坏视频不驻留）
			}

			function randomCandidates() {
				const arr = activeArr();
				if (randomPool.size === 0) return arr;
				const filtered = arr.filter((it) => randomPool.has(it.id));
				// 池过滤为空（随机池在图片模式勾选、当前却是视频层等跨层场景）→ 回退当前层全部，
				// 否则 doRandom 拿到空数组直接 return，视频播完不切、壁纸停住（2026-09-22 修）。
				return filtered.length > 0 ? filtered : arr;
			}

			function doRandom() {
				const arr = randomCandidates();
				if (arr.length === 0) return;
				const curId = videoOn ? currentVidId : currentImgId;
				const cur = arr.findIndex((it) => it.id === curId);
				let n = cur;
				if (arr.length > 1) while (n === cur) n = Math.floor(Math.random() * arr.length);
				showItem(arr[n]);
			}

			function clearRandom() { if (randomTimer) { clearTimeout(randomTimer); randomTimer = null; } }

			function scheduleRandom() {
				clearRandom();
				// 图片层「顺序/随机」都按间隔（分钟）轮换；「固定」不打断（2026-09-22 改）；
				// 视频层由 ended 驱动（播完即切，不按分钟打断）。
				if (videoOn || mode === "single") return;
				randomTimer = setTimeout(() => {
					if (mode === "random") doRandom(); else doSwitch();
					scheduleRandom();
				}, Math.max(1, interval) * MS_PER_MINUTE);
			}

			function setMode(m) {
				mode = m;
				localStorage.setItem(LS_BG_MODE, mode);
				syncModeBtn();
				updateIntervalLine(); // 间隔行显示随模式变化（固定隐藏 / 顺序·随机显示）
				if (mode === "random" || mode === "switch") {
					// 切到随机/顺序：若视频正在播放 → 不立即切换（避免中断当前视频重播），
					// 等当前视频播完由 ended 驱动 onVideoEnded → doRandom/doSwitch；图片层才立即随机。
					const v = bg.querySelector("video");
					if (mode === "random" && (!videoOn || !v || v.paused)) doRandom();
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
				if (mode !== "single") scheduleRandom(); // 图片顺序/随机都按新间隔重排（固定不调度）
			}

			function closePanel() { panel.classList.remove("open"); }

			// ── 选择面板：勾选 → 移除 / 随机；点卡片本体 → 应用该壁纸 ──
			function closePicker() { picker.classList.remove("open"); }

			function updatePickerActions() {
				const n = selected.size;
				pickerRemove.disabled = n === 0;
				pickerRemove.textContent = n > 0 ? "移除(" + n + ")" : "移除";
				// 2026-09-22 去掉随机按钮：原 pickerRandom.disabled / textContent 两行已移除
			}

			function buildPicker() {
				const arr = activeArr();
				pickerTitle.textContent = "选择壁纸（" + (videoOn ? "视频" : "图片") + "）";
				pickerList.innerHTML = "";
				if (arr.length === 0) {
					pickerList.innerHTML = '<div class="mediascape-dsh-bg-picker-empty">暂无壁纸</div>';
					updatePickerActions();
					return;
				}
				arr.forEach((item) => {
					const cell = document.createElement("div");
					cell.className = "mediascape-dsh-bg-picker-item" + (selected.has(item.id) ? " checked" : "");
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
					cb.className = "mediascape-dsh-bg-check";
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
				dock.__mediascapeDshCenter(picker);
			}

			// 2026-09-2x 拆（审计 max-function-length）：removeSelected 的「选中项收集」提为纯函数
			// 选中 id → 可移除项（带 file/size——isItemUsable 真实可用校验需要，缺字段会被滤掉删不掉）
			function collectSelectedWallpapers(ids) {
				const items = [];
				for (const id of ids) {
					const w = vids.concat(imgs).find((x) => x.id === id);
					if (w) items.push({ id: w.id, kind: "wallpaper", data: w.data, file: w.file, size: w.size });
				}
				return items;
			}

			// 移除勾选的壁纸：真实删除服务器文件（2026-09-2x 改：走公共 removeItems——同一份逻辑，
			// 开始前/结束后各一次 list 刷新内置）。本地收尾只清随机池 + 重算当前层（列表已重建）。
			async function removeSelected() {
				const ids = [...selected];
				if (ids.length === 0) return;
				selected.clear();
				const items = collectSelectedWallpapers(ids);
				// 统一移除（公共函数 upload.js：开始前/结束后各刷新一次 list + 逐个 DELETE 服务端文件）
				await removeItems(items);
				// 本地收尾：随机池清理 + 当前层重算（视频全删强制回图片层）
				for (const id of ids) randomPool.delete(id);
				saveIdSet(LS_BG_RANDOM, randomPool);
				if (vids.length === 0) videoOn = false; // 视频全删 → 强制回图片层
				renderLayers();
				if (picker.classList.contains("open")) buildPicker();
			}
			// 2026-09-23 修：移除按钮此前从未绑定点击（对齐音乐 pickerRemove.addEventListener）——
			// 勾选壁纸后点「移除」无反应（壁纸移除失效根因）。补绑定。
			pickerRemove.addEventListener("click", removeSelected);

			// 2026-09-22 去掉随机按钮：原 applyRandomPool（勾选壁纸作为随机池 + 立即随机模式）随按钮一并移除，
			// 随机模式仍可从面板顶部模式按钮进入（data-mode-cycle 循环切到「随机」）。以下为原实现，注释保留可恢复：
			// function applyRandomPool() {
			// 	if (selected.size === 0) return;
			// 	randomPool.clear();
			// 	for (const id of selected) {
			// 		if (vids.concat(imgs).some((w) => w.id === id)) randomPool.add(id);
			// 	}
			// 	saveIdSet(LS_BG_RANDOM, randomPool);
			// 	selected.clear();
			// 	closePicker();
			// 	setMode("random");
			// }

			// ── 用户上传壁纸（服务器持久化：$DSH_HOME/theme-mediascape/wallpaper/）──
			// 上传/删除走 HTTP API（fetch），不再用 IndexedDB：
			// 浏览器 IndexedDB 有版本冲突/配额静默失败问题，且换浏览器/清数据即丢；
			// 服务器磁盘才是真持久化，刷新/重启/换浏览器都在。
			const WALLPAPER_API = "/theme-mediascape-assets";

			async function loadCustomWallpapers(refresh) {
				try {
					const resp = await ffFetch(WALLPAPER_API + "/wallpaper/list");
					if (!resp.ok) return;
					const listData = await resp.json();
					// refresh 模式（打开面板时触发）：清空已加载的自定义列表再重载，
					// 使其他设备新上传的壁纸无需手动刷新网页即可出现在本机（跨设备即时可见）。
					if (refresh) {
						vids.length = 0; imgs.length = 0;
						for (const r of (listData.items || [])) {
							// file = 磁盘原始文件名（带扩展名）：上传预检「文件名+大小」去重基准
							const entry = { id: r.id, kind: r.kind, data: r.url, label: r.label || r.id, custom: true, etag: r.etag || null, size: r.size ?? null, file: r.file };
							if (r.kind === "video") vids.push(entry); else imgs.push(entry);
						}
						updateVideoToggle();
						return;
					}
					for (const r of (listData.items || [])) {
						const entry = { id: r.id, kind: r.kind, data: r.url, label: r.label || r.id, custom: true, etag: r.etag || null, size: r.size ?? null, file: r.file };
						if (r.kind === "video") vids.push(entry); else imgs.push(entry);
					}
					updateVideoToggle();
				} catch (e) { /* 服务器不可达则忽略（内置壁纸照常） */ }
			}

			// ── 2026-09-2x 挂公共上传/移除钩子（upload.js 公共函数 uploadFiles/removeItems 访问闭包内列表/刷新/落地）──
			// ⚠️ 刷新必须固定 refresh=true（清空重建）：若透传 undefined → !!undefined=false →
			// loadCustomWallpapers 走追加分支不清空 → 移除/上传后旧缓存累积（被删文件残留列表/重复项）
			window.__mediascapeDshRefreshWallpapers = () => loadCustomWallpapers(true);
			window.__mediascapeDshWallpaperItems = () => vids.concat(imgs);
			// 上传落地（公共 uploadFiles 全部上传完成后调用，此时列表已刷新含新项）：
			// 互斥语义（2026-09-22 改）——上传视频 → 视频模式并加载它；上传图片 → 切回图片模式显示它。
			window.__mediascapeDshAfterWallpaperUpload = (lastUp) => {
				if (!lastUp || !lastUp.ok) return;
				if (lastUp.kind === "video") { videoOn = true; localStorage.setItem(LS_BG_VIDEO, "1"); }
				else { videoOn = false; localStorage.setItem(LS_BG_VIDEO, "0"); }
				const arr = lastUp.kind === "video" ? vids : imgs;
				const wpItem = arr.find((w) => w.id === lastUp.id);
				if (wpItem) showByIndex(wpItem.kind, arr.indexOf(wpItem));
				btn.title = lastUp.existing ? "已存在：" + (lastUp.label || "") : ADDED_PREFIX + (lastUp.label || "");
			};

