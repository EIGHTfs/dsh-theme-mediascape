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

		// ── 纯 JS SHA-1（浏览器端）：crypto.subtle 在 http（非 secure context）不可用，
		//    音乐导入的 hash 键（40 位 hex，内容寻址去重）必须自算，不能依赖 WebCrypto。
		//    算法为标准 FIPS 180-1，输入 Uint8Array，输出小写 40 位 hex。
