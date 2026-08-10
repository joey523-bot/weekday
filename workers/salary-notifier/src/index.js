import webpush from "web-push";

const DAY_MS = 86400000;
const FIXED_TIMEZONE = "Asia/Shanghai";

export default {
  async scheduled(controller, env, ctx) {
    const [salaryRecords, reminderRecords] = await Promise.all([
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
            subscriptions.timezone
          FROM reminder_push_rules rules
          INNER JOIN salary_push_subscriptions subscriptions
            ON subscriptions.installation_id = rules.installation_id
          WHERE rules.enabled = 1 AND subscriptions.enabled = 1
        `
      ).all()
    ]);

    if (!salaryRecords?.results?.length && !reminderRecords?.results?.length) {
      return;
    }

    const subject = env.VAPID_SUBJECT || "mailto:no-reply@example.com";
    webpush.setVapidDetails(subject, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

    const jobs = [
      ...(salaryRecords.results || []).map((entry) => processSalaryEntry(entry, env)),
      ...(reminderRecords.results || []).map((entry) => processReminderEntry(entry, env))
    ];
    ctx.waitUntil(Promise.all(jobs));
  }
};

async function processSalaryEntry(entry, env) {
  const now = new Date();
  const local = getLocalParts(now, entry.timezone || FIXED_TIMEZONE);
  if (local.hour !== Number(entry.reminder_hour ?? 9)) {
    return;
  }

  const targetSalary = getNextSalaryParts(local, Number(entry.salary_day || 15));
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

async function processReminderEntry(entry, env) {
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

  const reminder = buildCustomReminderCopy(entry, Number(entry.lead_days || 0));
  const payload = JSON.stringify({
    title: reminder.title,
    body: reminder.body,
    tag: `reminder-${entry.reminder_id}-${noticeDate}`,
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

function getNextSalaryParts(local, salaryDay) {
  const candidate = getSalaryExecutionParts(local.year, local.month, salaryDay);

  if (compareParts(candidate, local) >= 0) {
    return candidate;
  }

  const rolled = new Date(Date.UTC(local.year, local.month, 1));
  return getSalaryExecutionParts(rolled.getUTCFullYear(), rolled.getUTCMonth() + 1, salaryDay);
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

function getSalaryExecutionParts(year, month, salaryDay) {
  const candidate = new Date(Date.UTC(year, month - 1, salaryDay));
  const adjusted = moveWeekendBackward(candidate);

  return {
    year: adjusted.getUTCFullYear(),
    month: adjusted.getUTCMonth() + 1,
    day: adjusted.getUTCDate()
  };
}

function moveWeekendBackward(date) {
  const day = date.getUTCDay();

  if (day === 6) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - 1));
  }

  if (day === 0) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - 2));
  }

  return date;
}

function compareParts(left, right) {
  const leftUtc = Date.UTC(left.year, left.month - 1, left.day);
  const rightUtc = Date.UTC(right.year, right.month - 1, right.day);
  return leftUtc - rightUtc;
}

function buildReminderCopy(daysUntil, targetSalary) {
  if (daysUntil === 0) {
    return {
      title: "今天是发薪日",
      body: `${targetSalary.month} 月的工资预计今天到账，记得看一眼。`
    };
  }

  return {
    title: "发薪日快到了",
    body: `还有 ${daysUntil} 天发薪，提前看一眼账单和安排。`
  };
}

function buildCustomReminderCopy(entry, leadDays) {
  const category = entry.category ? ` · ${entry.category}` : "";
  if (leadDays === 0) {
    return {
      title: `今天记得处理「${entry.title}」`,
      body: `给自己留出的这件事${category}`
    };
  }

  return {
    title: `「${entry.title}」快到了`,
    body: `还有 ${leadDays} 天，提前留一点时间给它${category}`
  };
}
