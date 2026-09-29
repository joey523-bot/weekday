import { getNextSalaryDate, getDaysUntil } from './date.js';

export function isWeatherFresh(report, now = new Date()) {
  if (!report?.observedAt || !report.timezone) return false;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: report.timezone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(now).map(p => [p.type,p.value]));
    const localNow = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
    const observed = Date.parse(report.observedAt.replace(/Z$/, '') + 'Z');
    const age = localNow - observed;
    return Number.isFinite(age) && age >= -15 * 60000 && age <= 90 * 60000;
  } catch { return false; }
}

export function greetingFor({ salaryDay, weather, now = new Date() }) {
  const next = getNextSalaryDate(salaryDay, now);
  if (next && getDaysUntil(next, now) === 0) return '今天发薪，开心一下。';
  const fresh = isWeatherFresh(weather, now);
  if (fresh && (weather.weatherCode >= 95)) return '雷雨天气，出门多留意。';
  if (fresh && (weather.rain > 0 || weather.showers > 0 || weather.rainProbability >= 60)) return '带上雨伞，从容出门。';
  const hour = now.getHours();
  if (hour >= 5 && hour < 11) return '早上好，开启新的一天。';
  if (hour >= 11 && hour < 14) return '中午好，记得歇一会儿。';
  if (hour >= 14 && hour < 18) return '下午好，按自己的节奏来。';
  return '晚上好，留点时间给自己。';
}

export function moonPhaseInfo(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value)) || value < 0 || value > 1) return null;
  const phase = Number(value) % 1;
  const index = Math.round(phase * 8) % 8;
  return { phase, name: ['新月','峨眉月','上弦月','盈凸月','满月','亏凸月','下弦月','残月'][index], illumination: Math.round((1 - Math.cos(phase * 2 * Math.PI)) * 50) };
}

export function clothingFor(report) {
  const value = report?.apparentTemperature ?? report?.temperature;
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const today = report.dailyForecast?.[0];
  let kind = 'layer', title = '薄外套＋长裤';
  if (value >= 24) { kind = 'light'; title = '轻薄上衣＋长裤'; }
  else if (value < 16) { kind = 'warm'; title = '保暖外套＋长裤'; }
  const notes = [];
  if (Number.isFinite(today?.low) && Number.isFinite(today?.high) && today.high - today.low >= 8) notes.push('早晚温差较大，备一件可增减的外套');
  if (report.windSpeed >= 25) notes.push('风较大，外层优先防风');
  if (report.rainProbability >= 50 || report.rain > 0 || report.showers > 0) notes.push('有降雨可能，带伞并选择不易打滑的鞋');
  return {kind, title, detail: notes.join('；') || '按个人怕冷怕热程度增减，空调房可多备一层。', basis: `参考体感${Math.round(value)}°${Number.isFinite(today?.low) && Number.isFinite(today?.high) ? `、今日${Math.round(today.low)}°—${Math.round(today.high)}°` : ''}`};
}

export function moonFor(report, now = new Date()) {
  if (!report?.timezone) return null;
  let date;
  try { date = new Intl.DateTimeFormat('sv-SE', {timeZone:report.timezone}).format(now); } catch { return null; }
  const today = report.dailyForecast?.find(d => d.date === date);
  const phase = moonPhaseInfo(today?.moonPhase);
  if (!phase) return null;
  const nextDate = new Date(Date.parse(date) + 86400000).toISOString().slice(0,10);
  const tomorrow = report.dailyForecast?.find(d => d.date === nextDate);
  // For tonight, pair an evening rise with tomorrow's set if today's set precedes the rise.
  const set = today.moonrise && today.moonset && today.moonset < today.moonrise ? tomorrow?.moonset : today.moonset;
  return {...phase, date, rise: today.moonrise || '', set: set || '', cloud: report.observedAt?.slice(0,10) === date ? report.nightCloudCover ?? null : null};
}
