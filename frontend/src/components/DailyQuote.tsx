import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Clock, Quote, Sparkles, Wind } from 'lucide-react';
import { pickTodayQuote, smallThings } from '../data/encouragements';
import { getPersonalSupplements, type PersonalSupplement } from '../services/mockApi';

/*
 * 「今日一句」
 * ============
 * 用途：填「我的心理档案」左栏在**心理管家服务不可用**时留下的空白。
 * 右栏是固定 620px 的星图，左栏只剩一行"暂未连接"就会露出大片留白。
 *
 * 关键点：**不靠留白撑高度**。
 *   只放一句语录，卡片只有 60~80px，靠 flex-1 拉开就变成"一句话 + 一大片白"；
 *   所以这里用四块真实内容把高度顶起来：
 *     ① 引言（大字，主体）
 *     ② 今天可以做的一件小事
 *     ③ 三分钟呼吸（三步，任何人都能做）
 *     ④ 底部入口 + 免责说明
 *   内容本身有厚度，卡片自然接近右栏的 620px，不需要人为拉空。
 *
 * 内容原则：只放鼓励性、可被普通人验证的话，不做"你一定会好"这类保证；
 * 并明确写出"不构成治疗或专业建议"，避免被当成干预手段。
 */
const breatheSteps = [
  '吸气 4 秒：用鼻子慢慢吸，感觉腹部鼓起来。',
  '停 2 秒：不用憋气，只是让呼吸停一下。',
  '呼气 6 秒：用嘴慢慢呼出去，比吸气长一点。',
];

export default function DailyQuote() {
  const quote = pickTodayQuote();
  const now = new Date();
  const dayIndex = Math.floor(
    (now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000,
  );
  const thing = smallThings[dayIndex % smallThings.length];

  /* 「最近一次记录」：用本人的真实记录接住语录——让这块内容不只是通用鸡汤。
     取不到就静默隐藏这一块，不影响卡片其余部分。 */
  const [recent, setRecent] = useState<PersonalSupplement | null>(null);
  useEffect(() => {
    let alive = true;
    getPersonalSupplements()
      .then((list) => {
        if (alive) setRecent(list[0] ?? null);
      })
      .catch(() => {
        /* 拿不到就不显示，不打断页面 */
      });
    return () => {
      alive = false;
    };
  }, []);

  const recentText = recent
    ? (recent.text || recent.filename || recent.description || '').trim()
    : '';

  return (
    <section
      className="ui-card relative flex h-full flex-col overflow-hidden p-5"
      aria-label="今日一句"
    >

      <div className="relative flex h-full flex-col">
        <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">
          <Quote className="h-3.5 w-3.5 text-primary-400" />
          今日一句
        </p>
        <span className="text-[11px] tabular-nums text-slate-400">
          {now.getMonth() + 1} 月 {now.getDate()} 日
        </span>
      </div>

      {/* ① 引言 */}
      <blockquote className="mt-4">
        <p className="text-[16.5px] font-medium leading-8 text-slate-800">{quote.text}</p>
        <p className="mt-2 text-[12px] text-slate-400">
          —— {quote.author}
          {quote.from ? `《${quote.from.replace(/^《|》$/g, '')}》` : ''}
        </p>
      </blockquote>

      {/* ② 一件小事 */}
      <div className="mt-5 border-t border-slate-100 pt-4">
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600">
          <Sparkles className="h-3.5 w-3.5 text-warning-500" />
          今天可以做的一件小事
        </p>
        <p className="mt-1.5 text-[13px] leading-6 text-slate-600">{thing}</p>
      </div>

      {/* ③ 三分钟呼吸 */}
      <div className="mt-4 border-t border-slate-100 pt-4">
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600">
          <Wind className="h-3.5 w-3.5 text-primary-400" />
          觉得心里紧的时候：三分钟呼吸
        </p>
        <ol className="mt-1.5 space-y-1">
          {breatheSteps.map((step, index) => (
            <li key={index} className="flex gap-2 text-[12.5px] leading-6 text-slate-600">
              <span className="mt-0.5 shrink-0 text-[11px] font-medium tabular-nums text-slate-400">
                {index + 1}.
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* ④ 最近一次记录（真实数据，接住上面这几块通用内容） */}
      {recent && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600">
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            你最近的一次记录
          </p>
          <p className="mt-1.5 line-clamp-3 text-[12.5px] leading-6 text-slate-600">
            {recentText || '（这一段没有留下文字）'}
          </p>
          <p className="mt-1 text-[11px] tabular-nums text-slate-400">{recent.createdAt ?? ''}</p>
        </div>
      )}

      {/* ⑤ 底部入口 + 免责（左对齐，把右下角留给猫图，避免文字压在插画上） */}
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-5">
        <Link
          to="/personal/screening?tab=text"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-primary-600 hover:text-primary-700"
        >
          写下此刻的一句
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        <span className="text-[10.5px] text-slate-400">以上内容仅供参考，不构成治疗或专业建议</span>
      </div>
      </div>
    </section>
  );
}
