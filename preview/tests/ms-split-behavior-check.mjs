// 拆分后行为验证：mock DSH ctx 走 apply → registerAssets → 注册 webServer 前缀路由
// → 用假 req/res 实测列表/静态/上传路由分发（不依赖真实 DSH，不污染真实数据目录）
// ⚠️ 强制独立 DSH_HOME（不允许继承环境变量，防写入真实数据目录）
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { registerAssets, apply } from '../../lib/index.js';

const D = '/tmp/ms-split-test-home';
process.env.DSH_HOME = D;

let registeredHandler = null;
const fakeWctx = { get: (k) => k === 'webServer' ? { register: (cfg) => { registeredHandler = cfg.handler; } } : undefined };
let injectCalled = false;
const fakeCtx = {
  inject(services, cb) { injectCalled = true; if (services.includes('webServer')) cb(fakeWctx); },
};

// ── 1) apply 注册链路 ──
const wired = apply(fakeCtx);
console.log('apply 返回:', wired, '| inject 被调:', injectCalled, '| handler 已注册:', !!registeredHandler);

// ── 2) 假 req/res 工具 ──
function makeRes() {
  let status = 0, body = '', headers = {};
  return {
    headers,
    writeHead(s, h) { status = s; headers = h || {}; },
    end(b) { body = typeof b === 'string' ? b : String(b ?? ''); },
    get status() { return status; }, get body() { return body; },
  };
}
function makeReq(method, url) {
  const handlers = {};
  return { method, url, on: (ev, cb) => { handlers[ev] = cb; }, emit(ev, data) { handlers[ev]?.(data); } };
}

// ── 0) 构造隔离初始状态（真实壁纸文件 + labels，防 list 空目录假阴性）──
rmSync(D, { recursive: true, force: true });
mkdirSync(join(D, 'theme-firefly', 'wallpapers'), { recursive: true });
writeFileSync(join(D, 'theme-firefly', 'wallpapers', 'custom-demo123.mp4'), 'demo-content', 'utf8');
writeFileSync(join(D, 'theme-firefly', 'wallpapers', '.labels.json'), JSON.stringify({ 'custom-demo123': '演示壁纸' }), 'utf8');

// ── 3) GET wallpapers/list ──
{
  const res = makeRes();
  registeredHandler(makeReq('GET', '/theme-mediascape-assets/wallpapers/list'), res);
  const ok = res.status === 200 && res.body.includes('custom-demo123') && res.body.includes('演示壁纸');
  console.log('list:', ok ? 'PASS' : 'FAIL', `(status=${res.status})`, res.body.slice(0, 120));
}

// ── 4) 404 检查（白名单外目录）──
{
  const res = makeRes();
  registeredHandler(makeReq('GET', '/theme-mediascape-assets/evil/x.png'), res);
  console.log('白名单拦截:', res.status === 404 ? 'PASS' : 'FAIL', `(status=${res.status})`);
}

// ── 5) 上传 400（无 body；与 HEAD 旧版行为比对一致）──
{
  const res = makeRes();
  const req = makeReq('POST', '/theme-mediascape-assets/upload');
  registeredHandler(req, res); // 先注册再发事件（真实 Node 流语义）
  req.emit('data', Buffer.from(''));
  req.emit('end');
  await new Promise((r) => setTimeout(r, 50)); // 上传为流式异步，等 writeHead 落定
  const ok = res.status === 400;
  console.log('上传空 body 拒绝:', ok ? 'PASS' : 'FAIL', `(status=${res.status})`);
}

// ── 6) DELETE 不存在（与旧版一致返回 400）──
{
  const res = makeRes();
  registeredHandler(makeReq('DELETE', '/theme-mediascape-assets/wallpapers/custom-not-exist.mp4'), res);
  const ok = res.status === 400;
  console.log('删除不存在文件(400=与旧版一致):', ok ? 'PASS' : 'FAIL', `(status=${res.status})`);
}

// ── 7) DELETE 存在文件（200）──
{
  const res = makeRes();
  registeredHandler(makeReq('DELETE', '/theme-mediascape-assets/wallpapers/custom-demo123.mp4'), res);
  const ok = res.status === 200;
  console.log('删除存在文件:', ok ? 'PASS' : 'FAIL', `(status=${res.status})`);
}