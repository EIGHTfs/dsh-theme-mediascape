// ── 环境自推导（公开插件可移植）：只依赖本文件位置，禁硬编码绝对路径 ──
// 被测对象：lib/client-parts/foundation/utils.js 的「媒体缓存门面」整段（localForage 单后端 + LRU）。
// 为什么不直接 import：client-parts 是 build 拼接用的**片段**（不是独立模块）⇒ 这里按标记切出该段，
//   用桩 localForage 求值后断言行为。若哪天标记或段落结构变了，本测试会**明确失败**（当作 canary）。
// env 覆盖：MS_UTILS=<utils.js 绝对路径>（缺省按本文件位置推导）。
import { readFileSync } from 'node:fs';
import { dirname as dName, join as jn, resolve as rslv } from 'node:path';
import { fileURLToPath as fURL } from 'node:url';
import { existsSync as exSync } from 'node:fs';

const SELF_DIR = dName(fURL(import.meta.url));
function findUp(rel, up = 8) {
  let d = SELF_DIR;
  for (let i = 0; i < up; i++) { const p = jn(d, rel); if (exSync(p)) return p; d = rslv(d, '..'); }
  return null;
}
const UTILS = process.env.MS_UTILS || findUp(jn('lib', 'client-parts', 'foundation', 'utils.js'));
let pass = 0, fail = 0, skipped = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  ✅ PASS ' + label); } else { fail++; console.log('  ❌ FAIL ' + label + (extra ? '  → ' + extra : '')); }
};
const skip = (label) => { skipped++; console.log('  ⏭️ SKIP ' + label); };

if (!UTILS || !exSync(UTILS)) {
  skip('未找到 utils.js（可用 MS_UTILS 指定）⇒ 无法验证缓存门面');
  console.log('  结果: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(0);
}
const src = readFileSync(UTILS, 'utf8');
const START = '// ── 媒体缓存门面';
const END = '// ── 文件选择器降载守卫';
const a = src.indexOf(START);
const b = src.indexOf(END);
if (a < 0 || b <= a) {
  console.log('  ❌ FAIL 未能按标记切出「媒体缓存门面」段（标记被改动？）');
  console.log('  结果: 0 PASS / 1 FAIL');
  process.exit(1);
}
const block = src.slice(a, b);

function makeStub() {
  const store = new Map();
  const calls = { config: [] };
  return {
    store, calls,
    config(o) { calls.config.push(o); },
    keys() { return Promise.resolve([...store.keys()]); },
    getItem(k) { return Promise.resolve(store.has(k) ? store.get(k) : null); },
    setItem(k, v) { store.set(k, v); return Promise.resolve(v); },
    removeItem(k) { store.delete(k); return Promise.resolve(); },
  };
}
function loadFacade(lf) {
  if (lf) globalThis.localforage = lf; else delete globalThis.localforage;
  const factory = new Function(block + '\nreturn { lfaPut, lfaGet, lfaTouch, lfaGetAll, lfaRemove, readCacheMeta, CACHE_MAX_BYTES };');
  return factory();
}
const blobOf = (n) => new Blob([new Uint8Array(n)], { type: 'image/jpeg' });

// ① 隔离配置 + ② put/get 往返 + 元数据累计
{
  const lf = makeStub();
  const api = loadFacade(lf);
  await api.lfaPut('coverart', { id: 'song-1', fp: '123', cover: blobOf(2048), lastUsed: 1 });
  ok(lf.calls.config.length === 1 && lf.calls.config[0].name === 'dsh-theme-mediascape' && lf.calls.config[0].storeName === 'media',
    '首次使用即隔离配置（name=dsh-theme-mediascape / store=media）');
  const got = await api.lfaGet('coverart', 'song-1');
  ok(!!(got && got.fp === '123' && got.cover && got.cover.size === 2048), 'lfaPut → lfaGet 往返（含指纹与图体）');
  const meta = await api.readCacheMeta();
  ok(meta.total === 2048 && !!meta.items['coverart:song-1'], '元数据累计正确（total=2048）', JSON.stringify(meta));
  await new Promise((r) => setTimeout(r, 5));
  await api.lfaTouch('coverart', 'song-1');
  ok((await api.readCacheMeta()).items['coverart:song-1'][1] > 1, 'lfaTouch 刷新 lastUsed');
  await api.lfaPut('other', { id: 'x', bytes: 16 });
  const only = await api.lfaGetAll('coverart');
  ok(only.length === 1 && only[0].id === 'song-1', 'lfaGetAll 只返回同 store 前缀记录（不串 store）', String(only.length));
  await api.lfaRemove('coverart', 'song-1');
  ok((await api.lfaGet('coverart', 'song-1')) === null, 'lfaRemove 后读不到');
  ok((await api.readCacheMeta()).total === 16, 'lfaRemove 后总量正确扣减', JSON.stringify(await api.readCacheMeta()));
}
// ③ LRU 逐出（预算 8MiB ⇒ 塞 3×4MiB 必逐出最旧）
{
  const api = loadFacade(makeStub());
  const M = 4 * 1024 * 1024;
  await api.lfaPut('coverart', { id: 'old', cover: blobOf(M), lastUsed: 1 });
  await new Promise((r) => setTimeout(r, 5));
  await api.lfaPut('coverart', { id: 'mid', cover: blobOf(M), lastUsed: Date.now() });
  await new Promise((r) => setTimeout(r, 5));
  await api.lfaPut('coverart', { id: 'new', cover: blobOf(M), lastUsed: Date.now() });
  const meta = await api.readCacheMeta();
  const keys = Object.keys(meta.items);
  ok(meta.total <= api.CACHE_MAX_BYTES, '总字节数不超预算（' + meta.total + ' ≤ ' + api.CACHE_MAX_BYTES + '）');
  ok(!keys.includes('coverart:old'), '最久未用的 old 被逐出', keys.join(','));
  ok(keys.includes('coverart:new'), '最新写入的 new 保留', keys.join(','));
  ok((await api.lfaGet('coverart', 'old')) === null, '被逐出的键确实已删除');
}
// ④ 无 localForage ⇒ 静默降级
{
  const api = loadFacade(null);
  let bad = null;
  try {
    await api.lfaPut('coverart', { id: 'nope', cover: blobOf(16) });
    const g = await api.lfaGet('coverart', 'nope');
    const all = await api.lfaGetAll('coverart');
    await api.lfaTouch('coverart', 'nope');
    await api.lfaRemove('coverart', 'nope');
    if (g !== null || all.length !== 0) bad = 'expected empty, got ' + JSON.stringify([g, all.length]);
  } catch (e) { bad = String(e && e.message); }
  ok(bad === null, '无 localForage 时全部静默降级（读空、不抛错）', bad || '');
}
console.log('  结果: ' + pass + ' PASS / ' + fail + ' FAIL' + (skipped ? ' / ' + skipped + ' SKIP' : ''));
process.exit(fail ? 1 : 0);
