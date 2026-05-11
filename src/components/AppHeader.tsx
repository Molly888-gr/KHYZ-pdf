import { Link, useLocation } from "@tanstack/react-router";
import { Thermometer, FileCheck2 } from "lucide-react";

export function AppHeader() {
  const loc = useLocation();
  const tabs = [
    { to: "/", label: "温度数据文件解析", icon: Thermometer },
    { to: "/calibration", label: "校准证书文件解析", icon: FileCheck2 },
  ];
  return (
    <header className="border-b border-slate-200 bg-white sticky top-0 z-50">
      <div className="mx-auto max-w-7xl px-6 py-5">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          KHYZ温度/校准文档解析器
        </h1>
        <nav className="flex gap-2 bg-slate-100 rounded-xl p-1.5">
          {tabs.map((t) => {
            const active = loc.pathname === t.to;
            const Icon = t.icon;
            return (
              <Link
                key={t.to}
                to={t.to}
                className={`px-5 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all duration-200 ${
                  active
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
