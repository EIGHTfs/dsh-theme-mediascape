		// ═══════════ 4. 开屏变身动画（GIF 版）═══════════
// 运行时配置：GIF/boot.json（{file, durationMs}），fetch 失败回退 build 注入的 GIF_DATA。
let bootGifUrl = GIF_DATA;
let bootDurationMs = 10000;
async function loadBootGifConfig() {
  try {
    const resp = await fetch("/theme-mediascape-assets/GIF/boot.json");
    if (!resp.ok) return;
    const cfg = await resp.json();
    if (cfg && typeof cfg.file === "string" && cfg.file) bootGifUrl = "/theme-mediascape-assets/GIF/" + encodeURIComponent(cfg.file);
    if (cfg && Number.isFinite(+cfg.durationMs) && +cfg.durationMs > 0) bootDurationMs = +cfg.durationMs;
  } catch { /* 网络/解析失败保留默认，不影响开屏 */ }
}
function buildBootOverlay() {
	const ov = document.createElement("div");
	ov.className = "ff-boot";
	ov.innerHTML =
		'<img class="ff-gif" src="' + bootGifUrl + '" alt="流萤变身">' +
		'<div class="ff-title">流萤 // FIREFLY</div>' +
		'<div class="ff-sub">萤火归位 · 变身完成</div>' +
		'<button class="ff-skip" type="button">点击跳过</button>';
	return ov;
}

async function playTransformIntro() {
	if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	await loadBootGifConfig(); // 读 GIF/boot.json（改配置刷新即生效，无需重新 build）
	const ov = buildBootOverlay();
	document.body.appendChild(ov);
	let done = false;
	const timers = [];
	const finish = () => {
		if (done) return;
		done = true;
		timers.forEach(clearTimeout);
		ov.classList.add("gone");
		setTimeout(() => ov.remove(), 520);
	};
	ov.querySelector(".ff-skip").addEventListener("click", finish);
	ov.addEventListener("click", (e) => { if (e.target === ov) finish(); });
	// 播放时长取配置 durationMs（缺省 10s）；点击可随时跳过
	timers.push(setTimeout(finish, bootDurationMs));
}

