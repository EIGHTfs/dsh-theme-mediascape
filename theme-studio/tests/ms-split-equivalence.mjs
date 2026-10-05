// ── 环境自推导（公开插件可移植）：pwviewer / pwviewer-libs / fonts 为仓库邻居目录
// （<harness>/pwviewer 等），从本文件位置向上搜索；env 可覆盖：PW_ROOT / MS_CHROMELIBS / MS_FONTCONF /
// MS_CHROME / MS_BROWSERS / MS_PWIMPORT。找不到时留空（浏览器测试需 env 提供）。
import { fileURLToPath as fURL, pathToFileURL as pURL } from 'node:url';
import { dirname as dName, join as jn, resolve as rslv } from 'node:path';
import { existsSync as exSync } from 'node:fs';
const SELF_DIR = dName(fURL(import.meta.url));
function findNeighbor(name, up = 8) {
  let d = SELF_DIR;
  for (let i = 0; i < up; i++) {
    if (exSync(jn(d, name))) return jn(d, name);
    d = rslv(d, '..');
  }
  return null;
}
const PW_ROOT = process.env.PW_ROOT || findNeighbor('pwviewer');
const PW_BROWSERS = process.env.MS_BROWSERS || (PW_ROOT ? jn(PW_ROOT, 'browsers') : '');
const CHROME = process.env.MS_CHROME || (PW_ROOT
  ? jn(PW_BROWSERS, exSync(jn(PW_BROWSERS, 'chromium-1243')) ? 'chromium-1243/chrome-linux64/chrome' : 'chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell')
  : '');
const MS_LIBS = process.env.MS_CHROMELIBS || findNeighbor('pwviewer-libs');
const MS_FONTS = process.env.MS_FONTCONF || (() => { const f = findNeighbor('fonts'); return f ? jn(f, 'fonts.conf') : ''; })();
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.MS_BROWSERS || PW_BROWSERS || process.env.PLAYWRIGHT_BROWSERS_PATH || '';
const PW_IMPORT = process.env.MS_PWIMPORT || (PW_ROOT ? pURL(jn(PW_ROOT, 'node_modules', 'playwright', 'index.mjs')).href : '');
const { chromium } = await import(PW_IMPORT);

// 拆分等价比对（回归基线）：旧(HEAD 单文件) vs 新(拆分模块)，同一组输入逐项 diff。
// 用法：node theme-studio/tests/ms-split-equivalence.mjs 0   # 旧
//       node theme-studio/tests/ms-split-equivalence.mjs 1   # 新
// 两个输出应逐字节一致（除模块加载方式差异）。
const which = process.argv[2] || 'x';
const HOME = '/tmp/ms-cmp-home-' + which;
process.env.DSH_HOME = HOME;
const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
const { join } = await import('node:path');
rmSync(HOME, { recursive: true, force: true });
mkdirSync(join(HOME, 'theme-mediascape', 'wallpapers'), { recursive: true });
writeFileSync(join(HOME, 'theme-mediascape', 'wallpapers', '.labels.json'), JSON.stringify({ 'custom-abc12345': '测试壁纸' }), 'utf8');
writeFileSync(join(HOME, 'theme-mediascape', 'wallpapers', 'custom-abc12345.mp4'), 'demo-content-123', 'utf8');

const ROOT = rslv(SELF_DIR, '..', '..');
// 旧版需先还原单文件：git show HEAD:lib/index.js > /tmp/ms-old-lib/old-index.mjs
const modUrl = which === '0' ? 'file:///tmp/ms-old-lib/old-index.mjs' : ROOT + '/lib/index.js';
const { apply } = await import(modUrl + '?t=' + Date.now());

let handler;
const fakeWctx = { get: (k) => k === 'webServer' ? { register: (cfg) => { handler = cfg.handler; } } : undefined };
const fakeCtx = { inject(svcs, cb) { if (svcs.includes('webServer')) cb(fakeWctx); } };
apply(fakeCtx);

function makeRes() { let s=0,b='',h={}; return { writeHead(x,y){s=x;h=y||{};}, end(x){b=typeof x==='string'?x:String(x??'');}, get status(){return s;}, get body(){return b;} }; }
function makeReq(method,url){ const ev={}; return { method, url, on:(k,cb)=>{ev[k]=cb;}, emit:(k,d)=>ev[k]?.(d) }; }

const out = {};
{ const res = makeRes(); handler({ method:'GET', url:'/theme-mediascape-assets/wallpapers/list' }, res); out.list = { status: res.status, body: res.body }; }
{ const res = makeRes(); handler({ method:'GET', url:'/theme-mediascape-assets/evil/x.png' }, res); out.evil = res.status; }
{ const res = makeRes(); handler({ method:'DELETE', url:'/theme-mediascape-assets/wallpapers/none.mp4' }, res); out.delMissing = res.status; }
{ const res = makeRes(); handler({ method:'DELETE', url:'/theme-mediascape-assets/wallpapers/custom-abc12345.mp4' }, res); out.delExist = res.status; }
{ const res = makeRes(); const req = makeReq('POST','/theme-mediascape-assets/upload'); handler(req,res); req.emit('data', Buffer.from('')); req.emit('end'); await new Promise(r=>setTimeout(r,50)); out.uploadEmpty = res.status; }
console.log(JSON.stringify(out));
