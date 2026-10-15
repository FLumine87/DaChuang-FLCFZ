import { useState } from 'react';
import { Search, Sparkles, Loader2, Camera } from 'lucide-react';
import { adminSearch } from '../../services/mockApi';
import AdminAlertBadge from '../components/AdminAlertBadge';
import CameraCapture from '../../components/CameraCapture';
import type { RetrievalResult } from '../data/adminMockData';
import { corpusRecords } from '../../data/corpusRecords';

const LEVEL_NAME: Record<string, string> = { green: '稳定', yellow: '关注', orange: '警告', red: '高危' };
const LEVEL_PILL: Record<string, string> = {
  green: 'bg-success-50 text-success-600', yellow: 'bg-warning-50 text-warning-600',
  orange: 'bg-orange-50 text-orange-600', red: 'bg-danger-50 text-danger-600',
};

interface RagReport {
  summary: string;
  sections?: { title: string; content: string }[];
}

export default function AdminRetrieval() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [shown, setShown] = useState(20);
  const [results, setResults] = useState<RetrievalResult[] | null>(null);
  const [report, setReport] = useState<RagReport | null>(null);
  // 查询模态与媒体：后端支持文本 / 图像 / 语音三种查询，这里补齐入口
  const [modality, setModality] = useState<'text' | 'image' | 'audio'>('text');
  const [media, setMedia] = useState<{ name: string; base64: string } | null>(null);
  const [mediaError, setMediaError] = useState('');
  /** 现场拍照（摄像头）：拍完与文件选择走同一条 pickMedia 链路 */
  const [cameraOpen, setCameraOpen] = useState(false);

  /** 选择图像 / 语音文件：读成 base64（去掉 dataURL 前缀）后随查询提交 */
  const pickMedia = (kind: 'image' | 'audio', file: File | null) => {
    setMediaError('');
    if (!file) return;
    if (kind === 'image' && !file.type.startsWith('image/')) {
      setMediaError('请选择图像文件');
      return;
    }
    if (kind === 'audio' && !file.type.startsWith('audio/')) {
      setMediaError('请选择音频文件');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      setMedia({ name: file.name, base64: raw.includes('base64,') ? raw.split('base64,')[1] : raw });
      setModality(kind);
    };
    reader.onerror = () => setMediaError('文件读取失败，请重试');
    reader.readAsDataURL(file);
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setResults(null);
    setReport(null);
    try {
      const res = await adminSearch(query, {
        modality,
        mediaBase64: media?.base64,
        mediaName: media?.name,
      });
      setResults(res.results as RetrievalResult[]);
      setReport(res.report as RagReport);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="ui-card p-5">
        <h3 className="font-semibold text-slate-800 mb-3">跨模态哈希检索（管理端）</h3>
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-40 flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="输入关键词或案例特征..."
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          {/* 图像 / 语音查询入口（后端本就支持两种模态，此前前端只给了文本） */}
          <input
            id="admin-media-image"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickMedia('image', e.target.files?.[0] ?? null)}
          />
          <input
            id="admin-media-audio"
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => pickMedia('audio', e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => document.getElementById('admin-media-image')?.click()}
            className={`cursor-pointer rounded-lg border px-3 py-2.5 text-sm transition-colors ${
              modality === 'image'
                ? 'border-primary-500 bg-primary-50 text-primary-600'
                : 'border-slate-200 text-slate-600 hover:border-primary-300'
            }`}
          >
            图像查询
          </button>
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            title="现场拍照作为图像查询线索"
            className={`cursor-pointer rounded-lg border px-3 py-2.5 text-sm transition-colors inline-flex items-center gap-1.5 ${
              modality === 'image'
                ? 'border-primary-500 bg-primary-50 text-primary-600'
                : 'border-slate-200 text-slate-600 hover:border-primary-300'
            }`}
          >
            <Camera className="h-4 w-4" />
            拍照查询
          </button>
          <button
            type="button"
            onClick={() => document.getElementById('admin-media-audio')?.click()}
            className={`cursor-pointer rounded-lg border px-3 py-2.5 text-sm transition-colors ${
              modality === 'audio'
                ? 'border-primary-500 bg-primary-50 text-primary-600'
                : 'border-slate-200 text-slate-600 hover:border-primary-300'
            }`}
          >
            语音查询
          </button>
          <button
            onClick={handleSearch}
            disabled={loading || (!query.trim() && !media)}
            className="px-6 py-2.5 bg-primary-500 text-white rounded-lg hover:bg-primary-600 text-sm font-medium transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? '检索中...' : '检索'}
          </button>
        </div>

        {(media || mediaError) && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            {media ? (
              <>
                <span className="rounded-full bg-primary-50 px-2.5 py-1 font-medium text-primary-600">
                  {modality === 'audio' ? '语音' : '图像'}查询：{media.name}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setMedia(null);
                    setModality('text');
                  }}
                  className="cursor-pointer text-slate-500 hover:text-slate-700 hover:underline"
                >
                  清除，改回文本查询
                </button>
              </>
            ) : (
              <span className="text-danger-600">{mediaError}</span>
            )}
          </div>
        )}
      </div>

      {loading && (
        <div className="ui-card p-10 flex items-center justify-center gap-3 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
          <span className="text-sm">正在执行动态跨模态哈希检索...</span>
        </div>
      )}

      {!loading && results && (
        <>
          <div className="ui-card divide-y divide-slate-100">
            {results.length === 0 && (
              <div className="px-5 py-12 text-center text-sm text-slate-400">
                没有找到相似案例。试试换一种描述，或把检索范围放宽到「全部模态」。
              </div>
            )}
            {results.map((result) => (
              <div key={result.id} className="p-5 hover:bg-slate-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{result.id}</p>
                    <p className="text-xs text-slate-400 mt-1">{result.date} · 相似度 {(result.similarity * 100).toFixed(0)}%</p>
                  </div>
                  <AdminAlertBadge level={result.alertLevel} size="sm" />
                </div>
                <p className="text-sm text-slate-600 mt-3">{result.summary}</p>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-slate-400">哈希相似度:</span>
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500 rounded-full"
                      style={{ width: `${result.similarity * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-primary-600">{(result.similarity * 100).toFixed(0)}%</span>
          </div>
        </div>
            ))}
          </div>

          {report && (
            <div className="ui-card p-5">
              <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary-600" />
                RAG 智能报告
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">{report.summary}</p>
              {report.sections?.map((section, i) => (
                <div key={i} className="mt-4">
                  <h4 className="text-sm font-medium text-slate-700 mb-1">{section.title}</h4>
                  <p className="text-sm text-slate-500 leading-relaxed">{section.content}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!loading && !results && (
        /* 空状态不再只有一张图标：把语料库的真实记录列出来，
           管理员可以直接点一条试检索 —— 和个人端检索页同一套做法。
           管理端看得更"横"：带主题标签与风险等级，便于按类别挑样本。 */
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-800">语料库记录</h2>
              <p className="mt-1 text-xs text-slate-500">
                共 {corpusRecords.length} 条真实语料，每条含文本 / 语音 / 图像三个单元。
                点一条把它填进检索框。
              </p>
            </div>
            <span className="text-xs tabular-nums text-slate-400">
              已显示 {Math.min(shown, corpusRecords.length)} / {corpusRecords.length}
            </span>
          </div>
          <ul className="mt-4 grid gap-2">
            {corpusRecords.slice(0, shown).map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setQuery(r.text)}
                  className="w-full rounded-lg border border-slate-100 p-3.5 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/40"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-xs">
                      <span className="font-medium tabular-nums text-slate-600">{r.id}</span>
                      <span className="tabular-nums text-slate-400">{r.date}</span>
                      {r.context && <span className="text-slate-400">· {r.context}</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="flex flex-wrap gap-1">
                        {r.themes.map((t) => (
                          <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                            {t}
                          </span>
                        ))}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_PILL[r.level]}`}>
                        {LEVEL_NAME[r.level]}
                      </span>
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-6 text-slate-600">{r.text}</p>
                </button>
              </li>
            ))}
          </ul>
          {shown < corpusRecords.length && (
            <button
              type="button"
              onClick={() => setShown((n) => n + 20)}
              className="ui-button mt-3 w-full"
            >
              显示更多（还有 {corpusRecords.length - shown} 条）
            </button>
          )}
        </div>
      )}

      {/* 现场拍照：拍完与"图像查询"走同一条 pickMedia 链路 */}
      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => pickMedia('image', file)}
      />
    </div>
  );
}
