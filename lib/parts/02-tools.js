		function sha1Hex(bytes) {
			const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
			const len = data.length;
			const padded = new Uint8Array(((len + 8) >> 6 << 6) + 64); // 至少再加 1 个 64 字节块
			padded.set(data);
			padded[len] = 0x80;
			const dv = new DataView(padded.buffer);
			dv.setUint32(padded.length - 8, Math.floor(len / 0x20000000), false); // 高位 32bit
			dv.setUint32(padded.length - 4, (len * 8) >>> 0, false);             // 低位 32bit（bit 长度）
			const w = new Uint32Array(80);
			let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
			const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
			for (let i = 0; i < padded.length; i += 64) {
				for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4, false);
				for (let j = 16; j < 80; j++) {
					w[j] = rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
				}
				let a = h0, b = h1, c = h2, d = h3, e = h4;
				for (let j = 0; j < 80; j++) {
					let f, k;
					if (j < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
					else if (j < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
					else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
					else { f = b ^ c ^ d; k = 0xCA62C1D6; }
					const t = (rotl(a, 5) + f + e + k + w[j]) >>> 0;
					e = d; d = c; c = rotl(b, 30); b = a; a = t;
				}
				h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
			}
			const out = [h0, h1, h2, h3, h4];
			return out.map((v) => ("00000000" + v.toString(16)).slice(-8)).join("");
		}

		// ── 共享 IndexedDB（壁纸 / 音乐 / 封面 三张表，v2 起）──
		const FF_DB_NAME = "dsh-theme-mediascape";
		const FF_DB_VERSION = 2;
		function ffIdbOpen() {
			return new Promise((resolve, reject) => {
				if (typeof indexedDB === "undefined") return reject(new Error("no idb"));
				const req = indexedDB.open(FF_DB_NAME, FF_DB_VERSION);
				req.onupgradeneeded = () => {
					const db = req.result;
					["wallpapers", "music", "covers"].forEach((s) => {
						if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
					});
				};
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			});
		}
		function ffIdbGetAll(store) {
			return ffIdbOpen().then((db) => new Promise((resolve) => {
				const req = db.transaction(store, "readonly").objectStore(store).getAll();
				req.onsuccess = () => { db.close(); resolve(req.result || []); };
				req.onerror = () => { db.close(); resolve([]); };
			})).catch(() => []);
		}
		function ffIdbPut(store, record) {
			return ffIdbOpen().then((db) => new Promise((resolve) => {
				const tx = db.transaction(store, "readwrite");
				tx.objectStore(store).put(record);
				tx.oncomplete = () => { db.close(); resolve(); };
				tx.onerror = () => { db.close(); resolve(); };
			})).catch(() => {});
		}
		function ffIdbDelete(store, key) {
			return ffIdbOpen().then((db) => new Promise((resolve) => {
				const tx = db.transaction(store, "readwrite");
				tx.objectStore(store).delete(key);
				tx.oncomplete = () => { db.close(); resolve(); };
				tx.onerror = () => { db.close(); resolve(); };
			})).catch(() => {});
		}

