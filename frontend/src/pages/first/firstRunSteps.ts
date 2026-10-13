/**
 * firstRunSteps.ts
 * 首次引导左侧那条步骤进度：**四步**（补充记录也是独立一步）。
 *
 * 为什么改成四步：02 补充记录已经是一个独立页面，如果左边还按三步画，
 * 就会出现"顶部写 2/3、左栏高亮第三步"这种两套编号打架的情况。
 * 现在顶部进度（首次筛查 · n/4）与左栏步骤用同一份定义生成。
 *
 * 单独一个文件而不是放在 FirstRunShell.tsx 里：Shell 是组件文件，
 * 同时导出常量会让 React Fast Refresh 失效（eslint react-refresh 规则会报错）。
 */

export interface FirstRunStep {
  label: string;
  /** 已完成 / 进行中 / 下一步 */
  state: "done" | "active" | "next";
  hint: string;
}

/* 注意：选择方向这一步发生在欢迎页，所以三步向导的编号是 2/4、3/4、4/4 */
const STEP_LABELS: { label: string; done: string; active: string; next: string }[] = [
  { label: "选择方向", done: "已完成", active: "进行中", next: "下一步" },
  { label: "回答问题", done: "已完成", active: "进行中", next: "下一步" },
  { label: "补充记录（可选）", done: "已完成", active: "进行中", next: "下一步" },
  { label: "查看结果", done: "已完成", active: "查看中", next: "下一步" },
];

export const FIRST_RUN_TOTAL_STEPS = STEP_LABELS.length;

/**
 * 当前处在第几步（1 选择方向 / 2 回答问题 / 3 补充记录 / 4 查看结果）时的步骤状态。
 * 之前的步骤一律"已完成"，当前步骤"进行中"，之后的"下一步"。
 */
export function firstRunSteps(current: 2 | 3 | 4): FirstRunStep[] {
  return STEP_LABELS.map((item, index) => {
    const position = (index + 1) as 1 | 2 | 3 | 4;
    const state: FirstRunStep["state"] =
      position < current ? "done" : position === current ? "active" : "next";
    return {
      label: item.label,
      state,
      hint: state === "done" ? item.done : state === "active" ? item.active : item.next,
    };
  });
}

/** 顶栏右侧的步骤文字：首次筛查 · n/4（欢迎页不传，显示「首次使用」） */
export function stepLabel(step?: 2 | 3 | 4): string {
  return step ? `首次筛查 · ${step}/${FIRST_RUN_TOTAL_STEPS}` : "首次使用";
}
