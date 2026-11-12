import { useEffect, useState, useSyncExternalStore } from 'react';
import bigfish from '../assets/bigfish-poses-short.png';
import bigfishWalk from '../assets/bigfish-walk-proportions.png';

export type BotPose = 'idle' | 'peek';

interface AiCompanionBotProps {
  size?: number;
  animated?: boolean;
  pose?: BotPose;
  walking?: boolean;
  walkFrameMs?: number;
  busy?: boolean;
  reaction?: 'drag' | 'drop';
  facing?: 1 | -1;
  className?: string;
}

// Preserve the source image's proportions and transparency, with room for motion.
// The visible bounds are centered so turning does not shift roaming placement.
const VB_W = 560;
const VB_H = 560;
const VB_X = 0;
const VB_Y = -24;
const BODY_X0 = 60;
const BODY_X1 = 500;
const BODY_Y0 = 10;
const BODY_Y1 = 470;

export const BOT_BODY_W = BODY_X1 - BODY_X0;
export const BOT_BODY_H = BODY_Y1 - BODY_Y0;
export const BOT_CANVAS_RATIO = VB_W / BOT_BODY_W;
export const BOT_PAD_LEFT_RATIO = (BODY_X0 - VB_X) / VB_W;
export const BOT_PAD_TOP_RATIO = (BODY_Y0 - VB_Y) / VB_H;
export const BOT_PAD_BOTTOM_RATIO = (VB_Y + VB_H - BODY_Y1) / VB_H;
export const BOT_LEAN_EXT_RATIO = 45 / VB_W;
export const BOT_ASPECT = VB_H / VB_W;

// Frames: neutral, blink, wave, listen, think, smile. Keep blinks brief and
// leave quiet pauses between gestures, rather than flickering through a GIF.
const SEQUENCES = {
  drag: [[5, 700], [2, 700], [5, 800]],
  drop: [[5, 1000], [2, 1000], [0, 1500]],
  idle: [[2, 1500], [0, 2800], [1, 140], [0, 3200], [3, 1800], [0, 2600], [5, 1600], [0, 3000], [4, 1800], [0, 2600], [1, 140], [0, 3000]],
  walk: [[0, 220], [1, 220], [2, 220], [3, 220]],
  peek: [[3, 2600], [0, 900], [1, 140], [3, 2400], [5, 1000]],
  busy: [[4, 2600], [0, 700], [1, 140], [4, 2200], [3, 1100]],
} as const;

const motionQuery = '(prefers-reduced-motion: reduce)';
function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
const readReducedMotion = () => window.matchMedia(motionQuery).matches;

export default function AiCompanionBot({
  size = 96,
  animated = true,
  pose = 'idle',
  walking = false,
  walkFrameMs = 220,
  busy = false,
  reaction,
  facing = 1,
  className = '',
}: AiCompanionBotProps) {
  const peeking = pose === 'peek';
  const reducedMotion = useSyncExternalStore(subscribeMotion, readReducedMotion, () => false);
  const walkingNow = walking && !reaction && animated && !reducedMotion;
  const mode = reaction ?? (walkingNow ? 'walk' : peeking ? 'peek' : busy ? 'busy' : 'idle');
  const [playback, setPlayback] = useState({ mode, index: 0 });
  const index = playback.mode === mode ? playback.index : 0;
  const sequence = SEQUENCES[mode];
  const frame = animated && !reducedMotion ? sequence[index % sequence.length][0] : 0;

  useEffect(() => {
    if (!animated || reducedMotion) return;
    const timer = window.setTimeout(() => {
      setPlayback({ mode, index: (index + 1) % sequence.length });
    }, mode === 'walk' ? walkFrameMs : sequence[index % sequence.length][1]);
    return () => window.clearTimeout(timer);
  }, [animated, reducedMotion, index, mode, sequence, walkFrameMs]);

  return (
    <svg
      width={size}
      height={Math.round(size * BOT_ASPECT)}
      viewBox={`${VB_X} ${VB_Y} ${VB_W} ${VB_H}`}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ transform: facing === -1 ? 'scaleX(-1)' : undefined }}
      role="img"
      aria-label={peeking ? 'AI 陪伴助手正在看你的输入' : 'AI 陪伴助手'}
      data-mode={mode}
      data-frame={frame}
    >
      <title>DeepSeek 大肥鱼</title>
      <g className={animated ? `bigfish-motion bigfish-${mode}` : undefined}>
        <g className="bigfish-lean" style={{ transform: peeking && !walkingNow ? 'rotate(4deg)' : undefined }}>
          <svg x={walkingNow ? 34 : 12} y={walkingNow ? 5 : 0} width={walkingNow ? 530 : 512} height={walkingNow ? 530 : 512} viewBox={`${(frame % (walkingNow ? 2 : 3)) * 512} ${Math.floor(frame / (walkingNow ? 2 : 3)) * 512} 512 512`} overflow="hidden">
            <image href={walkingNow ? bigfishWalk : bigfish} x="0" y="0" width={walkingNow ? 1024 : 1536} height="1024" />
          </svg>
        </g>
      </g>
    </svg>
  );
}
