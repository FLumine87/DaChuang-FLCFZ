import { Link } from 'react-router-dom';
import { ShieldCheck, UserRound, ArrowRight } from 'lucide-react';

export default function SystemSelector() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-4xl">
        <h1 className="text-3xl font-bold text-slate-800 text-center">心理筛查预警系统</h1>
        <p className="text-slate-500 text-center mt-2">请选择进入管理端或个人端原型</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-10">
          <Link
            to="/admin/dashboard"
            className="group bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all"
          >
            <ShieldCheck className="w-9 h-9 text-primary-600" />
            <h2 className="text-xl font-semibold text-slate-800 mt-4">管理端系统</h2>
            <p className="text-sm text-slate-500 mt-2 leading-6">
              面向心理咨询师/管理人员，包含筛查管理、预警处置、案例跟踪、检索分析等模块。
            </p>
            <span className="mt-5 inline-flex items-center gap-1 text-primary-600 text-sm font-medium">
              进入管理端 <ArrowRight className="w-4 h-4" />
            </span>
          </Link>

          <Link
            to="/personal/dashboard"
            className="group bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all"
          >
            <UserRound className="w-9 h-9 text-primary-600" />
            <h2 className="text-xl font-semibold text-slate-800 mt-4">个人端系统</h2>
            <p className="text-sm text-slate-500 mt-2 leading-6">
              面向个人用户，支持多模态采集、动态跨模态哈希检索、RAG 建议和自助预警管理。
            </p>
            <span className="mt-5 inline-flex items-center gap-1 text-primary-600 text-sm font-medium">
              进入个人端 <ArrowRight className="w-4 h-4" />
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
