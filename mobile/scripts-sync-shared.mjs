#!/usr/bin/env node
/**
 * scripts-sync-shared.mjs —— 与上游 `frontend/src` 同步 `mobile/src/shared/`
 *
 * 背景：移动端为了“分支自包含”（单独克隆即可构建、相对 main 的改动只剩 mobile/**），
 * 把数据层与通用组件以**原样副本**内置在 `mobile/src/shared/`。
 * 副本会与上游漂移，这个脚本用来查差异 / 同步。
 *
 * 用法（在 mobile/ 下执行）：
 *   node scripts-sync-shared.mjs                # 只检查差异，不改文件
 *   node scripts-sync-shared.mjs --write        # 用上游覆盖本地副本
 *   node scripts-sync-shared.mjs --from <dir>   # 指定上游 src 目录（默认 ../frontend/src）
 *
 * 上游目录不存在时（例如只克隆了移动端分支）会提示并退出，不报错。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCAL = join(HERE, 'src', 'shared');

/** 需要保持同步的文件清单（相对 frontend/src，与 shared/ 同构） */
const FILES = [
  'services/http.ts',
  'services/mockApi.ts',
  'auth/session.ts',
  'auth/mockAuth.ts',
  'data/mockData.ts',
  'data/questionnaireData.ts',
  'admin/data/adminMockData.ts',
  'components/AlertBadge.tsx',
  'hooks/useAudioRecorder.ts',
  'utils/audioRecorder.ts',
];

const args = process.argv.slice(2);
const write = args.includes('--write');
const fromIdx = args.indexOf('--from');
const upstream = resolve(
  fromIdx >= 0 ? args[fromIdx + 1] : join(HERE, '..', 'frontend', 'src'),
);

const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);

if (!existsSync(upstream)) {
  console.log(`上游目录不存在：${upstream}`);
  console.log('（只克隆了移动端分支时属正常；需要同步请先准备完整仓库，或用 --from 指定）');
  process.exit(0);
}

console.log(`上游: ${upstream}`);
console.log(`本地: ${LOCAL}\n`);

let same = 0;
const diff = [];
for (const rel of FILES) {
  const up = join(upstream, rel);
  const lo = join(LOCAL, rel);
  if (!existsSync(up)) { console.log(`⚠ 上游缺少: ${rel}`); continue; }
  if (!existsSync(lo)) { diff.push(rel); console.log(`✗ 本地缺失: ${rel}`); continue; }
  const a = readFileSync(up);
  const b = readFileSync(lo);
  if (sha(a) === sha(b)) { same++; continue; }
  diff.push(rel);
  console.log(`≠ 有差异: ${rel}  上游 ${sha(a)} / 本地 ${sha(b)}`);
}

console.log(`\n一致 ${same}/${FILES.length}，有差异 ${diff.length}`);

if (diff.length && write) {
  for (const rel of diff) {
    writeFileSync(join(LOCAL, rel), readFileSync(join(upstream, rel)));
  }
  console.log(`已用上游覆盖 ${diff.length} 个文件。请重新构建并验证：npm run build`);
} else if (diff.length) {
  console.log('（加 --write 用上游覆盖本地副本）');
}
