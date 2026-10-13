import { useEffect, useMemo, useRef, useState } from 'react';
import { Network, RefreshCw, AlertTriangle, HardDrive, MessageCircleHeart } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, type GraphData } from '../../services/api';
import { briefErrorMessage } from '../../services/http';
import { getCurrentSession } from '../../auth/session';
import { localGraph, mergeGraphs } from '../../services/localKg';

/* 节点/分类配色。
 *
 * 为什么不能直接写死十六进制：SVG 的 fill / stroke 属性不解析 var()，
 * 而 <html> 上的 .dark 会把整套 --color-* 令牌翻过来。所以这里在运行时
 * 从 documentElement 上读令牌值，并监听 class 变化——主题一换，
 * 色板跟着重算，深色下不会再出现浅色调的节点。
 * 每个标签保留原本的色相语义（用户/兴趣/情绪/症状/生活事件/诱因/应对/障碍）。 */
function readPalette() {
  const s = typeof window === 'undefined' ? null : getComputedStyle(document.documentElement);
  /* 第二个参数只是令牌读不到时的兜底（理论上不会用到）：真正的颜色一律来自
     index.css 的 --color-*，深浅色由 html.dark 翻转，这里只负责把它们读出来。 */
  const v = (name: string, fallback: string) => s?.getPropertyValue(name).trim() || fallback;
  return {
    user: v('--color-primary-500', '#465fff'),
    interest: v('--color-slate-500', '#667085'),
    emotion: v('--color-warning-500', '#f79009'),
    symptom: v('--color-danger-500', '#f04438'),
    lifeEvent: v('--color-primary-400', '#7592ff'),
    trigger: v('--color-orange-500', '#fb6514'),
    coping: v('--color-success-500', '#12b76a'),
    disorder: v('--color-danger-600', '#d92d20'),
    /* 兜底节点色与图的线条/文字 */
    fallback: v('--color-slate-400', '#98a2b3'),
    edge: v('--color-slate-300', '#d0d5dd'),
    edgeLabel: v('--color-slate-400', '#98a2b3'),
    nodeLabel: v('--color-slate-700', '#344054'),
    nodeRing: v('--color-white', '#ffffff'),
    /* 图谱底色：两端都用令牌，深色下是一块深底而不是刺眼的浅绿白 */
    canvasFrom: v('--color-slate-50', '#f9fafb'),
    canvasTo: v('--color-primary-50', '#ecf3ff'),
  };
}

type Palette = ReturnType<typeof readPalette>;

/** 跟随 html.dark 重算色板 */
function usePalette(): Palette {
  const [palette, setPalette] = useState<Palette>(readPalette);
  useEffect(() => {
    const observer = new MutationObserver(() => setPalette(readPalette()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return palette;
}

function labelColor(palette: Palette, label: string): string {
  const map: Record<string, string> = {
    User: palette.user,
    Interest: palette.interest,
    Emotion: palette.emotion,
    Symptom: palette.symptom,
    LifeEvent: palette.lifeEvent,
    Trigger: palette.trigger,
    Coping: palette.coping,
    Disorder: palette.disorder,
  };
  return map[label] ?? palette.fallback;
}

/** Interest 的分类色：统一走令牌色相，不再是一组浅色专用的硬编码值 */
function categoryColor(palette: Palette, category: string): string | undefined {
  const map: Record<string, string> = {
    音乐: palette.user,
    体育赛事: palette.lifeEvent,
    影视: palette.trigger,
    游戏: palette.disorder,
    运动: palette.coping,
    美食: palette.emotion,
    旅行: palette.interest,
  };
  return map[category];
}

const LABEL_NAME: Record<string, string> = {
  User: '用户', Interest: '兴趣', Emotion: '情绪', Symptom: '症状',
  LifeEvent: '生活事件', Trigger: '诱因', Coping: '应对方式', Disorder: '障碍',
};

interface Pos { x: number; y: number }
interface SimNode extends Pos { id: string; name: string; label: string; category?: string | null; vx: number; vy: number }
interface SimLink { source: SimNode; target: SimNode; relation: string }

export default function KgPage() {
  const session = getCurrentSession();
  const userId = session?.username ?? 'demo_user';

  const [data, setData] = useState<GraphData | null>(null);
  /** 后端图谱是否拿到了数据（决定"来源"标注写服务端还是本机） */
  const [serverNodes, setServerNodes] = useState(0);
  /** 图数据库是否真的连上了（Neo4j 已装好并接通，标注必须按真实状态写） */
  const [graphConnected, setGraphConnected] = useState(false);
  /** 本机三元组条数（localStorage）：标注里要用 */
  const [localCount, setLocalCount] = useState(0);
  const [serverNotice, setServerNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [, setRenderTick] = useState(0);
  /* 主题感知的节点/线条配色（见文件顶部 readPalette 的说明） */
  const palette = usePalette();

  /* L1：本机（localStorage）里的三元组由「AI 陪伴对话」写入，这里作为图谱的
     基础数据源。服务端（Neo4j）能给出数据时以它为主，本机只补充缺的部分。 */
  const load = async () => {
    setLoading(true);
    setServerNotice('');
    const local = localGraph(userId);
  setLocalCount(Math.max(0, local.nodes.length - 1));
    try {
      const server = await api.getGraph(userId);
      setServerNodes(Math.max(0, server.nodes.length - 1));
      setData(mergeGraphs(server, local));
      /* 说明文案只按**真实连接状态**给：连上了就什么都不说（2026-10-14 用户要求删掉
         "服务端处于演示模式 · 未连接图数据库"那句 —— Neo4j 已接通，那句话是错的）；
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
         直接上屏就是"把后端返回体糊在用户脸上"——这正是 2026-10-14 那个 bug。 */
      setServerNodes(0);
      setGraphConnected(false);
      setServerNotice(
        `知识图谱服务暂时取不到（${briefErrorMessage(e, '未连接到服务端')}），当前显示本机记录。`,
      );
      setData(local.nodes.length > 1 ? local : null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ---- 力导向布局模拟 ----
  const W = 860, H = 520;
  const nodes = useMemo<SimNode[]>(() => {
    if (!data) return [];
    return data.nodes.map((n, i) => {
      const angle = (i / Math.max(1, data.nodes.length)) * Math.PI * 2;
      return {
        id: n.id, name: n.name, label: n.label, category: n.category ?? null,
        x: W / 2 + Math.cos(angle) * 150, y: H / 2 + Math.sin(angle) * 150, vx: 0, vy: 0,
      };
    });
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

  const positionsRef = useRef<Map<string, Pos>>(new Map());

  // 简单力导向迭代（useEffect 内做几百次迭代收敛）
  useEffect(() => {
    if (nodes.length === 0) return;
    const pos = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    const iterations = 300;
    for (let iter = 0; iter < iterations; iter++) {
      const temp = 1 - iter / iterations;
      // 斥力
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = pos.get(nodes[i].id)!, b = pos.get(nodes[j].id)!;
          let dx = b.x - a.x, dy = b.y - a.y;
          let dist = Math.hypot(dx, dy);
          if (dist < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; dist = Math.hypot(dx, dy) || 1; }
          const force = (2200 / dist) * temp * 0.04;
          dx = (dx / dist) * force; dy = (dy / dist) * force;
          a.x -= dx; a.y -= dy; b.x += dx; b.y += dy;
        }
      }
      // 引力（边）
      for (const l of links) {
        const a = pos.get(l.source.id)!, b = pos.get(l.target.id)!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1;
        const force = (dist - 110) * 0.012 * temp;
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        a.x += fx; a.y += fy; b.x -= fx; b.y -= fy;
      }
      // 向心（防止漂移）
      for (const n of nodes) {
        const p = pos.get(n.id)!;
        p.x += (W / 2 - p.x) * 0.008 * temp;
        p.y += (H / 2 - p.y) * 0.008 * temp;
        p.x = Math.max(30, Math.min(W - 30, p.x));
        p.y = Math.max(30, Math.min(H - 30, p.y));
      }
    }
    positionsRef.current = pos;
    // 触发重绘
    setRenderTick((t) => t + 1);
  }, [nodes, links]);

  const pos = positionsRef.current;
  const selNode = nodes.find((n) => n.id === selected);

  return (
    <div className="space-y-4">
      <div className="ui-card p-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <Network className="w-4 h-4 text-primary-600" /> 我的个人知识图谱
          </h2>
          <p className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              用户 <span className="font-mono">{userId}</span> 的专属子图 · 点击节点查看详情
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
        <div className="flex items-center gap-2 text-sm text-slate-600 ui-card px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-warning-500" />
          <span>{serverNotice}</span>
        </div>
      )}

      <div className="ui-card overflow-hidden">
        {!data || nodes.length === 0 || links.length === 0 ? (
          <div className="h-[520px] flex flex-col items-center justify-center gap-3 text-sm text-slate-400">
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
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" style={{ background: `linear-gradient(135deg,${palette.canvasFrom},${palette.canvasTo})` }}>
            {/* 边 */}
            {links.map((l, i) => (
              <line
                key={i}
                x1={pos.get(l.source.id)?.x ?? 0} y1={pos.get(l.source.id)?.y ?? 0}
                x2={pos.get(l.target.id)?.x ?? 0} y2={pos.get(l.target.id)?.y ?? 0}
                stroke={palette.edge} strokeWidth={1.5} strokeOpacity={0.7}
              />
            ))}
            {/* 边标签 */}
            {links.map((l, i) => {
              const x1 = pos.get(l.source.id)?.x ?? 0, y1 = pos.get(l.source.id)?.y ?? 0;
              const x2 = pos.get(l.target.id)?.x ?? 0, y2 = pos.get(l.target.id)?.y ?? 0;
              return (
                <text key={`t${i}`} x={(x1 + x2) / 2} y={(y1 + y2) / 2} fontSize={9} fill={palette.edgeLabel} textAnchor="middle">
                  {l.relation}
                </text>
              );
            })}
            {/* 节点 */}
            {nodes.map((n) => {
              const p = pos.get(n.id);
              if (!p) return null;
              const isUser = n.label === 'User';
              const fill = isUser
                ? palette.user
                : (n.category ? categoryColor(palette, n.category) : undefined) ?? labelColor(palette, n.label);
              const r = isUser ? 22 : n.label === 'Disorder' ? 14 : 11;
              return (
                <g key={n.id} transform={`translate(${p.x},${p.y})`} onClick={() => setSelected(n.id)} style={{ cursor: 'pointer' }}>
                  <circle r={r + 4} fill={fill} opacity={selected === n.id ? 0.25 : 0.12} />
                  <circle r={r} fill={fill} stroke={palette.nodeRing} strokeWidth={2} />
                  <text y={r + 14} fontSize={11} textAnchor="middle" fill={palette.nodeLabel} fontWeight={isUser ? 700 : 400}>
                    {n.name.length > 6 ? n.name.slice(0, 6) + '…' : n.name}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* 图例 */}
      <div className="ui-card p-4 flex flex-wrap gap-3 items-center">
        <span className="text-xs font-medium text-slate-500 mr-1">图例：</span>
        {Object.entries(LABEL_NAME).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <span className="w-3 h-3 rounded-full inline-block" style={{ background: labelColor(palette, k) }} />
            {v}
          </span>
        ))}
      </div>

      {/* 选中详情 */}
      {selNode && (
        <div className="ui-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">
              节点：{selNode.name}
              <span className="ml-2 text-xs font-normal text-slate-500">
                {LABEL_NAME[selNode.label] ?? selNode.label}
                {selNode.category ? ` · ${selNode.category}` : ''}
              </span>
            </p>
            <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">✕</button>
          </div>
          <div className="mt-2 text-sm text-slate-600 space-y-1">
            {links
              .filter((l) => l.source.id === selNode.id || l.target.id === selNode.id)
              .map((l, i) => (
                <p key={i} className="font-mono text-xs">
                  {l.source.id === selNode.id
                    ? `—[${l.relation}]→ ${l.target.name}`
                    : `${l.source.name} —[${l.relation}]→`}
                </p>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
