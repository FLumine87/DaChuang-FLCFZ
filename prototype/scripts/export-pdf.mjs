#!/usr/bin/env node
/**
 * export-pdf.mjs · 把关键页面拼成一张长图 PDF
 * -----------------------------------------------------------------------------
 * 为什么需要：3.3MB 的单文件 HTML 在手机内置浏览器里常常打不开
 * （微信/飞书会直接提示「网络未连接」），PDF 是这时候最稳的退路。
 *
 * 做法：直接用已生成的高分辨率截图纵向拼接，再交给 Pillow 存成单页 PDF。
 * 不引 PDF 合并库、不需要重新渲染页面，改完截图重跑一次即可。
 *
 * 用法：node scripts/export-pdf.mjs [输出文件名]
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, process.argv[2] || '心理筛查预警系统-原型总览.pdf');
const PY = process.env.DSH_PYTHON || 'python3';

/* 选页：目录 + 每端最有代表性的视图。全 16 页会让 PDF 长到没人看完。 */
const SHOTS = [
  'index-light',
  'personal-home-light',
  'personal-screening-safety',
  'personal-collect',
  'personal-retrieval-light',
  'personal-rag',
  'personal-alerts',
  'admin-dashboard',
  'admin-screenings',
  'admin-collect',
  'admin-alerts',
  'admin-cases',
  'admin-agent',
];

const py = `
import os
from PIL import Image, ImageDraw, ImageFont

shots = ${JSON.stringify(SHOTS)}
base = ${JSON.stringify(path.join(ROOT, 'screenshots'))}
out = ${JSON.stringify(OUT)}

CAP = {
 'index-light': '原型目录（门面 + 8 分钟演示动线 + 16 页清单）',
 'personal-home-light': '个人端 · 我的首页（真实聚合数据）',
 'personal-screening-safety': '个人端 · 量表第 9 题：安全提示就地展开，不自动翻页',
 'personal-collect': '个人端 · 多模态采集（文本 / 语音 / 图像）',
 'personal-retrieval-light': '个人端 · 跨模态检索（一段文字命中语音与图像）',
 'personal-rag': '个人端 · RAG 分析结果（结论 / 依据 / 建议）',
 'personal-alerts': '个人端 · 预警中心（分级 + 处置留痕）',
 'admin-dashboard': '管理端 · 数据概览（要做的 → 风险总量 → 整体进度）',
 'admin-screenings': '管理端 · 筛查管理（四维筛选 + 就地详情）',
 'admin-collect': '管理端 · 采集审阅（高风险优先）',
 'admin-alerts': '管理端 · 预警管理（认领 / 指派 / 跟进留痕）',
 'admin-cases': '管理端 · 案例管理',
 'admin-agent': '管理端 · 预警研判台（权限闸门 + 任务草案，接口未通就禁用）',
}

W = 1200          # 输出宽度：手机上也看得清，又不至于文件过大
PAD = 28
CAP_H = 46

try:
    font = ImageFont.truetype('/System/Library/Fonts/PingFang.ttc', 26)
except Exception:
    font = ImageFont.load_default()

tiles = []
for key in shots:
    p = os.path.join(base, key + '.png')
    if not os.path.exists(p):
        print('  跳过（缺图）:', key); continue
    im = Image.open(p).convert('RGB')
    im = im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)
    tile = Image.new('RGB', (W, CAP_H + im.height + PAD), (255, 255, 255))
    d = ImageDraw.Draw(tile)
    d.text((PAD // 2, 10), CAP.get(key, key), fill=(35, 34, 32), font=font)
    tile.paste(im, (0, CAP_H))
    tiles.append(tile)
    print('  已加入:', key)

total_h = sum(t.height + PAD for t in tiles)
canvas = Image.new('RGB', (W, total_h), (255, 255, 255))
y = 0
for t in tiles:
    canvas.paste(t, (0, y)); y += t.height + PAD

canvas.save(out, 'PDF', resolution=110.0)
print('\\n已生成 %s' % os.path.basename(out))
print('  尺寸 %dx%d · %.2f MB · %d 个视图' % (canvas.width, canvas.height, os.path.getsize(out)/1048576, len(tiles)))
`;

execFileSync(PY, ['-c', py], { stdio: 'inherit' });
