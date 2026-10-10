import { useState } from 'react';
import { Search, Sparkles, Loader2 } from 'lucide-react';
import { adminSearch } from '../../services/mockApi';
import AdminAlertBadge from '../components/AdminAlertBadge';
import type { RetrievalResult } from '../data/adminMockData';

interface RagReport {
  summary: string;
  sections?: { title: string; content: string }[];
}

export default function AdminRetrieval() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<RetrievalResult[] | null>(null);
  const [report, setReport] = useState<RagReport | null>(null);
  // 查询模态与媒体：后端支持文本 / 图像 / 语音三种查询，这里补齐入口
  const [modality, setModality] = useState<'text' | 'image' | 'audio'>('text');
  const [media, setMedia] = useState<{ name: string; base64: string } | null>(null);
  const [mediaError, setMediaError] = useState('');

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
        <div className="text-center py-16">
          <Search className="w-14 h-14 text-slate-200 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">输入检索词，查找相似案例与风险模式</p>
        </div>
      )}
    </div>
  );
}
