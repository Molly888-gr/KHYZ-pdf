import { Thermometer } from "lucide-react";

export function AppHeader() {
  return (
    <header className="border-b border-slate-200 bg-white sticky top-0 z-50">
      <div className="mx-auto max-w-7xl px-6 py-5">
        <div className="flex items-center gap-3">
          <Thermometer className="h-8 w-8 text-blue-600" />
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            KHYZ温度文档解析器
          </h1>
        </div>
        <p className="text-sm text-slate-500 mt-2">
          批量上传温度数据PDF，自动提取并分析温度数据
        </p>
      </div>
    </header>
  );
}
