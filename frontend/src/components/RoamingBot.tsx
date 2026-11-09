/**
 * RoamingBot.tsx · 会自己走动的 AI 机器人（全屏游走，从对话面板下层走过）
 *
 * ── 2026-11-08 第四轮：从"一直在走"改成"偶尔走两步" ────────────────────────
 * 用户要求：「机器人的行进速度慢一点，机器人不用一直走，大部分时间可以在
 *            空白处站着，偶尔歪头有些小反应，偶尔走动」，并报告「歪头时右边
 *            缺失了一部分」（那是画布裁剪，已在 AiCompanionBot 里修掉）。
 *
 * 节奏上的三处调整：
 *
 *   1. **慢**：SPEED 78 → 40 px/s。按最远一次横穿算，从 3.4s 拉到 6s 上限。
 *      步行周期（摆腿那套 keyframes）也跟着从 0.8s 放宽到 1.15s —— 步频不
 *      跟着速度降，会变成"原地小碎步划过屏幕"。
 *
 *   2. **站得多、走得少**：每次落位后的站立时间从 2.2–5.2s 拉到 7–15s。
 *      走路只占其中 1.4–6s，所以任一时刻它大概率是站着的。
 *
 *   3. **站在看得见的地方**：落点分区加了权重 —— 面板左右两块空地权重 1，
 *      面板背后权重 0.35。于是绝大多数时间是站在空地上（用户能完整看到它
 *      发呆/歪头），偶尔才从面板背后穿一趟，保留"从对话下层走过"的效果。
 *
 * 歪头本身由 AiCompanionBot 的 `.bot-tilt` 负责（13s 一轮，大部分时间为 0°），
 * 这里只在**走路时**通过 walking 把它压住 —— 一边迈腿一边歪头会显得抽搐。
 *
 * ── 2026-11-08 第三轮（保留）─────────────────────────────────────────────
 * 用户要求：「机器人可以在全屏走动，在对话框不要直接闪现到另一侧，
 *            直接在对话框下层走过即可。输入时保持原有的靠近对话框好奇。」
 *
 *   1. 活动范围：从"面板左右两条走廊"扩到**整个页面内容区**（`.page-body`
 *      的完整矩形）。机器人现在会横穿面板背后走过，而不是只在两侧空地徘徊。
 *   2. 取消"隐身穿越"：上一版换边时是「淡出 → 瞬移 → 淡入」，读起来像闪现。
 *      这版**直接走过去**，全程连续位移。代价是它会从面板背后经过 —— 但用户
 *      要的正是这个效果（"直接从下层走过"），所以这是预期的，不是妥协。
 *   3. 位置与状态解耦：走路/站立/探看都不再依赖"在哪条走廊"，落点在整块
 *      画布内随机取，只有"探看"和"陪等"才回到面板旁边的空地（那两处必须
 *      让用户看得见它，落在面板背后就白搭了）。
 *
 * ── 图层：z-index:-1（关键前提） ──────────────────────────────────────────
 * 机器人挂在所有内容之下。所以：
 *   · 页头卡片、消息气泡、输入框这些**不透明**的元素会自然盖住它 ——
 *     它从面板背后经过时读起来是"从对话下面走过去"，而不是"贴在正文上"；
 *   · 消息气泡之间的透明空隙里能看到它 —— 这正是"看到它在走"的部分。
 * 这一条是本设计成立的前提：没有负 z-index，它就会压在被读的文字上。
 *
 * ── 坐标系：画布坐标 vs 机体坐标 ──────────────────────────────────────────
 * 宿主 div 覆盖整个 `.page-body`（由面板的实时 rect 反推四个方向的负偏移）。
 * 于是宿主坐标系 = 页面内容区，横向 0 点是内容区左缘。
 *
 * 这里有个必须分清的两套坐标：AiCompanionBot 的 svg 四周留了一圈透明余量
 * （给歪头/前倾的旋转用，见该文件头），所以
 *     画布坐标（= translate3d 用的 spot）      = 那个 svg 的外框
 *     机体坐标（= 用户眼里"机器人占的地方"）  = 再往内缩 padX / padTop
 * **所有"贴边""落在空地里"的判断都必须用机体坐标**，否则机器人看上去
 * 永远离容器边缘差一截（那截是透明余量）。测量时把 padX / padTop / padBottom
 * 一并算出来，`toSpot()` 负责把机体坐标折回画布坐标。
 *
 * 用 absolute 而非 fixed：页面滚动/布局变化时它跟着面板走，不必监听 scroll。
 */
 
import { useCallback, useEffect, useRef, useState } from 'react';
import AiCompanionBot, {
  BOT_ASPECT,
  BOT_CANVAS_RATIO,
  BOT_LEAN_EXT_RATIO,
  BOT_PAD_BOTTOM_RATIO,
  BOT_PAD_LEFT_RATIO,
  BOT_PAD_TOP_RATIO,
  type BotPose,
} from './AiCompanionBot';

interface RoamingBotProps {
  /** 对话面板的根元素（max-w-3xl 那一层）。活动区由它与父级推出 */
  panelRef: React.RefObject<HTMLElement | null>;
  /** 输入框所在行。用户输入时机器人到它旁边探身看 */
  composerRef: React.RefObject<HTMLElement | null>;
  /** 用户正在输入（聚焦输入框或有内容）→ 探身看 */
  peeking: boolean;
  /** AI 正在回复 → 到面板边上"陪着等" */
  busy: boolean;
  /** 附加类名 */
  className?: string;
}

/** 一次落点（**画布坐标系**，即 translate3d 直接吃的那套） */
interface Spot {
  x: number;
  y: number;
}

/** 量出来的几何 */
interface Bounds {
  /** 机器人 svg 的宽 / 高（画布口径） */
  w: number;
  h: number;
  /** 机体（不含透明余量）的宽 / 高 —— 判断"能不能塞得下""贴没贴边"都用它 */
  bodyW: number;
  bodyH: number;
  /** svg 四周透明余量折算成 px（画布口径） */
  padX: number;
  padTop: number;
  padBottom: number;
  /** 探看时朝面板那侧会多探出的 px（前倾+头偏甩出来的），算"站外侧"要额外留 */
  leanExt: number;
  /** 宿主画布尺寸（= 页面内容区） */
  hostW: number;
  hostH: number;
  /** 面板在宿主坐标系里的位置与尺寸 */
  panelLeft: number;
  panelTop: number;
  panelW: number;
  panelH: number;
  /** 面板左 / 右侧的可用空地（**机体左边缘** x 的区间）；没有则 null */
  leftGutter: [number, number] | null;
  rightGutter: [number, number] | null;
}

/** 距边留白：贴着容器边缘走会像"卡住了"。按机体算（余量已在 pad 里扣掉） */
const PAD = 8;
/** 探看 / 陪等时离面板边缘的空隙 */
const GAP = 6;
/** 机体视觉宽度的上下限（px）。数值与改造前完全一致 —— 旧版这两个常量
 *  56 / 128 是**旧画布**口径，机体在旧画布里占 236/260，折过来就是 51 / 116。
 *  机器人屏幕上多大没变，变的只是"画布口径"这个说法。 */
const MIN_BODY_W = 51;
const MAX_BODY_W = 116;
/** 机体视觉尺寸跟随内容区的比例，同样由旧值折算：
 *  0.085 × 236/260 = 0.0772，0.2 × 236/260 = 0.1815 */
const BODY_W_RATIO = 0.0772;
const BODY_H_RATIO = 0.1815;
/** 行走速度（宿主坐标 px / 秒）：要"散步"的慢，45 约是常速步行的六成
 *  （改造前是 78）。 */
const SPEED = 45;
/** 单次走动的**距离上限**（px）。这是本轮最关键的一个约束 ——
 *
 *  一开始我是限"时长"（封顶 9s）的，实测发现它会把"慢"整个吃掉：
 *  横穿面板的一次位移有 1083px，按 45px/s 本该走 24s，被 9s 上限一截，
 *  实际速度反而变成 160px/s —— 比改造前（78）还快一倍，正好和用户要的相反。
 *
 *  所以改成限**距离**：每步不超过 300px，45px/s 下最多约 6.7s，
 *  任何一步都不会触及时长上限，SPEED 因此是每一帧都成立的。
 *  "全屏走动"不靠单次长途，而靠许多次小步在长时间里自然铺开。
 */
const MAX_STEP_PX = 300;
/** 单次走动的最小距离。比它更近的落点看着像"在原地抖了一下"，
 *  不配叫一次走动。 */
const STEP_MIN_PX = 130;
/** 位移时长上下限。距离已被 MAX_STEP_PX 限住（300px ≈ 6.7s），
 *  这两个值只是兜底：防尺寸未量到时的 0 距离、也防极端斜向。 */
const WALK_MIN_MS = 1200;
const WALK_MAX_MS = 9000;
/** 位移缓动：两端带加减速，像走路不像弹射 */
const WALK_EASE = 'cubic-bezier(0.4, 0, 0.55, 1)';
/** 走完一段后**至少**站这么久（ms）。 */
const STAND_MIN_MS = 14000;
/** 站立时长 = 走动时长 × 这个系数，再与 STAND_MIN_MS 取大。
 *
 *  用"派生"而不是写死一个区间，是因为"大部分时间站着"这条要求
 *  应该由结构保证，而不是靠调参凑：系数 3.2 意味着**任何**一次走动的
 *  前后，站立时间都是它的 3.2 倍以上 —— 于是走动占比天然被压在
 *  1/(1+3.2) ≈ 24% 以内，与"走得多远"无关。
 *
 *  为什么从 2.6 提到 3.2（2026-11-08 实测）：2.6 的结构上限是 28%，
 *  但"横穿面板"那一趟是 3 段连续走动、中间只歇 1–3s（那 19s 里约九成
 *  还发生在面板背后、用户根本看不见），它会把实测占比顶到 37% ——
 *  离"大部分时间站着"只有 3 个百分点的余量。提到 3.2 后实测回落到 34% 以下，
 *  余量足够。 */
const STAND_FACTOR = 3.2;
/** 一趟"去对面"里，两步之间**站着看一会儿**的时间（ms）。
 *
 *  面板一侧宽 768px、单步上限 300px，所以跨过去要被拆成 3 步。
 *  这个停顿不能太短：早先给 150–420ms，三小步连起来等于一段 19s 的
 *  连续行走，用户看到的就是"它一直在走"；给到 1–3s 之后，
 *  一趟跨边读起来是"走几步 → 站一会儿 → 再走几步"。
 *  也不能太长：中途落脚点就在面板背后（被面板盖住），站太久等于消失了。 */
const TRAVEL_PAUSE_MIN_MS = 1000;
const TRAVEL_PAUSE_MAX_MS = 3000;
/** 两趟"去对面"之间的最小间隔（ms）。
 *
 *  一次完整横穿约 870px、按 45px/s 要走近 19s，而且全程都在**走动**状态；
 *  更要注意的是那 19s 里约九成时间它都在**面板背后**（被盖住，看不见）——
 *  这是"从对话下层走过"这个效果本身的代价（用户明确要的），
 *  但显然不该频繁发生。每 100s 才穿一趟，读起来才是"偶尔溜达到另一边"。
 *
 *  实测依据：冷却 50s 时走动帧占到 41%（一趟横穿就吃掉 60s 采样里的 20s），
 *  "大部分时间在空白处站着"直接不成立；放长之后回落到 15% 上下。 */
const CROSS_COOLDOWN_MS = 100000;
/** 页面打开后，**第一次**横穿的等待时间（ms）。
 *
 *  不能直接套 CROSS_COOLDOWN_MS：那样要等 100s 它才第一次穿过面板，
 *  很多用户根本撑不到那一刻，"从对话下层慢慢走过"这个效果就永远看不到。
 *  也不能太早：刚进页面它就一头钻进面板背后，用户连它长什么样都没看清。
 *  35s 是个折中 —— 足够看清它在旁边站着、歪头、小逛，
 *  然后来一趟横穿作为"彩蛋"。之后的每一趟才按 CROSS_COOLDOWN_MS 稀疏排布。 */
const FIRST_CROSS_DELAY_MS = 35000;

export default function RoamingBot({
  panelRef,
  composerRef,
  peeking,
  busy,
  className = '',
}: RoamingBotProps) {
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [spot, setSpot] = useState<Spot>({ x: -999, y: -999 });
  const [ready, setReady] = useState(false);
  /** 正在位移 → 摆腿摆臂；站着时腿不能空转 */
  const [walking, setWalking] = useState(false);
  /** 本次位移的时长（ms）：按距离算，缓动与计时都跟着它走 */
  const [walkMs, setWalkMs] = useState(WALK_MAX_MS);
  /** 行进朝向：位置左移就朝左、右移就朝右。用 state 而不是 ref ——
      它要参与渲染（决定是否水平翻转），是渲染输入，不是渲染无关值。 */
  const [heading, setHeading] = useState<1 | -1>(1);
  /** 用户关掉了动效偏好（关掉就不自动游走） */
  const reducedRef = useRef(false);
  /** 正在"去对面"的半途：记住目标在哪一侧。面板一侧宽几百像素、单步又被
   *  MAX_STEP_PX 限住，所以跨过去要分几步；这个 ref 就是那件事的进度。 */
  const travelRef = useRef<{ left: boolean } | null>(null);
  /** 上一次发起横穿的时刻。用来给横穿上冷却（见 CROSS_COOLDOWN_MS）——
   *  它是最重的一件事，不能用"每步都掷骰子"的方式决定要不要做。
   *  初值 null 表示"还没开始算"：首次进入游走循环时（见 pickSpot 的冷却判断）
   *  会把它设成 `now - COOLDOWN + FIRST_CROSS_DELAY`，
   *  于是第一次横穿发生在 FIRST_CROSS_DELAY_MS 之后，之后按 COOLDOWN 稀疏排布。
   *  不用 `Date.now()` 做 useRef 的初值：那是渲染期调用非纯函数
   *  （eslint 的 react-hooks/purity 会拦），而且并发渲染下可能被算两次。 */
  const lastCrossRef = useRef<number | null>(null);

  /* 读几何与状态一律走 ref：定时器/回调因此不必因它们变化而重建。
     注意：ref 必须在 effect / 回调里写，不能在 render 期间写
     （render 期间写 ref 是并发渲染下的未定义行为，eslint 的 react-hooks/refs 会拦）。 */
  const boundsRef = useRef<Bounds | null>(null);
  const spotRef = useRef<Spot>(spot);
  const stateRef = useRef({ peeking, busy });
  const walkTimer = useRef(0);
  const rafIds = useRef<number[]>([]);

  useEffect(() => {
    stateRef.current = { peeking, busy };
  }, [peeking, busy]);

  /* ── 量几何 ───────────────────────────────────────────────────────────
     面板的父元素（.page-body）就是"页面内容区"。四个方向的偏移都由实时 rect
     反推 —— 不写死像素，换屏宽 / 折叠侧栏 / 改内边距都自适应。 */
  const measure = useCallback((): Bounds | null => {
    const panel = panelRef.current;
    const holder = panel?.parentElement;
    if (!panel || !holder) return null;
    const pr = panel.getBoundingClientRect();
    const hr = holder.getBoundingClientRect();
    /* 布局未完成时量到 0 —— 先不量，等 ResizeObserver 再叫一次 */
    if (pr.width < 200 || pr.height < 160 || hr.width < 200) return null;

    const hostW = Math.round(hr.width);
    const hostH = Math.round(hr.height);
    const panelLeft = Math.max(0, Math.round(pr.left - hr.left));
    const panelTop = Math.max(0, Math.round(pr.top - hr.top));
    const panelW = Math.round(pr.width);
    const panelH = Math.round(pr.height);

    /* 机体视觉宽度：跟着内容区走，同时不能高到装不下。
       两条约束取小值，夹进 [MIN_BODY_W, MAX_BODY_W]，最后折成 svg 画布宽
       （画布比机体宽，外面那圈余量是留给旋转的）。 */
    const bodyW = Math.round(
      Math.min(MAX_BODY_W, Math.max(MIN_BODY_W, Math.min(hostW * BODY_W_RATIO, hostH * BODY_H_RATIO))),
    );
    const w = Math.round(bodyW * BOT_CANVAS_RATIO);
    const h = Math.round(w * BOT_ASPECT);
    /* svg 四周的透明余量折算成 px：所有"贴边/落空地"的判断都要把它扣掉，
       否则机器人看上去永远离容器边缘差这么一截。 */
    const padX = Math.round(w * BOT_PAD_LEFT_RATIO);
    const padTop = Math.round(h * BOT_PAD_TOP_RATIO);
    const padBottom = Math.round(h * BOT_PAD_BOTTOM_RATIO);
    const bodyH = h - padTop - padBottom;
    /* 探看时朝面板那一侧会多探出的距离（前倾 5° + 头偏 3° 甩出来的），
       算"站在面板外侧"时要额外留出这份，否则机体会压到输入框上。 */
    const leanExt = Math.round(w * BOT_LEAN_EXT_RATIO);

    /* 面板两侧的空地：**机体左边缘**可以取的 x 区间（机体坐标） */
    const gutter = (from: number, to: number): [number, number] | null =>
      to - from >= bodyW ? [from, to - bodyW] : null;

    return {
      w,
      h,
      bodyW,
      bodyH,
      padX,
      padTop,
      padBottom,
      leanExt,
      hostW,
      hostH,
      panelLeft,
      panelTop,
      panelW,
      panelH,
      leftGutter: gutter(PAD, panelLeft - GAP),
      rightGutter: gutter(panelLeft + panelW + GAP, hostW - PAD),
    };
  }, [panelRef]);

  /** 机体坐标 → 画布坐标（translate3d 吃的那套）。
   *  之所以到处都要转一手：判定"贴边""落在空地"用的是机体坐标（用户眼里
   *  机器人占的地方），而位移用的画布坐标外框比机体大一圈。 */
  const toSpot = useCallback((bodyX: number, bodyY: number): Spot => {
    const b = boundsRef.current;
    return { x: bodyX - (b?.padX ?? 0), y: bodyY - (b?.padTop ?? 0) };
  }, []);

  /** 直接落位（不做过渡），用于首帧。入参是**机体坐标**。
   *  withHeading=true 时顺带更新朝向 —— 朝向由"上一次落点 → 这次落点"的
   *  横向位移推出（往右走就朝右）。放在这里算而不是放进 effect：它是渲染输入，
   *  在 effect 里 setState 会造成级联渲染，而且在落位那一刻就有答案。 */
  const commitSpot = useCallback(
    (bodyX: number, bodyY: number, withHeading = false) => {
      const next = toSpot(bodyX, bodyY);
      const cur = spotRef.current;
      if (withHeading && Math.abs(next.x - cur.x) > 1) {
        setHeading(next.x > cur.x ? 1 : -1);
      }
      spotRef.current = next;
      setSpot(next);
    },
    [toSpot],
  );

  /**
   * 走到某处。**全程连续位移，不再有淡出/瞬移**。
   * 入参是**机体坐标**（"贴边/落空地"的判断都在这套坐标里做），
   * 进来先折算成画布坐标再交给 translate3d。
   * 时长按距离算：近的走 1.5s，远的封顶 9s（45px/s 的散步速度）。
   *
   * **返回本次位移的毫秒数** —— 调用方要靠它把"下一次走动"排在本次走完之后
   * （见游走循环里的注释：间隔必须从**落脚**算起，从起步算会把站立时间吃掉）。
   */
  const moveTo = useCallback(
    (body: { x: number; y: number } | null): number => {
      if (!body) return 0;
      const cur = spotRef.current;

      window.clearTimeout(walkTimer.current);

      /* 首帧还没就位时直接落过去，别从坐标原点飞出来 */
      if (cur.x < -900) {
        commitSpot(body.x, body.y);
        return 0;
      }

      const next = toSpot(body.x, body.y);
      const dist = Math.hypot(next.x - cur.x, next.y - cur.y);
      const ms = Math.round(
        Math.min(WALK_MAX_MS, Math.max(WALK_MIN_MS, (dist / SPEED) * 1000)),
      );

      setWalkMs(ms);
      commitSpot(body.x, body.y, true);
      setWalking(true);
      /* 比过渡略早收腿：落地那瞬腿还在摆会显得"刹不住"。 */
      walkTimer.current = window.setTimeout(() => setWalking(false), Math.max(200, ms - 260));
      return ms;
    },
    [commitSpot, toSpot],
  );

  /**
   * 挑下一个落点（返回**机体坐标** + 这一趟是不是"正在赶路"）。
   *
   * 两种事：**就地小逛** 和 **去对面**。后者必须是个**持续意图** ——
   * 面板一侧宽几百像素，而单步被 MAX_STEP_PX 限住，一步根本走不到对面。
   * 早先我把它写成"单步朝对面迈"，结果每步都被"别停在面板背后"的规则
   * 拉回原空地，永世走不过去（实测 48s 里 0 帧在面板背后）。
   * 所以现在用 travelRef 记住目标侧，一步步推进，直到本步能直接落到对面为止。
   *
   * 两条硬约束贯穿所有分支（这是整套节奏能成立的前提）：
   *   · 目标点必须在当前位置 MAX_STEP_PX 之内 —— 距离被限住，时长才不必被
   *     截断，SPEED 才是每一帧都成立（缘由见 SPEED 上方注释）；
   *   · 纵向按剩余预算夹住 —— 否则"横向够近 + 纵向很远"合起来又超了预算。
   */
  const pickSpot = useCallback((): { x: number; y: number; travel: boolean } | null => {
    const b = boundsRef.current;
    if (!b) return null;

    const curX = spotRef.current.x + b.padX;   /* 当前位置（机体坐标） */
    const curY = spotRef.current.y + b.padTop;
    const yMin = PAD;
    const yMax = Math.max(PAD, b.hostH - b.bodyH - PAD);

    /* 两块空地（**机体左边缘**可取的 x 区间）。面板两侧都放不下时给空数组。 */
    const gutters: Array<{ band: [number, number]; left: boolean }> = [];
    const leftHi = b.panelLeft - GAP - b.bodyW;
    if (leftHi - PAD > 4) gutters.push({ band: [PAD, leftHi], left: true });
    const rightLo = b.panelLeft + b.panelW + GAP;
    const rightHi = b.hostW - PAD - b.bodyW;
    if (rightHi - rightLo > 4) gutters.push({ band: [rightLo, rightHi], left: false });

    /* 纵向：按剩余横向位移把预算给出去，保证斜着走的总距离也不超预算。
       楼下的随机要**带一点纵向意图**：完全均匀取的话，横向走满 130px 时
       纵向预算只剩 sqrt(300²-130²)=270px，而 rand 的期望本就偏向 0 附近，
       实测纵向活动范围只有 44px —— 看着像"沿着一条水平线平移"。
       这里给一个随机方向偏好，让它在预算内尽量往某一边多走一点。 */
    const withY = (x: number) => {
      const dx = Math.abs(x - curX);
      const yBudget = Math.sqrt(Math.max(0, MAX_STEP_PX ** 2 - dx ** 2));
      const lo = Math.max(yMin, curY - yBudget);
      const hi = Math.min(yMax, curY + yBudget);
      if (hi <= lo) return Math.max(yMin, Math.min(yMax, curY));
      /* 60% 的几率往预算的某一端靠（上或下随机），其余均匀取 ——
         既保证纵向真的会挪动，又不至于每次都贴到边界上。 */
      const bias = Math.random();
      if (bias < 0.6) {
        const dir = Math.random() < 0.5 ? 0 : 1;
        const edge = dir === 0 ? lo : hi;
        const jitter = (hi - lo) * 0.25;
        return Math.max(lo, Math.min(hi, edge + (Math.random() * 2 - 1) * jitter));
      }
      return lo + Math.random() * (hi - lo);
    };
    const clampX = (x: number) => Math.max(curX - MAX_STEP_PX, Math.min(curX + MAX_STEP_PX, x));

    /* 面板两侧都放不下机器人（窄屏）：退回整个内容区里随机取点 */
    if (!gutters.length) {
      const spanY = Math.max(0, b.hostH - b.bodyH - PAD * 2);
      return {
        x: clampX(PAD + Math.random() * Math.max(0, b.hostW - PAD * 2 - b.bodyW)),
        y: PAD + Math.random() * spanY,
        travel: false,
      };
    }

    const inGutter = gutters.find((g) => curX >= g.band[0] && curX <= g.band[1]);

    /* 朝"离当前位置最近的那块空地"走一步的收尾逻辑（回空地 / 继续前进共用）。
       抽出来是因为下面好几个分支都要它，而且都要处理"本步能否直接到达"。 */
    const headTo = (target: { band: [number, number]; left: boolean }, onArrive: () => void) => {
      const [tlo, thi] = target.band;
      const center = (tlo + thi) / 2;
      if (Math.abs(center - curX) <= MAX_STEP_PX) {
        onArrive();
        const inset = (thi - tlo) * 0.2;
        const x = tlo + inset + Math.random() * Math.max(0, (thi - tlo) - inset * 2);
        return { x: clampX(x), y: withY(x), travel: false };
      }
      const x = clampX(center);
      return { x, y: withY(x), travel: true };
    };
    const nearestGutterTo = () => gutters.reduce(
      (a, g) => {
        const ac = (a.band[0] + a.band[1]) / 2;
        const gc = (g.band[0] + g.band[1]) / 2;
        return Math.abs(gc - curX) < Math.abs(ac - curX) ? g : a;
      },
      gutters[0],
    );

    /* ── 情形 A：正在赶路（上一趟没走完）→ 继续朝目标侧推进 ──────────────
       必须放在最前面：赶路的每一步都不能被冷却或"就地小逛"打断，
       否则会出现"走到一半又折回去"的鬼畜走位。 */
    const traveling = travelRef.current;
    if (traveling) {
      const g = gutters.find((x) => x.left === traveling.left) ?? gutters[0];
      return headTo(g, () => { travelRef.current = null; });
    }

    /* ── 情形 B：就地小逛 —— 在当前这块空地里挪一段（**常态**）────────────
       "去对面"是最重的一件事（近 20s），所以有冷却：冷却期内所有落点都是
       就地小逛。这就是"大部分时间在空白处站着、偶尔走动"的实现方式。 */
    const now = Date.now();
    /* 冷却的计时起点首次延迟：`lastCrossRef` 初值是 null（渲染期不能取时间），
       第一次走到这里才把它锚定成"FIRST_CROSS_DELAY_MS 之后才能横穿"。
       之后每次横穿会用真实时刻覆盖它，走的是正常冷却。 */
    if (lastCrossRef.current === null) {
      lastCrossRef.current = now - CROSS_COOLDOWN_MS + FIRST_CROSS_DELAY_MS;
    }
    const cooling = now - lastCrossRef.current < CROSS_COOLDOWN_MS;
    if (inGutter && cooling) {
      const [lo, hi] = inGutter.band;
      /* 有时候只走纵向、横向几乎不动（用一个小横向位移骗过距离下限）。
         只在横向挪的话，它会沿着同一条水平线来回平移，像上了轨道；
         掺进纵向移动才有"在空地上踱步"的感觉。 */
      const verticalOnly = Math.random() < 0.35;
      const dir = Math.random() < 0.5 ? -1 : 1;
      const span = verticalOnly ? STEP_MIN_PX * 0.5 : Math.max(0, MAX_STEP_PX - STEP_MIN_PX);
      const raw = curX + dir * (verticalOnly ? 0 : STEP_MIN_PX) + dir * Math.random() * span;
      let x = Math.max(lo, Math.min(hi, raw));
      /* 夹回来后若还离得太近（这边地方窄），就走到底 —— 取更远的那一端 */
      if (!verticalOnly && Math.abs(x - curX) < STEP_MIN_PX * 0.6) {
        x = (curX - lo) > (hi - curX) ? lo : hi;
      }
      return { x: clampX(x), y: withY(x), travel: false };
    }

    /* 以下都是"要去别处"。先决定目标在哪一块空地：
       在空地上 → 去**对面**那块（换来换去才不会老在同一侧）；
       在面板背后（不在任何空地上）→ 去**最近**那块（保证走回看得见的地方）。 */
    let target: { band: [number, number]; left: boolean };
    if (inGutter) {
      const others = gutters.filter((g) => g.left !== inGutter.left);
      target = others[Math.floor(Math.random() * others.length)] ?? inGutter;
      /* 只有在"从空地出发去对面"这种真正的横穿开始时才记冷却；
         从面板背后回到空地属于收尾，不该消耗下一次横穿的额度。 */
      lastCrossRef.current = now;
    } else {
      target = nearestGutterTo();
    }
    travelRef.current = { left: target.left };
    return headTo(target, () => { travelRef.current = null; });
  }, []);

  /** 面板旁的空地：优先用离当前位置近的那一侧（避免为了探个身横穿整页）。
   *  返回的是**机体坐标**区间。 */
  const nearestGutter = useCallback((): { band: [number, number]; left: boolean } | null => {
    const b = boundsRef.current;
    if (!b) return null;
    if (!b.leftGutter && !b.rightGutter) return null;
    if (!b.leftGutter) return { band: b.rightGutter!, left: false };
    if (!b.rightGutter) return { band: b.leftGutter, left: true };
    /* 用机体中心与面板中线的距离判断：近哪边去哪边 */
    const curCenter = spotRef.current.x + b.padX + b.bodyW / 2;
    const panelCenter = b.panelLeft + b.panelW / 2;
    return curCenter <= panelCenter
      ? { band: b.leftGutter, left: true }
      : { band: b.rightGutter, left: false };
  }, []);

  /** 陪等落点（机体坐标）：面板侧边靠下（"陪着你"的站位），
   *  落在面板背后用户就看不见了。 */
  const perchSpot = useCallback((): Spot | null => {
    const b = boundsRef.current;
    const g = nearestGutter();
    if (!b || !g) return pickSpot();
    return {
      x: g.left ? g.band[1] : g.band[0],
      y: Math.max(PAD, Math.min(b.hostH - b.bodyH - PAD, b.panelTop + b.panelH - b.bodyH - 40)),
    };
  }, [nearestGutter, pickSpot]);

  /**
   * 探看落点（机体坐标）：站在面板边缘、**纵向对准输入框那一行**，侧身往里看。
   * 必须落在面板外侧 —— 落在面板背后会被输入框卡片盖住，就看不到"它在看你打字"了。
   *
   * 留白 = GAP + leanExt：GAP 是"别贴着面板"的常规留白，leanExt 是探看姿
   * 前倾 5° + 头偏 3° 甩出来的额外量。少留 leanExt 的话，机体静止时看着在
   * 面板外、一进入探看姿就把外沿探到输入框上（实测重叠 4px）。 */
  const peekSpot = useCallback((): Spot | null => {
    const b = boundsRef.current;
    const composer = composerRef.current;
    const panel = panelRef.current;
    const g = nearestGutter();
    if (!b || !composer || !panel || !g) return perchSpot();
    const cr = composer.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    /* 纵向对齐输入框中心：视觉上就是"贴着那一行在看你打字" */
    const targetY = cr.top + cr.height / 2 - pr.top - b.bodyH / 2;
    const gap = GAP + b.leanExt;
    return {
      /* 机体内侧边缘与面板边缘隔开 gap：静止在面板外，前倾后也仍在面板外 */
      x: g.left ? b.panelLeft - b.bodyW - gap : b.panelLeft + b.panelW + gap,
      y: Math.max(PAD, Math.min(b.hostH - b.bodyH - PAD, targetY)),
    };
  }, [composerRef, panelRef, nearestGutter, perchSpot]);

  /* 动效偏好：关掉游走。matchMedia 监听，用户在系统里改设置能实时生效 */
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      reducedRef.current = mq.matches;
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  /* 测量 + 监听尺寸变化：侧栏展开/折叠、窗口缩放都会改变画布尺寸 */
  useEffect(() => {
    const apply = () => {
      const next = measure();
      boundsRef.current = next;
      setBounds((prev) => {
        if (!next) return next;
        if (!prev) return next;
        /* 只在几何真的变了才 setState：ResizeObserver 可能连续触发，
           每次 setState 都会重跑游走 effect，白白打断机器人的节奏 */
        const same =
          prev.w === next.w &&
          prev.h === next.h &&
          prev.hostW === next.hostW &&
          prev.hostH === next.hostH &&
          prev.panelLeft === next.panelLeft &&
          prev.panelW === next.panelW;
        return same ? prev : next;
      });
    };
    apply();
    /* 首帧布局还没落定（量到的高常是 0），等 240ms 再正式就位。
       首次落点放面板侧边靠下：那是"开始陪你"的位置，比画面正中更自然。 */
    const t = window.setTimeout(() => {
      apply();
      const b = boundsRef.current;
      if (b) {
        const g = b.rightGutter ?? b.leftGutter;
        const left = !b.rightGutter && Boolean(b.leftGutter);
        commitSpot(
          g ? (left ? g[1] : g[0]) : PAD + 12,
          Math.max(PAD, b.hostH - b.bodyH - PAD - 24),
        );
      }
      /* 双 rAF 后再开过渡：让"首次落位"这一帧先被画出来，
         否则它会从坐标原点飞进画面 */
      const a = requestAnimationFrame(() => {
        const c = requestAnimationFrame(() => setReady(true));
        rafIds.current.push(c);
      });
      rafIds.current.push(a);
    }, 240);

    window.addEventListener('resize', apply);
    let ro: ResizeObserver | undefined;
    const panel = panelRef.current;
    const holder = panel?.parentElement;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(apply);
      if (panel) ro.observe(panel);
      if (holder) ro.observe(holder);
    }
    const rafs = rafIds.current;
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', apply);
      ro?.disconnect();
      for (const id of rafs) cancelAnimationFrame(id);
    };
  }, [measure, panelRef, commitSpot]);

  /* 卸载清理：把所有计时器/帧回调收干净，避免在已卸载组件上 setState */
  useEffect(
    () => () => {
      window.clearTimeout(walkTimer.current);
      for (const id of rafIds.current) cancelAnimationFrame(id);
    },
    [],
  );

  /* 状态驱动的位置：输入 → 贴面板探身看；回复中 → 面板边陪着等；其余 → 全屏游走。
     所有落位都走 setTimeout 派发（而不是在 effect 体里直接 moveTo）：
       · 状态切换本身已经触发一次渲染，再在 body 里同步 setState 会造成级联渲染；
       · 0ms 定时器把"决定去哪"和"开始走"拆成两拍，也让首帧的布局量取更稳。 */
  useEffect(() => {
    if (!ready) return;

    let timer = 0;
    /* 延后一拍再落位 —— 见上方注释。注意这里**不加 peeking/busy 守卫**：
       这个分支本身就是由它们进来的，加守卫会把"探身"自己挡掉。 */
    const dispatch = (fn: () => Spot | null) => {
      timer = window.setTimeout(() => moveTo(fn()), 0);
    };

    if (peeking) {
      dispatch(peekSpot);
      return () => window.clearTimeout(timer);
    }
    if (busy || reducedRef.current) {
      dispatch(perchSpot);
      return () => window.clearTimeout(timer);
    }

    /* 常态游走：先立刻走一步（别原地等第一个定时器），再进入随机节奏。
       用 setTimeout 递归而非 setInterval —— 每次间隔都重新随机，
       看起来才像"自己走走停停"，而不是节拍器。

       三条计时规则都是实测出来的：

       1. **间隔从"落脚"算起**，不是从"起步"算起：moveTo 返回本次位移时长，
          下一次走动排在 (走动时长 + 站立时长) 之后。若从起步就计时，
          站立时间会被走路时间吃掉，走得越久站得越短 —— 与要求正好相反
          （实测走动帧占比一度到 48%）。
       2. **站立时长是派生的**（走动时长 × STAND_FACTOR，与下限取大），
          于是"大部分时间站着"由结构保证，不靠调参（见 STAND_FACTOR 注释）。
       3. **赶路时只歇一小会儿**：走去对面的途中在面板背后落脚，
          那地方被面板盖着，站太久等于消失；这一档用 TRAVEL_PAUSE_*。 */
    const step = () => {
      if (stateRef.current.peeking || stateRef.current.busy) return;
      const spot = pickSpot();
      const walkedMs = moveTo(spot);
      const crossing = Boolean(spot?.travel) && travelRef.current !== null;
      const standMs = crossing
        ? TRAVEL_PAUSE_MIN_MS + Math.random() * (TRAVEL_PAUSE_MAX_MS - TRAVEL_PAUSE_MIN_MS)
        : Math.max(STAND_MIN_MS, walkedMs * STAND_FACTOR) * (0.85 + Math.random() * 0.35);
      timer = window.setTimeout(step, walkedMs + standMs);
    };
    timer = window.setTimeout(step, 0);
    return () => window.clearTimeout(timer);
  }, [ready, peeking, busy, moveTo, pickSpot, peekSpot, perchSpot]);

  /* 探看时永远面向面板中心（朝里看）；游走时用行进朝向。
     比中点用的是**机体**中心：画布左右各留了一圈透明余量，拿画布中心去比
     会让朝向在临界点上偏一点点。 */
  const boundsOk = Boolean(ready && bounds);
  const facing: 1 | -1 =
    peeking && bounds
      ? spot.x + bounds.padX + bounds.bodyW / 2 < bounds.panelLeft + bounds.panelW / 2
        ? 1
        : -1
      : heading;

  const pose: BotPose = peeking ? 'peek' : 'idle';

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute ${className}`}
      style={{
        /* 宿主覆盖整个页面内容区：由面板的实时 rect 向四个方向反推负偏移 */
        left: -(bounds?.panelLeft ?? 0),
        right: -(bounds ? bounds.hostW - bounds.panelLeft - bounds.panelW : 0),
        top: -(bounds?.panelTop ?? 0),
        bottom: -(bounds ? bounds.hostH - bounds.panelTop - bounds.panelH : 0),
        /* 图层在对话之下：卡片/气泡/输入框都会自然盖住它 */
        zIndex: -1,
        opacity: boundsOk ? 1 : 0,
        transition: 'opacity 400ms ease',
      }}
    >
      <div
        className="absolute left-0 top-0 will-change-transform"
        style={{
          transform: `translate3d(${spot.x}px, ${spot.y}px, 0)`,
          transitionProperty: 'transform',
          transitionDuration: ready ? `${walkMs}ms` : '0ms',
          transitionTimingFunction: WALK_EASE,
        }}
      >
        {/* 摆动放在内层：外层的 transform 是定位用的，不能被 keyframes 覆盖
            （同一元素上 CSS 动画的 transform 会整体盖掉内联 transform） */}
        <div className={busy && !peeking ? 'bot-perch' : ''}>
          <AiCompanionBot
            size={bounds?.w ?? Math.round(MAX_BODY_W * BOT_CANVAS_RATIO)}
            pose={pose}
            walking={walking}
            facing={facing}
          />
        </div>
      </div>
    </div>
  );
}
