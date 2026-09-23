import { useState } from 'react';
import { Search, FileText, Mic, Image, Sparkles, ArrowRight, Hash, Loader2 } from 'lucide-react';
import { search } from '../services/mockApi';
import { userProfile } from '../data/mockData';
import type { RetrievalResult, RetrievalIndexInfo } from '../data/mockData';
import AlertBadge from '../components/AlertBadge';

const modalityIcons = {
  text: FileText,
  audio: Mic,
  image: Image,
  multimodal: Sparkles,
};

const modalityLabels = {
  text: '文本',
  audio: '语音',
  image: '图像',
  multimodal: '多模态',
};

interface RagReport {
  summary: string;
  riskLevel: string;
  sections: { title: string; content: string }[];
  recommendations: string[];
}

export default function Retrieval() {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'text' | 'audio' | 'image'>('all');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<RetrievalResult[] | null>(null);
  const [report, setReport] = useState<RagReport | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [indexInfo, setIndexInfo] = useState<RetrievalIndexInfo | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setResults(null);
    setReport(null);
    setShowReport(false);
    setError(null);
    setIndexInfo(null);
    try {
      const res = await search(query, scope === 'all' ? undefined : scope);
      setResults((res.results ?? []) as RetrievalResult[]);
      setReport((res.report ?? null) as RagReport | null);
      setIndexInfo((res.index ?? null) as RetrievalIndexInfo | null);
    } catch (err) {
      setError((err as Error).message || '检索失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <Hash className="w-5 h-5 text-primary-600" />
          动态跨模态哈希检索
        </h3>
        <p className="text-sm text-slate-400 mb-4">
          输入你的症状描述、语音片段或图像，系统将检索与你当前状态相似的历史模式并触发 RAG 风险解释
        </p>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="例如：最近入睡困难、白天无力、对课程提不起兴趣..."
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <button
            disabled
            title="语音检索待接入真实音频特征（当前语料为文本形态）"
            className="px-3 py-2.5 border border-slate-200 rounded-lg text-slate-300 cursor-not-allowed"
          >
            <Mic className="w-4 h-4" />
          </button>
          <button
            disabled
            title="图像检索待接入真实图像特征（当前语料为文本形态）"
            className="px-3 py-2.5 border border-slate-200 rounded-lg text-slate-300 cursor-not-allowed"
          >
            <Image className="w-4 h-4" />
          </button>
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="px-6 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? '检索中...' : '开始检索'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-slate-100">
          <span className="text-xs text-slate-400">检索范围</span>
          {([
            ['all', '全部模态'],
            ['text', '仅文本'],
            ['audio', '仅语音线索'],
            ['image', '仅图像线索'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setScope(value)}
              className={`px-3 py-1 rounded-full text-xs border transition-colors cursor-pointer ${
                scope === value
                  ? 'bg-primary-50 border-primary-200 text-primary-600 font-medium'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
          <span className="text-xs text-slate-400 ml-auto">
            选择「仅图像线索」可用一段文字描述去检索表情 / 绘画线索（跨模态检索）
          </span>
        </div>
      </div>

      {loading && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 shadow-sm flex flex-col items-center gap-4 text-slate-400">
          <Loader2 className="w-10 h-10 animate-spin text-primary-500" />
          <div className="text-center">
            <p className="text-sm font-medium text-slate-600">动态跨模态哈希检索中</p>
            <p className="text-xs mt-1">正在编码特征向量并计算哈希距离...</p>
          </div>
        </div>
      )}

      {!loading && results && (
        <>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h3 className="font-semibold text-slate-800">
                  检索结果 <span className="text-sm font-normal text-slate-400">（找到 {results.length} 个高相似模式）</span>
                </h3>
                {indexInfo && (
                  <p className="text-xs text-slate-400 mt-1">
                    查询码 <span className="font-mono">{indexInfo.query_code_hex?.slice(0, 8)}…</span>
                    {' · '}命中主题 {indexInfo.query_themes?.join('、') || '—'}
                    {' · '}候选 {indexInfo.candidates}/{indexInfo.index_size}
                    {' · '}探测桶 {indexInfo.keys_probed}
                    {' · '}{indexInfo.scoring === 'asymmetric' ? '非对称距离' : '汉明距离'}排序
                  </p>
                )}
              </div>
              <button
                onClick={() => setShowReport((v) => !v)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium transition-colors cursor-pointer"
              >
                <Sparkles className="w-4 h-4" /> {showReport ? '收起报告' : 'RAG智能分析'}
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {results.map((result) => {
                const Icon = modalityIcons[result.modality] ?? FileText;
                const modalityLabel = modalityLabels[result.modality] ?? (result.modality || '文本');
                return (
                  <div key={result.id} className="p-5 hover:bg-slate-50 transition-colors">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center">
                          <Icon className="w-4 h-4 text-primary-600" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-800">{result.recordId ?? result.id}</span>
                            <span className="text-xs px-2 py-0.5 bg-slate-100 rounded text-slate-500">
                              {result.modalityLabel ?? modalityLabel}
                            </span>
                            {result.crossModal && (
                              <span className="text-xs px-2 py-0.5 bg-primary-50 text-primary-600 rounded">
                                跨模态命中
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">{result.date}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <AlertBadge level={result.alertLevel} size="sm" />
                        <div className="text-right">
                          <p className="text-lg font-bold text-primary-600">
                            {(result.similarity * 100).toFixed(0)}%
                          </p>
                          <p className="text-xs text-slate-400">相似度</p>
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-slate-600 mt-2">{result.summary}</p>
                    <div className="flex gap-2 mt-2">
                      {(result.tags ?? []).map((tag) => (
                        <span key={tag} className="text-xs px-2 py-0.5 bg-primary-50 text-primary-600 rounded-full">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 space-y-2">
                      {(result.explain?.shared_themes?.length ?? 0) > 0 && (
                        <p className="text-xs text-slate-500">
                          为什么相似：共同命中主题{' '}
                          <span className="font-medium text-primary-600">
                            {result.explain!.shared_themes!.join('、')}
                          </span>
                        </p>
                      )}
                      {result.explain && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                          <span>
                            汉明距离{' '}
                            <span className="font-mono text-slate-500">
                              {result.explain.hamming_distance}/{64}
                            </span>
                          </span>
                          {typeof result.explain.asymmetric_score === 'number' && (
                            <span>
                              非对称得分{' '}
                              <span className="font-mono text-slate-500">
                                {result.explain.asymmetric_score.toFixed(3)}
                              </span>
                            </span>
                          )}
                          {result.explain.code_hex && (
                            <span>
                              哈希码{' '}
                              <span className="font-mono text-slate-500">
                                {result.explain.code_hex.slice(0, 8)}…
                              </span>
                            </span>
                          )}
                          {typeof result.explain.window === 'number' && (
                            <span>时间窗 {result.explain.window}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {showReport && report && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className="p-5 border-b border-slate-100 bg-gradient-to-r from-primary-50 to-white rounded-t-xl">
                <div className="flex items-center gap-3">
                  <Sparkles className="w-6 h-6 text-primary-600" />
                  <div>
                    <h3 className="font-semibold text-slate-800">RAG 智能分析报告</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      用户：{userProfile.name}，综合 {results.length} 个相似模式与知识库生成
                    </p>
                  </div>
                  <div className="ml-auto px-3 py-1 bg-danger-50 text-danger-600 rounded-full text-sm font-medium">
                    高风险
                  </div>
                </div>
              </div>

              <div className="p-5 space-y-5">
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-sm text-slate-700 leading-relaxed">{report.summary}</p>
                </div>

                {(report.sections ?? []).map((section, i) => (
                  <div key={i}>
                    <h4 className="font-medium text-slate-800 mb-2 flex items-center gap-2">
                      <ArrowRight className="w-4 h-4 text-primary-500" />
                      {section.title}
                    </h4>
                    <p className="text-sm text-slate-600 leading-relaxed pl-6">{section.content}</p>
                  </div>
                ))}

                <div className="mt-4">
                  <h4 className="font-medium text-slate-800 mb-3">个性化建议措施</h4>
                  <div className="space-y-2">
                    {(report.recommendations ?? []).map((rec, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-warning-50 rounded-lg">
                        <span className="w-5 h-5 rounded-full bg-warning-500 text-white text-xs flex items-center justify-center shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <span className="text-sm text-slate-700">{rec}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {!loading && error && (
        <div className="bg-danger-50 border border-danger-200 rounded-xl p-5 text-danger-700 text-sm">
          <p className="font-medium">检索失败</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      {!loading && !error && !results && (
        <div className="text-center py-20">
          <Search className="w-16 h-16 text-slate-200 mx-auto mb-4" />
          <p className="text-slate-400 text-sm">输入你的状态描述，开始动态跨模态哈希检索</p>
          <p className="text-slate-300 text-xs mt-1">支持文本、语音、图像多模态输入，输出 RAG 风险解释</p>
        </div>
      )}
    </div>
  );
}
