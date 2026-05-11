import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Upload, Download, Trash2, Search, FileCheck2, FileX2, Files, Cpu } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { extractPdfText, parseCalibrationPdf, CalRecord } from "@/lib/pdf-parser";
import { toast } from "sonner";

export const Route = createFileRoute("/calibration")({
  head: () => ({
    meta: [
      { title: "校准证书解析 — PDF 数据解析平台" },
      { name: "description", content: "批量解析校准证书PDF，自动计算下次校准日期与状态。" },
    ],
  }),
  component: CalPage,
});

const STORAGE_KEY = "cal-records-v1";

function makeDemo(): CalRecord[] {
  return [
    {
      fileName: "demo-thirdparty-001.pdf",
      deviceId: "SN-2024-001",
      calDate: "2025-08-10",
      nextCalDate: "2026-08-09",
      maxError: -0.32,
      errors: [0.1, -0.2, 0.15, -0.32, 0.08],
    },
    {
      fileName: "demo-factory-002.pdf",
      deviceId: "T7-FAC-002",
      calDate: "2026-02-01",
      nextCalDate: "2027-01-31",
      maxError: 0.45,
      errors: [0.45, 0.21, -0.18],
    },
    {
      fileName: "demo-expired-003.pdf",
      deviceId: "SN-2023-099",
      calDate: "2024-11-01",
      nextCalDate: "2025-10-31",
      maxError: 0.6,
      errors: [0.6, -0.3],
    },
  ];
}

function daysLeft(target: string): number {
  if (!target) return 0;
  const t = new Date(target).getTime();
  const now = new Date(new Date().toDateString()).getTime();
  return Math.round((t - now) / 86400000);
}

function statusInfo(target: string) {
  const d = daysLeft(target);
  if (d < 0)
    return {
      label: `已过期${-d}天`,
      cls: "bg-destructive/15 text-destructive border border-destructive/30",
    };
  return {
    label: `还有${d}天过期`,
    cls: "bg-green-100 text-green-800 border border-green-300",
  };
}

function CalPage() {
  const [records, setRecords] = useState<CalRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [stats, setStats] = useState({ uploaded: 0, success: 0, failed: 0 });

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        setRecords(JSON.parse(raw));
      } catch {}
    } else {
      setRecords(makeDemo());
    }
  }, []);

  useEffect(() => {
    if (records.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }, [records]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setLoading(true);
    const total = files.length;
    let success = 0;
    let failed = 0;
    const newRecs: CalRecord[] = [];
    for (const f of Array.from(files)) {
      try {
        const text = await extractPdfText(f);
        newRecs.push(parseCalibrationPdf(text, f.name));
        success++;
      } catch (e: any) {
        toast.error(`${f.name} 解析失败: ${e.message}`);
        failed++;
      }
    }
    setRecords((r) => [...r, ...newRecs]);
    setStats((s) => ({
      uploaded: s.uploaded + total,
      success: s.success + success,
      failed: s.failed + failed,
    }));
    setLoading(false);
    toast.success(`成功解析 ${success} 个证书${failed ? `，失败 ${failed} 个` : ""}`);
  }

  const filtered = useMemo(
    () =>
      records.filter(
        (r) =>
          r.fileName.toLowerCase().includes(search.toLowerCase()) ||
          r.deviceId.toLowerCase().includes(search.toLowerCase())
      ),
    [records, search]
  );

  function exportExcel() {
    const header = [
      "文件名", "设备号", "校准日期", "下次校准日期", "最大误差", "状态",
    ];
    const rows = records.map((r) => {
      const d = daysLeft(r.nextCalDate);
      return [
        r.fileName, r.deviceId, r.calDate, r.nextCalDate, r.maxError,
        d < 0 ? `已过期${-d}天` : `还有${d}天过期`,
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "校准证书汇总");
    XLSX.writeFile(wb, "校准证书汇总.xlsx");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-6 py-8 space-y-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "已上传文件", value: stats.uploaded, icon: Files, color: "text-blue-600", bg: "bg-blue-50" },
            { label: "成功解析", value: stats.success, icon: FileCheck2, color: "text-emerald-600", bg: "bg-emerald-50" },
            { label: "解析失败", value: stats.failed, icon: FileX2, color: "text-red-500", bg: "bg-red-50" },
            { label: "已识别设备", value: new Set(records.map((r) => r.deviceId)).size, icon: Cpu, color: "text-violet-600", bg: "bg-violet-50" },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-all p-5 border border-slate-100 flex items-center gap-4">
              <div className={`rounded-xl p-2.5 ${s.bg}`}>
                  <s.icon className={`h-5 w-5 ${s.color}`} />
              </div>
              <div>
                <div className="text-xs text-slate-500 font-medium">{s.label}</div>
                <div className="text-2xl font-bold tabular-nums tracking-tight text-slate-900">{s.value}</div>
              </div>
            </div>
          ))}
        </div>

        <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">批量上传校准证书</h2>
              <p className="text-sm text-slate-500 mt-1">
                已识别 <span className="font-semibold text-blue-600">{new Set(records.map((r) => r.deviceId)).size}</span> 台设备
              </p>
            </div>
            <div className="flex gap-3">
              <label>
                <input
                  type="file"
                  multiple
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files)}
                />
                <Button asChild disabled={loading} className="h-10 rounded-xl bg-blue-600 hover:bg-blue-700 px-5">
                  <span className="cursor-pointer flex items-center">
                    <Upload className="mr-2 h-4 w-4" />
                    {loading ? "解析中..." : "选择文件"}
                  </span>
                </Button>
              </label>
              <Button
                variant="outline"
                onClick={() => {
                  setRecords([]);
                  setStats({ uploaded: 0, success: 0, failed: 0 });
                  localStorage.removeItem(STORAGE_KEY);
                }}
                className="h-10 rounded-xl"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                清空
              </Button>
            </div>
          </div>
          <div className="border-2 border-dashed border-slate-200 hover:border-blue-400 rounded-2xl p-10 text-center bg-slate-50/50 transition-colors duration-200">
            <Upload className="mx-auto h-10 w-10 text-slate-400 mb-3" />
            <p className="text-sm font-medium text-slate-600">拖拽文件到此处，或点击上方按钮上传</p>
            <p className="text-xs text-slate-400 mt-1">支持批量上传，自动判断证书类型</p>
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">校准结果汇总</h2>
              <p className="text-sm text-slate-500 mt-1">共 {filtered.length} 条记录</p>
            </div>
            <div className="flex gap-3 items-center">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="搜索文件 / 设备号"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-10 rounded-xl bg-white border-slate-200 w-full"
                />
              </div>
              <Button onClick={exportExcel} disabled={!records.length} className="h-10 rounded-xl bg-blue-600 hover:bg-blue-700">
                <Download className="mr-1.5 h-4 w-4" />
                导出Excel
              </Button>
            </div>  
          </div>
          <div className="overflow-auto rounded-2xl border border-slate-200">
            <Table>
              <TableHeader className="bg-slate-100 sticky top-0 z-10">
                <TableRow className="hover:bg-transparent border-slate-200">
                  <TableHead className="py-4 px-5 text-sm font-semibold text-slate-700 w-[220px]">文件名</TableHead>
                  <TableHead className="py-4 px-5 text-sm font-semibold text-slate-700 w-[120px]">设备号</TableHead>
                  <TableHead className="py-4 px-5 text-sm font-semibold text-slate-700 w-[140px]">校准日期</TableHead>
                  <TableHead className="py-4 px-5 text-sm font-semibold text-slate-700 w-[140px]">下次校准日期</TableHead>
                  <TableHead className="py-4 px-5 text-right text-sm font-semibold text-slate-700 w-[100px]">最大误差</TableHead>
                  <TableHead className="py-4 px-5 text-sm font-semibold text-slate-700 w-[120px]">状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r, i) => {
                  const s = statusInfo(r.nextCalDate);
                  return (
                    <TableRow key={i} className="hover:bg-slate-50 border-b border-slate-100">
                      <TableCell className="py-4 px-5 font-mono text-xs text-slate-500 w-[220px] truncate">{r.fileName}</TableCell>
                      <TableCell className="py-4 px-5 font-medium text-slate-900 w-[120px]">{r.deviceId}</TableCell>
                      <TableCell className="py-4 px-5 text-sm tabular-nums text-slate-700 w-[140px]">{r.calDate}</TableCell>
                      <TableCell className="py-4 px-5 text-sm tabular-nums text-slate-700 w-[140px]">{r.nextCalDate}</TableCell>
                      <TableCell className="py-4 px-5 text-right tabular-nums font-medium text-slate-900 w-[100px]">
                        {(r.maxError ?? 0) > 0 ? `+${r.maxError}` : r.maxError ?? 0}℃
                      </TableCell>
                      <TableCell className="py-4 px-5 w-[120px]">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${s.cls}`}>
                          {s.label}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!filtered.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-slate-400 py-16">
                      暂无数据
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      </main>
    </div>
  );
}
