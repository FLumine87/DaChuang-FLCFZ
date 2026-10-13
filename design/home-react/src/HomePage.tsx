/* 个人首页（改版样张 j1）的 React 实现。
 *
 * 从 design/home-redesign/home-j1.html 逐节点搬过来，样式见 mockup.css，
 * 目的是先让评审在真实浏览器里看间距与层级。数据目前是写死的演示值，
 * 落地到 frontend/ 时需要接 getDashboardData()。 */

export default function HomePage() {
  return (
    <>
  <div className="hero3">
            <div>
              <p className="pagehead__eyebrow"><span className="pagehead__greet">下午好，xiaoyu</span><span className="pagehead__date"> · 3 月 20 日 星期五</span></p>
              <div className="hero3__row">
                <div className="hero3__text">
                  <h1 className="hero3__title">今天，想说说自己吗？</h1>
                  <p className="hero3__desc">不用想好怎么说，两三分钟记下来就行。</p>
                </div>
                <div className="hero3__actions">
                  <a className="btnstack btnstack--primary" href="personal-collect.html">
                    <span className="btnstack__t">记录一下现在</span>
                    <span className="btnstack__m">今天 08:20 记过一次</span>
                  </a>
                  <a className="btnstack btnstack--ghost" href="personal-screening.html">
                    <span className="btnstack__t">评估心理状态</span>
                    <span className="btnstack__m">距上次评估 16 天，可以做一次了</span>
                  </a>
                </div>
              </div>
            </div>
          </div>

        
          <section className="card alertblock" style={{ marginTop: "24px" }}>
            <div className="spread" style={{ alignItems: "flex-start", gap: "var(--sp-6)" }}>
              <div style={{ flex: "1", minWidth: "0" }}>
                <div className="inline" style={{ gap: "var(--sp-4)" }}>
                  <span className="pill pill--red"><span className="pill__dot"></span>红色预警</span>
                  <span className="dim" style={{ fontSize: "var(--fs-meta)" }}>触发于 2026-03-18 23:10 · 已同步给值班咨询师</span>
                </div>
                <p className="alertblock__title">连续负性情绪 + 睡眠下降</p>
                <p className="alertblock__desc">近 7 天情绪从 62 降到 45，睡眠从 6.8 小时降到 5.1 小时；命中历史「期中周压力—睡眠下降—情绪低落」模式。</p>
              </div>
              <div className="inline" style={{ gap: "var(--sp-4)", flex: "none" }}>
                <a className="btn btn--primary" href="personal-alerts.html">现在可以做什么</a>
                <button className="btn" type="button">标记已处理</button>
              </div>
            </div>
          </section>

        
          <div className="grid grid--sidebar" style={{ marginTop: "var(--sp-6)" }}>

            <section className="card">
              <div className="spread" style={{ alignItems: "baseline" }}>
                <div className="eyebrow">最近 30 天 · 已连续记录 12 天</div>
                <span className="pill pill--green"><span className="pill__dot"></span>平稳</span>
              </div>
              <p className="recent__conclusion">这周比上周平稳一些</p>

              <div className="mrows">
                <div className="mrow">
                  <span className="dim__name">情绪</span>
                  <svg className="dim__spark" viewBox="0 0 96 26" aria-hidden="true"><polyline fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" points="2,20 12,18 22,15 32,17 42,12 52,14 62,10 72,11 82,7 94,5"/></svg>
                  <span className="dim__val">波动</span>
                  <span className="dim__delta dim__delta--good">较上周 好转</span>
                </div>
                <div className="mrow">
                  <span className="dim__name">睡眠</span>
                  <svg className="dim__spark" viewBox="0 0 96 26" aria-hidden="true"><polyline fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" points="2,7 12,10 22,13 32,16 42,19 52,16 62,15 72,17 82,13 94,13"/></svg>
                  <span className="dim__val">6.1 小时</span>
                  <span className="dim__delta dim__delta--bad">较上周 ↓ 0.8 小时</span>
                </div>
                <div className="mrow">
                  <span className="dim__name">压力</span>
                  <svg className="dim__spark" viewBox="0 0 96 26" aria-hidden="true"><polyline fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" points="2,19 12,16 22,13 32,9 42,6 52,10 62,13 72,16 82,14 94,13"/></svg>
                  <span className="dim__val">偏高</span>
                  <span className="dim__delta dim__delta--bad">较上周 ↑ 3</span>
                </div>
              </div>

              <p className="recent__similar">
                这次的模式，和 <a href="personal-retrieval.html">3 月 12 日、2 月 28 日</a> 很像 —— 都是任务堆叠后睡眠先掉。
              </p>
            </section>

            <section className="card">
              <div className="spread" style={{ alignItems: "baseline" }}>
                <div className="eyebrow">最近记录</div>
                <a className="btn btn--ghost btn--sm" href="personal-profile.html">查看全部</a>
              </div>
              <ul className="reclist">
                <li><span className="mono dim">03-20</span><span className="reclist__mod">文本</span><span className="reclist__sum">“作业堆着做不完，晚上三点才睡。”</span><span className="pill pill--orange"><span className="pill__dot"></span>需关注</span></li>
                <li><span className="mono dim">03-18</span><span className="reclist__mod">语音</span><span className="reclist__sum">语速较基线下降 18%</span><span className="pill pill--orange"><span className="pill__dot"></span>需关注</span></li>
                <li><span className="mono dim">03-17</span><span className="reclist__mod">图像</span><span className="reclist__sum">用色偏暗、线条收紧</span><span className="pill pill--yellow"><span className="pill__dot"></span>留意</span></li>
                <li><span className="mono dim">03-15</span><span className="reclist__mod">文本</span><span className="reclist__sum">“今天还行，跟室友吃了饭。”</span><span className="pill pill--green"><span className="pill__dot"></span>平稳</span></li>
                <li><span className="mono dim">03-13</span><span className="reclist__mod">语音</span><span className="reclist__sum">语速与基线接近</span><span className="pill pill--green"><span className="pill__dot"></span>平稳</span></li>
              </ul>
            </section>

          </div>

        
          <section className="card" style={{ marginTop: "var(--sp-6)" }}>
            <div className="card__head card__head--tight">
              <div>
                <h2 className="card__title">今天可以做的</h2>
                <p className="card__desc">从一件小事开始，完成后点一下打勾</p>
              </div>
              <span className="pill pill--brand" data-plan-count>0 / 3</span>
            </div>
            <div className="homex-plan" data-plan>
              <button className="homex-plan__item" type="button" aria-pressed="false">
                <span className="homex-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
                <span className="homex-plan__text">
                  <span className="homex-plan__title">睡前写 3 条情绪日记</span>
                  <span className="homex-plan__meta">约 5 分钟 · 与近期睡眠困扰对应</span>
                </span>
              </button>
              <button className="homex-plan__item" type="button" aria-pressed="false">
                <span className="homex-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
                <span className="homex-plan__text">
                  <span className="homex-plan__title">给一位朋友发条消息</span>
                  <span className="homex-plan__meta">约 10 分钟 · 缓解社交回避倾向</span>
                </span>
              </button>
              <button className="homex-plan__item" type="button" aria-pressed="false">
                <span className="homex-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
                <span className="homex-plan__text">
                  <span className="homex-plan__title">完成一次 5-4-3-2-1 地面化练习</span>
                  <span className="homex-plan__meta">约 8 分钟 · 压力升高时使用</span>
                </span>
              </button>
            </div>
            <p className="homex-aux__note" style={{ marginTop: "var(--sp-5)" }}>
              这些建议来自 <a href="personal-rag.html">RAG 分析</a>，依据是相似历史模式里恢复得比较快的那几条路径。
            </p>
          </section>

        
          <div className="helpbar">
            <span className="helpbar__label">需要人聊聊？</span>
            <span>心理援助热线 <b className="mono">12356</b>（24 小时）</span>
            <span className="helpbar__sep">·</span>
            <a href="#">预约校心理中心</a>
            <span className="helpbar__sep">·</span>
            <span>紧急联系人 辅导员张老师 <b className="mono">138 **** 6621</b></span>
          </div>
    </>
  );
}
