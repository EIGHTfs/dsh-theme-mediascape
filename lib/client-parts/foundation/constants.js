		const THEME_ID = "dsh-theme-mediascape";
		const LS_AMBIENCE = "ff_ambience";
		const LS_TYPESOUND = "ff_type";
		const LS_BG = "ff_bg_id";
		const LS_BG_MODE = "ff_bg_mode";
		const LS_BG_INTERVAL = "ff_bg_interval";

		// ── 纯 JS SHA-1（浏览器端）：crypto.subtle 在 http（非 secure context）不可用，
		//    音乐导入的 hash 键（40 位 hex，内容寻址去重）必须自算，不能依赖 WebCrypto。
		//    算法为标准 FIPS 180-1，输入 Uint8Array，输出小写 40 位 hex。
