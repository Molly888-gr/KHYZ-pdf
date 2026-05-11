import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import * as XLSX from "xlsx";
import { Upload, Download, Trash2, Search, ImageDown, FileCheck2, FileX2, Files, Cpu } from "lucide-react";
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
import { extractPdfText, parseTemperaturePdf, TempRecord } from "@/lib/pdf-parser";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "温度PDF解析 — PDF 数据解析平台" },
      { name: "description", content: "批量解析温度数据PDF，自动生成综合温度曲线图。" },
    ],
  }),
  component: TempPage,
});

const STORAGE_KEY = "temp-records-v1";
const COLORS = [
  "#2563eb", "#16a34a", "#ea580c", "#7c3aed", "#0891b2",
  "#db2777", "#ca8a04", "#0d9488", "#9333ea", "#0ea5e9",
];

function formatDuration(start: string, end: string): string {
  if (!start || !end) return "-";
  const s = new Date(start.replace(" ", "T")).getTime();
  const e = new Date(end.replace(" ", "T")).getTime();
  if (isNaN(s) || isNaN(e) || e < s) return "-";
  let diff = Math.floor((e - s) / 1000);
  const days = Math.floor(diff / 86400); diff -= days * 86400;
  const hours = Math.floor(diff / 3600); diff -= hours * 3600;
  const mins = Math.floor(diff / 60);
  let out = "";
  if (days > 0) out += `${days}天`;
  if (hours > 0) out += `${hours}h`;
  out += `${mins}mins`;
  return out;
}

function makeDemo(): TempRecord[] {
  const out: TempRecord[] = [];
  for (let d = 0; d < 3; d++) {
    const points = [];
    const start = new Date(2026, 0, 22, 10, 0, 0);
    for (let i = 0; i < 48; i++) {
      const t = new Date(start.getTime() + i * 30 * 60 * 1000);
      const time = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:00`;
      points.push({ time, temp: +(4 + d + Math.sin(i / 4) * 1.5 + Math.random() * 0.4).toFixed(2) });
    }
    const temps = points.map((p) => p.temp);
    out.push({
      fileName: `demo-device-${d + 1}.pdf`,
      deviceId: `T7-A0${d + 1}`,
      start: points[0].time,
      end: points[points.length - 1].time,
      highest: Math.max(...temps),
      lowest: Math.min(...temps),
      average: +(temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(2),
      dataPoints: points.length,
      points,
    });
  }
  return out;
}

function TempPage() {
  const [records, setRecords] = useState<TempRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [upper, setUpper] = useState<string>("8");
  const [lower, setLower] = useState<string>("2");
  const [showLimits, setShowLimits] = useState(false);
  const chartRef = useRef<any>(null);

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
    const newRecs: TempRecord[] = [];
    for (const f of Array.from(files)) {
      try {
        const text = await extractPdfText(f);
        const rec = parseTemperaturePdf(text, f.name);
        if (rec.points.length === 0) {
          toast.error(`${f.name}：未识别到数据点`);
          failed++;
          continue;
        }
        newRecs.push(rec);
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
    toast.success(`成功解析 ${success} 个文件${failed ? `，失败 ${failed} 个` : ""}`);
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

  const chartOption = useMemo(() => {
    const series: any[] = records.map((r, i) => ({
      name: r.deviceId,
      type: "line",
      showSymbol: false,
      lineStyle: { width: 2.25, type: "solid" },
      itemStyle: { color: COLORS[i % COLORS.length] },
      data: r.points.map((p) => [p.time, p.temp]),
    }));
    if (showLimits) {
      const u = parseFloat(upper);
      const l = parseFloat(lower);
      if (!isNaN(u))
        series.push({
          name: "上限",
          type: "line",
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: "#dc2626", width: 1, type: "solid" },
            data: [{ yAxis: u, label: { formatter: `上限 ${u}°C` } }],
          },
          data: [],
        });
      if (!isNaN(l))
        series.push({
          name: "下限",
          type: "line",
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: "#dc2626", width: 1, type: "solid" },
            data: [{ yAxis: l, label: { formatter: `下限 ${l}°C` } }],
          },
          data: [],
        });
    }
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, type: "scroll" },
      grid: { left: 50, right: 30, top: 40, bottom: 60 },
            xAxis: {
        type: "time",
        axisLabel: {
          rotate: 45,
          interval: (() => {
            let total = 0;
            records.forEach((r) => total += r.points.length);
            if (total <= 200) return 0;
            if (total <= 1000) return 3;
            if (total <= 3000) return 5;
            return 8;
          })(),
          formatter: (value: number) => {
            const d = new Date(value);
            const Y = d.getFullYear();
            const M = String(d.getMonth() + 1).padStart(2, "0");
            const D = String(d.getDate()).padStart(2, "0");
            const h = String(d.getHours()).padStart(2, "0");
            const m = String(d.getMinutes()).padStart(2, "0");
            return `${Y}/${M}/${D} ${h}:${m}`;
          },
        },
        minInterval: 2 * 60 * 1000,
        splitNumber: (() => {
          if (records.length === 0) return 10;
          let minT = Infinity, maxT = -Infinity;
          records.forEach((r) => r.points.forEach((p) => {
            const ts = new Date(p.time).getTime();
            if (ts < minT) minT = ts;
            if (ts > maxT) maxT = ts;
          }));
          const spanH = (maxT - minT) / 3600000;
          if (spanH <= 2) return Math.ceil(spanH * 6);
          if (spanH <= 6) return Math.ceil(spanH * 2);
          if (spanH <= 24) return Math.ceil(spanH);
          if (spanH <= 72) return Math.ceil(spanH / 3);
          if (spanH <= 168) return Math.ceil(spanH / 6);
          return Math.ceil(spanH / 12);
        })(),
      },
      
            yAxis: {
        type: "value",
        name: "°C",
        min: (() => {
          const u = parseFloat(upper);
          const l = parseFloat(lower);
          let minVal = Infinity;
          records.forEach((r) => r.points.forEach((p) => { if (p.temp < minVal) minVal = p.temp; }));
          if (!isNaN(l) && l < minVal) minVal = l;
          return isFinite(minVal) ? Math.floor(minVal - 1) : undefined;
        })(),
        max: (() => {
          const u = parseFloat(upper);
          const l = parseFloat(lower);
          let maxVal = -Infinity;
          records.forEach((r) => r.points.forEach((p) => { if (p.temp > maxVal) maxVal = p.temp; }));
          if (!isNaN(u) && u > maxVal) maxVal = u;
          return isFinite(maxVal) ? Math.ceil(maxVal + 1) : undefined;
        })(),
      },
      dataZoom: [
        { type: "inside" },
        { type: "slider", height: 20, bottom: 10 },
      ],
      series,
    };
  }, [records, showLimits, upper, lower]);

  function generateChart() {
    if (!upper || !lower) {
      toast.error("请先输入上限和下限温度");
      return;
    }
    setShowLimits(true);
    toast.success("已生成综合温度曲线图");
  }

  function exportExcel() {
    const allTimes = new Set<string>();
    records.forEach((r) => r.points.forEach((p) => allTimes.add(p.time)));
    const sorted = Array.from(allTimes).sort();
    const u = parseFloat(upper);
    const l = parseFloat(lower);
    const header = ["时间", ...records.map((r) => r.deviceId), "上限", "下限"];
    const rows = sorted.map((t) => {
      const row: any[] = [t];
      for (const r of records) {
        const p = r.points.find((pt) => pt.time === t);
        row.push(p ? p.temp : "");
      }
      row.push(isNaN(u) ? "" : u);
      row.push(isNaN(l) ? "" : l);
      return row;
    });
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const summary = [
      ["文件名", "设备号", "开始时间", "结束时间", "数据点数", "最高温", "最低温", "平均温"],
      ...records.map((r) => [r.fileName, r.deviceId, r.start, r.end, r.dataPoints, r.highest, r.lowest, r.average]),
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(summary);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "综合温度数据");
    XLSX.utils.book_append_sheet(wb, ws2, "汇总");
    XLSX.writeFile(wb, "综合温度数据.xlsx");
  }

  function exportPng() {
    const inst = chartRef.current?.getEchartsInstance();
    if (!inst) return;
    const url = inst.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: "#fff",
    });
    // Resize to 1200x600
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 600;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 1200, 600);
      ctx.drawImage(img, 0, 0, 1200, 600);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = "温度曲线图.png";
      a.click();
    };
    img.src = url;
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
            <div key={s.label} className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-all p-5 border border-slate-100" style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
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
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">批量上传温度数据PDF</h2>
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
            <p className="text-sm font-medium text-slate-600">点击或拖拽 PDF 文件到此处</p>
            <p className="text-xs text-slate-400 mt-1">可批量上传多个文件</p>
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">解析结果汇总</h2>
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
                导出综合温度数据Excel
              </Button>
            </div>
          </div>
          <div className="overflow-auto max-h-[500px] rounded-2xl border border-slate-200">
            <Table>
              <TableHeader className="bg-slate-100 sticky top-0 z-10">
                <TableRow className="hover:bg-transparent border-slate-200">
                  <TableHead className="py-4 px-5 text-sm font-semibold text-slate-700 w-[220px]">文件名</TableHead>
                  <TableHead className="py-4 px-5 text-sm font-semibold text-slate-700 w-[120px]">设备号</TableHead>
                  <TableHead className="py-4 px-5 text-sm font-semibold text-slate-700 w-[170px]">开始时间</TableHead>
                  <TableHead className="py-4 px-5 text-sm font-semibold text-slate-700 w-[170px]">结束时间</TableHead>
                  <TableHead className="py-4 px-5 text-sm font-semibold text-slate-700 w-[130px]">运输时长</TableHead>
                  <TableHead className="py-4 px-5 text-right text-sm font-semibold text-slate-700 w-[90px]">数据点数</TableHead>
                  <TableHead className="py-4 px-5 text-right text-sm font-semibold text-slate-700 w-[90px]">最高温</TableHead>
                  <TableHead className="py-4 px-5 text-right text-sm font-semibold text-slate-700 w-[90px]">最低温</TableHead>
                  <TableHead className="py-4 px-5 text-right text-sm font-semibold text-slate-700 w-[90px]">平均温</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r, i) => (
                  <TableRow key={i} className="hover:bg-slate-50 border-b border-slate-100">
                    <TableCell className="py-4 px-5 font-mono text-xs text-slate-500 w-[220px] truncate">{r.fileName}</TableCell>
                    <TableCell className="py-4 px-5 font-medium text-slate-900 w-[120px]">{r.deviceId}</TableCell>
                    <TableCell className="py-4 px-5 text-xs tabular-nums text-slate-700 w-[170px]">{r.start}</TableCell>
                    <TableCell className="py-4 px-5 text-xs tabular-nums text-slate-700 w-[170px]">{r.end}</TableCell>
                    <TableCell className="py-4 px-5 text-sm font-semibold text-blue-600 tabular-nums w-[130px]">{formatDuration(r.start, r.end)}</TableCell>
                    <TableCell className="py-4 px-5 text-right tabular-nums text-slate-700 w-[90px]">{r.dataPoints}</TableCell>
                    <TableCell className="py-4 px-5 text-right tabular-nums font-medium text-red-600 w-[90px]">{r.highest}°C</TableCell>
                    <TableCell className="py-4 px-5 text-right tabular-nums font-medium text-blue-600 w-[90px]">{r.lowest}°C</TableCell>
                    <TableCell className="py-4 px-5 text-right tabular-nums font-medium text-slate-900 w-[90px]">{r.average}°C</TableCell>
                  </TableRow>
                ))}
                {!filtered.length && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-slate-400 py-16">
                      暂无数据
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">综合温度曲线图</h2>
              <p className="text-sm text-slate-500 mt-1">输入上下限温度后生成多设备叠加曲线</p>
            </div>
            <div className="flex gap-3 items-center flex-wrap">
              <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 h-10 border border-slate-200">
                <span className="text-xs font-medium text-slate-500">上限</span>
                <Input
                  type="number"
                  step="0.1"
                  value={upper}
                  onChange={(e) => setUpper(e.target.value)}
                  className="w-20 h-7 border-0 bg-white shadow-sm tabular-nums"
                />
                <span className="text-xs text-slate-500">°C</span>
              </div>
              <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 h-10 border border-slate-200">
                <span className="text-xs font-medium text-slate-500">下限</span>
                <Input
                  type="number"
                  step="0.1"
                  value={lower}
                  onChange={(e) => setLower(e.target.value)}
                  className="w-20 h-7 border-0 bg-white shadow-sm tabular-nums"
                />
                <span className="text-xs text-slate-500">°C</span>
              </div>
              <Button onClick={generateChart} disabled={!records.length} className="h-10 rounded-xl bg-blue-600 hover:bg-blue-700">
                生成曲线图
              </Button>
              <Button variant="outline" onClick={exportPng} disabled={!records.length} className="h-10 rounded-xl">
                <ImageDown className="mr-1.5 h-4 w-4" />
                导出PNG图片
              </Button>
            </div>
          </div>
          <div className="bg-slate-50/50 rounded-2xl border border-slate-200 p-4">
            <ReactECharts
              ref={chartRef}
              option={chartOption}
              style={{ height: 560, width: "100%" }}
              notMerge
            />
          </div>
        </section>
      </main>
    </div>
  );
}

