		// dsh-skip-quality（拼接架构：音乐「乐」按钮在 music-extract 创建、music-player 绑定，跨片段）
		// ═══════════ 7.5 背景音乐播放器 ═══════════
		const LS_MUSIC_MODE = "mediascape-dsh-music-mode";
		const LS_MUSIC_ID = "mediascape-dsh-music-id";
		async function startMusic(dock) {
			const LS_MUSIC_RANDOM = "mediascape-dsh-music-random";
			function loadIdSet(key) {
				try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); }
				catch (e) { return new Set(); }
			}
			function saveIdSet(key, set) {
				try { localStorage.setItem(key, JSON.stringify([...set])); } catch (e) { /* localStorage 异常（配额/隐私模式）可忽略 */ }
			}
			// 2026-09-2x 删 hidden 死代码：音乐移除=真实删除服务端文件（列表来自服务端扫描，
			// 删除后自然消失），不再有「内置隐藏名单」机制（fillList 重建时也不过滤）。
			const randomPool = loadIdSet(LS_MUSIC_RANDOM);   // 随机(洗牌)用的勾选池（空=全部）
			// 音乐列表运行时拉取（build 不再内嵌）：GET /theme-mediascape-assets/music/list
			// 返回 [{id, name, cover, url, custom}]，含封面与在线下载的音乐。
			// 注意：列表加载是异步的，但 dock 按钮必须同步先挂载——async 函数首个 await 会
			// 挂起整个函数体，导致「乐」按钮比其它按钮晚出现（开机动画放完才出来）。
			// 因此按钮/面板/播放器全部同步创建，fetch 列表改由下方 fillList() 异步填充。
			let list = [];
			async function fillList() {
				try {
					const resp = await ffFetch("/theme-mediascape-assets/music/list");
					if (resp.ok) {
						const listData = await resp.json();
						// 2026-09-2x 删 hidden 过滤：音乐移除=真实删除服务端文件（列表来自服务端扫描，
						// 删除后自然消失），不再需要「内置隐藏名单」机制。
						list = (listData.items || [])
							.map((m) => Object.assign({}, m, { custom: m.custom === false ? false : true }));
						buildPicker();
						refresh();
						// 启动播放策略（theme-studio/playback.json → PLAYBACK_CONFIG）：musicAutoPlay=false（默认）时
						// 只填充列表不自动播放，点「乐」/选曲后才播（2026-09-21 阶段3 定稿）。
						if (PLAYBACK_CONFIG.musicAutoPlay && !audio.src && list.length) loadAndPlay(0);
						return;
					}
				} catch (e) { /* 服务器不可达则列表为空（内置已不内嵌） */ }
				list = (Array.isArray(MUSIC) ? MUSIC : [])
					.map((m) => Object.assign({}, m, { custom: false }));
				buildPicker();
				refresh();
			}
			// ── 2026-09-2x 挂公共上传/移除钩子（upload.js 公共函数 uploadFiles/removeItems 访问闭包内列表/刷新/落地）──
			window.__mediascapeDshRefreshMusic = () => fillList();
			window.__mediascapeDshMusicItems = () => list;
			window.__mediascapeDshAfterMusicUpload = () => {
				// 公共 uploadFiles 已在结束后刷新 list；无播放时自动播第一首（保留原「＋添加」语义）
				if (!audio.src && list.length) loadAndPlay(0);
				else buildPicker();
			};
			const audio = new Audio();
			audio.volume = 0.9;
			// 2026-09-2x：挂全局引用——apply 幂等清理时停掉独立 Audio() 实例（不在 DOM，
			// 否则重复 apply 时旧实例继续播放 → 音乐声音叠加）
			window.__mediascapeDshMusicAudio = audio;
			let current = -1;
			let mode = localStorage.getItem(LS_MUSIC_MODE) || "list"; // single | list | shuffle
			let playing = false;
			let seeking = false;
			const coverCache = new Map();   // 歌曲 id -> 封面 objectURL（null = 无内嵌封面）
			const customCovers = new Map(); // 歌曲 id -> 用户手动指定封面 objectURL
			const selected = new Set();     // 选择面板里的勾选（移除/随机 共用临时选择）

			const MODES = { single: "单曲", list: "列表", shuffle: "随机" };

			// ─ 封面提取：MP3(ID3v2 APIC) / FLAC(PICTURE 块) ─
			function parseSyncsafeSize(v, i) { return ((v[i] & 127) << 21) | ((v[i + 1] & 127) << 14) | ((v[i + 2] & 127) << 7) | (v[i + 3] & 127); }
			function readFourCC(v, i) { return String.fromCharCode(v[i], v[i + 1], v[i + 2], v[i + 3]); }
			function str(v, s, e) { let r = ""; for (let i = s; i < e && i < v.length; i++) r += String.fromCharCode(v[i]); return r; }
			function flacPicture(b) {
				const u32 = (i) => ((b[i] << 24) >>> 0) | ((b[i + 1] << 16)) | ((b[i + 2] << 8)) | b[i + 3];
				let offset = 4; // 跳过 picture type
				const ml = u32(offset); offset += 4;
				if (offset + ml > b.length) return null;
				const mime = str(b, offset, offset + ml); offset += ml;
				const dl = u32(offset); offset += 4; offset += dl; // 描述
				offset += 4 + 4 + 4 + 4; // width / height / depth / colors
				const il = u32(offset); offset += 4;
				if (offset + il > b.length) return null;
				return { mime: mime || "image/jpeg", data: b.slice(offset, offset + il) };
			}
			function extractCover(buf) {
				const v = new Uint8Array(buf);
				if (v.length < 12) return null;
				// ID3v2（MP3）
				if (v[0] === 0x49 && v[1] === 0x44 && v[2] === 0x33) {
					const ver = v[3];
					const tagSize = parseSyncsafeSize(v, 6);
					let off = 10;
					const end = Math.min(10 + tagSize, v.length);
					while (off + 10 <= end) {
						const id = readFourCC(v, off);
						if (!/[A-Z]/.test(id[0])) break;
						const fsize = ver === 4 ? parseSyncsafeSize(v, off + 4) : ((v[off + 4] << 24) | (v[off + 5] << 16) | (v[off + 6] << 8) | v[off + 7]);
						if (fsize <= 0 || off + 10 + fsize > v.length) break;
						if (id === "APIC") {
							const body = v.slice(off + 10, off + 10 + fsize);
							const enc = body[0];
							let marker = 1;
							while (marker < body.length && body[marker] !== 0) marker++;
							if (marker >= body.length) break;
							const mime = str(body, 1, marker);
							let quoteStart = marker + 2; // 跳过 null + 图片类型字节
							let dataStart = quoteStart;
							if (enc === 1 || enc === 2) {
								while (dataStart + 1 < body.length && !(body[dataStart] === 0 && body[dataStart + 1] === 0)) dataStart += 2;
								dataStart += 2;
							} else {
								while (dataStart < body.length && body[dataStart] !== 0) dataStart++;
								if (dataStart < body.length) dataStart += 1;
							}
							const img = body.slice(dataStart);
							if (img.length > 64) return { mime: mime || "image/jpeg", data: img };
						}
						off += 10 + fsize;
					}
					return null;
				}
				// FLAC：fLaC，扫描 PICTURE 元数据块（type 6）
				if (v[0] === 0x66 && v[1] === 0x4c && v[2] === 0x61 && v[3] === 0x43) {
					let offset = 4;
					while (offset + 4 <= v.length) {
						const last = (v[offset] & 0x80) !== 0;
						const type = v[offset] & 0x7f;
						const len = (v[offset + 1] << 16) | (v[offset + 2] << 8) | v[offset + 3];
						offset += 4;
						if (type === 6 && offset + len <= v.length) return flacPicture(v.slice(offset, offset + len));
						if (last) break;
						offset += len;
					}
					return null;
				}
				return null;
			}
			function dataUriToBuffer(uri) {
				const comma = uri.indexOf(",");
				if (comma < 0) return null;
				const meta = uri.slice(0, comma);
				const payload = uri.slice(comma + 1);
				if (/;base64/i.test(meta)) {
					const bin = atob(payload);
					const out = new Uint8Array(bin.length);
					for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
					return out.buffer;
				}
				let txt;
				try { txt = decodeURIComponent(payload); } catch (e) { txt = payload; }
				const out = new Uint8Array(txt.length);
				for (let i = 0; i < txt.length; i++) out[i] = txt.charCodeAt(i) & 0xff;
				return out.buffer;
			}
			async function resolveCover(item) {
				if (coverCache.has(item.id)) return;
				coverCache.set(item.id, null);
				if (customCovers.has(item.id)) { coverCache.set(item.id, customCovers.get(item.id)); return; }
				// 服务端返回的同名封面（music/music.json 指定或同名文件）：直接取 URL 作封面，最高优先
				if (item.cover) {
					try {
						const r = await ffFetch("/theme-mediascape-assets/music/" + encodeURIComponent(item.cover), {}, 20000);
						if (r.ok) {
							const blob = await r.blob();
							if (blob.size > 0) { coverCache.set(item.id, URL.createObjectURL(blob)); return; }
						}
					} catch (e) { /* 封面加载失败 → 继续走内嵌封面 */ }
				}
				// 内置歌曲：开箱即用的默认封面（知更鸟图）；无则回退 ♪ 占位
				if (!item.custom) { if (DEFAULT_COVER) coverCache.set(item.id, DEFAULT_COVER); return; }
				try {
					let buf;
					const src = item.url || item.data;
					if (item.file) buf = await item.file.arrayBuffer();
					else if (typeof src === "string" && src.indexOf("data:") === 0) buf = dataUriToBuffer(src);
					else { const r = await ffFetch(src, {}, 20000); if (!r.ok) return; buf = await r.arrayBuffer(); }
					if (!buf) return;
					const art = extractCover(buf);
					if (art && art.data && art.data.length) {
						coverCache.set(item.id, URL.createObjectURL(new Blob([art.data], { type: art.mime || "image/jpeg" })));
					}
				} catch (e) { /* 解析失败视为无内嵌封面 */ }
			}

			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "mediascape-dsh-music-toggle mediascape-dsh-dock-btn";
			btn.textContent = "乐";
			btn.title = "背景音乐开关";
			dock.appendChild(btn);

			const card = document.createElement("div");
			card.className = "mediascape-dsh-music-card";
			card.innerHTML =
				'<div class="mediascape-dsh-music-top"><span class="mediascape-dsh-music-title">—</span>' +
				'<button class="mediascape-dsh-music-shrink" data-act="shrink" type="button" title="收起面板">收起</button>' +
				'<button class="mediascape-dsh-music-close" type="button" title="收起">×</button></div>' +
				'<div class="mediascape-dsh-music-disc-wrap" title="点击播放/暂停">' +
					'<div class="mediascape-dsh-music-disc"><div class="mediascape-dsh-music-cover"><span class="mediascape-dsh-music-lbl">♪</span></div><div class="mediascape-dsh-music-hub"></div></div>' +
				'</div>' +
				'<div class="mediascape-dsh-music-seek-row">' +
					'<span class="mediascape-dsh-music-time mediascape-dsh-music-cur">0:00</span>' +
					'<input class="mediascape-dsh-music-seek" type="range" min="0" max="100" step="0.01" value="0">' +
					'<span class="mediascape-dsh-music-time mediascape-dsh-music-dur">0:00</span>' +
				'</div>' +
				'<div class="mediascape-dsh-music-row">' +
					'<button class="mediascape-dsh-music-btn" data-act="prev" type="button" title="上一首">⏮</button>' +
					'<button class="mediascape-dsh-music-btn mediascape-dsh-music-play" data-act="play" type="button" title="播放/暂停">▶</button>' +
					'<button class="mediascape-dsh-music-btn" data-act="next" type="button" title="下一首">⏭</button>' +
					'<button class="mediascape-dsh-music-btn mediascape-dsh-music-mode" data-act="mode" type="button" title="循环模式">列表</button>' +
				'</div>' +
				'<div class="mediascape-dsh-music-row">' +
					'<button class="mediascape-dsh-music-btn" data-act="select" type="button" title="选择歌曲（勾选后移除/随机）">选择</button>' +
					// 2026-09-23 删「＋添加」：上传入口统一收归 dock「传」按钮（音乐/图片/视频一次多选）
					'<button class="mediascape-dsh-music-btn" data-act="cover" type="button" title="为当前歌曲指定封面">封面</button>' +
				'</div>';
			card.style.display = "none";
			dock.appendChild(card);

			// 歌单选择面板（勾选后移除，与壁纸选择器一致——2026-09-23 删随机按钮，
			// 随机播放走面板顶部模式按钮 shuffle）
			const picker = document.createElement("div");
			picker.className = "mediascape-dsh-ms-picker";
			picker.innerHTML =
				'<div class="mediascape-dsh-ms-picker-head">' +
					'<div class="mediascape-dsh-ms-picker-title">选择歌曲</div>' +
					'<button class="mediascape-dsh-bg-close" type="button" title="收起">—</button>' +
				'</div>' +
				'<div class="mediascape-dsh-ms-picker-list"></div>' +
				'<div class="mediascape-dsh-ms-picker-actions">' +
					'<button class="mediascape-dsh-bg-act mediascape-dsh-bg-remove" type="button">移除</button>' +
				'</div>';
			dock.appendChild(picker);

			const titleEl = card.querySelector(".mediascape-dsh-music-title");
			const playBtn = card.querySelector('[data-act="play"]');
			const modeBtn = card.querySelector('[data-act="mode"]');
			const shrinkBtn = card.querySelector('[data-act="shrink"]');
			const discEl = card.querySelector(".mediascape-dsh-music-disc");
			const coverEl = card.querySelector(".mediascape-dsh-music-cover");
			const lblEl = card.querySelector(".mediascape-dsh-music-lbl");
			const seekEl = card.querySelector(".mediascape-dsh-music-seek");
			const timeCur = card.querySelector(".mediascape-dsh-music-cur");
			const timeDur = card.querySelector(".mediascape-dsh-music-dur");
			const pickerList = picker.querySelector(".mediascape-dsh-ms-picker-list");
			const pickerRemove = picker.querySelector(".mediascape-dsh-bg-remove");

