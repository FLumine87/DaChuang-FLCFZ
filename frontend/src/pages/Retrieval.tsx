import { useState } from 'react';
import { Search, FileText, Mic, Image, Sparkles, ArrowRight, Hash } from 'lucide-react';
import { searchSimilarCases, analyzeScreening } from '../services/api';
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

export default function Retrieval() {
  const [query, setQuery] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);

  const handleSearch = async () => {
    if (query.trim()) {
      try {
        setLoading(true);
        const data = await searchSimilarCases(query, 'text', 5);
        setResults(data.results);
        setHasSearched(true);
      } catch (error) {
        console.error('Search failed:', error);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleGenerateReport = async () => {
    try {
      setReportLoading(true);
      // 这里使用模拟的screening_id，实际应该从选择的案例中获取
      const data = await analyzeScreening(1, true, 5);
      setReport(data.rag_report);
      setShowReport(true);
    } catch (error) {
      console.error('Report generation failed:', error);
    } finally {
      setReportLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Search Box */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <Hash className="w-5 h-5 text-primary-600" />
          跨模态哈希检索
        </h3>
        <p className="text-sm text-slate-400 mb-4">
          输入文本描述、上传语音或图像，系统将通过跨模态哈希编码检索相似历史案例
        </p>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="输入症状描述、关键词或上传多模态数据进行检索..."
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <button className="px-3 py-2.5 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 cursor-pointer" title="上传语音">
            <Mic className="w-4 h-4" />
          </button>
          <button className="px-3 py-2.5 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 cursor-pointer" title="上传图像">
            <Image className="w-4 h-4" />
          </button>
          <button
            onClick={handleSearch}
            className="px-6 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium transition-colors cursor-pointer"
          >
            检索
          </button>
        </div>
      </div>

      {hasSearched && (
        <>
          {/* Retrieval Results */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">
                检索结果 <span className="text-sm font-normal text-slate-400">（找到 {results.length} 个相似案例）</span>
              </h3>
              <button
                onClick={handleGenerateReport}
                disabled={reportLoading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium transition-colors cursor-pointer"
              >
                {reportLoading ? (
                  <span>生成中...</span>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" /> RAG智能分析
                  </>
                )}
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <p className="text-slate-500">检索中...</p>
                </div>
              ) : results.length === 0 ? (
                <div className="flex items-center justify-center py-10">
                  <p className="text-slate-500">未找到相似案例</p>
                </div>
              ) : (
                results.map((result) => {
                  return (
                    <div key={result.id} className="p-5 hover:bg-slate-50 transition-colors">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center">
                            <FileText className="w-4 h-4 text-primary-600" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-slate-800">{result.id}</span>
                              <span className="text-xs px-2 py-0.5 bg-slate-100 rounded text-slate-500">
                                文本
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
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
                        {result.tags.map((tag) => (
                          <span key={tag} className="text-xs px-2 py-0.5 bg-primary-50 text-primary-600 rounded-full">
                            {tag}
                          </span>
                        ))}
                      </div>
                      {/* Hash visualization bar */}
                      <div className="mt-3 flex items-center gap-2">
                        <span className="text-xs text-slate-400">哈希距离:</span>
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-primary-500 to-primary-300 rounded-full"
                            style={{ width: `${result.similarity * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* RAG Report */}
          {showReport && report && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className="p-5 border-b border-slate-100 bg-gradient-to-r from-primary-50 to-white rounded-t-xl">
                <div className="flex items-center gap-3">
                  <Sparkles className="w-6 h-6 text-primary-600" />
                  <div>
                    <h3 className="font-semibold text-slate-800">RAG 智能分析报告</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      基于检索增强生成技术，综合 {results.length} 个相似案例和知识库生成
                    </p>
                  </div>
                  <div className="ml-auto px-3 py-1 bg-danger-50 text-danger-600 rounded-full text-sm font-medium">
                    {report.risk_level === 'high' ? '高风险' : report.risk_level === 'medium' ? '中风险' : '低风险'}
                  </div>
                </div>
              </div>

              <div className="p-5 space-y-5">
                {/* Summary */}
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-sm text-slate-700 leading-relaxed">{report.summary}</p>
                </div>

                {/* Sections */}
                {report.sections.map((section, i) => (
                  <div key={i}>
                    <h4 className="font-medium text-slate-800 mb-2 flex items-center gap-2">
                      <ArrowRight className="w-4 h-4 text-primary-500" />
                      {section.title}
                    </h4>
                    <p className="text-sm text-slate-600 leading-relaxed pl-6">{section.content}</p>
                  </div>
                ))}

                {/* Recommendations */}
                <div className="mt-4">
                  <h4 className="font-medium text-slate-800 mb-3">建议措施</h4>
                  <div className="space-y-2">
                    {report.recommendations.map((rec, i) => (
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

      {!hasSearched && (
        <div className="text-center py-20">
          <Search className="w-16 h-16 text-slate-200 mx-auto mb-4" />
          <p className="text-slate-400 text-sm">输入查询内容，开始跨模态哈希检索</p>
          <p className="text-slate-300 text-xs mt-1">支持文本、语音、图像多模态输入</p>
        </div>
      )}
    </div>
  );
}
