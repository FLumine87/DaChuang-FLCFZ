import { useState } from 'react';
import { FileText, Mic, Image } from 'lucide-react';

type Tab = 'text' | 'audio' | 'image';

export default function AdminDataCollection() {
  const [activeTab, setActiveTab] = useState<Tab>('text');

  const tabs = [
    { id: 'text' as Tab, label: '文本采集', icon: FileText },
    { id: 'audio' as Tab, label: '语音采集', icon: Mic },
    { id: 'image' as Tab, label: '图像采集', icon: Image },
  ];

  return (
    <div className="space-y-6">
      <div className="flex gap-2 bg-white rounded-xl border border-slate-200 p-1.5 shadow-sm w-fit">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                isActive ? 'bg-primary-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        {activeTab === 'text' && <p className="text-slate-600">管理端文本采集模块（量表与开放文本管理）。</p>}
        {activeTab === 'audio' && <p className="text-slate-600">管理端语音采集模块（录音与文件上传）。</p>}
        {activeTab === 'image' && <p className="text-slate-600">管理端图像采集模块（绘画/图像上传）。</p>}
      </div>
    </div>
  );
}
