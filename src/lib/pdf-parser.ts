export async function extractPdfText(file: File): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("PDF parsing is only supported in browser environment");
  }
  
  const pdfjsLib = await import("pdfjs-dist");
  // @ts-ignore
  const { default: workerSrc } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
  
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
  duration: string; // 运输时长，格式：xx天xxhxxmins
  highest: number;
  lowest: number;
  average: number;
  dataPoints: number;
  points: TempPoint[];
}

// 辅助函数：计算时长（End - Start）
function calculateDuration(start: string, end: string): string {
  if (!start || !end) return "";
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return "";
  
  const diffMs = endDate.getTime() - startDate.getTime();
  if (diffMs < 0) return "";
  
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  return `${days}天${hours}h${minutes}mins`;
}

// 辅助函数：解析中文时长格式（如 "5天19小时52分0秒"）
function parseChineseDuration(durationStr: string): string {
  if (!durationStr) return "";
  const dayMatch = durationStr.match(/(\d+)\s*天/);
  const hourMatch = durationStr.match(/(\d+)\s*小时/);
  const minMatch = durationStr.match(/(\d+)\s*分/);
  
  const days = dayMatch ? parseInt(dayMatch[1]) : 0;
  const hours = hourMatch ? parseInt(hourMatch[1]) : 0;
  const minutes = minMatch ? parseInt(minMatch[1]) : 0;
  
  return `${days}天${hours}h${minutes}mins`;
}

// Parse "YY-MM-DD HH:MM:SS" → "20YY-MM-DD HH:MM:SS" (validated, UTC-safe)
export function parseTemperaturePdf(text: string, fileName: string): TempRecord {
  // 判断格式：格式二中文文件包含"冷链监控数据报告"或"温度曲线表"等关键词
  const isChineseFormat = /冷链监控数据报告|温度曲线表|运输信息|发货单位/.test(text);
  
  // 提取8位设备号（C或T开头，8位字母数字）
  const extractDeviceId8 = (txt: string, pattern: RegExp): string => {
    const match = txt.match(pattern);
    if (match) {
      const id = match[1].trim();
      // 确保是8位
      const idMatch = id.match(/^[CT][A-Za-z0-9]{7}$/);
      if (idMatch) return id.toUpperCase();
    }
    return "";
  };

  if (isChineseFormat) {
    // ========== 格式二：中文格式（CCTSCHINA 冷链监控数据报告） ==========
    
    // 1. 设备号：查询"设备号"后面的8位大写字母和数字（如 T034C0FD、CD68B038）
    let deviceId = "";
    // 优先匹配"设备号"后面的内容，直接在regex内部限制格式
    const devMatch = text.match(
      /设备号[\s：:]*([CT][A-Za-z0-9]{7})/i
    );
    if (devMatch) {
      deviceId = devMatch[1].toUpperCase();
    }
    // fallback：全文搜索 C 或 T 开头的8位字母数字
    if (!deviceId) {
      const globalMatch = text.match(
        /\b([CT][A-Za-z0-9]{7})\b/i
      );
      if (globalMatch) {
        deviceId = globalMatch[1].toUpperCase();
      }
    }

    // 2. 开始时间：查询"采集开始时间"后面的内容（格式：2026-01-27 14:10:00）
    let start = "";
    const startMatch = text.match(/采集开始时间[：:\s]+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
    if (startMatch) start = startMatch[1];

    // 3. 结束时间：查询"采集结束时间"后面的内容（格式：2026-02-02 10:02:00）
    let end = "";
    const endMatch = text.match(/采集结束时间[：:\s]+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
    if (endMatch) end = endMatch[1];

    // 4. 运输时长：查询"采集时长"后面的内容（如"5天19小时52分0秒"），或计算
    let duration = "";
    const durationMatch = text.match(/采集时长[：:\s]+([\d天小时分秒]+)/);
    if (durationMatch) {
      duration = parseChineseDuration(durationMatch[1]);
    } else if (start && end) {
      duration = calculateDuration(start, end);
    }

    // 5. 数据点数：查询"温度记录次数"后面的数字
    let dataPoints = 0;
    const dpMatch = text.match(/温度记录次数[：:\s]*(\d+)/);
    if (dpMatch) dataPoints = parseInt(dpMatch[1], 10);

    // 6. 最高温：查询"最高温度"后面的数字
    let highest = 0;
    const highMatch = text.match(/最高温度[：:\s]*(-?\d+\.?\d*)/);
    if (highMatch) highest = parseFloat(highMatch[1]);

    // 7. 最低温：查询"最低温度"后面的数字
    let lowest = 0;
    const lowMatch = text.match(/最低温度[：:\s]*(-?\d+\.?\d*)/);
    if (lowMatch) lowest = parseFloat(lowMatch[1]);

    // 8. 平均温：查询"平均温度"后面的数字
    let average = 0;
    const avgMatch = text.match(/平均温度[：:\s]*(-?\d+\.?\d*)/);
    if (avgMatch) average = parseFloat(avgMatch[1]);

    // 9. 提取所有数据点
    const points: TempPoint[] = [];
    
    // 先尝试匹配完整日期+时间+温度
    const fullReg = /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(-?\d+\.?\d*)/g;
    let match: RegExpExecArray | null;
    let currentDate = "";
    
    while ((match = fullReg.exec(text)) !== null) {
      const datePart = match[1];
      const timePart = match[2];
      const tempVal = parseFloat(match[3]);
      
      if (!isFinite(tempVal)) continue;
      
      currentDate = datePart;
      points.push({ time: `${datePart} ${timePart}`, temp: tempVal });
    }
    
    // 匹配只有时间+温度的行
    const timeOnlyReg = /(?<!\d{4}-\d{2}-\d{2}\s)(\d{2}:\d{2}:\d{2})\s+(-?\d+\.?\d*)/g;
    while ((match = timeOnlyReg.exec(text)) !== null) {
      const timePart = match[1];
      const tempVal = parseFloat(match[2]);
      
      if (!isFinite(tempVal)) continue;
      if (!currentDate) continue;
      
      const fullTime = `${currentDate} ${timePart}`;
      if (!points.some(p => p.time === fullTime)) {
        points.push({ time: fullTime, temp: tempVal });
      }
    }

    // 去重并排序
    const seen = new Set<string>();
    const uniqPoints: TempPoint[] = [];
    for (const p of points) {
      if (!seen.has(p.time)) {
        seen.add(p.time);
        uniqPoints.push(p);
      }
    }
    uniqPoints.sort((a, b) => a.time.localeCompare(b.time));

    // 如果查询不到统计值，从数据点计算
    if (uniqPoints.length > 0) {
      if (!start) start = uniqPoints[0].time;
      if (!end) end = uniqPoints[uniqPoints.length - 1].time;
      if (!duration && start && end) duration = calculateDuration(start, end);
      
      const temps = uniqPoints.map((p) => p.temp);
      if (!highest) highest = Math.max(...temps);
      if (!lowest) lowest = Math.min(...temps);
      if (!average) average = +(temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(2);
      if (!dataPoints) dataPoints = uniqPoints.length;
    }

    if (typeof window !== "undefined") {
      console.log(`[中文PDF解析] ${fileName} 设备号=${deviceId}, 数据点=${uniqPoints.length}`);
    }

    return {
      fileName,
      deviceId: deviceId || "",
      start,
      end,
      duration,
      highest,
      lowest,
      average,
      dataPoints,
      points: uniqPoints,
    };
  }

  // ========== 格式一：英文格式（Frigga T7 DataReport） ==========

  // 1. 设备号：查询"Device ID"后面的T开头8位大写字母和数字（如 T034C0FD、T047A243）
  let deviceId = "";
  const devMatch = text.match(/Device\s*ID[：:\s]+([A-Za-z0-9]+)/i);
  if (devMatch) {
    const id = devMatch[1].trim();
    // 仅匹配T开头的8位字母数字
    const idMatch = id.match(/^([T][A-Za-z0-9]{7})$/);
    if (idMatch) deviceId = idMatch[1].toUpperCase();
  }
  // 如果上面没找到，全局搜索 T 开头的8位字母数字
  if (!deviceId) {
    const globalMatch = text.match(/\b([T][A-Za-z0-9]{7})\b/);
    if (globalMatch) deviceId = globalMatch[1].toUpperCase();
  }

  // 2. 开始时间：查询"Start:"后面的内容（格式：26-01-27 14:08:51），仅提取时间
  let start = "";
  const startMatch = text.match(/Start[:\s]+(?:.*?\s)?(\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/i);
  if (startMatch) {
    const parsed = parseYYMMDD(startMatch[1].split(' ')[0], startMatch[1].split(' ')[1]);
    if (parsed) start = parsed;
  }

  // 3. 结束时间：查询"End:"后面的内容（格式：26-01-27 17:46:54），仅提取时间
  let end = "";
  const endMatch = text.match(/End[:\s]+(?:.*?\s)?(\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/i);
  if (endMatch) {
    const parsed = parseYYMMDD(endMatch[1].split(' ')[0], endMatch[1].split(' ')[1]);
    if (parsed) end = parsed;
  }

  // 4. 运输时长：计算 End - Start
  let duration = "";
  if (start && end) {
    duration = calculateDuration(start, end);
  }

  // 5. 数据点数：查询"Data Points:"后面的数字
  let dataPoints = 0;
  const dpMatch = text.match(/Data\s*Points[:\s]*(\d+)/i);
  if (dpMatch) dataPoints = parseInt(dpMatch[1], 10);

  // 6. 最高温：查询"Highest Temperature:"后面的数字
  let highest = 0;
  const highMatch = text.match(/Highest\s*Temperature[:\s]*(-?\d+\.?\d*)/i);
  if (highMatch) highest = parseFloat(highMatch[1]);

  // 7. 最低温：查询"Lowest Temperature:"后面的数字
  let lowest = 0;
  const lowMatch = text.match(/Lowest\s*Temperature[:\s]*(-?\d+\.?\d*)/i);
  if (lowMatch) lowest = parseFloat(lowMatch[1]);

  // 8. 平均温：查询"Average:"后面的数字
  let average = 0;
  const avgMatch = text.match(/Average[:\s]*(-?\d+\.?\d*)/i);
  if (avgMatch) average = parseFloat(avgMatch[1]);

  // 9. 提取所有数据点
  const points2: TempPoint[] = [];
  const re = /(\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(-?\d+(?:\.\d+)?)/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(text)) !== null) {
    const iso = parseYYMMDD(mm[1], mm[2]);
    if (!iso) continue;
    const temp = parseFloat(mm[3]);
    if (!isFinite(temp)) continue;
    points2.push({ time: iso, temp });
  }

  // 去重并排序
  const seen2 = new Set<string>();
  const uniq2: TempPoint[] = [];
  for (const p of points2) {
    if (seen2.has(p.time)) continue;
    seen2.add(p.time);
    uniq2.push(p);
  }
  uniq2.sort((a, b) => a.time.localeCompare(b.time));

  // 如果查询不到统计值，从数据点计算
  if (uniq2.length > 0) {
    if (!start) start = uniq2[0].time;
    if (!end) end = uniq2[uniq2.length - 1].time;
    if (!duration && start && end) duration = calculateDuration(start, end);
    
    const temps = uniq2.map((p) => p.temp);
    if (!highest) highest = Math.max(...temps);
    if (!lowest) lowest = Math.min(...temps);
    if (!average) average = +(temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(2);
    if (!dataPoints) dataPoints = uniq2.length;
  }

  if (typeof window !== "undefined") {
    console.log(`[英文PDF解析] ${fileName} 设备号=${deviceId}, 数据点=${uniq2.length}`);
  }

  return {
    fileName,
    deviceId: deviceId || "",
    start,
    end,
    duration,
    highest,
    lowest,
    average,
    dataPoints,
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
  // 从最后一页提取"校准结果"下面的"示值误差"表格
  // 大标题：校准结果（Results of Calibration）
  // 小标题：示值误差（Indication Error） 或 示值误差校准（Error of indication）
  let errors: number[] = [];
  
  // 查找校准结果部分
  const calibrationResultMatch = text.match(/校准结果|Results\s+of\s+Calibration/i);
  if (calibrationResultMatch) {
    const startIndex = calibrationResultMatch.index!;
    const resultSection = text.substring(startIndex);
    
    // 查找示值误差小标题
    const errorTitleMatch = resultSection.match(/示值误差(校准)?\s*(?:\(Indication\s+Error\))?|Error\s+of\s+indication/i);
    if (errorTitleMatch) {
      const errorStartIndex = errorTitleMatch.index!;
      let errorSection = resultSection.substring(errorStartIndex);
      
      // 提取到下一个空行或表格结束
      const emptyLineMatch = errorSection.match(/\n\s*\n/);
      if (emptyLineMatch) {
        errorSection = errorSection.substring(0, emptyLineMatch.index!);
      }
      
      // 提取表格中的数值
      // 格式一（4页）：示值误差（error）列
      // 格式二（3页）：示值误差（Indication Error）列
      const errorValues = errorSection.match(/[+-]?\d+\.\d+/g);
      if (errorValues) {
        errors = errorValues.map((n) => parseFloat(n)).filter((n) => Math.abs(n) <= 10);
      }
    }
  }
  
  // 如果上面没找到，回退到全文搜索"示值误差"附近的值
  if (!errors.length) {
    const errorSection = text.match(/示值误差[\s\S]*?(?=\n\s*\n|$)/i);
    if (errorSection) {
      const errorNums = errorSection[0].match(/([+-]?\d+\.\d+)/g);
      if (errorNums) {
        errors = errorNums.map((n) => parseFloat(n)).filter((n) => Math.abs(n) <= 10);
      }
    }
  }
  
  // 如果还是没找到，回退到全文搜索
  if (!errors.length) {
    const allNums = Array.from(text.matchAll(/-?\d+\.\d+/g)).map((m) => parseFloat(m[0]));
    errors = allNums.filter((n) => Math.abs(n) <= 10);
  }

  // 计算最大误差（保留符号信息）
  let maxError = 0;
  if (errors.length) {
    // 找到绝对值最大的值
    const maxAbs = Math.max(...errors.map(Math.abs));
    // 检查是否同时存在正负两个方向的最大值
    const hasPositive = errors.some(e => Math.abs(e - maxAbs) < 0.001);
    const hasNegative = errors.some(e => Math.abs(e + maxAbs) < 0.001);
    
    if (hasPositive && hasNegative) {
      // 如果同时存在正负两个方向的最大值，返回正值（显示时会处理为±）
      maxError = maxAbs;
    } else if (hasPositive) {
      maxError = maxAbs;
    } else if (hasNegative) {
      maxError = -maxAbs;
    } else {
      maxError = errors.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), errors[0]);
    }
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
