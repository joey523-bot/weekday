import { processRepeatAccount } from "./repeat.js";
import { REPEAT_ACCOUNT_SELECT, REPEAT_ACCOUNT_FILTER } from "../../../functions/_utils/repeat-push.js";
import { processCycleAccount } from "./cycle.js";
import { CYCLE_ACCOUNT_SELECT } from "../../../functions/_utils/cycle-push.js";
import { processSnoozeEntry } from "./snooze.js";
import webpush from "web-push";
import { getNextSalaryParts, normalizeSalaryDay } from "../../../scripts/utils/payday.js";
import { isChinaWorkday, CalendarUnavailableError } from "../../../scripts/utils/workday-calendar.js";

const DAY_MS = 86400000;
const FIXED_TIMEZONE = "Asia/Shanghai";

export default {
  async scheduled(controller, env, ctx) {
    const [salaryRecords, reminderRecords, dailyRecords, snoozes, cycleAccounts, repeatAccounts] = await Promise.all([
      env.DB.prepare(
      `
        SELECT
          installation_id,
          endpoint,
          p256dh,
          auth,
          salary_day,
          lead_days,
          reminder_hour,
          timezone,
          last_sent_key
        FROM salary_push_subscriptions
        WHERE enabled = 1
      `
      ).all(),
      env.DB.prepare(
        `
          SELECT
            rules.installation_id,
            rules.reminder_id,
            rules.title,
            rules.category,
            rules.reminder_date,
            rules.lead_days,
            rules.reminder_hour,
            rules.last_sent_key,
            subscriptions.endpoint,
            subscriptions.p256dh,
            subscriptions.auth,
            subscriptions.timezone,
            subscriptions.user_id
          FROM reminder_push_rules rules
          INNER JOIN salary_push_subscriptions subscriptions
            ON subscriptions.installation_id = rules.installation_id
          WHERE rules.enabled = 1 AND subscriptions.enabled = 1
            AND (subscriptions.user_id = '' OR EXISTS (
              SELECT 1 FROM account_sync a, json_each(a.snapshot_data, '$.reminders') r
              WHERE a.user_id = subscriptions.user_id AND json_extract(r.value, '$.id') = rules.reminder_id
                AND COALESCE(json_extract(r.value, '$.completed'), 0) = 0
                AND json_extract(r.value, '$.repeat') IS NULL))
        `
      ).all(),
      env.DB.prepare(`
        SELECT subscriptions.*, rules.last_sent_key AS daily_last_sent_key,
          rules.enabled AS daily_enabled
        FROM salary_daily_push_rules rules
        INNER JOIN salary_push_subscriptions subscriptions
          ON subscriptions.installation_id = rules.installation_id
        WHERE rules.enabled = 1 AND subscriptions.enabled = 1
      `).all(),
      env.DB.prepare(`SELECT * FROM reminder_snoozes WHERE active=1 AND next_at<=?
        AND (mode='once' OR until_at>?)`).bind(new Date().toISOString(), new Date().toISOString()).all(),
      env.DB.prepare(`${CYCLE_ACCOUNT_SELECT} WHERE json_extract(snapshot_data,'$.preferences.cycle.pushEnabled')=1`).all(),
      env.DB.prepare(`${REPEAT_ACCOUNT_SELECT} WHERE ${REPEAT_ACCOUNT_FILTER}`).all()
    ]);

    if (!salaryRecords?.results?.length && !reminderRecords?.results?.length && !dailyRecords?.results?.length && !snoozes?.results?.length && !cycleAccounts?.results?.length && !repeatAccounts?.results?.length) {
      return;
    }

    const subject = env.VAPID_SUBJECT || "mailto:no-reply@example.com";
    webpush.setVapidDetails(subject, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

    const jobs = [
      ...(salaryRecords.results || []).map((entry) => processSalaryEntry(entry, env)),
      ...(reminderRecords.results || []).map((entry) => processReminderEntry(entry, env)),
      ...(dailyRecords.results || []).map((entry) => processDailyCountdownEntry(entry, env)),
      ...(snoozes.results || []).map((entry) => processSnoozeEntry(entry, env)),
      ...(cycleAccounts.results || []).map((entry) => processCycleAccount(entry, env)),
      ...(repeatAccounts.results || []).map((entry) => processRepeatAccount(entry, env))
    ];
    ctx.waitUntil(Promise.all(jobs));
  }
};

// Daily countdown has its own opt-in and delivery key. Existing salary/reminder rules are untouched.
export async function processDailyCountdownEntry(entry, env, now = new Date()) {
  if (Number(entry.daily_enabled) !== 1 || Number(entry.enabled) !== 1) return;
  const local = getLocalParts(now, FIXED_TIMEZONE);
  // Cron runs every five minutes; allow retries during the 10:00 hour only.
  if (local.hour !== 10) return;
  let target;
  try {
    if (!isChinaWorkday(local)) return;
    target = getNextSalaryParts(local, normalizeSalaryDay(entry.salary_day));
  } catch (error) {
    if (!(error instanceof CalendarUnavailableError)) throw error;
    console.warn(error.message);
    return;
  }
  const cycleKey = toCycleKey(local);
  if (entry.daily_last_sent_key === cycleKey) return;
  const stamp = now.toISOString();
  // Atomically reserve this device/day before calling the push provider. Concurrent cron runs
  // cannot both send; re-check the live switches to handle stale scheduler snapshots.
  const claim = await env.DB.prepare(`
    UPDATE salary_daily_push_rules
    SET last_sent_key = ?, updated_at = ?
    WHERE installation_id = ? AND enabled = 1 AND last_sent_key != ?
      AND EXISTS (SELECT 1 FROM salary_push_subscriptions
        WHERE installation_id = ? AND enabled = 1)
  `).bind(cycleKey, stamp, entry.installation_id, cycleKey, entry.installation_id).run();
  if (claim.meta?.changes !== 1) return;
  const days = daysBetween(local, target);
  const payload = JSON.stringify({
    title: days === 0 ? "今天发工资" : `距离发工资还有${days}天`,
    body: days === 0 ? "今天是本次实际发薪日。" : `下次发薪日：${target.month}月${target.day}日。`,
    tag: `salary-daily-${cycleKey}`,
    url: env.APP_URL || "/"
  });
  try {
    await webpush.sendNotification({
      endpoint: entry.endpoint, keys: { p256dh: entry.p256dh, auth: entry.auth }
    }, payload);
  } catch (error) {
    await recordDeliveryAttempt(env, {
      installationId: entry.installation_id, eventType: "salary_daily", cycleKey,
      status: "failed", detail: describePushError(error)
    });
    if (error?.statusCode === 404 || error?.statusCode === 410) {
      await env.DB.prepare("UPDATE salary_push_subscriptions SET enabled = 0, updated_at = ? WHERE installation_id = ?")
        .bind(stamp, entry.installation_id).run();
    } else if (Number(error?.statusCode) >= 400) {
      // Provider explicitly rejected the request: permit another attempt this hour.
      await env.DB.prepare(`UPDATE salary_daily_push_rules SET last_sent_key = ''
        WHERE installation_id = ? AND last_sent_key = ?`)
        .bind(entry.installation_id, cycleKey).run();
    }
    // Transport failure may have delivered. Keep the reservation rather than duplicate it.
    return;
  }
  await env.DB.prepare(`UPDATE salary_daily_push_rules SET last_sent_at = ?, updated_at = ?
    WHERE installation_id = ? AND last_sent_key = ?`)
    .bind(stamp, stamp, entry.installation_id, cycleKey).run();
  await recordDeliveryAttempt(env, {
    installationId: entry.installation_id, eventType: "salary_daily", cycleKey, status: "sent"
  });
}

export async function processSalaryEntry(entry, env, now = new Date()) {
  const local = getLocalParts(now, entry.timezone || FIXED_TIMEZONE);
  if (local.hour !== Number(entry.reminder_hour ?? 9)) {
    return;
  }

  let targetSalary;
  try {
    targetSalary = getNextSalaryParts(local, normalizeSalaryDay(entry.salary_day));
  } catch (error) {
    if (!(error instanceof CalendarUnavailableError)) throw error;
    // Leave last_sent_key unchanged; unrelated custom reminders still run.
    console.warn(error.message);
    return;
  }
  const daysUntil = daysBetween(local, targetSalary);

  if (daysUntil !== Number(entry.lead_days || 0)) {
    return;
  }

  const cycleKey = toCycleKey(targetSalary);
  if (cycleKey === entry.last_sent_key) {
    return;
  }

  const reminder = buildReminderCopy(daysUntil, targetSalary);
  const payload = JSON.stringify({
    title: reminder.title,
    body: reminder.body,
    tag: `salary-${cycleKey}`,
    url: env.APP_URL || "/"
  });

  try {
    await webpush.sendNotification(
      {
        endpoint: entry.endpoint,
        keys: {
          p256dh: entry.p256dh,
          auth: entry.auth
        }
      },
      payload
    );

    await env.DB.prepare(
      `
        UPDATE salary_push_subscriptions
        SET last_sent_key = ?, last_sent_at = ?, updated_at = ?
        WHERE installation_id = ?
      `
    )
      .bind(cycleKey, new Date().toISOString(), new Date().toISOString(), entry.installation_id)
      .run();
    await recordDeliveryAttempt(env, {
      installationId: entry.installation_id,
      eventType: "salary",
      cycleKey,
      status: "sent"
    });
  } catch (error) {
    await recordDeliveryAttempt(env, {
      installationId: entry.installation_id,
      eventType: "salary",
      cycleKey,
      status: "failed",
      detail: describePushError(error)
    });
    if (error?.statusCode === 404 || error?.statusCode === 410) {
      await env.DB.prepare(
        `
          UPDATE salary_push_subscriptions
          SET enabled = 0, updated_at = ?
          WHERE installation_id = ?
        `
      )
        .bind(new Date().toISOString(), entry.installation_id)
        .run();
      return;
    }

    throw error;
  }
}

export async function processReminderEntry(entry, env) {
  // A queued or legacy-device job cannot resurrect a deleted/completed series.
  if (entry.user_id) {
    const current = await env.DB.prepare(`SELECT 1 AS found FROM account_sync a, json_each(a.snapshot_data, '$.reminders') r
      WHERE a.user_id = ? AND json_extract(r.value, '$.id') = ?
        AND COALESCE(json_extract(r.value, '$.completed'), 0) = 0 AND json_extract(r.value, '$.repeat') IS NULL`)
      .bind(entry.user_id, entry.reminder_id).first();
    if (!current) return;
  }
  const now = new Date();
  const local = getLocalParts(now, entry.timezone || FIXED_TIMEZONE);
  if (local.hour !== Number(entry.reminder_hour ?? 9)) {
    return;
  }

  const noticeDate = getReminderNoticeDate(entry.reminder_date, Number(entry.lead_days || 0));
  if (!noticeDate || toCycleKey(local) !== noticeDate) {
    return;
  }

  const cycleKey = `${entry.reminder_id}:${noticeDate}`;
  if (cycleKey === entry.last_sent_key) {
    return;
  }

  const payload = JSON.stringify({
    title: entry.title,
    body: buildCustomReminderBody(entry, Number(entry.lead_days || 0)),
    tag: `reminder-${entry.reminder_id}-${noticeDate}`,
    reminderId: entry.reminder_id,
    url: `${(env.APP_URL || "/").split("#")[0]}#reminder=${encodeURIComponent(entry.reminder_id)}`
  });

  try {
    await webpush.sendNotification(
      {
        endpoint: entry.endpoint,
        keys: {
          p256dh: entry.p256dh,
          auth: entry.auth
        }
      },
      payload
    );

    await env.DB.prepare(
      `
        UPDATE reminder_push_rules
        SET last_sent_key = ?, updated_at = ?
        WHERE installation_id = ? AND reminder_id = ?
      `
    )
      .bind(cycleKey, new Date().toISOString(), entry.installation_id, entry.reminder_id)
      .run();
    await recordDeliveryAttempt(env, {
      installationId: entry.installation_id,
      reminderId: entry.reminder_id,
      eventType: "reminder",
      cycleKey,
      status: "sent"
    });
  } catch (error) {
    await recordDeliveryAttempt(env, {
      installationId: entry.installation_id,
      reminderId: entry.reminder_id,
      eventType: "reminder",
      cycleKey,
      status: "failed",
      detail: describePushError(error)
    });
    if (error?.statusCode === 404 || error?.statusCode === 410) {
      await env.DB.prepare(
        `UPDATE salary_push_subscriptions SET enabled = 0, updated_at = ? WHERE installation_id = ?`
      )
        .bind(new Date().toISOString(), entry.installation_id)
        .run();
      return;
    }

    throw error;
  }
}

async function recordDeliveryAttempt(env, { installationId, reminderId = "", eventType, cycleKey, status, detail = "" }) {
  try {
    await env.DB.prepare(
      `
        INSERT INTO push_delivery_attempts (
          installation_id, reminder_id, event_type, cycle_key, status, detail, attempted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    )
      .bind(installationId, reminderId, eventType, cycleKey, status, detail.slice(0, 500), new Date().toISOString())
      .run();
  } catch (error) {
    // A diagnostics write must never block the notification attempt.
    console.error("Failed to record push delivery attempt", error);
  }
}

function describePushError(error) {
  const status = error?.statusCode ? `HTTP ${error.statusCode}` : "";
  const message = String(error?.message || "Unknown push error");
  return [status, message].filter(Boolean).join(": ");
}

function getLocalParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour)
  };
}

function daysBetween(start, end) {
  const startUtc = Date.UTC(start.year, start.month - 1, start.day);
  const endUtc = Date.UTC(end.year, end.month - 1, end.day);
  return Math.round((endUtc - startUtc) / DAY_MS);
}

function toCycleKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function getReminderNoticeDate(value, leadDays) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return "";
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - leadDays));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function buildReminderCopy(daysUntil, targetSalary) {
  if (daysUntil === 0) {
    return {
      title: "今天是发薪日",
      body: `${targetSalary.nominalMonth} 月的工资预计今天到账，记得看一眼。`
    };
  }

  return {
    title: "发薪日快到了",
    body: `还有 ${daysUntil} 天发薪，提前看一眼账单和安排。`
  };
}

// Preserve the existing production custom-reminder copy in this payday-only release.
function buildCustomReminderBody(entry, leadDays) {
  if (leadDays === 0) {
    return `今天需要处理：${entry.title}${entry.category ? `（${entry.category}）` : ""}。`;
  }
  return `${leadDays} 天后需要处理：${entry.title}${entry.category ? `（${entry.category}）` : ""}。`;
}
