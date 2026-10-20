import { repeatDeliverySlotKey } from "../../../functions/_utils/repeat-push.js";

export function repeatNotificationPayload(item, env) {
  const slotKey = repeatDeliverySlotKey(item);
  return {
    title: item.title,
    body: Number(item.leadDays) > 0 ? `${item.leadDays}天后需要处理：${item.title}（循环事项）。` : `今天需要处理：${item.title}（循环事项）。`,
    tag: `repeat-${item.repeat.seriesId}-${slotKey}`,
    reminderId: item.id,
    url: `${(env.APP_URL || '/').split('#')[0]}#reminder=${encodeURIComponent(item.id)}&occurrence=${encodeURIComponent(item.repeat.scheduledDate)}${item.repeat.times?.length ? `&slot=${encodeURIComponent(item.repeat.scheduledTime)}` : ''}`
  };
}

export function dailyNotificationPayload(days, target, cycleKey, env) {
  return {
    title: days === 0 ? "今天发工资" : `距离发工资还有${days}天`,
    body: days === 0 ? "今天是本次实际发薪日。" : `下次发薪日：${target.month}月${target.day}日。`,
    tag: `salary-daily-${cycleKey}`,
    url: env.APP_URL || "/"
  };
}
