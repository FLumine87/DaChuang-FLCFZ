import { useEffect, useState } from 'react';
import { listAdminSupplements, USE_MOCK, type AdminSupplement, type Page } from '../../services/adminApi';

const labels = { text: '文本', audio: '语音', image: '图像' };

export default function AdminSupplements() {
  const [kind, setKind] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<Page<AdminSupplement> | null>(null);
  const [selected, setSelected] = useState<AdminSupplement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    listAdminSupplements({ keyword, kind, page }).then((data) => {
      if (active) { setResult(data); setError(''); }
    }).catch((reason: unknown) => {
      if (active) { setResult(null); setError(reason instanceof Error ? reason.message : '加载失败'); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [keyword, kind, page, reload]);
  return <section className="space-y-4">
    <p className="text-sm text-slate-500">个人端保存的文本、语音和图像采集，含独立采集与问卷补充。分析结果用于人工复核。</p>
    {USE_MOCK && <p className="text-sm text-amber-700">演示模式没有真实采集记录；连接后端后显示实际数据。</p>}
    <div className="flex flex-wrap gap-3">
      <input aria-label="搜索采集记录" className="ui-input" placeholder="姓名、筛查编号或文件名" value={keyword}
        onChange={(event) => { setKeyword(event.target.value); setPage(1); setLoading(true); setSelected(null); }} />
      <select aria-label="采集类型" className="ui-input" value={kind}
        onChange={(event) => { setKind(event.target.value); setPage(1); setLoading(true); setSelected(null); }}>
        <option value="">全部模态</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </div>
    {loading && <p role="status">正在加载采集记录…</p>}
    {error && <p role="alert" className="text-danger-600">{error} <button className="ui-button" onClick={() => { setLoading(true); setReload((n) => n + 1); }}>重试</button></p>}
    {!loading && result?.items.length === 0 && <p className="ui-card p-8 text-center text-slate-500">当前条件下没有多模态采集记录。</p>}
    {!loading && result && <div className="ui-card ui-table-scroll"><table className="ui-table">
      <thead><tr><th>姓名</th><th>模态</th><th>关联筛查</th><th>采集内容</th><th>时间</th><th>操作</th></tr></thead>
      <tbody>{result.items.map((item) => <tr key={item.id}>
        <td>{item.name}</td><td>{labels[item.kind]}</td><td>{item.screeningId || '独立采集'}</td>
        <td className="max-w-64 truncate">{item.filename || item.text || item.description || '未填写说明'}</td>
        <td>{item.createdAt}</td><td><button className="text-primary-600 hover:underline" onClick={() => setSelected(item)}>查看采集 {item.id}</button></td>
      </tr>)}</tbody>
    </table></div>}
    {result && <div className="flex items-center gap-3 text-sm text-slate-500">
      <span>共 {result.total} 条 · 第 {page} 页</span>
      <button className="ui-button" disabled={page <= 1 || loading} onClick={() => { setPage((n) => n - 1); setLoading(true); }}>上一页</button>
      <button className="ui-button" disabled={page * result.pageSize >= result.total || loading} onClick={() => { setPage((n) => n + 1); setLoading(true); }}>下一页</button>
    </div>}
    {selected && <article className="ui-card space-y-3 p-5" aria-label="采集详情">
      <div className="flex justify-between"><h3 className="font-semibold">采集详情 · {labels[selected.kind]}</h3>
        <button className="ui-button" onClick={() => setSelected(null)}>关闭详情</button></div>
      <p>{selected.name} · {selected.createdAt}</p>
      <p className="whitespace-pre-wrap">{selected.text || selected.description || selected.filename || '无补充说明'}</p>
      <h4 className="font-medium">已保存的分析结果</h4>
      {selected.analysis ? <div className="space-y-2 text-sm text-slate-600">
        <p>分析等级：{selected.analysis.levelLabel || '未提供'}</p>
        <p>{selected.analysis.conclusion || '未保存分析结论'}</p>
        <p>{selected.analysis.reason}</p>
        {selected.analysis.alertId && <a className="text-primary-600 underline" href={`#/admin/alerts?alert=${encodeURIComponent(selected.analysis.alertId)}`}>查看关联预警 →</a>}
      </div> :
        <p className="text-sm text-slate-500">暂无分析结果，不能据此判断风险。</p>}
    </article>}
  </section>;
}
