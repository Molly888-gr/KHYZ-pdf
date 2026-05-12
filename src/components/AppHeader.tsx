import { Thermometer, FileCheck2 } from "lucide-react";

interface AppHeaderProps {
  activeTab: "temperature" | "calibration";
  onTabChange: (tab: "temperature" | "calibration") => void;
}

export function AppHeader({ activeTab, onTabChange }: AppHeaderProps) {
  const tabs = [
    { id: "temperature" as const, label: "温度数据文件解析", icon: Thermometer },
    { id: "calibration" as const, label: "校准证书文件解析", icon: FileCheck2 },
  ];

  return (
    <header className="border-b border-slate-200 bg-white sticky top-0 z-50">
      <div className="mx-auto max-w-7xl px-6 py-5">
        <div className="flex items-center gap-3 mb-4">
          <Thermometer className="h-8 w-8 text-blue-600" />
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            KHYZ温度/校准文档解析器
          </h1>
        </div>
        <nav className="flex gap-2 bg-slate-100 rounded-xl p-1.5">
          {tabs.map((t) => {
            const active = activeTab === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => onTabChange(t.id)}
                className={`px-5 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all duration-200 ${
                  active
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
