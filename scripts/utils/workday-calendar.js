// Mainland China national calendar. Reviewed 2026-09-28; no network dependency.
// Annual updates: docs/payday-calendar.md. Never infer an unpublished year.
export const CALENDAR_SOURCES = Object.freeze({
  2025: "https://www.forestry.gov.cn/c/www/szxx/594663.jhtml",
  2026: "https://www.beijing.gov.cn/cs/gncs/zcwj/202603/t20260327_4568275.html"
});
const CALENDARS = {
  2025: {
    holidays: [["01-01", "01-01"], ["01-28", "02-04"], ["04-04", "04-06"],
      ["05-01", "05-05"], ["05-31", "06-02"], ["10-01", "10-08"]],
    workdays: ["01-26", "02-08", "04-27", "09-28", "10-11"]
  },
  2026: {
    holidays: [["01-01", "01-03"], ["02-15", "02-23"], ["04-04", "04-06"],
      ["05-01", "05-05"], ["06-19", "06-21"], ["09-25", "09-27"], ["10-01", "10-07"]],
    workdays: ["01-04", "02-14", "02-28", "05-09", "09-20", "10-10"]
  }
};

export class CalendarUnavailableError extends Error {
  constructor(year) {
    super(`${year}年工作日日历待更新`);
    this.name = "CalendarUnavailableError";
    this.year = year;
  }
}

export function isChinaWorkday({ year, month, day }) {
  const calendar = CALENDARS[year];
  if (!calendar) throw new CalendarUnavailableError(year);
  const key = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (calendar.workdays.includes(key)) return true;
  if (calendar.holidays.some(([start, end]) => key >= start && key <= end)) return false;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}
