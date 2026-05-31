// 日期辅助：纯函数，与 web 端 app-v2.js 4582-4625 对齐
function parseDate(value) {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const [y, m, d] = String(value).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatDate(d) {
  const v = parseDate(d);
  return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
}

function addDays(d, n) {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

function diffDays(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

function formatShort(d) {
  const v = d instanceof Date ? d : parseDate(d);
  return `${v.getMonth() + 1}/${v.getDate()}`;
}

function weekdayName(d) {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(d).getDay()];
}

function dayTitle(dateStr) {
  const diff = diffDays(formatDate(new Date()), dateStr);
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff === -1) return "昨天";
  if (diff === 2) return "后天";
  return dateStr;
}

function startOfWeek(date) {
  const d = parseDate(formatDate(date));
  // 周一为本周第 0 天
  return addDays(d, -((d.getDay() + 6) % 7));
}

function startOfMonth(date) {
  const d = date instanceof Date ? date : parseDate(date);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function getCalendarDays(monthDate) {
  const first = startOfMonth(monthDate);
  const offset = (first.getDay() + 6) % 7;
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function isPeriodOnToday(viewMode, anchorDate) {
  const today = new Date();
  const todayStr = formatDate(today);
  if (viewMode === "month") {
    return anchorDate.getFullYear() === today.getFullYear() && anchorDate.getMonth() === today.getMonth();
  }
  const start = viewMode === "week" ? startOfWeek(anchorDate) : parseDate(formatDate(anchorDate));
  const span = viewMode === "week" ? 7 : 3;
  for (let i = 0; i < span; i += 1) {
    if (formatDate(addDays(start, i)) === todayStr) return true;
  }
  return false;
}

module.exports = {
  parseDate,
  formatDate,
  addDays,
  diffDays,
  formatShort,
  weekdayName,
  dayTitle,
  startOfWeek,
  startOfMonth,
  getCalendarDays,
  isPeriodOnToday,
};
