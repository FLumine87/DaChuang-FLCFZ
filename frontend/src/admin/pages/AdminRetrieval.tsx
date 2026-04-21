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

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setResults(null);
    setReport(null);
    try {
      const res = await adminSearch(query);
      setResults(res.results as RetrievalResult[]);
      setReport(res.report as RagReport);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="font-semibold text-slate-800 mb-3">跨模态哈希检索（管理端）</h3>
        <div className="flex gap-3">
          <div className="relative flex-1">
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
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="px-6 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? '检索中...' : '检索'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="bg-white rounded-xl border border-slate-200 p-10 shadow-sm flex items-center justify-center gap-3 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
          <span className="text-sm">正在执行动态跨模态哈希检索...</span>
        </div>
      )}

      {!loading && results && (
        <>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
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
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
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
