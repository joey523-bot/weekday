export async function fetchWeatherReportByCoordinates(latitude, longitude) {
  const fallbackLabel = "当前位置";
  const resolvedLabelPromise = resolveLocationLabel(latitude, longitude, fallbackLabel).catch(() => fallbackLabel);
  const query = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: [
      "temperature_2m",
      "uv_index",
      "relative_humidity_2m",
      "apparent_temperature",
      "is_day",
      "precipitation",
      "rain",
      "showers",
      "snowfall",
      "weather_code",
      "cloud_cover",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m"
    ].join(","),
    hourly: "temperature_2m,weather_code,precipitation_probability,cloud_cover",
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "uv_index_max",
      "precipitation_sum",
      "wind_speed_10m_max",
      "wind_gusts_10m_max",
      "sunrise",
      "sunset",
      "moonrise",
      "moonset",
      "moon_phase"
    ].join(","),
    timezone: "auto",
    forecast_days: "4"
  });
  const weatherResponse = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`);

  if (!weatherResponse.ok) {
    throw new Error("天气服务暂时不可用");
  }

  const weatherData = await weatherResponse.json();
  const resolvedLabel = await resolvedLabelPromise;

  const current = weatherData?.current || {};
  const dailyForecast = normalizeDailyForecast(weatherData?.daily);
  const hourlyForecast = normalizeHourlyForecast(weatherData?.hourly, current.time);
  const weatherCode = resolveCurrentWeatherCode(current, hourlyForecast[0]);
  const report = {
    city: resolvedLabel,
    country: "自动定位",
    timezone: String(weatherData?.timezone || ""),
    observedAt: String(current.time || ""),
    source: "Open-Meteo",
    temperature: numberOrNull(current.temperature_2m),
    uvIndex: numberOrNull(current.uv_index),
    nightCloudCover: averageNightCloud(weatherData.hourly, String(current.time || "").slice(0,10)),
    apparentTemperature: numberOrNull(current.apparent_temperature),
    humidity: numberOrNull(current.relative_humidity_2m),
    weatherCode,
    isDay: Number(current.is_day) === 1,
    precipitation: numberOrNull(current.precipitation),
    rain: numberOrNull(current.rain),
    showers: numberOrNull(current.showers),
    snowfall: numberOrNull(current.snowfall),
    cloudCover: numberOrNull(current.cloud_cover),
    windSpeed: numberOrNull(current.wind_speed_10m),
    windDirection: numberOrNull(current.wind_direction_10m),
    windGusts: numberOrNull(current.wind_gusts_10m),
    rainProbability: hourlyForecast[0]?.rainProbability ?? dailyForecast[0]?.rainProbability ?? null,
    hourlyForecast,
    dailyForecast
  };

  return {
    ...report,
    advice: buildWeatherAdvice(report)
  };
}

export function buildWeatherAdvice(report) {
  const advice = [];
  const feelsLike = report.apparentTemperature ?? report.temperature;
  const rainProbability = report.rainProbability ?? report.dailyForecast?.[0]?.rainProbability ?? 0;
  const precipitation = (report.rain || 0) + (report.showers || 0) + (report.snowfall || 0);
  const code = Number(report.weatherCode);
  const isThunder = code >= 95;
  const isSnow = (code >= 71 && code <= 77) || (code >= 85 && code <= 86) || (report.snowfall || 0) > 0;
  const isRain = isThunder || (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || precipitation > 0;

  if (feelsLike >= 32) {
    advice.push({ kind: "clothing", title: "清凉着装", detail: "体感偏热，穿透气短袖并及时补水。" });
  } else if (feelsLike >= 24) {
    advice.push({ kind: "clothing", title: "轻薄衣物", detail: "短袖即可，室内空调较凉可带薄外套。" });
  } else if (feelsLike >= 16) {
    advice.push({ kind: "clothing", title: "带件外套", detail: "早晚温差可能明显，薄外套更稳妥。" });
  } else if (feelsLike !== null) {
    advice.push({ kind: "clothing", title: "注意保暖", detail: "建议增加保暖层，避免长时间受凉。" });
  }

  if (isThunder) {
    advice.push({ kind: "warning", title: "雷雨提醒", detail: "带伞并远离开阔地、高处和金属设施。" });
  } else if (isSnow) {
    advice.push({ kind: "warning", title: "防滑保暖", detail: "注意道路结冰，穿防滑鞋并预留通勤时间。" });
  } else if (isRain && precipitation > 0) {
    advice.push({ kind: "umbrella", title: "正在降水", detail: "记得带伞，路面湿滑时放慢脚步。" });
  } else if (isRain || rainProbability >= 60) {
    advice.push({ kind: "umbrella", title: "带好雨具", detail: `降水概率约 ${Math.round(rainProbability)}%，出门带伞更安心。` });
  } else if (rainProbability >= 30) {
    advice.push({ kind: "umbrella", title: "留意阵雨", detail: `有 ${Math.round(rainProbability)}% 降水可能，可带一把折叠伞。` });
  }

  const uvIndex = report.dailyForecast?.[0]?.uvIndex;
  if (uvIndex >= 6 && advice.length < 3) {
    advice.push({ kind: "sun", title: "加强防晒", detail: "紫外线较强，建议使用防晒并避开长时间暴晒。" });
  }

  const gust = report.windGusts ?? report.dailyForecast?.[0]?.windGusts;
  if (gust >= 50 && advice.length < 3) {
    advice.push({ kind: "wind", title: "小心大风", detail: "远离临时搭建物，骑行时注意侧风。" });
  }

  if (advice.length < 2) {
    advice.push({ kind: "outing", title: "适合出行", detail: "天气相对平稳，出门前再轻点刷新一次即可。" });
  }

  return advice.slice(0, 3);
}

function resolveCurrentWeatherCode(current, currentHour) {
  const code = numberOrNull(current?.weather_code);
  const hourlyCode = numberOrNull(currentHour?.weatherCode);
  const hourlyRainProbability = numberOrNull(currentHour?.rainProbability) ?? 0;
  if (Number(current?.snowfall) > 0 && !(code >= 71 && code <= 77) && !(code >= 85 && code <= 86)) {
    return 71;
  }
  if ((Number(current?.rain) > 0 || Number(current?.showers) > 0) && (code === null || code <= 3)) {
    return Number(current?.showers) > 0 ? 80 : 61;
  }
  if (
    (code === null || code <= 3) &&
    hourlyRainProbability >= 30 &&
    hourlyCode !== null &&
    ((hourlyCode >= 51 && hourlyCode <= 67) || (hourlyCode >= 80 && hourlyCode <= 99))
  ) {
    return hourlyCode;
  }
  return code ?? hourlyCode;
}

function normalizeDailyForecast(daily) {
  if (!Array.isArray(daily?.time)) {
    return [];
  }

  return daily.time.map((date, index) => ({
    date: String(date || ""),
    weatherCode: numberOrNull(daily.weather_code?.[index]),
    high: numberOrNull(daily.temperature_2m_max?.[index]),
    low: numberOrNull(daily.temperature_2m_min?.[index]),
    rainProbability: numberOrNull(daily.precipitation_probability_max?.[index]),
    uvIndex: numberOrNull(daily.uv_index_max?.[index]),
    precipitation: numberOrNull(daily.precipitation_sum?.[index]),
    windSpeed: numberOrNull(daily.wind_speed_10m_max?.[index]),
    windGusts: numberOrNull(daily.wind_gusts_10m_max?.[index]),
    sunrise: String(daily.sunrise?.[index] || ""),
    sunset: String(daily.sunset?.[index] || ""),
    moonrise: String(daily.moonrise?.[index] || ""),
    moonset: String(daily.moonset?.[index] || ""),
    moonPhase: numberOrNull(daily.moon_phase?.[index])
  }));
}

function normalizeHourlyForecast(hourly, observedAt) {
  if (!Array.isArray(hourly?.time)) {
    return [];
  }

  const startIndex = Math.max(
    0,
    hourly.time.findIndex((time) => String(time) >= String(observedAt || ""))
  );
  const entries = [];
  for (let index = startIndex; index < hourly.time.length && entries.length < 6; index += 2) {
    entries.push({
      time: String(hourly.time[index] || ""),
      temperature: numberOrNull(hourly.temperature_2m?.[index]),
      weatherCode: numberOrNull(hourly.weather_code?.[index]),
      rainProbability: numberOrNull(hourly.precipitation_probability?.[index])
    });
  }
  return entries;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function resolveLocationLabel(latitude, longitude, fallback) {
  try {
    const response = await fetch(
      `/api/weather/location?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`
    );
    if (response.ok) {
      const payload = await response.json();
      const city = String(payload?.city || "").trim();
      if (city) {
        return city;
      }
    }
  } catch (error) {
    // 本地静态预览没有 Pages Function，继续尝试公共地址查询服务。
  }

  const response = await fetchWithTimeout(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&zoom=10&addressdetails=1&accept-language=zh-CN`,
    3500
  );
  if (!response.ok) {
    return fallback;
  }
  const payload = await response.json();
  return formatNominatimLocation(payload) || fallback;
}

function formatNominatimLocation(payload) {
  const address = payload?.address || {};
  const province = address.state || address.province || "";
  const city = address.city || address.town || address.village || address.municipality || address.county || "";
  const district = address.city_district || address.district || address.suburb || "";
  const parts = [province, city, district].filter((part, index, values) => part && values.indexOf(part) === index);

  return parts.join(" · ") || String(payload?.display_name || "").split(",").slice(0, 2).join(" · ").trim();
}

async function fetchWithTimeout(url, timeout) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

function averageNightCloud(hourly, date) {
  const values = (hourly?.time || []).flatMap((time, i) => {
    const v = numberOrNull(hourly.cloud_cover?.[i]);
    return time.slice(0,10) === date && Number(time.slice(11,13)) >= 18 && v !== null ? [v] : [];
  });
  return values.length ? Math.round(values.reduce((a,b)=>a+b,0)/values.length) : null;
}
