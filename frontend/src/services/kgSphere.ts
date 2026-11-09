/**
 * kgSphere.ts · 知识图谱的三维球面布局与透视投影（纯函数，不含任何 React / DOM）
 *
 * 为什么要单独一层：图谱页从「2D 力导向」换成「3D 星空」后，最容易出问题的
 * 从来不是渲染，而是**坐标**——布局、旋转、透视三件事互相耦合，如果全写在
 * 组件里，改一处就说不清是哪一步算错了。这里把它们拆成可单独验算的纯函数：
 *
 *   sphereLayout()  节点 id → 单位球面上的三维坐标（确定性，同一份数据永远同一结果）
 *   projectPoint()  三维点 + 相机 → 屏幕坐标 / 深度缩放 / 远近系数
 *   buildRings()    三条大圆的采样点（星空球体的经纬线）
 *
 * ── 布局为什么是「类型锚点 + 锥内螺旋」而不是力导向 ───────────────────────
 * 需求是「同个类型的节点尽量靠近」。力导向只能让它**倾向于**靠近，节点一多
 * 就会被斥力推散；而锥内螺旋是结构保证：每个类型先占球面一个锚点方向
 * （Fibonacci 球均分，相邻锚点约 63°），该类型的节点全部撒在锚点周围一个
 * 约 21° 的锥内 —— 不论多少个节点，同类永远抱成一团，不同类永远不会混。
 *
 * ── 为什么用 Fibonacci 球分锚点 ───────────────────────────────────────────
 * 按经纬度均分会在两极堆点，改用黄金角螺旋（Fibonacci）能在球面上得到
 * 近似均匀的分布，任意两个锚点间距都差不多 —— 每个类型分到的"地盘"一样大，
 * 不会出现某两类挤在一起、另外两类空一大片。
 * 索引从 (i+0.5)/n 起步而不是 i/(n-1)：后者必然把首尾两个锚点放在南北极，
 * 而两极在视角正上/正下方，投影后会和中心的用户节点重叠。
 *
 * ── 透视的坐标口径（改参数前务必读） ──────────────────────────────────────
 * 世界空间里球壳半径≈1，相机在 +z 方向 CAM_DIST 处、朝 -z 看。投影：
 *     depth  = CAM_DIST - z'            （越大越远）
 *     persp  = FOCAL / depth
 *     屏幕坐标 = 中心 + 坐标 × KG_PX × persp × zoom
 *     depthScale = CAM_DIST / depth     （1 = 基准深度，>1 更近、<1 更远）
 * 球壳在屏幕上投出的最大半径出现在 z'=0 的那一圈（θ=90°）：
 *     KG_PX × FOCAL/CAM_DIST = 262 × 2.6/3.2 ≈ 213px
 * 画布高 560（半高 280）。实测：把相机俯仰扫过 -0.4…0.4 弧度、偏航整整一圈，
 * 节点中心的屏幕偏移最大 |Δx|=236、|Δy|=227（脚本实测，见 .tmp_probe 的验算）；
 * 垂直方向再叠加节点半径约 14px 与下方标签约 20px → 261px < 280，不裁切。
 * KG_PX 初版取的是 285，实测"含标签余量 282 > 280"会裁到最下方那排标签，
 * 因此收紧到 262 —— 球体在横向上反而更舒展（430px 直径居中于 900px 画布）。
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Pos {
  x: number;
  y: number;
}

/** 相机：yaw 绕 Y 轴（左右转）、pitch 绕 X 轴（上下翻）、zoom 缩放 */
export interface Camera {
  yaw: number;
  pitch: number;
  zoom: number;
}

export interface Projected extends Pos {
  /** 相对基准深度的缩放（1 = 正好在球心平面），用于节点半径与字号 */
  depthScale: number;
  /** 0 = 最远、1 = 最近。用于雾化（越远越暗） */
  nearness: number;
  /** 旋转后的 z（正 = 朝观察者）。用于远近排序 */
  z: number;
}

/* ───────────────────────────── 画布与投影常量 ───────────────────────────── */

export const KG_W = 900;
export const KG_H = 560;
/** 与 KG_W/KG_H 对应的 viewBox 字符串：验证脚本按它取 SVG，改尺寸时要同步 */
export const KG_VIEWBOX = `0 0 ${KG_W} ${KG_H}`;

const CX = KG_W / 2;
const CY = KG_H / 2;
/** 相机到原点的距离（世界单位） */
const CAM_DIST = 3.2;
/** 焦距：与 CAM_DIST 一起决定透视强度（比值 2.6/3.2 越大透视越夸张） */
const FOCAL = 2.6;
/** 世界单位 → 像素。262 是实测定的：再大最下方那排标签就会被画布下边缘裁掉 */
export const KG_PX = 262;

/** 相机默认位姿：略微从上方俯看，符合"星图"的习惯视角 */
export const DEFAULT_CAMERA: Camera = { yaw: 0.35, pitch: 0.22, zoom: 1 };

/** 自动自转速度（弧度/秒）。0.10 ≈ 63 秒一圈，是"在转"但不打扰往下读的节奏 */
export const AUTO_YAW_SPEED = 0.1;
/** 俯仰的极缓摆动幅度与周期：让静止时也能看出这是个立体球，而不是一张圆图 */
export const PITCH_SWAY_AMP = 0.06;
export const PITCH_SWAY_PERIOD = 31;

/* ───────────────────────────── 布局常量 ───────────────────────────── */

/** 锥内撒点的最大切向距离（≈球面上 26°），决定同一类"抱团"有多紧 */
const CONE_R = 0.46;
/**
 * 同类节点之间的切向间距下限。
 *
 * 间距本身是**算出来的**（见 sphereLayout：把整簇按 √k 均分填满锥），
 * 这里只保一个下限，防止某一类节点特别多（>40 个）时挤成一团糊掉。
 * 踩过的坑：初版还设了上限 CLUSTER_STEP_MAX = 0.13，结果**小簇被卡死** ——
 * 3 个节点时间距被压到 0.13（投影后约 34px），而节点半径已达 13px、
 * 标签字号 11px，实测同类节点屏幕间距只有 20~30px，节点互相压着、
 * 标签糊成一片，点击还会误中旁边的节点。去掉上限、改为按锥均分后，
 * 3 个节点铺满 26° 的锥（投影后约 85px 间距），既"抱团"又点得准。
 */
const CLUSTER_STEP_MIN = 0.075;
/** 黄金角：按它转着撒点，任意两点不会连成直线，看起来才像自然分布 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** 用户节点固定在球心 —— "我的画像"是整张图的核心 */
export const CENTER: Vec3 = { x: 0, y: 0, z: 0 };

/* ───────────────────────────── 小工具 ───────────────────────────── */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 字符串 → [0,1) 的确定性散列（FNV-1a）。用它代替 Math.random：
 *  同一份数据每次刷新得到同一张图，节点不会"每次打开都在别的位置"。 */
export function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100003) / 100003;
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

/** 取一组与单位向量 a 正交的基 (u, v)。挑"最不平行的坐标轴"去叉乘，避免退化 */
function orthonormalBasis(a: Vec3): { u: Vec3; v: Vec3 } {
  const ax = Math.abs(a.x);
  const ay = Math.abs(a.y);
  const az = Math.abs(a.z);
  const seed: Vec3 = ax <= ay && ax <= az ? { x: 1, y: 0, z: 0 } : ay <= az ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  const u = normalize(cross(a, seed));
  const v = normalize(cross(a, u));
  return { u, v };
}

/** 球面上近似均匀的 n 个方向（Fibonacci 螺旋）。刻意避开南北极，见文件顶部说明 */
function fibonacciSphere(n: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2; // (0.5..n-0.5)/n → 不含 ±1
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN_ANGLE * i;
    out.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r });
  }
  return out;
}

/* ───────────────────────────── 球面布局 ───────────────────────────── */

export interface LayoutInput {
  id: string;
  label: string;
}

/**
 * 把节点铺到单位球面上。
 *
 * 结构：用户节点 → 球心；其余按 label 分组 → 每组一个锚点方向 + 锥内螺旋。
 * 同类型的节点因此永远聚在一起（结构保证，不靠力导向"尽量"）。
 *
 * @param nodes 节点列表（含 label）
 * @returns     id → 球面上的三维坐标（用户节点为 (0,0,0)）
 */
export function sphereLayout(nodes: LayoutInput[]): Map<string, Vec3> {
  const out = new Map<string, Vec3>();

  const byType = new Map<string, LayoutInput[]>();
  for (const n of nodes) {
    if (n.label === 'User') {
      out.set(n.id, { ...CENTER });
      continue;
    }
    const arr = byType.get(n.label);
    if (arr) arr.push(n);
    else byType.set(n.label, [n]);
  }

  /* 类型按名字排序后分配锚点：顺序稳定，加一个节点不会让所有类型整体换位 */
  const types = [...byType.keys()].sort();
  const anchors = fibonacciSphere(types.length);

  types.forEach((type, ti) => {
    const anchor = anchors[ti];
    const { u, v } = orthonormalBasis(anchor);
    /* 每个类型的螺旋起始角不同，否则所有簇的花纹会长得一模一样 */
    const phase = hash01(`phase:${type}`) * Math.PI * 2;
    /* 每个类型的球壳半径略有差异（±6%），避免所有簇正好贴在同一层球壳上 ——
       那样从侧面看会是一条"薄片"，加一点厚度才有体积感 */
    const shell = 1 + (hash01(`shell:${type}`) - 0.5) * 0.12;

    const list = byType.get(type)!;
    const m = list.length;
    /**
     * 间距：把整簇按 √k 的螺旋**铺满整个锥**，而不是取 min(锥/√m, 上限)。
     *
     * 数学上，第 k 个点落在半径 step·√k 处，最外圈 k=m-1 恰好到 step·√(m-1)。
     * 要"铺满锥（不用满、留 6% 余量）且相邻点等距"，就解 step = CONE_R·0.94/√(m-1)。
     * 单点（m=1）落在锥心即可。
     * 这样同类节点的**平均间距**随数量自然收缩，但永远不重叠 ——
     * 节点越多簇越大，而不是越挤。
     */
    const step = m <= 1 ? 0 : Math.max(CLUSTER_STEP_MIN, (CONE_R * 0.94) / Math.sqrt(m - 1));

    list.forEach((n, k) => {
      const t = phase + k * GOLDEN_ANGLE;
      /* ±7% 的半径抖动：纯螺旋太"规整"，抖一下更像自然分布 */
      const jitter = 1 + (hash01(`${type}|${n.id}`) - 0.5) * 0.14;
      const d = step * Math.sqrt(k) * jitter;
      const offset: Vec3 = {
        x: (u.x * Math.cos(t) + v.x * Math.sin(t)) * d,
        y: (u.y * Math.cos(t) + v.y * Math.sin(t)) * d,
        z: (u.z * Math.cos(t) + v.z * Math.sin(t)) * d,
      };
      /* offset ⊥ anchor，所以 anchor+offset 的模恒为 √(1+d²)：归一化后再乘
         shell，落点就精确在球壳上，切向偏移仍是 d */
      const dir = normalize({ x: anchor.x + offset.x, y: anchor.y + offset.y, z: anchor.z + offset.z });
      out.set(n.id, { x: dir.x * shell, y: dir.y * shell, z: dir.z * shell });
    });
  });

  return out;
}

/* ───────────────────────────── 旋转与投影 ───────────────────────────── */

/** 先绕 Y 轴转 yaw，再绕 X 轴转 pitch */
export function rotatePoint(p: Vec3, yaw: number, pitch: number): Vec3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const x1 = p.x * cy + p.z * sy;
  const z1 = -p.x * sy + p.z * cy;
  const y1 = p.y;
  return { x: x1, y: y1 * cp - z1 * sp, z: y1 * sp + z1 * cp };
}

/** 世界坐标 → 屏幕坐标（含透视与缩放） */
export function projectPoint(p: Vec3, cam: Camera): Projected {
  const q = rotatePoint(p, cam.yaw, cam.pitch);
  const depth = CAM_DIST - q.z;
  const persp = FOCAL / depth;
  const k = KG_PX * persp * cam.zoom;
  return {
    x: CX + q.x * k,
    y: CY + q.y * k,
    depthScale: CAM_DIST / depth,
    nearness: clamp((q.z + 1) / 2, 0, 1),
    z: q.z,
  };
}

/** 只算深度缩放（不需要屏幕坐标时用，少两次乘法） */
export function depthScaleOf(p: Vec3, cam: Camera): number {
  const q = rotatePoint(p, cam.yaw, cam.pitch);
  return CAM_DIST / (CAM_DIST - q.z);
}

/** 把一组"深空底纹"的坐标也跟着相机转（大圆经纬线用） */
export function projectRing(points: Vec3[], cam: Camera): Pos[] {
  return points.map((p) => projectPoint(p, cam));
}

/* ───────────────────────────── 球体经纬线 ───────────────────────────── */

/**
 * 三条大圆的采样点（未旋转，投影时再跟着相机转）。
 *
 * 为什么画大圆而不是"同心圆环"：同心圆环只在正对视角时读起来是球，
 * 一转视角就露馅（它不跟着转、也不变成椭圆）。大圆是三维曲线，
 * 旋转后自然投影成椭圆，球体感就立住了。
 */
export function buildRings(samples = 72): Vec3[][] {
  const planes: Vec3[] = [
    { x: 0, y: 1, z: 0 }, // 赤道
    { x: 0.92, y: 0.38, z: 0 }, // 斜 22°
    { x: 0.5, y: 0, z: 0.866 }, // 斜 60°
  ];
  return planes.map((n) => {
    const { u, v } = orthonormalBasis(normalize(n));
    const pts: Vec3[] = [];
    for (let i = 0; i <= samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      pts.push({ x: u.x * c + v.x * s, y: u.y * c + v.y * s, z: u.z * c + v.z * s });
    }
    return pts;
  });
}

/** 把点列转成 SVG path（需要填充/描边的曲线用） */
export function ringPath(screen: Pos[]): string {
  if (!screen.length) return '';
  return screen.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

/** 把点列转成 <polyline points="..."> 的字符串（比 path 少一次解析，且更好直接更新） */
export function ringPoints(screen: Pos[]): string {
  return screen.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

/**
 * 求"把某个方向转到正对观察者（+z）"所需的相机位姿。
 *
 * 旋转顺序是 先 Ry(yaw) 再 Rx(pitch)（见 rotatePoint），所以可以解析反解：
 *   · Ry 要让 x 分量归零、z 分量为正：yaw = atan2(-x, z)
 *   · Rx 要让 y 分量归零、z 分量保持为正：pitch = atan2(y, √(x²+z²))
 * 双击节点"转到正面"用它，比逐步动画更准也更快（一步到位）。
 */
export function cameraLookingAt(v: Vec3): { yaw: number; pitch: number } {
  const r = Math.hypot(v.x, v.z);
  return { yaw: Math.atan2(-v.x, v.z), pitch: Math.atan2(v.y, r) };
}
