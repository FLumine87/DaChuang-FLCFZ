import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  Check,
  ImagePlus,
  Info,
  Loader2,
  Mic,
  Network,
  SquarePen,
  X,
} from "lucide-react";
import { saveScreeningRetrieval, saveScreeningSupplement, uploadFile } from "../../services/mockApi";
import { getDraft, saveDraft, type SupplementKind } from "../../services/firstRun";
import { loadFirstRunEvidence, toRetrievalSnapshot } from "../../services/firstRunRetrieval";
import { getCurrentSession } from "../../auth/session";
import FirstRunShell from "./FirstRunShell";
import { firstRunSteps } from "./firstRunSteps";

/**
 * FirstRunSupplement.tsx · 首次引导 02 补充记录（可选）
 *
 * 按 02-optional-input.svg 实现。这一步的定位是"多模态是项目特色，但由用户决定分享多少"：
 *   · 三种方式任选其一，也可以直接跳过；
 *   · 不补充也能看结果（两个按钮一个是"提交补充并查看结果"、一个是"跳过补充，查看量表结果"）；
 *   · 提交前先预览：文字给摘要、图片给缩略图、语音给文件名，都可以撤掉重来。
 *
 * 语音这一版先做**选择音频文件**（复用 uploadFile），没有做麦克风实时录制：
 * 引导流程里少一次权限弹窗，实现也轻；实时录制仍在「多模态采集」页里。
 */
export default function FirstRunSupplement() {
  const navigate = useNavigate();
  const draft = getDraft();
  const [kind, setKind] = useState<SupplementKind>("text");
  const [text, setText] = useState(draft?.supplement?.text ?? "");
  const [file, setFile] = useState<{ name: string; url: string; description?: string } | null>(
    draft?.supplement?.url
      ? {
          name: draft.supplement.filename ?? "已选择的文件",
          url: draft.supplement.url,
          description: draft.supplement.description,
        }
      : null,
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  /* 没有 01 的作答结果就别停在这一页（直接刷新/手输地址进来的情况） */
  if (!draft?.recordId) {
    return (
      <FirstRunShell
        step={3}
        eyebrow="02  ·  补充记录（可选）"
        title={<>还没完成量表。</>}
        body={<>先做完 01 的逐题作答，再回来补充记录。</>}
      >
        <div className="ui-card p-6">
          <p className="text-sm text-slate-500">
            这一步需要上一份量表的结果，当前会话里没有找到。
          </p>
          <Link
            to="/personal/first/questionnaire"
            className="ui-button ui-button-primary mt-4"
          >
            回到答题
          </Link>
        </div>
      </FirstRunShell>
    );
  }

  const pickFile = async (picked: File | undefined) => {
    if (!picked) return;
    setError("");
    setUploading(true);
    try {
      const result = await uploadFile(picked);
      /* analysis 一起存下来：首页「最近一次输入」与检索历史都展示这段描述，
         而不是只给一个文件名（用户 2026-10-14 明确要求两处一致） */
      setFile({ name: result.filename, url: result.url, description: result.analysis });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传失败，请重试");
    } finally {
      setUploading(false);
    }
  };

  const goResult = (withSupplement: boolean) => {
    const supplement = withSupplement
      ? kind === "text"
        ? text.trim()
          ? { kind, text: text.trim() }
          : undefined
        : file
          ? { kind, filename: file.name, url: file.url, description: file.description }
          : undefined
      : undefined;
    /* 先写进草稿（03 结果页要读），再**当场落库**到本次筛查记录上——
       否则离开引导流程后这段内容就没了，档案里也查不到。 */
    saveDraft({ supplement });
    const recordId = draft?.recordId;
    if (supplement && recordId) {
      void saveScreeningSupplement(recordId, supplement);
    }
    /* 本次「检索与解释」的快照也存进这条记录（L1：只存在浏览器本地）。
       03 结果页会自己再取一遍用于展示，这里只负责"记录里留得住"：
       拿不到就存 mode:'unavailable' 与原样原因，绝不编造。 */
    if (recordId) {
      const userId = getCurrentSession()?.username ?? "demo_user";
      void loadFirstRunEvidence(userId, supplement?.text)
        .then((evidence) => saveScreeningRetrieval(recordId, toRetrievalSnapshot(evidence)))
        .catch(() =>
          saveScreeningRetrieval(recordId, {
            at: new Date().toISOString(),
            mode: "unavailable",
            reason: "检索服务暂不可用",
          }),
        );
    }
    navigate("/personal/first/result", { replace: true });
  };

  return (
    <FirstRunShell
      step={3}
      eyebrow="02  ·  补充记录（可选）"
      title={
        <>
          多一条线索，
          <br />
          由你决定分享多少。
        </>
      }
      body={
        <>
          可以补充近期感受，也可以直接查看量表结果。
        </>
      }
      steps={firstRunSteps(3)}
    >
      <div className="mx-auto w-full max-w-[560px] rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_24px_70px_-36px_rgba(16,24,40,0.35)] sm:p-7">
        <span className="inline-flex items-center gap-2 rounded-full bg-success-50 px-3 py-1.5 text-[13px] font-medium text-success-600">
          <Check className="h-3.5 w-3.5" />
          量表已完成
        </span>

        <h2 className="mt-4 text-xl font-semibold text-slate-900">想补充些什么？</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          选择一种方式即可，也可以稍后再做；不补充同样能查看量表结果。
        </p>

        {/* 三种方式：图标 + 名称，选中态与答题页选项同一套语言 */}
        <div className="mt-5 grid grid-cols-3 gap-3" role="tablist" aria-label="补充方式">
          {(
            [
              { id: "text", label: "文字记录", icon: SquarePen },
              { id: "audio", label: "语音片段", icon: Mic },
              { id: "image", label: "图片上传", icon: ImagePlus },
            ] as const
          ).map((item) => {
            const active = kind === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setKind(item.id)}
                className={`flex flex-col items-center gap-2 rounded-2xl border px-3 py-4 text-[13px] transition-all duration-200 ${
                  active
                    ? "border-primary-500 bg-primary-50/70 font-medium text-primary-700"
                    : "border-slate-200 bg-white text-slate-600 hover:border-primary-200 hover:bg-primary-50/40"
                }`}
              >
                <item.icon className="h-5 w-5" strokeWidth={1.7} />
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="mt-5">
          {kind === "text" ? (
            <>
              <label
                htmlFor="supplement-text"
                className="text-sm font-medium text-slate-700"
              >
                最近有什么让你在意的事？
              </label>
              <textarea
                id="supplement-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={4}
                maxLength={500}
                placeholder="可以写几句，也可以留空……"
                className="mt-2.5 w-full resize-none rounded-2xl border border-slate-300 bg-white p-3.5 text-sm leading-6 text-slate-800"
              />
              <div className="mt-2 flex items-center justify-between text-[12px] text-slate-400">
                <span>可选内容；跳过后仍能查看量表结果。</span>
                <span className="tabular-nums">{text.length} / 500</span>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-slate-700">
                {kind === "audio" ? "选择一段音频文件" : "选择一张图片"}
              </p>
              <input
                ref={inputRef}
                type="file"
                accept={kind === "audio" ? "audio/*" : "image/*"}
                className="hidden"
                onChange={(event) => void pickFile(event.target.files?.[0])}
              />
              {file ? (
                <div className="mt-2.5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  {kind === "image" ? (
                    <img
                      src={file.url}
                      alt={file.name}
                      className="h-14 w-14 shrink-0 rounded-xl object-cover"
                    />
                  ) : (
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-white text-primary-500">
                      <Mic className="h-5 w-5" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-slate-700">
                      {file.name}
                    </p>
                    <p className="mt-1 text-[12px] text-slate-400">已就绪，提交后会一起保存。</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    aria-label="移除这个文件"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-white hover:text-slate-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => inputRef.current?.click()}
                  className="mt-2.5 flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-7 text-[13px] text-slate-500 transition-colors hover:border-primary-300 hover:text-primary-600 disabled:opacity-60"
                >
                  {uploading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <ImagePlus className="h-5 w-5" />
                  )}
                  {uploading ? "正在上传…" : "点击选择文件"}
                </button>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-danger-600">
              {error}
            </p>
          )}
        </div>


        {/* 技术说明区：紧贴输入区，让评委在填写/提交时就能看到两个创新名称，
            但默认不铺开解释——点 (i) 才展开一句话（图二方案第 2 条）。 */}
        <TechNote />

        <button
          type="button"
          onClick={() => goResult(true)}
          disabled={uploading}
          className="ui-button ui-button-primary mt-5 h-12 w-full rounded-xl disabled:cursor-not-allowed disabled:opacity-60"
        >
          提交补充并查看结果
          <ArrowRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => goResult(false)}
          className="mt-3 h-12 w-full rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-700 transition-colors hover:border-primary-200 hover:text-primary-600"
        >
          跳过补充，查看量表结果
        </button>
      </div>
    </FirstRunShell>
  );
}

/**
 * 「报告生成方式」技术说明条
 * —— 图二方案：两段技术介绍不再独立摆在左下角（那里是展示流程的位置），
 *    而是合成一条低调的说明，贴在输入区下方、提交按钮上方。
 *    宽度与输入框对齐、高度约 64~80px；技术名称直接可见，解释点 (i) 再展开。
 */
function TechNote() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/70 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[12px] font-medium text-slate-500">报告生成方式</span>
        <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-500">
          <Network className="h-3.5 w-3.5 text-primary-500" strokeWidth={1.7} />
          动态跨模态哈希检索
        </span>
        <ArrowRight className="h-3 w-3 text-slate-300" aria-hidden="true" />
        <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-500">
          <BookOpen className="h-3.5 w-3.5 text-primary-500" strokeWidth={1.7} />
          RAG 检索增强生成
        </span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={open ? "收起技术说明" : "展开技术说明"}
          className="grid h-5 w-5 place-items-center rounded-full text-slate-400 transition-colors hover:bg-white hover:text-primary-600"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && (
        <p className="mt-2 border-t border-slate-200 pt-2 text-[12px] leading-5 text-slate-500">
          通过动态跨模态哈希检索关联输入线索，并结合心理知识库，通过 RAG 组织报告中的解释与建议。
        </p>
      )}
    </div>
  );
}
