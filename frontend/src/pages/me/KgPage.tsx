import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Network, RefreshCw, AlertTriangle, HardDrive, MessageCircleHeart, Trash2, X, ZoomIn, ZoomOut, Maximize2, Pause, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, type GraphData } from '../../services/api';
import { briefErrorMessage } from '../../services/http';
import { getCurrentSession } from '../../auth/session';
import { localGraph, mergeGraphs, removeLocalTriples } from '../../services/localKg';
import {
  AUTO_YAW_SPEED,
  CENTER,
  DEFAULT_CAMERA,
  KG_H,
  KG_VIEWBOX,
  KG_W,
  PITCH_SWAY_AMP,
  PITCH_SWAY_PERIOD,
  buildRings,
  cameraLookingAt,
  projectPoint,
  ringPoints,
  sphereLayout,
  type Camera,
  type Vec3,
} from '../../services/kgSphere';
import { DEEP_SPACE, LABEL_NAME, nodeColorOf, resolveGender } from '../../services/kgProfile';
import KgStarfield, { type StarfieldHandle } from '../../components/KgStarfield';
import KgUserAvatar from '../../components/KgUserAvatar';

/* ═══════════════════════ 图谱页：深空球体星图 ═══════════════════════════════
 *
 * 2026-11-08 第四轮改造。需求与落点：
 *
 *  1. **做成 3D** —— services/kgSphere.ts 负责三维布局与透视投影，本文件只做
 *     渲染与交互。节点铺在球壳上、用户节点在球心，画面随相机转动。
 *     为什么不用 three.js：这里是页面上的一块可视化，节点还必须是**可点、
 *     可读的文字标签** —— SVG 文字矢量锐利、事件直接绑、发光用 CSS 即可；
 *     引 600KB 的 3D 库换来的是包体与联网风险，不划算。
 *
 *  2. **中间用户节点用头像（男/女）** —— components/KgUserAvatar.tsx。
 *     性别来自 services/kgProfile.ts；当前个人信息**没有性别字段**，
 *     按用户约定兜底成男生（详见该文件注释）。
 *
 *  3. **同类型节点尽量靠近** —— sphereLayout() 用"类型锚点 + 锥内螺旋"，
 *     是**结构保证**而非力导向的"倾向于"：实测同类最大夹角 16.8°、
 *     跨类最小夹角 87.9°（见 .tmp_probe 验算与 verify_kg_3d_starfield.mjs）。
 *
 *  4. **星空风格** —— components/KgStarfield.tsx（三层星点视差 + 星云 + 银河 + 暗角）。
 *
 *  5. **点击某节点、同类型发光** —— focusId 决定"同类"集合，同类节点统一挂
 *     CSS 呼吸光晕（kg-halo-pulse），并整簇提亮、其余淡出。
 *
 * ── 为什么用 requestAnimationFrame 命令式更新，而不是把相机放 state ──────
 * 自转时相机每帧都在变。若每帧 setState，React 会把几十个节点（含头像、
 * 光晕、标签）整棵子树重算一遍 —— 60fps 下纯属浪费。
 * 所以：**几何布局只算一次**（useMemo）；每帧只做"投影 + 直接写 DOM 属性"
 * （paint()：节点 transform、边的端点、经纬线、星空视差），一次 React
 * 重渲染都不触发。而"选中/悬停"这类低频状态仍走 state，因为它们要改变
 * React 的结构（哪个节点挂光晕、哪些边被强调）。
 *
 * ── 两层 <g> 分工（踩过的坑） ─────────────────────────────────────────────
 * 深度雾化（越远越暗）与"淡出"（有聚焦时压暗无关节点）都要动 opacity。
 * 若两者都写在同一个 g 上，就会互相覆盖（命令式写入被 React 重渲染冲掉，
 * 反之亦然）。所以拆成两层：
 *   · 外层 g  —— React 管 opacity（dim 值 + 过渡）；
 *   · 内层 g  —— paint() 管 transform 与雾化 opacity。
 * opacity 会沿树相乘，两层互不干扰。
 */

interface SimNode {
  id: string;
  name: string;
  label: string;
  category?: string | null;
  /** 球面坐标（单位球壳；用户节点在原点）。x 朝右、y 朝下（与屏幕一致） */
  v: Vec3;
  /** 基准半径（屏幕像素） */
  r: number;
  color: string;
}

interface SimLink {
  source: SimNode;
  target: SimNode;
  relation: string;
}

/** 各类节点的基准半径：用户最大，其余按信息量分级 */
function radiusOf(label: string): number {
  if (label === 'User') return 22;
  if (label === 'Disorder') return 9.5;
  if (label === 'Symptom') return 8.5;
  return 7.5;
}

/** 判断两个节点是否直接相连（悬停高亮邻域用） */
function isAdjacent(links: SimLink[], a: string, b: string): boolean {
  return links.some((l) => (l.source.id === a && l.target.id === b) || (l.source.id === b && l.target.id === a));
}

/**
 * 颜色 → 径向辉光渐变的 id（不含 #）。
 *
 * 为什么按颜色预生成：色板里总共十来种颜色，而节点样式每帧都在被读写；
 * 若把渐变写死成"每个节点一个"，defs 会有几十条、且节点一多就不可控。
 * 按颜色归并后：同色节点共用一条渐变，defs 恒定在十几条。
 * id 里把 `#` 换成 `_`：颜色值会出现在 id 属性里，`#` 会截断 URL 引用。
 */
function glowId(color: string): string {
  return `kgGlow-${color.replace('#', '')}`;
}

export default function KgPage() {
  const session = getCurrentSession();
  const userId = session?.username ?? 'demo_user';
  /* 性别：当前档案无此字段 → resolveGender 兜底男生 */
  const gender = useMemo(() => resolveGender(), []);

  const [data, setData] = useState<GraphData | null>(null);
  const [serverNodes, setServerNodes] = useState(0);
  const [graphConnected, setGraphConnected] = useState(false);
  const [localCount, setLocalCount] = useState(0);
  const [serverNotice, setServerNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  /** 鼠标悬停的节点：与选中一样点亮同类 */
  const [hovered, setHovered] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SimNode | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [zoom, setZoom] = useState(1);
  /** 是否正在自动旋转（用户拖动会暂停它） */
  const [spinning, setSpinning] = useState(true);

  const svgRef = useRef<SVGSVGElement>(null);
  const starfieldRef = useRef<StarfieldHandle>(null);
  /** 相机（放 ref 不放 state：每帧都在变，见文件顶部说明） */
  const camRef = useRef<Camera>({ ...DEFAULT_CAMERA });
  const zoomRef = useRef(zoom);
  /** 节点外层 g（React 管 opacity）—— 同时用于"按深度重排 DOM" */
  const nodeHostRefs = useRef<Map<string, SVGGElement>>(new Map());
  /** 节点内层 g（paint 管 transform / 雾化 / 标签字号补偿） */
  const nodeBodyRefs = useRef<Map<string, SVGGElement>>(new Map());
  /** 上一帧节点的前后顺序签名：变了才重排 DOM（见 paint 里的说明） */
  const nodeOrderRef = useRef('');
  const edgeRefs = useRef<(SVGLineElement | null)[]>([]);
  const edgeLabelRefs = useRef<(SVGTextElement | null)[]>([]);
  const ringRefs = useRef<(SVGPolylineElement | null)[]>([]);

  /** 拖拽视角 */
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number; moved: number; pointerId: number; captured: boolean } | null>(null);
  /** 用户松手后的静置截止时间（毫秒时间戳）：到点才恢复自转 */
  const resumeAtRef = useRef(0);

  /* ── 拉数据（服务端为主、本机补充；口径与改造前完全一致） ─────────────── */
  const load = useCallback(async () => {
    setLoading(true);
    setServerNotice('');
    const local = localGraph(userId);
    setLocalCount(Math.max(0, local.nodes.length - 1));
    try {
      const server = await api.getGraph(userId);
      setServerNodes(Math.max(0, server.nodes.length - 1));
      setData(mergeGraphs(server, local));
      /* 说明文案只按**真实连接状态**给：连上了就什么都不说；
         确实没连上才提示一句人话，且不含任何后端原始响应体。 */
      setGraphConnected(Boolean(server.neo4j_connected));
      if (!server.neo4j_connected) {
        setServerNotice(
          server.mock
            ? '服务端处于演示模式，图数据库尚未连接，当前显示本机记录。'
            : '图数据库尚未连接，当前显示本机记录。',
        );
      }
    } catch (e) {
      /* 后端不可用不该让页面空掉：本机三元组照样画出来，失败只在顶部如实说明。
         注意 briefErrorMessage：axios 的消息里可能带着原始响应体（裸 JSON），
         直接上屏就是"把后端返回体糊在用户脸上"。 */
      setServerNodes(0);
      setGraphConnected(false);
      setServerNotice(
        `知识图谱服务暂时取不到（${briefErrorMessage(e, '未连接到服务端')}），当前显示本机记录。`,
      );
      setData(local.nodes.length > 1 ? local : null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* 换数据时清掉选中/悬停并复位相机，避免残留一个不存在的节点 id */
  useEffect(() => {
    setSelected(null);
    setHovered(null);
    setZoom(1);
    camRef.current = { ...DEFAULT_CAMERA };
    resumeAtRef.current = 0;
    setSpinning(true);
  }, [data]);

  /* ── 建节点/边 ──────────────────────────────────────────────────────── */
  const nodes = useMemo<SimNode[]>(() => {
    if (!data) return [];
    const positions = sphereLayout(data.nodes.map((n) => ({ id: n.id, label: n.label })));
    return data.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      label: n.label,
      category: n.category ?? null,
      v: positions.get(n.id) ?? { ...CENTER },
      r: radiusOf(n.label),
      color: nodeColorOf(n.label, n.category),
    }));
  }, [data]);

  const links = useMemo<SimLink[]>(() => {
    if (!data) return [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return data.links
      .map((l) => {
        const s = byId.get(l.source);
        const t = byId.get(l.target);
        return s && t ? { source: s, target: t, relation: l.relation } : null;
      })
      .filter((x): x is SimLink => x !== null);
  }, [data, nodes]);

  /** 球体经纬大圆的三维点列：只算一次，投影时每帧跟着相机转 */
  const rings = useMemo(() => buildRings(64), []);

  /** 本图用到的全部星体色（去重）：供 <defs> 预生成辉光渐变 */
  const glowColors = useMemo(() => [...new Set(nodes.map((n) => n.color))], [nodes]);

  const selNode = nodes.find((n) => n.id === selected);
  /** 当前聚焦的节点：优先选中，其次悬停 —— 两者都点亮同类 */
  const focusId = selected ?? hovered;
  const focusNode = nodes.find((n) => n.id === focusId);
  const focusLabel = focusNode?.label ?? null;

  /**
   * 「同类型」的判定。
   *
   * Interest 再看 category：兴趣是唯一带明确类别的类型（音乐/运动/影视…），
   * 点「周杰伦」时把"音乐"这一簇也点亮，比只点亮整个 Interest 更贴用户意图 ——
   * 图谱上兴趣的颜色本来就是按 category 分的。
   * 其他类型不细分（它们的 category 语义不统一）。
   */
  const sameType = useCallback(
    (n: SimNode): boolean => {
      if (!focusLabel || n.label === 'User') return false;
      if (focusLabel === 'Interest' && focusNode?.category) {
        return n.label === 'Interest' && n.category === focusNode.category;
      }
      return n.label === focusLabel;
    },
    [focusLabel, focusNode],
  );

  /** 有聚焦时，既非焦点、非同类、也非直接邻居的节点 → 淡出 */
  const isDim = useCallback(
    (n: SimNode): boolean => {
      if (!focusId || n.id === focusId) return false;
      if (sameType(n)) return false;
      return !isAdjacent(links, focusId, n.id);
    },
    [focusId, links, sameType],
  );

  /* ── 绘制：投影并写 DOM（每帧调用，不触发 React 重渲染） ─────────────── */
  const paint = useCallback(() => {
    const cam = camRef.current;

    /* 0) 先算投影（位置、深度、雾化、排序都要用） */
    const proj = new Map<string, { x: number; y: number; z: number; depthScale: number; nearness: number }>();
    for (const n of nodes) proj.set(n.id, projectPoint(n.v, cam));

    /**
     * 1) 前后顺序变化时重排节点 DOM。
     *
     * 为什么必须重排：SVG 没有 z-index，谁在 DOM 后面谁压在上面。球体转起来时
     * 节点前后关系会互换，若不重排，"此刻在背面"的节点仍会画在正面节点（以及
     * 中心的用户头像）之上 —— 实测过：转个角度后「疲乏」直接盖住了头像，
     * 立体感立刻垮掉。
     *
     * 代价与安全性：节点只有十几个，且仅在**两两前后关系真的改变时**才动 DOM
     * （先用顺序签名比对）。与 React 的关系：外部改动子顺序不会让 React 崩
     * （它按自己记录的节点做 insertBefore），最坏情况是某次重渲染把顺序还原 ——
     * 而 paint() 每帧都跑，下一帧就会重排回来，用户看不到。
     */
    const ordered = [...nodes].sort((a, b) => proj.get(a.id)!.z - proj.get(b.id)!.z);
    const sig = ordered.map((n) => n.id).join(',');
    if (sig !== nodeOrderRef.current) {
      const parent = nodeHostRefs.current.get(ordered[0].id)?.parentNode;
      if (parent) {
        nodeOrderRef.current = sig;
        for (const n of ordered) {
          const el = nodeHostRefs.current.get(n.id);
          if (el && el.parentNode === parent) parent.appendChild(el);
        }
      }
    }

    /* 2) 节点：位置 + 透视缩放 + 深度雾化 */
    for (const n of nodes) {
      const g = nodeBodyRefs.current.get(n.id);
      if (!g) continue;
      const p = proj.get(n.id)!;
      /* 缩放必须是 depthScale × zoom 两者相乘：
         projectPoint 里 zoom 只进了**位置**（k = KG_PX·persp·zoom），
         而 depthScale 是纯透视系数、与 zoom 无关。若这里只写 depthScale，
         点"放大"时节点只会往外挪、自己不变大 —— 实测过这个 bug（0.775→0.783）。 */
      const k = p.depthScale * cam.zoom;
      g.setAttribute('transform', `translate(${p.x.toFixed(2)},${p.y.toFixed(2)}) scale(${k.toFixed(3)})`);
      /* 0.42（最远）…1（最近）。乘法叠在外层的 dim opacity 上，互不干扰。
         雾化**不**跟 zoom 走：缩放是"靠近看"，不是"把远处的空气也变亮" */
      g.setAttribute('opacity', (0.42 + 0.58 * p.nearness).toFixed(3));
    }

    /* 3) 标签排布（独立一趟，做碰撞避让）
       ── 为什么不能只按"离心方向"挂
          只朝外摆看似能错开，但有两个洞：
            · 离画布中心很近的节点（尤其深度大、被投影放大的），"外侧"方向
              几乎贴着中心，标签会直接压到中心的用户头像上（实测「周杰伦」就这么压上去的）；
            · 同一片星域里相邻的几个节点，离心方向差不了几度，标签仍会叠（实测
              「准备考试 / 打篮球 / 考试」三个糊在一起）。
          所以这里按**屏幕空间**排：先给出期望位置，再迭代把互相重叠的标签推开，
          并把它们从中心头像的圆盘里挤出去。节点只有十几个，几轮迭代开销可忽略。
       ── 字号与偏移为什么要除以 k
          标签挂在节点的 scale(k) 组里，不补偿就会"近处的字巨大、远处的字小到看不见"
          （实测「周杰伦」depthScale 1.42 → 15.6px，最远的只有 8.5px，同图两种字号）。
          补偿后屏幕字号恒为 baseSize，而节点圆盘继续随深度缩放，深度线索不受影响。 */
    const labels: { n: SimNode; k: number; sx: number; sy: number; size: number; w: number; h: number }[] = [];
    for (const n of nodes) {
      const p = proj.get(n.id)!;
      const k = p.depthScale * cam.zoom;
      const size = n.label === 'User' ? 12.5 : 11;
      const shown = n.name.length > 7 ? n.name.slice(0, 7) + '…' : n.name;
      /* 屏幕宽度的粗略估算：中文按 1 字宽、其余按 0.6 字宽 */
      const wide = [...shown].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? 1 : 0.6), 0);
      /* 标签与节点圆盘之间的屏幕间距：随缩放一起放大，否则放大时标签会
         被挤回圆盘上（圆盘变大了、间距没变）。上限 2 倍避免极端缩放时飘太远 */
      const zm = Math.min(2, cam.zoom);
      const onScreenR = n.r * k;
      const gap = onScreenR + (n.label === 'User' ? 15 : 12) * zm;
      /* 期望方向：离心（远离画布中心）。用户节点固定在正下方 */
      let dx = p.x - KG_W / 2;
      let dy = p.y - KG_H / 2;
      const len = Math.hypot(dx, dy);
      if (n.label === 'User' || len < 1) {
        dx = 0;
        dy = 1;
      } else {
        dx /= len;
        dy /= len;
      }
      labels.push({
        n,
        k,
        sx: p.x + dx * gap,
        sy: p.y + dy * gap + size * 0.34,
        size,
        w: wide * size,
        h: size * 1.3,
      });
    }

    /* 迭代避让：两两重叠就沿连线方向各推开一半，并躲开中心头像 */
    const userLabel = labels.find((l) => l.n.label === 'User');
    const avatarR = userLabel ? userLabel.n.r * userLabel.k + 10 : 0;
    const AVATAR_CX = KG_W / 2;
    const AVATAR_CY = KG_H / 2;
    for (let iter = 0; iter < 8; iter++) {
      let moved = false;
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const a = labels[i];
          const b = labels[j];
          const ox = (a.w + b.w) / 2 - Math.abs(a.sx - b.sx);
          const oy = (a.h + b.h) / 2 - Math.abs(a.sy - b.sy);
          if (ox <= 0 || oy <= 0) continue;
          moved = true;
          /* 沿**重叠更少**的那个轴分离：这样位移最小，标签仍贴近各自节点 */
          if (ox < oy) {
            const push = (ox / 2 + 0.5) * (a.sx <= b.sx ? -1 : 1);
            a.sx += push;
            b.sx -= push;
          } else {
            const push = (oy / 2 + 0.5) * (a.sy <= b.sy ? -1 : 1);
            a.sy += push;
            b.sy -= push;
          }
        }
      }
      /* 把标签挤出头像的圆盘（用户自己的标签除外） */
      for (const l of labels) {
        if (l.n.label === 'User') continue;
        const ddx = l.sx - AVATAR_CX;
        const ddy = l.sy - AVATAR_CY;
        const d = Math.hypot(ddx, ddy);
        const need = avatarR + l.h / 2 + 2;
        if (d < need) {
          moved = true;
          const ux = d < 0.001 ? 0 : ddx / d;
          const uy = d < 0.001 ? -1 : ddy / d;
          l.sx = AVATAR_CX + ux * need;
          l.sy = AVATAR_CY + uy * need;
        }
      }
      if (!moved) break;
    }

    /* 写回标签：屏幕坐标 → 节点本地坐标（除以 k），字号/描边同样除以 k。
       注意**每一项都要除 k** —— 标签挂在 scale(k) 的组里，属性写的是本地值。
       漏掉 font-size 的 /k 就等于没做补偿（实测屏幕上会出现 7.4~11.5px 的字号差，
       正是这个补偿要解决的问题）。 */
    for (const l of labels) {
      const g = nodeBodyRefs.current.get(l.n.id);
      const p = proj.get(l.n.id)!;
      if (!g) continue;
      const label = g.querySelector('text');
      if (!label) continue;
      label.setAttribute('font-size', (l.size / l.k).toFixed(3));
      label.setAttribute('stroke-width', (2.6 / l.k).toFixed(3));
      label.setAttribute('x', ((l.sx - p.x) / l.k).toFixed(2));
      label.setAttribute('y', ((l.sy - p.y) / l.k).toFixed(2));
    }

    /* 2) 边：端点每帧跟着节点走（漏了这一步边会留在原地、与节点脱开） */
    links.forEach((l, i) => {
      const el = edgeRefs.current[i];
      if (!el) return;
      const a = projectPoint(l.source.v, cam);
      const b = projectPoint(l.target.v, cam);
      el.setAttribute('x1', a.x.toFixed(2));
      el.setAttribute('y1', a.y.toFixed(2));
      el.setAttribute('x2', b.x.toFixed(2));
      el.setAttribute('y2', b.y.toFixed(2));
    });

    /* 3) 边标签：同理，位置每帧更新（显隐由 React 决定） */
    links.forEach((l, i) => {
      const el = edgeLabelRefs.current[i];
      if (!el) return;
      const a = projectPoint(l.source.v, cam);
      const b = projectPoint(l.target.v, cam);
      el.setAttribute('x', ((a.x + b.x) / 2).toFixed(2));
      el.setAttribute('y', ((a.y + b.y) / 2 - 4).toFixed(2));
    });

    /* 4) 经纬大圆 */
    rings.forEach((pts, i) => {
      const el = ringRefs.current[i];
      if (!el) return;
      el.setAttribute('points', ringPoints(pts.map((p) => projectPoint(p, cam))));
    });

    /* 5) 星空视差（只改三个 <g> 的 transform，不重渲染五百个星点） */
    starfieldRef.current?.sync(cam.yaw, cam.pitch);
  }, [nodes, links, rings]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  /* ── 主循环：自转 + 每帧重绘 ─────────────────────────────────────────── */
  useEffect(() => {
    if (nodes.length === 0) return;
    let raf = 0;
    let prev = performance.now();
    let running = true;

    const tick = (now: number) => {
      if (!running) return;
      /* 夹住 dt：切走标签页再回来后 dt 会是几十秒，不夹会让球体瞬间转飞 */
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const cam = camRef.current;
      cam.zoom = zoomRef.current;

      /* 自动自转：用户操作后静置到点才恢复 */
      if (spinningRef.current && now >= resumeAtRef.current) {
        cam.yaw += AUTO_YAW_SPEED * dt;
        /* 俯仰做极缓往复（±0.06rad≈3.4°）：静止时也能看出是立体球而非一张圆图 */
        cam.pitch =
          DEFAULT_CAMERA.pitch +
          Math.sin((now / 1000) * ((Math.PI * 2) / PITCH_SWAY_PERIOD)) * PITCH_SWAY_AMP;
      }

      paint();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, [nodes.length, paint]);

  /**
   * 自转开关放 ref 供主循环读。
   *
   * 为什么不用 effect 依赖 spinning：那样每次开关都会重建 rAF 循环，
   * 重建瞬间 prev 重置、且会丢掉一帧 —— 表现为"暂停/恢复时画面一顿"。
   * 用 ref 让循环始终只有一个，只切换一个布尔值。
   */
  const spinningRef = useRef(true);
  useEffect(() => {
    spinningRef.current = spinning;
  }, [spinning]);

  /* nodes/links 变化（删除、刷新、缩放）时立刻重画一次，不等下一帧 */
  useEffect(() => {
    paint();
  }, [paint]);

  /** 暂停自转，并在 delayMs 后恢复（用户松手 / 双击聚焦后调用） */
  const pauseSpin = useCallback((delayMs: number) => {
    setSpinning(false);
    resumeAtRef.current = delayMs > 0 ? performance.now() + delayMs : 0;
    if (delayMs > 0) {
      /* 到点后重新开始转。用 ref 判定"这段时间内有没有新的操作"，
         没有才恢复 —— 否则连续拖动会被一次次推后、却总在最后一次之后立刻转起来 */
      window.setTimeout(() => {
        if (resumeAtRef.current && performance.now() >= resumeAtRef.current) {
          resumeAtRef.current = 0;
          setSpinning(true);
        }
      }, delayMs + 80);
    }
  }, []);

  /** 手动恢复自转（控件上的"继续旋转"；会清掉挂起的恢复计时） */
  const resumeSpin = useCallback(() => {
    resumeAtRef.current = 0;
    setSpinning(true);
  }, []);

  /* ── 拖拽旋转视角 ───────────────────────────────────────────────────── */
  /**
   * 指针捕获**只在确认拖动之后**才设置（不在 pointerdown 里立刻设）。
   *
   * 踩过的坑：若在 pointerdown 时就 setPointerCapture，指针事件会全部被
   * <svg> 捕获，浏览器随之把 **click 也派发给 <svg>** —— 结果节点的
   * onClick 再也不触发，"单击选中节点"整个失灵（而且 hover 仍会点亮同类，
   * 所以表面上像是好的，很难发现）。改成移动超过阈值才捕获：
   *   · 单击 → 从不捕获 → click 正常落到节点上；
   *   · 拖动 → 在 move 里捕获 → 指针移出画布也不丢事件。
   */
  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY, moved: 0, pointerId: e.pointerId, captured: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d?.active) return;
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    d.moved += Math.abs(dx) + Math.abs(dy);
    if (d.moved < 3) return; // 抖动阈值：别把"点击"当成"拖动"
    /* 到这里才能确定是拖动：此刻才捕获指针（见上面的坑） */
    if (!d.captured) {
      d.captured = true;
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    }
    /* 用户接管视角：立刻停自转（resumeAt 归零表示"拖动中，别恢复"） */
    setSpinning(false);
    resumeAtRef.current = 0;
    const cam = camRef.current;
    cam.yaw += dx * 0.006;
    /* 俯仰夹在 ±0.75rad（≈±43°）：再翻球体投影会压扁成一条线，节点全挤一起 */
    cam.pitch = Math.max(-0.75, Math.min(0.75, cam.pitch + dy * 0.005));
    paint();
  };

  /**
   * 「刚刚拖过」的时间戳（0 = 没有）。
   *
   * 为什么是时间戳而不是布尔：浏览器只在**按下与松开落在同一元素**时才补发
   * click。用户在球上斜着拖一把时，起止点往往在不同节点/空白上，于是**没有**
   * click 来消费那个标记；用一个残留的布尔会让之后第一次真实点击被白白吞掉
   * （实测：连续拖动之后双击节点会失灵）。改成时间窗（250ms）后，陈旧标记
   * 自动失效，不存在残留。
   */
  const dragEndAtRef = useRef(0);
  const DRAG_CLICK_WINDOW_MS = 250;

  /** 拖动结束后的极短窗口内，浏览器补发的那次 click 要吞掉 */
  const shouldSwallowClick = useCallback(() => {
    if (!dragEndAtRef.current || performance.now() - dragEndAtRef.current > DRAG_CLICK_WINDOW_MS) return false;
    dragEndAtRef.current = 0;
    return true;
  }, []);

  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    /* 真的转过视角才安排恢复；单纯点一下不该触发"恢复计时" */
    if (d?.active && d.moved >= 3) {
      dragEndAtRef.current = performance.now();
      pauseSpin(2500);
    }
  };

  /** 空白处单击 = 取消选中（但拖动结束那一下补发的 click 要吞掉） */
  const onBackgroundClick = () => {
    if (shouldSwallowClick()) return;
    setSelected(null);
  };

  const resetView = useCallback(() => {
    camRef.current = { ...DEFAULT_CAMERA };
    setZoom(1);
    resumeAtRef.current = 0;
    setSpinning(true);
    paint();
  }, [paint]);

  /** 双击节点：把该节点转到正对观察者（一步到位，用解析解） */
  const bringToFront = useCallback(
    (n: SimNode) => {
      if (n.label === 'User') {
        resetView();
        return;
      }
      const { yaw, pitch } = cameraLookingAt(n.v);
      camRef.current.yaw = yaw;
      camRef.current.pitch = Math.max(-0.75, Math.min(0.75, pitch));
      setSelected(n.id);
      pauseSpin(4000);
      paint();
    },
    [pauseSpin, resetView, paint],
  );

  /* ── 删除节点（两处数据都删；服务端失败不阻断本机删除） ───────────────── */
  const confirmDelete = async () => {
    const node = pendingDelete;
    if (!node || deleting) return;
    setDeleting(true);

    /* 1) 本机：按名字删掉所有指向它的三元组 */
    const nextLocal = removeLocalTriples(userId, { name: node.name });
    setLocalCount(Math.max(0, nextLocal.triples.length));

    /* 2) 服务端：只删自己到该节点的边 */
    let serverNote = '';
    if (graphConnected && node.label !== 'User') {
      try {
        const r = await api.deleteGraphNode(userId, node.id);
        if (!r.neo4j_connected) serverNote = '图数据库当前未连接，本次只删除了本机记录。';
        else if (r.deleted === 0) serverNote = '服务端没有这条记录，本次只删除了本机记录。';
      } catch (e) {
        serverNote = `服务端记录删除失败（${briefErrorMessage(e, '未连接到服务端')}），本机记录已删除。`;
      }
    }

    /* 3) 重新拉取：以服务端 + 本机的真实合并结果为准，不用本地推测维护状态 */
    setPendingDelete(null);
    setSelected(null);
    setHovered(null);
    await load();
    setDeleting(false);
    if (serverNote) setServerNotice(serverNote);
  };

  const zoomBy = (delta: number) => setZoom((z) => Math.min(2.2, Math.max(0.55, Number((z + delta).toFixed(2)))));

  /**
   * 滚轮缩放：必须用原生监听 + { passive: false }。
   *
   * 为什么不用 React 的 onWheel：React 17+ 把 wheel 挂在根节点上且是**被动
   * 监听**（passive: true），被动监听里调 preventDefault 会被浏览器忽略，
   * 控制台还会刷 "Unable to preventDefault inside passive event listener" ——
   * 结果是页面跟着滚一页、图也缩了一下，两个动作同时发生。
   */
  const hasGraph = Boolean(data && nodes.length > 0 && links.length > 0);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(2.2, Math.max(0.55, Number((z + (e.deltaY > 0 ? -0.12 : 0.12)).toFixed(2)))));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [hasGraph]);

  /**
   * DOM 绘制顺序（painter's algorithm：后面的压前面的）。
   *
   * 按初始视角的 z 排一次即可。自转时前后会互换，若每帧重排 DOM 就要重排
   * 节点子树（贵，且会让 CSS 过渡失效）。这里取折中：顺序固定，前后关系靠
   * "深度雾化 + 透视缩放"表达 —— 视觉上足够，成本为零。
   */
  const drawOrder = useMemo(() => {
    const cy = Math.cos(DEFAULT_CAMERA.yaw);
    const sy = Math.sin(DEFAULT_CAMERA.yaw);
    return [...nodes].sort((a, b) => (a.v.x * sy + a.v.z * cy) - (b.v.x * sy + b.v.z * cy));
  }, [nodes]);

  return (
    /* kg-fullheight：把自己声明成「撑满一屏」的页面，index.css 里
       `.app-content:has(.kg-fullheight)` 据此把整条高度链打通到视口。
       这里同时是 flex 列容器：标题卡与图例志在必得（shrink-0），
       中间的星图卡吃掉剩余高度（flex-1 min-h-0）—— 于是"一屏放下整张星图"
       由**结构**保证，不靠给每块写死高度。
       注：用 gap-4 而不是 space-y-4。space-y 给所有兄弟加 margin-top，
       而下面的删除确认弹窗是 position:fixed + inset:0，它也是"兄弟"之一，
       被 margin-top 顶下去 1rem、整块遮罩就少了一圈（既有小瑕疵）。
       换成 flex gap 后，fixed 子元素不参与 flex 布局，这个偏差顺带消失。 */
    <div className="kg-fullheight flex flex-1 flex-col gap-4 min-h-0">
      {/* ── 页头 ───────────────────────────────────────────────────────── */}
      <div className="ui-card shrink-0 p-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <Network className="w-4 h-4 text-primary-600" /> 我的个人知识图谱
          </h2>
          <p className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              用户 <span className="font-mono">{userId}</span> 的专属星图 · 拖动可旋转，双击节点转到正面
            </span>
            {/* 来源标注：本机（localStorage）/ 服务端图谱，两者都画在同一张图上时说清主次 */}
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
              <HardDrive className="w-3 h-3" />
              {graphConnected
                ? serverNodes > 0
                  ? `已连接个人知识图谱 · ${serverNodes} 个节点（本机记录作补充）`
                  : `已连接个人知识图谱 · 该用户暂无图谱数据（本机记录 ${Math.max(0, localCount)} 条）`
                : `图数据库未连接 · 本机记录 ${Math.max(0, localCount)} 条`}
            </span>
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-50 text-primary-600 text-sm font-medium hover:bg-primary-100 disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {/* 服务端图谱取不到时的如实说明：只说人话，不放原始响应体 */}
      {serverNotice && (
        <div className="flex shrink-0 items-center gap-2 text-sm text-slate-600 ui-card px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-warning-500" />
          <span>{serverNotice}</span>
        </div>
      )}

      {/* 星图卡：一屏里唯一可伸缩的一块。flex-1 吃掉剩余高度、min-h-0 允许被压缩，
          内部的 <svg> 用 h-full 撑满，而不是按 900:560 等比撑宽
          （等比撑宽正是改造前"必须滚 69px"的直接原因）。
          min-h 是**兜底下限**：窗口特别矮时，星图宁可把整页顶出滚动，
          也不压成一条看不清的窄带。 */}
      <div className="ui-card overflow-hidden relative flex-1 min-h-[280px]">
        {!data || nodes.length === 0 || links.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-slate-400">
            {loading ? (
              '加载中…'
            ) : (
              <>
                <p>先在「AI 陪伴对话」里说说近况，图谱会随记录生长。</p>
                <Link
                  to="/personal/me/chat"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary-50 px-3 py-1.5 text-primary-600 hover:bg-primary-100"
                >
                  <MessageCircleHeart className="w-3.5 h-3.5" /> 去聊几句
                </Link>
              </>
            )}
          </div>
        ) : (
          <>
            <svg
              ref={svgRef}
              viewBox={KG_VIEWBOX}
              /* w-full h-full + preserveAspectRatio="xMidYMid meet"：
                 卡片高度现在由 flex 决定（不再由 SVG 的宽高比倒推），所以画布
                 必须自己撑满卡片。SVG 默认就是 meet（等比缩放、居中、不裁切），
                 这里显式写出来，是为了**明确不选 slice** —— slice 会填满卡片但
                 裁掉两侧星点，星图会缺一块；宁可两侧留一点夜空。
                 而 meet 留下的空白带由 KgStarfield 的底纹溢出 + 这里的
                 overflow: visible 来填（否则会看到一条接缝，见那边的说明）。 */
              className="w-full h-full block select-none touch-none"
              preserveAspectRatio="xMidYMid meet"
              style={{ background: DEEP_SPACE.voidOuter, cursor: 'grab', overflow: 'visible' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerLeave={endDrag}
              onClick={onBackgroundClick}
            >
              {/* 节点辉光渐变：色板里每出现一种颜色就生成一条径向渐变
                  （从节点色实心 → 中段半透 → 边缘全透，即"光向外散开"）。
                  共用同一 id，避免每节点一条 defs。 */}
              <defs>
                {glowColors.map((c) => (
                  <radialGradient key={c} id={glowId(c)} cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor={c} stopOpacity="0.72" />
                    <stop offset="42%" stopColor={c} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={c} stopOpacity="0" />
                  </radialGradient>
                ))}
              </defs>

              {/* 星空背景（三层视差 + 星云 + 银河 + 暗角） */}
              <KgStarfield ref={starfieldRef} w={KG_W} h={KG_H} />

              {/* 球体经纬线：三维大圆，跟着相机转 → 球体感。
                  纯经纬、不填充，避免在节点之下压出一块"实体球" */}
              <g data-kg="rings">
                {rings.map((_, i) => (
                  <polyline
                    key={`ring${i}`}
                    ref={(el) => {
                      ringRefs.current[i] = el;
                    }}
                    fill="none"
                    stroke={DEEP_SPACE.wire}
                    strokeOpacity={i === 0 ? 0.22 : 0.13}
                    strokeWidth={1}
                    strokeDasharray={i === 0 ? '4 8' : undefined}
                  />
                ))}
              </g>

              {/* 边：三维直线投影后自然带透视 */}
              <g data-kg="edges">
                {links.map((l, i) => {
                  const lit = focusId !== null && (l.source.id === focusId || l.target.id === focusId);
                  const dim = focusId !== null && !lit;
                  return (
                    <line
                      key={`e${i}`}
                      ref={(el) => {
                        edgeRefs.current[i] = el;
                      }}
                      stroke={DEEP_SPACE.wire}
                      strokeWidth={lit ? 1.9 : 1.1}
                      strokeOpacity={dim ? 0.07 : lit ? 0.8 : 0.3}
                      style={{ transition: 'stroke-opacity 240ms, stroke-width 240ms' }}
                    />
                  );
                })}
              </g>

              {/* 节点 */}
              <g data-kg="nodes">
                {drawOrder.map((n) => {
                  const isUser = n.label === 'User';
                  const dim = isDim(n);
                  const isFocus = focusId === n.id;
                  const litSame = sameType(n);
                  return (
                    <g
                      key={n.id}
                      data-kg-node={n.label}
                      ref={(el) => {
                        if (el) nodeHostRefs.current.set(n.id, el);
                        else nodeHostRefs.current.delete(n.id);
                      }}
                      /* 外层：React 管"淡出"与交互 */
                      style={{
                        cursor: isUser ? 'grab' : 'pointer',
                        opacity: dim ? 0.2 : 1,
                        transition: 'opacity 260ms',
                      }}
                      /* 注意：pointerdown **不能** stopPropagation。
                         用户节点正好在画布中心（球心投影到中心），若它吞掉
                         pointerdown，用户在画面正中按下想转视角时就会被挡住 ——
                         实测过：从头像上起手拖，视角一动不动。
                         所以这里让事件冒泡给 <svg> 开始旋转；而"选中"仍由
                         click 的 stopPropagation 独占（拖动不会触发选中，
                         因为 endDrag 之后那次补发的 click 已被 suppressClickRef 吞掉）。 */
                      onMouseEnter={() => setHovered(n.id)}
                      onMouseLeave={() => setHovered((h) => (h === n.id ? null : h))}
                      onClick={(e) => {
                        e.stopPropagation();
                        /* 拖动视角结束时光标可能正好停在节点上，浏览器会补发 click。
                           不吞掉的话"转一下视角"会顺手选中一个节点 —— 用户没想选它 */
                        if (shouldSwallowClick()) return;
                        setSelected(n.id);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        bringToFront(n);
                      }}
                    >
                      {/* 内层：paint() 管位置 / 缩放 / 深度雾化 */}
                      <g
                        ref={(el) => {
                          if (el) nodeBodyRefs.current.set(n.id, el);
                          else nodeBodyRefs.current.delete(n.id);
                        }}
                      >
                        {/* 同类发光：聚焦时所有同类共用同一个呼吸光晕类。
                            用 CSS 动画（kg-halo-pulse）而非 JS，几十个节点齐闪也不吃主线程。
                            形状必须用**径向渐变**而不是实心圆：实心圆看起来是"贴了一块
                            色卡"，渐变才是"从节点向外散开的光"（截图中那三片实心粉圆
                            就是这个问题）。渐变在 <defs> 里按颜色预生成，见 glowId()。
                            ── pointerEvents: none 是必须的
                               辉光的边缘已透明，但**元素本身仍覆盖整个半径**。
                               不关掉指针事件时，点某个节点的外侧会命中邻居那圈看不见的
                               辉光，于是"双击 A 却选中了 B"（实测踩到过）。
                               装饰层一律不参与命中，命中只留给节点圆盘与删除按钮。 */}
                        {litSame && (
                          <circle
                            r={n.r * 3.1}
                            fill={`url(#${glowId(n.color)})`}
                            className="kg-halo-pulse"
                            style={{ pointerEvents: 'none' }}
                          />
                        )}
                        {/* 外光晕：同样是径向柔和。焦点最亮，同类次之，无关基本不发光 */}
                        <circle
                          r={n.r + (isFocus ? 12 : 8)}
                          fill={`url(#${glowId(n.color)})`}
                          opacity={isFocus ? 0.75 : litSame ? 0.5 : dim ? 0.06 : 0.22}
                          style={{ pointerEvents: 'none' }}
                        />

                        {isUser ? (
                          <KgUserAvatar gender={gender} radius={n.r} ring={n.color} focused={isFocus} />
                        ) : (
                          <>
                            {/* 星体：底色 + 左上高光，读作"发光的球"而不是"平面圆点" */}
                            <circle r={n.r} fill={n.color} stroke={DEEP_SPACE.nodeRing} strokeWidth={1.4} />
                            <circle cx={-n.r * 0.26} cy={-n.r * 0.3} r={n.r * 0.42} fill="#ffffff" opacity={0.42} />
                          </>
                        )}

                        {/* 命中区：一个刚好盖住节点圆盘的透明圆。
                            为什么需要它：星体圆的 fill 就是命中区，但对**用户头像**
                            来说它由一堆子路径组成、形状不规整；显式加一个透明圆能让
                            "点哪里算点中这个节点"在所有节点上一致（半径 = 圆盘半径，
                            不含辉光）。pointer-events: all 让透明区域照样可点。 */}
                        <circle
                          r={n.r}
                          fill="transparent"
                          style={{ pointerEvents: 'all', cursor: isUser ? 'grab' : 'pointer' }}
                        />

                        <text
                          /* x/y 与字号都由 paint() 每帧按"离心方向 + 反向缩放补偿"
                             写入（见 paint 里的说明）；这里的初值只是首帧前的占位 */
                          y={n.r + (isUser ? 15 : 13)}
                          fontSize={isUser ? 12.5 : 11}
                          textAnchor="middle"
                          fill={DEEP_SPACE.nodeLabel}
                          fontWeight={isUser ? 700 : 500}
                          /* 描边用画布底色：星空上标签与星点重叠时，没有描边会糊掉。
                             paint 用 SVG，描边比投影阴影便宜，且小字号下更清晰 */
                          stroke={DEEP_SPACE.voidOuter}
                          strokeWidth={2.6}
                          paintOrder="stroke"
                          strokeLinejoin="round"
                          style={{ pointerEvents: 'none' }}
                        >
                          {n.name.length > 7 ? n.name.slice(0, 7) + '…' : n.name}
                        </text>

                        {/* 删除按钮：悬停或选中该节点时浮出（用户节点是核心，不给删） */}
                        {!isUser && (isFocus || hovered === n.id) && (
                          <g
                            transform={`translate(${n.r + 6},${-n.r - 6})`}
                            style={{ cursor: 'pointer' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingDelete(n);
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            <circle r="8" fill="#0b1330" stroke={n.color} strokeWidth="1.4" />
                            <path
                              d="M-2.8,-2.8 L2.8,2.8 M2.8,-2.8 L-2.8,2.8"
                              stroke={n.color}
                              strokeWidth="1.7"
                              strokeLinecap="round"
                            />
                            <title>删除这个节点</title>
                          </g>
                        )}
                      </g>
                    </g>
                  );
                })}
              </g>

              {/* 边标签：只在聚焦时显示与焦点相邻的边（全量显示会糊成一团） */}
              <g data-kg="edge-labels">
                {links.map((l, i) => {
                  const show = focusId !== null && (l.source.id === focusId || l.target.id === focusId);
                  return (
                    <text
                      key={`lt${i}`}
                      ref={(el) => {
                        edgeLabelRefs.current[i] = el;
                      }}
                      fontSize={10}
                      fill={DEEP_SPACE.edgeLabel}
                      textAnchor="middle"
                      opacity={show ? 1 : 0}
                      style={{ pointerEvents: 'none', transition: 'opacity 200ms' }}
                    >
                      {show ? l.relation : ''}
                    </text>
                  );
                })}
              </g>
            </svg>

            {/* 视角与缩放控件：右上角浮层 */}
            <div className="absolute right-3 top-3 flex flex-col gap-1.5">
              <button
                onClick={() => zoomBy(0.2)}
                title="放大"
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/25 bg-white/15 text-white backdrop-blur hover:bg-white/30 cursor-pointer"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <button
                onClick={() => zoomBy(-0.2)}
                title="缩小"
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/25 bg-white/15 text-white backdrop-blur hover:bg-white/30 cursor-pointer"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                onClick={() => (spinning ? setSpinning(false) : resumeSpin())}
                title={spinning ? '暂停旋转' : '继续旋转'}
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/25 bg-white/15 text-white backdrop-blur hover:bg-white/30 cursor-pointer"
              >
                {spinning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <button
                onClick={resetView}
                title="重置视角"
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/25 bg-white/15 text-white backdrop-blur hover:bg-white/30 cursor-pointer"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            </div>

            {/* 操作提示 */}
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-black/35 px-2.5 py-1.5 text-[11px] text-white/70 backdrop-blur">
              拖动旋转 · 滚轮缩放 · 点击节点看同类发光 · 双击转到正面
            </div>

            {/* 聚焦时说明"点亮的是什么"：否则用户不知道同类发光的判据 */}
            {focusNode && (
              <div className="pointer-events-none absolute bottom-3 right-3 rounded-lg bg-black/35 px-2.5 py-1.5 text-[11px] text-white/75 backdrop-blur">
                已点亮同类：
                {focusLabel === 'Interest' && focusNode.category
                  ? `兴趣 · ${focusNode.category}`
                  : LABEL_NAME[focusLabel ?? ''] ?? focusLabel}
              </div>
            )}

            {/* 选中详情：**浮在画布之上**，而不是排在卡片下面。
                为什么必须浮（真实缺陷）：页面现在撑满一屏、星图卡是 flex-1。
                若详情卡插进文档流，它一出现就把星图卡压低（实测 584px → 482px），
                而画布尺寸一变，所有节点的屏幕坐标就跟着变（实测「考试」位移 56px）。
                后果不止是"图跳一下"：**双击节点会被自己的第一下 click 破坏** ——
                第一下选中 → 详情卡挤进来 → 画布缩小 → 节点移位 → 第二下点空。
                改造前星图是固定宽高比、不随内容伸缩，所以没暴露这个问题。
                浮动式还顺带省下详情卡占的那 100px 高度，一屏更从容。
                位置选左上：右下是"已点亮同类"、左下是操作提示、右上是缩放控件，
                只有左上这块是空的。 */}
            {selNode && (
              <div className="absolute left-3 top-3 z-10 max-h-[calc(100%-1.5rem)] w-[min(22rem,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-white/15 bg-[#0b1330]/85 p-3 text-white shadow-[0_18px_50px_-30px_rgba(0,0,0,0.9)] backdrop-blur">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-sm font-semibold">
                    <span className="block truncate">节点：{selNode.name}</span>
                    <span className="mt-0.5 block text-[11px] font-normal text-white/60">
                      {LABEL_NAME[selNode.label] ?? selNode.label}
                      {selNode.category ? ` · ${selNode.category}` : ''}
                    </span>
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    {/* 用户节点是核心，不给删（删了整张图没有根了） */}
                    {selNode.label !== 'User' && (
                      <button
                        onClick={() => setPendingDelete(selNode)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-danger-500/20 px-2.5 py-1.5 text-xs font-medium text-danger-100 hover:bg-danger-500/35 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> 删除节点
                      </button>
                    )}
                    <button onClick={() => setSelected(null)} className="text-white/50 hover:text-white cursor-pointer">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {/* 关联边列表：深空底上用浅色小字，边多时内部滚动（不撑高浮层） */}
                <div className="app-scrollbar mt-2 max-h-32 overflow-y-auto space-y-1 text-[11px] text-white/70">
                  {links
                    .filter((l) => l.source.id === selNode.id || l.target.id === selNode.id)
                    .map((l, i) => (
                      <p key={i} className="font-mono">
                        {l.source.id === selNode.id
                          ? `—[${l.relation}]→ ${l.target.name}`
                          : `${l.source.name} —[${l.relation}]→`}
                      </p>
                    ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 图例：深空底上的用色说明（同时是"哪些点算同类"的索引）。
          shrink-0：它必须完整可见，高度不参与压缩 —— 一屏的预算先给
          标题卡/图例/详情，星图吃剩下的。 */}
      <div className="ui-card shrink-0 p-4 flex flex-wrap gap-3 items-center">
        <span className="text-xs font-medium text-slate-500 mr-1">星体类型：</span>
        {Object.entries(LABEL_NAME).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <span className="w-3 h-3 rounded-full inline-block" style={{ background: nodeColorOf(k) }} />
            {v}
          </span>
        ))}
      </div>

      {/* 删除确认：心理图谱是长期积累，删错代价高，必须二次确认并说清影响范围 */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => !deleting && setPendingDelete(null)}
        >
          <div
            className="ui-card w-full max-w-md p-6 shadow-[0_24px_70px_-36px_rgba(16,24,40,0.45)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-800">
              <Trash2 className="w-4 h-4 text-danger-500" /> 从图谱中删除「{pendingDelete.name}」？
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              将删除你与这个节点之间的全部关联记录，图谱上这个点会消失。
              删除后无法恢复。
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              只影响你自己的图谱 —— 节点本身在系统里是共享的，删除不会影响其他用户的记录。
              {!graphConnected && ' 当前图数据库未连接，本次只删本机记录。'}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-50 cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-lg bg-danger-500 px-4 py-2 text-sm font-medium text-white hover:bg-danger-600 disabled:opacity-50 cursor-pointer"
              >
                {deleting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
