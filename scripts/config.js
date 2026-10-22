import { DEFAULT_SALARY_DAY } from "./utils/payday.js";

export const STORAGE_KEY = "yoyuan-ledger:v2";
export const INSTALLATION_KEY = "yoyuan-ledger:installation-id";
export const APP_VERSION = "20261022.logout.1";

export const APP_META = {
  productName: "星期",
  descriptor: "Payday, weather and personal reminders",
  version: APP_VERSION
};

export const APP_THEMES = {
  forest: {
    label: "默认绿",
    description: "清爽青绿，保持现在的外观",
    tag: "默认",
    themeColor: "#f4f7f5",
    artwork: ""
  },
  clear: {
    label: "清透蓝",
    description: "浅灰白底、清透蓝与轻盈卡片",
    tag: "清透",
    themeColor: "#f4f6fa",
    artwork: ""
  },
  twinkle: {
    label: "星星人",
    description: "粉彩云朵与治愈星光",
    tag: "泡泡玛特",
    themeColor: "#fff2e8",
    artwork: "/assets/themes/twinkle-theme.jpg"
  },
  jay: {
    label: "周杰伦",
    description: "雨夜钢琴与电影光影",
    tag: "音乐",
    themeColor: "#12131a",
    artwork: "/assets/themes/jay-theme.jpg"
  },
  custom: {
    label: "我的照片",
    description: "从相册挑一张，自动适配配色",
    tag: "本机",
    themeColor: "#171717",
    artwork: ""
  }
};

export const DEFAULT_THEME = "forest";

export const REMINDER_CATEGORIES = ["账单", "会员", "证件", "合同", "家庭", "其他"];

export const REMINDER_FILTERS = {
  all: "all",
  upcoming: "upcoming",
  overdue: "overdue",
  completed: "completed",
  inactive: "inactive"
};

export const DEFAULT_STATE = {
  salary: {
    day: DEFAULT_SALARY_DAY,
    amount: "",
    account: "",
    notification: {
      enabled: false,
      dailyCountdownEnabled: false,
      leadDays: 0,
      hour: 9,
      timezone: "Asia/Shanghai",
      permission: "default",
      endpoint: "",
      lastSyncedAt: "",
      lastTestedAt: "",
      lastError: ""
    }
  },
  reminders: [],
  preferences: {
    cycle: { enabled: true, pushEnabled: false, groups: [], excludedIds: [], clearedIds: [], handledTokens: [] },
    city: "",
    nickname: "",
    reminderFilter: REMINDER_FILTERS.all,
    theme: DEFAULT_THEME,
    customCategories: [],
    customThemes: [],
    activeCustomThemeId: ""
  },
  weather: {
    status: "idle",
    payload: null,
    updatedAt: null,
    error: ""
  }
};

export const WEATHER_CODES = {
  0: "晴朗",
  1: "大致晴",
  2: "局部多云",
  3: "阴天",
  45: "雾",
  48: "冻雾",
  51: "小毛毛雨",
  53: "毛毛雨",
  55: "强毛毛雨",
  56: "轻微冻雨",
  57: "强冻雨",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  66: "轻微冰雨",
  67: "强冰雨",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  77: "米雪",
  80: "阵雨",
  81: "较强阵雨",
  82: "强阵雨",
  85: "阵雪",
  86: "强阵雪",
  95: "雷暴",
  96: "雷暴伴冰雹",
  99: "强雷暴伴冰雹"
};
