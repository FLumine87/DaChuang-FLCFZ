import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Lock } from 'lucide-react';

/*
 * 隐私政策
 * ========
 * 需求：项目会收集用户信息，需要一个「隐私政策」说明；但不要做成弹窗，
 * 也不要打断原有流程 —— 所以入口放在侧栏页脚的小字链接里（角落位置），
 * 点开是一个普通整页，看完按浏览器返回即可。
 *
 * 内容原则：只写系统实际在做的事，不写承诺不到的能力。
 * 与实现对应关系：
 *   · 采集哪几类数据 → DataCollection（text/audio/image/scale 四种）
 *   · 谁能看见       → 个人端只见自己；管理端按角色可见，原文默认不进检索语料
 *   · 是否用于训练   → 当前不用于模型训练（设置页的同意项在开发中）
 *   · 删除           → 筛查记录页可逐条删除（记录与其便签一并删除）
 */

const sections: { title: string; body: string[] }[] = [
  {
    title: '一、我们收集哪些信息',
    body: [
      '账号信息：用户名、姓名、院系与年级、手机号或邮箱（仅在你填写时保存），用于登录与联系。',
      '筛查信息：你提交的量表答案、得分与系统给出的关注等级。',
      '记录内容：你主动写下的文字、录制的语音、上传的照片，以及为它们生成的分析结论。',
      '使用痕迹：记录产生的时间、来源类型（文字 / 语音 / 照片 / 量表），用于按时间回顾。',
      '以上内容都只在你点了「同意上传」之后才会保存。',
    ],
  },
  {
    title: '二、这些信息用来做什么',
    body: [
      '生成你的心理健康档案：按时间整理记录，给出关注程度与依据。',
      '比对相似样本：把你的记录与语料库中的样本做相似度比对，作为理解当前状态的参考。',
      '触发提醒：当记录中反复出现需要关注的信号时，生成提醒供你与咨询师一起回顾。',
      '以上结果都是筛查参考，不等同于诊断，也不替代专业评估。',
    ],
  },
  {
    title: '三、谁可以看到',
    body: [
      '你自己的记录只有你本人和值班咨询师可以查看。',
      '管理员看到的是汇总与必要的处置信息（如预警状态、复核意见），用于跟进而不是围观。',
      '你在语音、照片中主动提供的内容，与文字记录采用同样的可见范围。',
    ],
  },
  {
    title: '四、提交前的同意',
    body: [
      '每次提交量表、文字、语音或图片前，系统都会询问一次「是否同意上传本次内容」，只有你点同意才会保存；点不同意则本次内容不会上传。',
      '如果不想每次都被询问，可以在「账号设置 → 数据与隐私」开启「提交时不再询问」。开启后不再询问，同时也不会提交 —— 不询问不等于默认同意。',
    ],
  },
  {
    title: '五、关于模型训练',
    body: [
      '「账号设置 → 数据与隐私」里有「同意将我的筛查数据用于模型训练」开关，默认关闭。',
      '关闭时，你的筛查与记录不会进入模型训练集；开启后，还需要管理端审核通过，内容才可能被用作训练样本 —— 审核决定能不能用，同意决定能不能当训练样本。',
      '随时可以再次关闭；关闭后不影响你已经生成的档案与预警。',
    ],
  },
  {
    title: '六、你可以怎么做',
    body: [
      '在「账号设置」里修改姓名、院系与联系方式；在「筛查记录」里逐条删除某段记录（记录与便签会一并删除）。',
      '不填写手机号或邮箱不影响使用；语音与照片都是可选，只写文字同样可以完成记录。',
      '如果你不希望留下某段内容，删除后它不会继续出现在档案、时间线与检索结果中。',
      '训练数据同意与提交询问都可以在「账号设置 → 数据与隐私」里随时更改。',
    ],
  },
  {
    title: '七、我们不会做的事',
    body: [
      '不会把你的记录用于与心理健康服务无关的用途。',
      '不会把可识别到个人的记录公开发布或分享给第三方。',
      '不会把筛查结果当作诊断结论，也不会据此限制你使用系统的其他功能。',
    ],
  },
];

export default function PrivacyPolicy() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="ui-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-50 text-primary-600">
              <Lock className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">隐私政策</h1>
              <p className="mt-0.5 text-[12px] text-slate-400">
                关于我们收集什么、用来做什么、谁能看到
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-500 transition-colors hover:text-primary-600"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回上一页
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-[13.5px] font-semibold text-slate-800">{section.title}</h2>
              <ul className="mt-2 space-y-1.5">
                {section.body.map((line, i) => (
                  <li key={i} className="flex gap-2 text-[13px] leading-6 text-slate-600">
                    <span aria-hidden="true" className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <p className="text-[11.5px] leading-5 text-slate-400">
            本页说明会随功能变化更新，最后更新于 2026 年 11 月。若对数据处理有疑问，
            可在「账号设置」里查看当前保存的个人信息，或联系值班咨询师。
          </p>
        </div>
      </div>
    </div>
  );
}
