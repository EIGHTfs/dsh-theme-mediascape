		// ═══════════ 7. 打字音效（Web Audio 合成，无音频文件）═══════════
		// 2026-09-23 魔数命名化（审计 magic-number-smart）：音效合成参数集中为 TYPE_SOUND 配置。
		// 清脆（crisp）= 高频带通咔哒；柔和（soft）= 更低频/低 Q/平缓包络。音量整体较大（可听）。
		const VOL_RANGE = { min: 0, max: 100, default: 80 }; // 壁纸音量条范围与默认值
		const TYPE_SOUND = {
			noiseSeconds: 0.05,              // 噪声缓冲时长（相对 sampleRate）
			noiseGainBase: { soft: 0.10, crisp: 0.18 }, // 噪声主音量（+随机 0.04）
			oscGain: { soft: 0.07, crisp: 0.12 },
			baseFreq: { space: { soft: 900, crisp: 1400 }, enter: { soft: 700, crisp: 1050 }, other: { soft: 1100, crisp: 2100 } },
			freqJitter: { soft: 300, crisp: 700 },   // bandpass 中心频率随机抖动范围
			bandQ: { soft: 0.6, crisp: 1.4 },
			attack: { soft: 0.004, crisp: 0.002 },   // 起音时间
			noiseRelease: { soft: 0.06, crisp: 0.04 },
			noiseStop: { soft: 0.09, crisp: 0.06 },
			oscFreq: { enter: { soft: 110, crisp: 150 }, space: { soft: 80, crisp: 110 }, other: { soft: 90, crisp: 120 }, jitter: 30 },
			oscSlideTo: { soft: 40, crisp: 50 },     // 振荡器滑向频率
			oscSlideTime: { soft: 0.08, crisp: 0.05 },
			oscAttack: { soft: 0.006, crisp: 0.003 },
			oscRelease: { soft: 0.08, crisp: 0.055 },
			oscStop: { soft: 0.1, crisp: 0.07 },
			minGain: 0.0001,                 // 包络静音底值（指数包络不能到 0）
		};
		let typeAudioCtx = null;
		let typeNoiseBuf = null;
		function ensureTypeAudio() {
			const AC = window.AudioContext || window.webkitAudioContext;
			if (AC === undefined) return null;
			if (typeAudioCtx === null) typeAudioCtx = new AC();
			if (typeAudioCtx.state === "suspended") typeAudioCtx.resume().catch(() => {});
			return typeAudioCtx;
		}
		function typeNoiseBuffer(ctx) {
			if (typeNoiseBuf !== null) return typeNoiseBuf;
			const len = Math.floor(ctx.sampleRate * TYPE_SOUND.noiseSeconds);
			const buf = ctx.createBuffer(1, len, ctx.sampleRate);
			const noiseData = buf.getChannelData(0);
			for (let i = 0; i < len; i++) noiseData[i] = Math.random() * 2 - 1;
			typeNoiseBuf = buf;
			return buf;
		}
		function playTypeClick(key, style) {
			const ctx = ensureTypeAudio();
			if (ctx === null || ctx.state !== "running") return;
			const t = ctx.currentTime;
			const soft = style === "soft";
			const pick = (v) => (soft ? v.soft : v.crisp);
			const noiseGain = pick(TYPE_SOUND.noiseGainBase) + Math.random() * 0.04; // 主音量：明显可听
			const oscGain = pick(TYPE_SOUND.oscGain);
			const baseFreq = key === " " ? pick(TYPE_SOUND.baseFreq.space) : key === "Enter" ? pick(TYPE_SOUND.baseFreq.enter) : pick(TYPE_SOUND.baseFreq.other);
			const src = ctx.createBufferSource();
			src.buffer = typeNoiseBuffer(ctx);
			const bp = ctx.createBiquadFilter();
			bp.type = "bandpass";
			bp.frequency.value = baseFreq + Math.random() * pick(TYPE_SOUND.freqJitter);
			bp.Q.value = pick(TYPE_SOUND.bandQ);
			const gainNode = ctx.createGain();
			gainNode.gain.setValueAtTime(TYPE_SOUND.minGain, t);
			gainNode.gain.exponentialRampToValueAtTime(noiseGain, t + pick(TYPE_SOUND.attack));
			gainNode.gain.exponentialRampToValueAtTime(TYPE_SOUND.minGain, t + pick(TYPE_SOUND.noiseRelease));
			src.connect(bp); bp.connect(gainNode); gainNode.connect(ctx.destination);
			src.start(t); src.stop(t + pick(TYPE_SOUND.noiseStop));
			const osc = ctx.createOscillator();
			osc.type = "sine";
			const f0 = key === "Enter" ? pick(TYPE_SOUND.oscFreq.enter) : key === " " ? pick(TYPE_SOUND.oscFreq.space) : (pick(TYPE_SOUND.oscFreq.other) + Math.random() * TYPE_SOUND.oscFreq.jitter);
			osc.frequency.setValueAtTime(f0, t);
			osc.frequency.exponentialRampToValueAtTime(pick(TYPE_SOUND.oscSlideTo), t + pick(TYPE_SOUND.oscSlideTime));
			const g2 = ctx.createGain();
			g2.gain.setValueAtTime(TYPE_SOUND.minGain, t);
			g2.gain.exponentialRampToValueAtTime(oscGain, t + pick(TYPE_SOUND.oscAttack));
			g2.gain.exponentialRampToValueAtTime(TYPE_SOUND.minGain, t + pick(TYPE_SOUND.oscRelease));
			osc.connect(g2); g2.connect(ctx.destination);
			osc.start(t); osc.stop(t + pick(TYPE_SOUND.oscStop));
		}
		// 2026-09-23 拆（审计）：音量行 UI（喇叭 + 音量条）构建与交互，独立于 startSoundPanel。
		// ctx = { loadVol, loadMuted, saveVol, saveMuted, applyVideoSound, onStateChange }
		function buildVolumeLine(menu, line, label, ctx) {
			const ico = document.createElement("button");
			ico.type = "button";
			ico.className = "mediascape-dsh-snd-vol-ico";
			const vol = document.createElement("input");
			vol.type = "range";
			vol.className = "mediascape-dsh-snd-vol";
			vol.min = String(VOL_RANGE.min); vol.max = String(VOL_RANGE.max); vol.step = "1";
			vol.value = String(ctx.loadVol());
			const syncIco = () => {
				const muted = ctx.loadMuted();
				const silent = muted || ctx.loadVol() === 0;
				ico.textContent = "音";
				ico.classList.toggle("on", !silent);
			};
			syncIco();
			// 喇叭：单击切换静音/取消静音（不改音量条的值）
			ico.addEventListener("click", () => {
				ctx.saveMuted(!ctx.loadMuted());
				syncIco();
				ctx.onStateChange(); // 静音态变 → 「声」按钮高亮同步
				ctx.applyVideoSound();
			});
			// 音量条：拖动改音量，同时取消静音
			vol.addEventListener("input", () => {
				const v = parseInt(vol.value, 10) || 0;
				ctx.saveVol(v);
				if (v > 0 && ctx.loadMuted()) ctx.saveMuted(false);
				syncIco();
				ctx.onStateChange(); // 音量/静音态变 → 「声」按钮高亮同步
				ctx.applyVideoSound();
			});
			line.appendChild(label); line.appendChild(ico); line.appendChild(vol);
			return { ico, vol };
		}
		// 打字音效键盘监听（输入型元素判定 + 试听）；isTypeSoundOff 每次按键实时判定。
		// 2026-09-23 拆：壁纸视频音量应用（loadVol/loadMuted 由调用方传入）提为顶层函数
		function applyVideoSoundToBg(loadVol, loadMuted) {
			const muted = loadMuted();
			const v = loadVol() / 100;
			document.querySelectorAll(".mediascape-dsh-bg video").forEach((el) => {
				el.volume = v;
				el.muted = muted;
			});
		}
		// 2026-09-2x 拆（审计 max-function-length）：attachTypeKeydown 的「输入元素判定」提为纯函数
		// 输入型元素：原生 textarea/input，或 contenteditable（宿主聊天输入为 CodeMirror 渲染的
		// contenteditable 容器，非 TEXTAREA——2026-09-22 实测打字无声根因，放宽判定）。
		// CodeMirror 实际输入点是 .cm-content 下的子元素，向上找最近可编辑容器。
		function isEditableTarget(el) {
			let node = el;
			while (node && node !== document.body) {
				if (node.tagName === "TEXTAREA" || node.tagName === "INPUT" ||
					node.getAttribute && node.getAttribute("contenteditable") === "true") break;
				node = node.parentElement;
			}
			return !!node && node !== document.body;
		}

		function attachTypeKeydown(isTypeSoundOff, loadStyle) {
			const onKeydown = (e) => {
				if (isTypeSoundOff()) return;
				const el = e.target;
				if (el === null) return;
				if (!isEditableTarget(el)) return;
				if (e.metaKey || e.ctrlKey || e.altKey) return;
				playTypeClick(e.key === "Enter" ? "Enter" : e.key === " " ? " " : "", loadStyle());
			};
			document.addEventListener("keydown", onKeydown, true);
			return () => document.removeEventListener("keydown", onKeydown, true);
		}

		// 2026-09-23 拆（审计）：打字音效开关行 UI + 交互（startSoundPanel 只挂载）。
		// onChange(newOn) 通知外部（「声」按钮高亮同步）；点击开启给一次试听反馈。
		function buildTypeToggle(menu, onChange) {
			const line = document.createElement("div");
			line.className = "mediascape-dsh-snd-line";
			const lab = document.createElement("span");
			lab.className = "mediascape-dsh-snd-label";
			lab.textContent = "打字音效";
			const tbox = document.createElement("span");
			tbox.className = "mediascape-dsh-snd-toggle-box" + (localStorage.getItem(LS_TYPESOUND) !== "0" ? " on" : "");
			tbox.title = "打字音效开关";
			const setBox = (on) => tbox.classList.toggle("on", on);
			tbox.addEventListener("click", () => {
				const on = localStorage.getItem(LS_TYPESOUND) === "0";
				localStorage.setItem(LS_TYPESOUND, on ? "1" : "0");
				setBox(on);
				if (typeof onChange === "function") onChange(on);
				if (on) playTypeClick("", loadTypeStyle()); // 点击开启时给一次试听反馈（当前音色）
			});
			line.appendChild(lab); line.appendChild(tbox);
			menu.appendChild(line);
		}
		// 音色选择行（清脆/柔和，localStorage 记忆，默认柔和）；loadTypeStyle 供外部复用
		function loadTypeStyle() { const s = localStorage.getItem("mediascape-dsh-type-style"); return s === "crisp" || s === "soft" ? s : "soft"; }
		function buildStylePicker(menu) {
			const line = document.createElement("div");
			line.className = "mediascape-dsh-snd-line";
			const lab = document.createElement("span");
			lab.className = "mediascape-dsh-snd-label";
			lab.textContent = "音色";
			const btns = ["crisp", "soft"].map((s) => {
				const b = document.createElement("button");
				b.type = "button";
				b.className = "mediascape-dsh-snd-style" + (loadTypeStyle() === s ? " on" : "");
				b.textContent = s === "crisp" ? "清脆" : "柔和";
				b.title = s === "crisp" ? "高频咔哒（原音色）" : "低频柔和（默认）";
				b.addEventListener("click", () => {
					localStorage.setItem("mediascape-dsh-type-style", s);
					btns.forEach((x) => x.classList.toggle("on", x === b));
					playTypeClick("", s); // 试听反馈
				});
				return b;
			});
			btns.forEach((b) => line.appendChild(b));
			menu.appendChild(line);
		}

		function startSoundPanel(dock) {
			const LS_VOL = "mediascape-dsh-vol";
			const LS_MUTED = "mediascape-dsh-muted";
			function loadVol() { return Math.min(100, Math.max(0, parseInt(localStorage.getItem(LS_VOL) || String(VOL_RANGE.default), 10) || VOL_RANGE.default)); }
			function loadMuted() { return localStorage.getItem(LS_MUTED) !== "0"; }
			function saveVol(v) { try { localStorage.setItem(LS_VOL, String(v)); } catch (e) { /* localStorage 异常（配额/隐私模式）可忽略 */ } }
			function saveMuted(m) { try { localStorage.setItem(LS_MUTED, m ? "1" : "0"); } catch (e) { /* localStorage 异常（配额/隐私模式）可忽略 */ } }
			// 供主壁纸 render() 读取：当前音量(0-100) 与 是否静音
			window.__mediascapeDshSoundVol = loadVol;
			window.__mediascapeDshSoundMuted = loadMuted;

			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "mediascape-dsh-snd-toggle mediascape-dsh-dock-btn";
			btn.textContent = "声";
			btn.title = "声音设置";
			dock.appendChild(btn);

			// 「声」按钮高亮 = 功能态（2026-09-22 改）：打字音效与视频音量**全关** → 暗，
			// 任一启用（打字音效开 或 视频有声）→ 亮。不再是「面板打开时亮」。
			const updateBtnState = () => {
				const typeOn = localStorage.getItem(LS_TYPESOUND) !== "0"; // 打字音效开
				const volOn = !loadMuted() && loadVol() > 0;               // 视频有声（未静音且音量>0）
				btn.classList.toggle("on", typeOn || volOn);
				btn.title = (typeOn ? "打字音效开" : "打字音效关") + " · " + (volOn ? "视频有声" : "视频静音") + "（点击设置）";
			};
			updateBtnState();

			const menu = document.createElement("div");
			menu.className = "mediascape-dsh-snd-menu";
			// 2026-09-23 拆（审计）：打字音效行/音色行/音量行各自独立函数（buildTypeToggle/
			// buildStylePicker/buildVolumeLine），startSoundPanel 只组装。
			buildTypeToggle(menu, () => updateBtnState());
			buildStylePicker(menu);
			// ── 壁纸视频音量条 + 喇叭静音 ──
			const line2 = document.createElement("div");
			line2.className = "mediascape-dsh-snd-line";
			const lab2 = document.createElement("span");
			lab2.className = "mediascape-dsh-snd-label";
			lab2.textContent = "壁纸音量";
			buildVolumeLine(menu, line2, lab2, { loadVol, loadMuted, saveVol, saveMuted, applyVideoSound: () => applyVideoSoundToBg(loadVol, loadMuted), onStateChange: updateBtnState });
			menu.appendChild(line2);

			dock.appendChild(menu);

			btn.addEventListener("click", () => {
				menu.classList.toggle("open");
				// 2026-09-22 改：按钮高亮由功能态驱动（打字音效/视频音量任一开即亮），面板开合不再改变 .on
				if (menu.classList.contains("open")) dock.__mediascapeDshCenter(menu);
			});
			const onDocClick = (e) => {
				if (!menu.contains(e.target) && e.target !== btn) {
					menu.classList.remove("open");
				}
			};
			document.addEventListener("click", onDocClick);

			// 2026-09-23 拆：打字音效键盘监听提取为 attachTypeKeydown（输入型元素判定 + 试听）
			const offKeydown = attachTypeKeydown(() => localStorage.getItem(LS_TYPESOUND) === "0", loadTypeStyle);

			return () => {
				offKeydown();
				document.removeEventListener("click", onDocClick);
				btn.remove();
				menu.remove();
				delete window.__mediascapeDshSoundVol;
				delete window.__mediascapeDshSoundMuted;
			};
		}

