		// ═══════════ 7.5 背景音乐播放器 ═══════════
		const LS_MUSIC_MODE = "ff_music_mode";
		const LS_MUSIC_ID = "ff_music_id";
		async function startMusic(dock) {
			const LS_MUSIC_HIDDEN = "ff_music_hidden";
			const LS_MUSIC_RANDOM = "ff_music_random";
			function loadIdSet(key) {
				try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); }
				catch (e) { return new Set(); }
			}
			function saveIdSet(key, set) {
				try { localStorage.setItem(key, JSON.stringify([...set])); } catch (e) {}
			}
			const hidden = loadIdSet(LS_MUSIC_HIDDEN);       // 内置歌曲「移除」后的隐藏名单
			const randomPool = loadIdSet(LS_MUSIC_RANDOM);   // 随机(洗牌)用的勾选池（空=全部）
			// 音乐列表运行时拉取（build 不再内嵌）：GET /theme-mediascape-assets/music/list
			// 返回 [{id, name, cover, url, custom}]，含封面与在线下载的音乐。
			let list = [];
			try {
				const resp = await fetch("/theme-mediascape-assets/music/list");
				if (resp.ok) {
					const data = await resp.json();
					list = (data.items || [])
						.filter((m) => !hidden.has(m.id))
						.map((m) => Object.assign({}, m, { custom: m.custom === false ? false : true }));
				}
			} catch (e) { /* 服务器不可达则列表为空（内置已不内嵌） */ }
			if (list.length === 0) {
				list = (Array.isArray(MUSIC) ? MUSIC : [])
					.filter((m) => !hidden.has(m.id))
					.map((m) => Object.assign({}, m, { custom: false }));
			}
			const audio = new Audio();
			audio.volume = 0.9;
			let current = -1;
			let mode = localStorage.getItem(LS_MUSIC_MODE) || "list"; // single | list | shuffle
			let playing = false;
			let seeking = false;
			const coverCache = new Map();   // 歌曲 id -> 封面 objectURL（null = 无内嵌封面）
			const customCovers = new Map(); // 歌曲 id -> 用户手动指定封面 objectURL
			const selected = new Set();     // 选择面板里的勾选（移除/随机 共用临时选择）

			const MODES = { single: "单曲", list: "列表", shuffle: "随机" };

			// ─ 封面提取：MP3(ID3v2 APIC) / FLAC(PICTURE 块) ─
			function ss(v, i) { return ((v[i] & 127) << 21) | ((v[i + 1] & 127) << 14) | ((v[i + 2] & 127) << 7) | (v[i + 3] & 127); }
			function a4(v, i) { return String.fromCharCode(v[i], v[i + 1], v[i + 2], v[i + 3]); }
			function str(v, s, e) { let r = ""; for (let i = s; i < e && i < v.length; i++) r += String.fromCharCode(v[i]); return r; }
			function flacPicture(b) {
				const u32 = (i) => ((b[i] << 24) >>> 0) | ((b[i + 1] << 16)) | ((b[i + 2] << 8)) | b[i + 3];
				let o = 4; // 跳过 picture type
				const ml = u32(o); o += 4;
				if (o + ml > b.length) return null;
				const mime = str(b, o, o + ml); o += ml;
				const dl = u32(o); o += 4; o += dl; // 描述
				o += 4 + 4 + 4 + 4; // width / height / depth / colors
				const il = u32(o); o += 4;
				if (o + il > b.length) return null;
				return { mime: mime || "image/jpeg", data: b.slice(o, o + il) };
			}
			function extractCover(buf) {
				const v = new Uint8Array(buf);
				if (v.length < 12) return null;
				// ID3v2（MP3）
				if (v[0] === 0x49 && v[1] === 0x44 && v[2] === 0x33) {
					const ver = v[3];
					const tagSize = ss(v, 6);
					let off = 10;
					const end = Math.min(10 + tagSize, v.length);
					while (off + 10 <= end) {
						const id = a4(v, off);
						if (!/[A-Z]/.test(id[0])) break;
						const fsize = ver === 4 ? ss(v, off + 4) : ((v[off + 4] << 24) | (v[off + 5] << 16) | (v[off + 6] << 8) | v[off + 7]);
						if (fsize <= 0 || off + 10 + fsize > v.length) break;
						if (id === "APIC") {
							const body = v.slice(off + 10, off + 10 + fsize);
							const enc = body[0];
							let m = 1;
							while (m < body.length && body[m] !== 0) m++;
							if (m >= body.length) break;
							const mime = str(body, 1, m);
							let q = m + 2; // 跳过 null + 图片类型字节
							let d = q;
							if (enc === 1 || enc === 2) {
								while (d + 1 < body.length && !(body[d] === 0 && body[d + 1] === 0)) d += 2;
								d += 2;
							} else {
								while (d < body.length && body[d] !== 0) d++;
								if (d < body.length) d += 1;
							}
							const img = body.slice(d);
							if (img.length > 64) return { mime: mime || "image/jpeg", data: img };
						}
						off += 10 + fsize;
					}
					return null;
				}
				// FLAC：fLaC，扫描 PICTURE 元数据块（type 6）
				if (v[0] === 0x66 && v[1] === 0x4c && v[2] === 0x61 && v[3] === 0x43) {
					let o = 4;
					while (o + 4 <= v.length) {
						const last = (v[o] & 0x80) !== 0;
						const type = v[o] & 0x7f;
						const len = (v[o + 1] << 16) | (v[o + 2] << 8) | v[o + 3];
						o += 4;
						if (type === 6 && o + len <= v.length) return flacPicture(v.slice(o, o + len));
						if (last) break;
						o += len;
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
						const r = await fetch("/theme-mediascape-assets/music/" + encodeURIComponent(item.cover));
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
					else { const r = await fetch(src); if (!r.ok) return; buf = await r.arrayBuffer(); }
					if (!buf) return;
					const art = extractCover(buf);
					if (art && art.data && art.data.length) {
						coverCache.set(item.id, URL.createObjectURL(new Blob([art.data], { type: art.mime || "image/jpeg" })));
					}
				} catch (e) { /* 解析失败视为无内嵌封面 */ }
			}

			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "ff-music-toggle ff-dock-btn";
			btn.textContent = "乐";
			btn.title = "背景音乐开关";
			dock.appendChild(btn);

			const card = document.createElement("div");
			card.className = "ff-music-card";
			card.innerHTML =
				'<div class="ff-music-top"><span class="ff-music-title">—</span>' +
				'<button class="ff-music-shrink" data-act="shrink" type="button" title="收起面板">收起</button>' +
				'<button class="ff-music-close" type="button" title="收起">×</button></div>' +
				'<div class="ff-music-disc-wrap" title="点击播放/暂停">' +
					'<div class="ff-music-disc"><div class="ff-music-cover"><span class="ff-music-lbl">♪</span></div><div class="ff-music-hub"></div></div>' +
				'</div>' +
				'<div class="ff-music-seek-row">' +
					'<span class="ff-music-time ff-music-cur">0:00</span>' +
					'<input class="ff-music-seek" type="range" min="0" max="100" step="0.01" value="0">' +
					'<span class="ff-music-time ff-music-dur">0:00</span>' +
				'</div>' +
				'<div class="ff-music-row">' +
					'<button class="ff-music-btn" data-act="prev" type="button" title="上一首">⏮</button>' +
					'<button class="ff-music-btn ff-music-play" data-act="play" type="button" title="播放/暂停">▶</button>' +
					'<button class="ff-music-btn" data-act="next" type="button" title="下一首">⏭</button>' +
					'<button class="ff-music-btn ff-music-mode" data-act="mode" type="button" title="循环模式">列表</button>' +
				'</div>' +
				'<div class="ff-music-row">' +
					'<button class="ff-music-btn" data-act="select" type="button" title="选择歌曲（勾选后移除/随机）">选择</button>' +
					'<button class="ff-music-btn" data-act="add" type="button" title="导入本机歌曲">＋添加</button>' +
					'<button class="ff-music-btn" data-act="cover" type="button" title="为当前歌曲指定封面">封面</button>' +
				'</div>';
			card.style.display = "none";
			dock.appendChild(card);

			// 歌单选择面板（勾选后移除 / 随机，类似壁纸选择器）
			const picker = document.createElement("div");
			picker.className = "ff-ms-picker";
			picker.innerHTML =
				'<div class="ff-ms-picker-head">' +
					'<div class="ff-ms-picker-title">选择歌曲</div>' +
					'<button class="ff-bg-close" type="button" title="收起">—</button>' +
				'</div>' +
				'<div class="ff-ms-picker-list"></div>' +
				'<div class="ff-ms-picker-actions">' +
					'<button class="ff-bg-act ff-bg-remove" type="button">移除</button>' +
					'<button class="ff-bg-act ff-ms-random" type="button">随机</button>' +
				'</div>';
			dock.appendChild(picker);

			const titleEl = card.querySelector(".ff-music-title");
			const playBtn = card.querySelector('[data-act="play"]');
			const modeBtn = card.querySelector('[data-act="mode"]');
			const shrinkBtn = card.querySelector('[data-act="shrink"]');
			const discEl = card.querySelector(".ff-music-disc");
			const coverEl = card.querySelector(".ff-music-cover");
			const lblEl = card.querySelector(".ff-music-lbl");
			const seekEl = card.querySelector(".ff-music-seek");
			const timeCur = card.querySelector(".ff-music-cur");
			const timeDur = card.querySelector(".ff-music-dur");
			const pickerList = picker.querySelector(".ff-ms-picker-list");
			const pickerRemove = picker.querySelector(".ff-bg-remove");
			const pickerRandom = picker.querySelector(".ff-ms-random");

