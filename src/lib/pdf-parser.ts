import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
}

export async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Group items by y to form lines
    const items = content.items as any[];
    const lines: { y: number; texts: { x: number; s: string }[] }[] = [];
    for (const it of items) {
      const x = it.transform[4];
      const y = Math.round(it.transform[5]);
      let line = lines.find((l) => Math.abs(l.y - y) < 3);
      if (!line) {
        line = { y, texts: [] };
        lines.push(line);
      }
      line.texts.push({ x, s: it.str });
    }
    lines.sort((a, b) => b.y - a.y);
    for (const l of lines) {
      l.texts.sort((a, b) => a.x - b.x);
      fullText += l.texts.map((t) => t.s).join(" ") + "\n";
    }
    fullText += "\n";
  }
  return fullText;
}

function parseYYMMDD(date: string, time: string): string | null {
  const dm = date.match(/^(\d{2})-(\d{2})-(\d{2})$/);
  const tm = time.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!dm || !tm) return null;
  const yy = +dm[1], mo = +dm[2], dd = +dm[3];
  const hh = +tm[1], mi = +tm[2], ss = +tm[3];
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31 || hh > 23 || mi > 59 || ss > 59) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${2000 + yy}-${p(mo)}-${p(dd)} ${p(hh)}:${p(mi)}:${p(ss)}`;
}

// ---- Temperature PDF (Frigga T7 4G) ----
export interface TempPoint {
  time: string; // YYYY-MM-DD HH:mm:ss
  temp: number;
}
export interface TempRecord {
  fileName: string;
  deviceId: string;
  start: string;
  end: string;
  highest: number;
  lowest: number;
  average: number;
  dataPoints: number;
  points: TempPoint[];
}

// Parse "YY-MM-DD HH:MM:SS" → "20YY-MM-DD HH:MM:SS" (validated, UTC-safe)
export function parseTemperaturePdf(text: string, fileName: string): TempRecord {
  // 通过内容判断是否为中文格式（C1/C2 类 PDF）
  const isChineseFormat = /温度曲线表/.test(text);

  if (isChineseFormat) {
    // ========== 中文格式解析 ==========
    
    // 1. 设备号：从"设备号："后面提取
    let deviceId = "";
    const devMatch = text.match(/设备号[：:]\s*([A-Za-z0-9\-_]+)/);
    if (devMatch) {
      deviceId = devMatch[1].trim();
    } else {
      const shipmentBlock = text.match(/发货单位[\s\S]{0,200}设备号[：:]\s*([A-Za-z0-9\-_]+)/);
      if (shipmentBlock) {
        deviceId = shipmentBlock[1].trim();
      }
    }

    // 2. 提取所有数据点
    // C类 PDF 的数据排列特点：
    // - 有些行是完整格式：2026-01-27 14:12:00 5.1 2026-01-27 14:14:00 5.1 ...
    // - 有些行只有时间+温度：14:12:00 5.1 14:14:00 5.1 ...（日期继承上一行）
    const points: TempPoint[] = [];
    
    // 先尝试匹配完整日期+时间+温度
    const fullReg = /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(-?\d+\.?\d*)/g;
    let match: RegExpExecArray | null;
    let currentDate = ""; // 跟踪最近的日期
    
    while ((match = fullReg.exec(text)) !== null) {
      const datePart = match[1];
      const timePart = match[2];
      const tempVal = parseFloat(match[3]);
      
      if (!isFinite(tempVal) || tempVal < -80 || tempVal > 120) continue;
      
      currentDate = datePart; // 记住当前日期
      points.push({ time: `${datePart} ${timePart}`, temp: tempVal });
    }
    
    // 匹配只有时间+温度的行（格式如 "14:12:00 5.1"）
    const timeOnlyReg = /(?<!\d{4}-\d{2}-\d{2}\s)(\d{2}:\d{2}:\d{2})\s+(-?\d+\.?\d*)/g;
    while ((match = timeOnlyReg.exec(text)) !== null) {
      const timePart = match[1];
      const tempVal = parseFloat(match[2]);
      
      if (!isFinite(tempVal) || tempVal < -80 || tempVal > 120) continue;
      if (!currentDate) continue; // 如果没有日期上下文则跳过
      
      // 检查这个时间点是否已经存在
      const fullTime = `${currentDate} ${timePart}`;
      if (!points.some(p => p.time === fullTime)) {
        points.push({ time: fullTime, temp: tempVal });
      }
    }

    // 3. 去重
    const seen = new Set<string>();
    const uniqPoints: TempPoint[] = [];
    for (const p of points) {
      if (!seen.has(p.time)) {
        seen.add(p.time);
        uniqPoints.push(p);
      }
    }

    // 4. 计算汇总数据
    let start = "";
    let end = "";
    let highest = 0;
    let lowest = 0;
    let average = 0;

    if (uniqPoints.length > 0) {
      const sorted = [...uniqPoints].sort((a, b) => a.time.localeCompare(b.time));
      start = sorted[0].time;
      end = sorted[sorted.length - 1].time;
      const temps = uniqPoints.map((p) => p.temp);
      highest = Math.max(...temps);
      lowest = Math.min(...temps);
      average = +(temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(2);
    }

    if (typeof window !== "undefined") {
      console.log(`[中文PDF解析] ${fileName} 数据点=${uniqPoints.length}, 设备号=${deviceId}`);
    }

    return {
      fileName,
      deviceId: deviceId || fileName,
      start,
      end,
      highest,
      lowest,
      average,
      dataPoints: uniqPoints.length,
      points: uniqPoints,
    };
  }

  // ========== 以下是 Frigga T7 英文格式解析（保持原有逻辑） ==========

  const get = (re: RegExp) => {
    const m = text.match(re);
    return m ? m[1].trim() : "";
  };

  const deviceId = get(/Device\s*ID[:\s]+([A-Za-z0-9\-_]+)/i);
  const highest = parseFloat(get(/Highest\s*Temperature[:\s]+(-?\d+\.?\d*)/i) || "0");
  const lowest = parseFloat(get(/Lowest\s*Temperature[:\s]+(-?\d+\.?\d*)/i) || "0");
  const average = parseFloat(get(/Average[:\s]+(-?\d+\.?\d*)/i) || "0");
  const dataPoints = parseInt(get(/Data\s*Points[:\s]+(\d+)/i) || "0", 10);

  if (typeof window !== "undefined") {
    const firstLines = text.split("\n").filter((l) => l.trim()).slice(0, 10);
    console.log(`[PDF解析] ${fileName} 前10行:`, firstLines);
  }

  const points2: TempPoint[] = [];
  const re = /(\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(-?\d+(?:\.\d+)?)/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(text)) !== null) {
    const iso = parseYYMMDD(mm[1], mm[2]);
    if (!iso) continue;
    const temp = parseFloat(mm[3]);
    if (!isFinite(temp) || temp < -80 || temp > 120) continue;
    points2.push({ time: iso, temp });
  }

  const seen2 = new Set<string>();
  const uniq2: TempPoint[] = [];
  for (const p of points2) {
    if (seen2.has(p.time)) continue;
    seen2.add(p.time);
    uniq2.push(p);
  }

  let start = "";
  let end = "";
  if (uniq2.length) {
    const sorted = [...uniq2].sort((a, b) => a.time.localeCompare(b.time));
    start = sorted[0].time;
    end = sorted[sorted.length - 1].time;
  }

  if (typeof window !== "undefined") {
    console.log(`[PDF解析] ${fileName} 数据点=${uniq2.length}, 开始=${start}, 结束=${end}`);
  }

  return {
    fileName,
    deviceId: deviceId || fileName,
    start,
    end,
    highest,
    lowest,
    average,
    dataPoints: dataPoints || uniq2.length,
    points: uniq2,
  };
}
// ---- Calibration certificate ----
export interface CalRecord {
  fileName: string;
  deviceId: string;
  calDate: string; // YYYY-MM-DD
  nextCalDate: string;
  maxError: number;
  errors: number[];
}

function addYears(date: Date, years: number): Date {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}
function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}
function subDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}
function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseCalibrationPdf(text: string, fileName: string): CalRecord {
  const isFormatB = /上海鼎为物联|验证结果|设备编号/.test(text);

  // Helper to safely build a date
  const safeDate = (dateStr: string): Date | null => {
    if (!dateStr) return null;
    const d = new Date(dateStr + "T00:00:00");
    return isNaN(d.getTime()) ? null : d;
  };

  // ---- 设备号提取 ----
    // ---- 设备号提取 ----
  let deviceId = "";
  
  // 1) 优先匹配 "出厂编号" 后面跟着的 T 开头 + 6-7 位
  const factoryM = text.match(/出厂编号[:\s]*\b(T[A-Za-z0-9]{6,7})\b/);
  if (factoryM) deviceId = factoryM[1];
  
  // 2) 其次匹配 Serial No. 附近以 T 开头 + 6-7 位的值
  if (!deviceId) {
    const serialBlock = text.match(/Serial\s*No\.?[:\s]+([\s\S]{0,30})/i);
    if (serialBlock) {
      const tm = serialBlock[1].match(/\b(T[A-Za-z0-9]{6,7})\b/);
      if (tm) deviceId = tm[1];
    }
  }
  
  // 3) 回退：全文搜索 T 开头 + 6-7 位
  if (!deviceId) {
    const looseM = text.match(/\b(T[A-Za-z0-9]{6,7})\b/);
    if (looseM && looseM[1] !== "Testing" && looseM[1] !== "Technique") {
      deviceId = looseM[1];
    }
  }
  
  // 4) 最后从文件名提取
  if (!deviceId) {
    const fnM = fileName.match(/\b(T[A-Za-z0-9]{6,7})\b/i);
    deviceId = fnM ? fnM[1].toUpperCase() : fileName;
  }

  // ---- 误差提取 ----
  // 从最后一页提取"示值误差"列中的值
  const errorSection = text.match(/示值误差[\s\S]*?(?=\n\s*\n|$)/i);
  let errors: number[] = [];
  if (errorSection) {
    const errorNums = errorSection[0].match(/([+-]?\d+\.\d+)/g);
    if (errorNums) {
      errors = errorNums.map((n) => parseFloat(n)).filter((n) => Math.abs(n) <= 5);
    }
  }
  // 如果上面没找到，回退到全文搜索
  if (!errors.length) {
    const allNums = Array.from(text.matchAll(/-?\d+\.\d+/g)).map((m) => parseFloat(m[0]));
    errors = allNums.filter((n) => Math.abs(n) <= 5);
  }

  let maxError = 0;
  if (errors.length) {
    maxError = errors.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), errors[0]);
  }

  // ---- 日期提取 ----
  let calDate = "";
  let nextCalDate = "";

  if (isFormatB) {
    // 格式B：广电计量
    // 优先匹配"校准日期"后面的 YYYY年MM月DD日
    const cnDateM = text.match(/校准日期[:\s]*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (cnDateM) {
      calDate = `${cnDateM[1]}-${String(parseInt(cnDateM[2])).padStart(2, "0")}-${String(parseInt(cnDateM[3])).padStart(2, "0")}`;
    } else {
      // 回退：YMD 前面的日期
      const ymdM = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日.*Y\s*M\s*D.*Cal\.?\s*Date/);
      if (ymdM) {
        calDate = `${ymdM[1]}-${String(parseInt(ymdM[2])).padStart(2, "0")}-${String(parseInt(ymdM[3])).padStart(2, "0")}`;
      } else {
        // 再回退：找第一个完整的 8 位日期数字，但排除温度值和证书编号
        const allDates = Array.from(text.matchAll(/(20\d{2})[年\-\/](\d{1,2})[月\-\/](\d{1,2})/g));
        for (const dm of allDates) {
          const y = parseInt(dm[1]);
          const m = parseInt(dm[2]);
          const d = parseInt(dm[3]);
          if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
            // 排除温度值范围（月份不会是 40-99）
            if (m <= 12) {
              calDate = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
              break;
            }
          }
        }
      }
    }
    if (calDate) {
      const d = safeDate(calDate);
      if (d) nextCalDate = fmt(subDays(addMonths(d, 12), 1));
    }
  } else {
    // 格式A：深圳天溯
    const dateM = text.match(/Cal\.?\s*Date[:\s]+(\d{4}[-\/]\d{2}[-\/]\d{2}|\d{2}[-\/]\d{2}[-\/]\d{4})/i);
    if (dateM) {
      const raw = dateM[1].replace(/\//g, "-");
      const parts = raw.split("-");
      if (parts[0].length === 4) calDate = raw;
      else calDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
    } else {
      const monthDayMatch = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
      if (monthDayMatch) {
        const month = parseInt(monthDayMatch[1]);
        const day = parseInt(monthDayMatch[2]);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          const issueMatch = text.match(/(?:发布日期|Issued\s*Date)[:\s]*(\d{4})/i);
          const receiptMatch = text.match(/(?:接收日期|Date\s*of\s*Receipt)[:\s]*(\d{4})/i);
          const yearMatch = issueMatch || receiptMatch;
          const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
          calDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        }
      }
    }
    if (calDate) {
      const d = safeDate(calDate);
      if (d) nextCalDate = fmt(subDays(addYears(d, 1), 1));
    }
  }

  return {
    fileName,
    deviceId,
    calDate,
    nextCalDate,
    maxError,
    errors,
  };
}
