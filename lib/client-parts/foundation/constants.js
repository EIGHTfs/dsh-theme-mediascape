		const THEME_ID = "dsh-theme-mediascape";
		// ── 启动播放策略（build 注入）：来自 theme-studio/playback.json（2026-09-21 阶段3）。
		// 视频壁纸/背景音乐启动时是否自动播放；缺失/非法 → 降级为默认 { 视频自动播, 音乐不自动播 }，
		// 与定稿默认一致（视频 true / 音乐 false），不崩溃。
		const PLAYBACK_CONFIG = /*__PLAYBACK_START__*/{ videoAutoPlay: true, musicAutoPlay: false }/*__PLAYBACK_END__*/;
		const LS_AMBIENCE = "mediascape-dsh-ambience";
		const LS_TYPESOUND = "mediascape-dsh-type";
		const LS_BG = "mediascape-dsh-bg-id";               // 当前壁纸 id（图片层 id；无视频开关时兼容旧值）
		const LS_BG_VIDEO = "mediascape-dsh-bg-video-on";   // 视频覆盖开关 "1"|"0"
		const LS_BG_VID = "mediascape-dsh-bg-vid-id";       // 视频层当前 id
		const LS_BG_MODE = "mediascape-dsh-bg-mode";
		const LS_BG_INTERVAL = "mediascape-dsh-bg-interval";

		// ── 旧前缀键迁移（2026-09-21 前缀统一 ff_ → mediascape-dsh-）──
		// 键名从 ff_* 改为 mediascape-dsh-*（含 font/wallpaper/typesound/music/dock 各模块本文件之外定义的旧键），
		// 启动时把旧键值搬到新键并删除旧键，避免用户已保存的设置（壁纸/音乐/字号/声音）在升级后丢失。
		const LS_LEGACY_KEYS = {
			"ff_ambience": "mediascape-dsh-ambience",
			"ff_type": "mediascape-dsh-type",
			"ff_bg_id": "mediascape-dsh-bg-id",
			"ff_bg_video_on": "mediascape-dsh-bg-video-on",
			"ff_bg_vid_id": "mediascape-dsh-bg-vid-id",
			"ff_bg_mode": "mediascape-dsh-bg-mode",
			"ff_bg_interval": "mediascape-dsh-bg-interval",
			"ff_bg_random": "mediascape-dsh-bg-random",
			"ff_font_scale": "mediascape-dsh-font-scale",
			"ff_vol": "mediascape-dsh-vol",
			"ff_muted": "mediascape-dsh-muted",
			"ff_music_mode": "mediascape-dsh-music-mode",
			"ff_music_id": "mediascape-dsh-music-id",
			"ff_music_random": "mediascape-dsh-music-random",
			"ff_dock_pos": "mediascape-dsh-dock-pos",
			// 2026-09-2x 删 hidden 迁移：移除=真实删除服务端文件后 hidden 机制废弃，旧名键不再迁移
		};
		function migrateLegacyKeys() {
			for (const oldKey in LS_LEGACY_KEYS) {
				const oldValue = localStorage.getItem(oldKey);
				if (oldValue === null) continue;     // 旧键不存在 → 无迁移
				if (localStorage.getItem(LS_LEGACY_KEYS[oldKey]) === null) {
					localStorage.setItem(LS_LEGACY_KEYS[oldKey], oldValue); // 新键未有值才搬，避免覆盖新写入
				}
				localStorage.removeItem(oldKey);     // 迁移完删旧键（幂等）
			}
		}

		// ── 纯 JS SHA-1（浏览器端）：crypto.subtle 在 http（非 secure context）不可用，
		//    音乐导入的 hash 键（40 位 hex，内容寻址去重）必须自算，不能依赖 WebCrypto。
		//    算法为标准 FIPS 180-1，输入 Uint8Array，输出小写 40 位 hex。
