import { useEffect, useMemo, useRef, useState } from 'react';
import { Network, RefreshCw, AlertTriangle } from 'lucide-react';
import { api, type GraphData } from '../../services/api';
import { getCurrentSession } from '../../auth/session';

// 标签 -> 颜色（与后端本体对应）
const LABEL_COLOR: Record<string, string> = {
  User: '#059669',
  Interest: '#3b82f6',
  Emotion: '#f59e0b',
  Symptom: '#ef4444',
  LifeEvent: '#8b5cf6',
  Trigger: '#f97316',
  Coping: '#10b981',
  Disorder: '#dc2626',
};
const LABEL_NAME: Record<string, string> = {
  User: '用户', Interest: '兴趣', Emotion: '情绪', Symptom: '症状',
  LifeEvent: '生活事件', Trigger: '诱因', Coping: '应对方式', Disorder: '障碍',
};
const CATEGORY_COLOR: Record<string, string> = {
  音乐: '#6366f1', 体育赛事: '#0ea5e9', 影视: '#a855f7', 游戏: '#f43f5e',
  运动: '#22c55e', 美食: '#f59e0b', 旅行: '#14b8a6',
};

interface Pos { x: number; y: number }
interface SimNode extends Pos { id: string; name: string; label: string; category?: string | null; vx: number; vy: number }
interface SimLink { source: SimNode; target: SimNode; relation: string }

export default function KgPage() {
  const session = getCurrentSession();
  const userId = session?.username ?? 'demo_user';

  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [, setRenderTick] = useState(0);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.getGraph(userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载图谱失败');
      setData(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links]);

  const pos = positionsRef.current;
  const selNode = nodes.find((n) => n.id === selected);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <Network className="w-4 h-4 text-emerald-600" /> 我的个人知识图谱
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            用户 <span className="font-mono">{userId}</span> 的专属子图 · 点击节点查看详情
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-sm font-medium hover:bg-emerald-100 disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-danger-600 bg-danger-50 border border-danger-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {!data || nodes.length === 0 ? (
          <div className="h-[520px] flex items-center justify-center text-sm text-slate-400">
            {loading ? '加载中…' : data ? '该用户暂无图谱数据，去对话页聊几句吧' : '无法加载图谱'}
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" style={{ background: 'linear-gradient(135deg,#f8fafc,#f0fdf4)' }}>
            {/* 边 */}
            {links.map((l, i) => (
              <line
                key={i}
                x1={pos.get(l.source.id)?.x ?? 0} y1={pos.get(l.source.id)?.y ?? 0}
                x2={pos.get(l.target.id)?.x ?? 0} y2={pos.get(l.target.id)?.y ?? 0}
                stroke="#cbd5e1" strokeWidth={1.5} strokeOpacity={0.7}
              />
            ))}
            {/* 边标签 */}
            {links.map((l, i) => {
              const x1 = pos.get(l.source.id)?.x ?? 0, y1 = pos.get(l.source.id)?.y ?? 0;
              const x2 = pos.get(l.target.id)?.x ?? 0, y2 = pos.get(l.target.id)?.y ?? 0;
              return (
                <text key={`t${i}`} x={(x1 + x2) / 2} y={(y1 + y2) / 2} fontSize={9} fill="#94a3b8" textAnchor="middle">
                  {l.relation}
                </text>
              );
            })}
            {/* 节点 */}
            {nodes.map((n) => {
              const p = pos.get(n.id);
              if (!p) return null;
              const isUser = n.label === 'User';
              const fill = isUser ? LABEL_COLOR.User : (n.category && CATEGORY_COLOR[n.category]) || LABEL_COLOR[n.label] || '#64748b';
              const r = isUser ? 22 : n.label === 'Disorder' ? 14 : 11;
              return (
                <g key={n.id} transform={`translate(${p.x},${p.y})`} onClick={() => setSelected(n.id)} style={{ cursor: 'pointer' }}>
                  <circle r={r + 4} fill={fill} opacity={selected === n.id ? 0.25 : 0.12} />
                  <circle r={r} fill={fill} stroke="#fff" strokeWidth={2} />
                  <text y={r + 14} fontSize={11} textAnchor="middle" fill="#334155" fontWeight={isUser ? 700 : 400}>
                    {n.name.length > 6 ? n.name.slice(0, 6) + '…' : n.name}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* 图例 */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-wrap gap-3 items-center">
        <span className="text-xs font-medium text-slate-500 mr-1">图例：</span>
        {Object.entries(LABEL_NAME).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <span className="w-3 h-3 rounded-full inline-block" style={{ background: LABEL_COLOR[k] }} />
            {v}
          </span>
        ))}
      </div>

      {/* 选中详情 */}
      {selNode && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
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
