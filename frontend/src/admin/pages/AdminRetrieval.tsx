import { useState } from 'react';
import { Search, Sparkles } from 'lucide-react';
import { retrievalResults, ragReport } from '../data/adminMockData';
import AdminAlertBadge from '../components/AdminAlertBadge';

export default function AdminRetrieval() {
  const [query, setQuery] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

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
              placeholder="输入关键词或案例特征..."
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={() => setHasSearched(Boolean(query.trim()))}
            className="px-6 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium transition-colors cursor-pointer"
          >
            检索
          </button>
        </div>
      </div>

      {hasSearched && (
        <>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
            {retrievalResults.map((result) => (
              <div key={result.id} className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{result.id}</p>
                    <p className="text-xs text-slate-400 mt-1">{result.date}</p>
                  </div>
                  <AdminAlertBadge level={result.alertLevel} size="sm" />
                </div>
                <p className="text-sm text-slate-600 mt-3">{result.summary}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary-600" />
              RAG 智能报告
            </h3>
            <p className="text-sm text-slate-600">{ragReport.summary}</p>
          </div>
        </>
      )}
    </div>
  );
}
