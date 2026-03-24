import { useState } from 'react';
import { FileText, Mic, Image, Upload, Check, ChevronRight } from 'lucide-react';

type Tab = 'text' | 'audio' | 'image';

const questionnaires = [
  { id: 'phq9', name: 'PHQ-9 抑郁症筛查量表', questions: 9, time: '约3分钟' },
  { id: 'gad7', name: 'GAD-7 广泛性焦虑量表', questions: 7, time: '约2分钟' },
  { id: 'scl90', name: 'SCL-90 症状自评量表', questions: 90, time: '约15分钟' },
  { id: 'sds', name: 'SDS 抑郁自评量表', questions: 20, time: '约5分钟' },
  { id: 'sas', name: 'SAS 焦虑自评量表', questions: 20, time: '约5分钟' },
];

export default function DataCollection() {
  const [activeTab, setActiveTab] = useState<Tab>('text');
  const [selectedQ, setSelectedQ] = useState<string | null>(null);
  const [freeText, setFreeText] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);

  const tabs = [
    { id: 'text' as Tab, label: '文本采集', icon: FileText },
    { id: 'audio' as Tab, label: '语音采集', icon: Mic },
    { id: 'image' as Tab, label: '图像采集', icon: Image },
  ];

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).map(f => f.name);
    setUploadedFiles(prev => [...prev, ...files]);
  };

  return (
    <div className="space-y-6">
      {/* Tabs */}
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

      {/* Text Collection */}
      {activeTab === 'text' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Questionnaire Selection */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h3 className="font-semibold text-slate-800 mb-4">选择量表</h3>
            <div className="space-y-2">
              {questionnaires.map((q) => (
                <button
                  key={q.id}
                  onClick={() => setSelectedQ(q.id)}
                  className={`w-full flex items-center justify-between p-3.5 rounded-lg border transition-colors text-left cursor-pointer ${
                    selectedQ === q.id
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      selectedQ === q.id ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-400'
                    }`}>
                      {selectedQ === q.id ? <Check className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-800">{q.name}</p>
                      <p className="text-xs text-slate-400">{q.questions} 题 · {q.time}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300" />
                </button>
              ))}
            </div>
            {selectedQ && (
              <button className="mt-4 w-full py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium transition-colors cursor-pointer">
                开始填写
              </button>
            )}
          </div>

          {/* Free Text Input */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h3 className="font-semibold text-slate-800 mb-4">开放式文本输入</h3>
            <p className="text-sm text-slate-400 mb-3">
              请描述您近期的情绪状态、睡眠情况、人际关系等方面的感受
            </p>
            <textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder="在这里输入您的感受和想法..."
              className="w-full h-48 p-3 border border-slate-200 rounded-lg text-sm text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-slate-400">{freeText.length} 字</span>
              <button
                disabled={!freeText.trim()}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-700 transition-colors cursor-pointer"
              >
                提交文本
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audio Collection */}
      {activeTab === 'audio' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h3 className="font-semibold text-slate-800 mb-4">实时录音</h3>
            <div className="flex flex-col items-center py-8">
              <div className="w-24 h-24 rounded-full bg-primary-50 flex items-center justify-center mb-4 hover:bg-primary-100 transition-colors cursor-pointer">
                <Mic className="w-10 h-10 text-primary-600" />
              </div>
              <p className="text-sm text-slate-500 mb-2">点击开始录音</p>
              <p className="text-xs text-slate-400">建议录制2-5分钟的语音，用于情感分析</p>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h3 className="font-semibold text-slate-800 mb-4">上传音频文件</h3>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center hover:border-primary-400 transition-colors"
            >
              <Upload className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-600 mb-1">拖拽文件到此处或点击上传</p>
              <p className="text-xs text-slate-400">支持 MP3、WAV、M4A 格式，最大 50MB</p>
            </div>
          </div>
        </div>
      )}

      {/* Image Collection */}
      {activeTab === 'image' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h3 className="font-semibold text-slate-800 mb-4">绘画测试上传</h3>
            <p className="text-sm text-slate-400 mb-4">
              请上传房树人测试（HTP）或其他绘画测试的图片
            </p>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              className="border-2 border-dashed border-slate-200 rounded-lg p-12 text-center hover:border-primary-400 transition-colors"
            >
              <Image className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-600 mb-1">拖拽图片到此处或点击上传</p>
              <p className="text-xs text-slate-400">支持 JPG、PNG 格式，最大 20MB</p>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h3 className="font-semibold text-slate-800 mb-4">已上传文件</h3>
            {uploadedFiles.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm">暂无已上传文件</div>
            ) : (
              <div className="space-y-2">
                {uploadedFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                    <Image className="w-4 h-4 text-slate-400" />
                    <span className="text-sm text-slate-700 flex-1">{f}</span>
                    <Check className="w-4 h-4 text-success-500" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
