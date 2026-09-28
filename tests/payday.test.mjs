import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { isChinaWorkday, CalendarUnavailableError } from "../scripts/utils/workday-calendar.js";
import { getSalaryExecutionParts, getNextSalaryParts, daysBetweenParts } from "../scripts/utils/payday.js";
import { getNextSalaryDate, getDaysUntil, formatLocalDateInput, getSalaryCycleProgress, buildSalaryAgenda } from "../scripts/utils/date.js";
import { renderSalaryPanel } from "../scripts/views/render.js";
import { DEFAULT_STATE } from "../scripts/config.js";
import { normalizePushPayload } from "../functions/_utils/push.js";
import worker, { processSalaryEntry } from "../workers/salary-notifier/src/index.js";
import webpush from "../workers/salary-notifier/node_modules/web-push/src/index.js";

const key = p => `${p.year}-${String(p.month).padStart(2,"0")}-${String(p.day).padStart(2,"0")}`;
const local = text => { const [year,month,day] = text.split('-').map(Number); return {year,month,day}; };
const date = text => { const p = local(text); return new Date(p.year,p.month-1,p.day,12); };

test("official 2026 calendar: holidays, weekends and makeup workdays", () => {
  for (const value of ["2026-01-04","2026-02-14","2026-02-28","2026-05-09","2026-09-20","2026-10-10","2026-09-30"]) {
    assert.equal(isChinaWorkday(local(value)), true, value);
  }
  for (const value of ["2026-01-01","2026-02-23","2026-04-06","2026-05-05","2026-06-19","2026-09-25","2026-10-05","2026-09-19"]) {
    assert.equal(isChinaWorkday(local(value)), false, value);
  }
});

test("all twelve 2026 monthly fifths have expected execution dates", () => {
  const expected = ["01-05","02-05","03-05","04-03","04-30","06-05","07-03","08-05","09-04","09-30","11-05","12-04"];
  expected.forEach((value,i) => assert.equal(key(getSalaryExecutionParts(2026,i+1,5)),`2026-${value}`));
});

test("makeup Sunday, long holiday, cross-year and 2025 regression", () => {
  assert.equal(key(getSalaryExecutionParts(2026,1,4)),"2026-01-04");
  assert.equal(key(getSalaryExecutionParts(2026,2,20)),"2026-02-14");
  assert.equal(key(getSalaryExecutionParts(2026,1,1)),"2025-12-31");
  assert.equal(key(getSalaryExecutionParts(2025,5,5)),"2025-04-30");
  assert.equal(key(getSalaryExecutionParts(2025,10,5)),"2025-09-30");
});

test("frontend and worker shared result advances after early cross-month payday", () => {
  const cases = [["2026-09-28","2026-09-30",2],["2026-09-30","2026-09-30",0],
    ["2026-10-01","2026-11-05",35],["2026-10-05","2026-11-05",31],
    ["2026-04-30","2026-04-30",0],["2026-05-01","2026-06-05",35]];
  for (const [today,expected,days] of cases) {
    const next = getNextSalaryDate(5,date(today));
    assert.equal(formatLocalDateInput(next), expected);
    assert.equal(key(getNextSalaryParts(local(today),5)), expected);
    assert.equal(getDaysUntil(next,date(today)), days);
  }
  assert.equal(getSalaryCycleProgress(5,date("2026-09-30")),1);
  assert.ok(getSalaryCycleProgress(5,date("2026-10-01")) > 0);
  assert.ok(getSalaryCycleProgress(5,date("2026-10-01")) < 0.1);
});

test("every covered 2026 day selects a non-past actual workday for each selectable salary day", () => {
  for (let day=1; day<=28; day++) {
    for (let d=new Date(Date.UTC(2026,0,1)); d<=new Date(Date.UTC(2026,10,30)); d.setUTCDate(d.getUTCDate()+1)) {
      const today = local(d.toISOString().slice(0,10));
      const next = getNextSalaryParts(today,day);
      assert.ok(daysBetweenParts(today,next)>=0);
      assert.equal(isChinaWorkday(next),true);
      const nominal = {year:next.nominalYear,month:next.nominalMonth,day};
      assert.ok(daysBetweenParts(next,nominal)>=0);
      for (let offset=1;offset<=daysBetweenParts(next,nominal);offset++) {
        const after = new Date(Date.UTC(next.year,next.month-1,next.day+offset));
        assert.equal(isChinaWorkday(local(after.toISOString().slice(0,10))),false);
      }
    }
  }
});

function refs() {
  return Object.fromEntries(["salaryStatus","salaryDate","salaryReminderDate","salaryReminderState","salaryAmountDisplay",
    "salaryAccountDisplay","salaryCountdown","salaryCountdownUnit","salaryDaySelect","salaryAmountInput","salaryAccountInput"].map(k=>[k,{}]));
}
test("home panel renders exact countdown, payday and unknown-calendar state", () => {
  const state = structuredClone(DEFAULT_STATE); state.salary.notification.enabled = true;
  for (const [today,expected] of [["2026-09-28","2"],["2026-09-30","0"],["2026-10-01","35"]]) {
    const r=refs(); renderSalaryPanel(state,r,date(today)); assert.equal(r.salaryCountdown.textContent,expected);
  }
  const r=refs(); renderSalaryPanel(state,r,date("2027-01-01"));
  assert.equal(r.salaryCountdown.textContent,"--");
  assert.match(r.salaryDate.textContent,/待更新/);
  assert.match(r.salaryReminderState.textContent,/暂停/);
  assert.equal(r.salaryDaySelect.value,"5");
});

test("missing calendar never invents dates or breaks the salary agenda", () => {
  assert.throws(()=>getSalaryExecutionParts(2027,1,5),CalendarUnavailableError);
  assert.equal(getNextSalaryDate(5,date("2026-12-05")),null);
  assert.equal(getSalaryCycleProgress(5,date("2027-01-01")),null);
  assert.deepEqual(buildSalaryAgenda(5,4,date("2027-01-01")),[]);
  assert.deepEqual(buildSalaryAgenda(5,4,date("2026-11-01")).map(p=>p.date),["2026-11-05","2026-12-04"]);
});

test("default is fifth while explicit existing salary settings survive", () => {
  assert.equal(DEFAULT_STATE.salary.day,5);
  assert.equal(normalizePushPayload({}).salaryDay,5);
  assert.equal(normalizePushPayload({salaryDay:15}).salaryDay,15);
});

function fakeEnv() {
  const writes=[];
  return {
    APP_URL: "https://example.test", writes,
    DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return { async run() { writes.push({ sql, values }); } };
          }
        };
      }
    }
  };
}
const entry = {installation_id:"test-device", endpoint:"https://example.test/push", p256dh:"test",auth:"test",
  salary_day:5,lead_days:0,reminder_hour:9,timezone:"Asia/Shanghai",last_sent_key:"2026-09-04"};
test("worker sends October cycle on Sep 30, suppresses duplicate and respects hour/lead time", async t => {
  const sent=[]; t.mock.method(webpush,"sendNotification",async (_subscription,payload)=>sent.push(JSON.parse(payload)));
  const env=fakeEnv();
  await processSalaryEntry(entry,env,new Date("2026-09-30T01:05:00Z"));
  assert.equal(sent.length,1); assert.equal(sent[0].tag,"salary-2026-09-30"); assert.match(sent[0].body,/10 月/);
  assert.equal(env.writes[0].values[0],"2026-09-30");
  await processSalaryEntry({...entry,last_sent_key:"2026-09-30"},env,new Date("2026-09-30T01:55:00Z"));
  await processSalaryEntry(entry,env,new Date("2026-09-30T02:00:00Z"));
  await processSalaryEntry(entry,env,new Date("2026-10-05T01:00:00Z"));
  assert.equal(sent.length,1);
  await processSalaryEntry({...entry,lead_days:2},env,new Date("2026-09-28T01:00:00Z"));
  assert.equal(sent.length,2); assert.match(sent[1].body,/2 天/);
  await processSalaryEntry({...entry,last_sent_key:"2026-09-30"},env,new Date("2026-11-05T01:00:00Z"));
  assert.equal(sent.length,3); assert.equal(sent[2].tag,"salary-2026-11-05");
});

test("missing calendar does not send or advance salary delivery state", async t => {
  const sent=[];t.mock.method(webpush,"sendNotification",async (...args)=>sent.push(args));
  t.mock.method(console,"warn",()=>{});
  const env=fakeEnv(); await processSalaryEntry(entry,env,new Date("2027-01-05T01:00:00Z"));
  assert.equal(sent.length,0);assert.equal(env.writes.length,0);
});

test("scheduler still sends custom reminder when salary calendar is unavailable", async t => {
  t.mock.timers.enable({apis:["Date"],now:new Date("2027-01-05T01:05:00Z")});
  t.mock.method(console,"warn",()=>{}); t.mock.method(webpush,"setVapidDetails",()=>{});
  const sent=[];t.mock.method(webpush,"sendNotification",async (_s,p)=>sent.push(JSON.parse(p)));
  const env=fakeEnv();const original=env.DB.prepare;
  env.DB.prepare=sql=> sql.includes("SELECT") ? {async all(){return {results: sql.includes("INNER JOIN")
    ? [{...entry, reminder_id:"r1",title:"测试事项",reminder_date:"2027-01-05",last_sent_key:""}] : [entry]};}} : original(sql);
  let pending;await worker.scheduled({},env,{waitUntil(p){pending=p;}});await pending;
  assert.equal(sent.length,1);assert.match(sent[0].title,/测试事项/);
});

test("offline cache includes shared calendar and all precache paths exist", () => {
  const sw=readFileSync(new URL("../sw.js",import.meta.url),"utf8");
  for (const name of ["payday.js","workday-calendar.js"]) assert.ok(sw.includes(`./scripts/utils/${name}`));
  const list=sw.split("const STATIC_ASSETS = [")[1].split("];",1)[0];
  for (const [,path] of list.matchAll(/"([^"]+)"/g)) assert.ok(existsSync(new URL(`../${path}`,import.meta.url)),path);
});
