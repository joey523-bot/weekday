import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRepeat, firstRepeatDate, nextRepeatDate, beijingDate, repeatDueAt, fixedOccurrenceForDate, nextFixedOccurrence, fixedDueOccurrences } from '../scripts/utils/repeat.js';
const rule = values => normalizeRepeat({ freq: 'custom', mode: 'fixed', interval: 20, unit: 'day', startDate: '2026-10-12', time: '09:35', ...values });
const next = (r, values = {}) => nextRepeatDate(r, { afterDate: r.startDate, today: '2026-10-14', completedOn: '2026-10-14', ...values });

test('fixed and after completion keep different anchors; overdue does not accumulate', () => {
  assert.equal(next(rule({})).date, '2026-11-01');
  assert.equal(next(rule({ mode: 'after' })).date, '2026-11-03');
  assert.equal(next(rule({}), { today: '2026-12-13' }).date, '2026-12-31');
  assert.equal(next(rule({ mode: 'after' }), { action: 'skip', today: '2026-10-18' }).date, '2026-11-07');
});
test('missing month dates and leap day skip, never overflow or drift', () => {
  const monthly = rule({ freq: 'month', startDate: '2026-01-31' });
  assert.equal(next(monthly, { today: '2026-02-01' }).date, '2026-03-31');
  const yearly = rule({ freq: 'year', startDate: '2024-02-29' });
  assert.equal(next(yearly, { today: '2025-02-01' }).date, '2028-02-29');
  assert.equal(next(rule({ mode: 'after', unit: 'month', interval: 1 }), { completedOn: '2026-01-31', today: '2026-01-31' }).date, '2026-03-31');
});
test('weekly multi-selection and N-week intervals anchored to start week', () => {
  const weekly = rule({ freq: 'week', weekdays: [1, 5], startDate: '2026-10-13' });
  assert.equal(firstRepeatDate(weekly).date, '2026-10-16');
  const two = rule({ unit: 'week', interval: 2, weekdays: [1, 5] });
  assert.equal(next(two).date, '2026-10-16');
  assert.equal(next(two, { afterDate: '2026-10-16', today: '2026-10-16' }).date, '2026-10-26');
});
test('actual workdays respect makeup days and fail closed for unknown year', () => {
  assert.equal(firstRepeatDate(rule({ freq: 'weekday', startDate: '2026-10-10' })).date, '2026-10-10');
  assert.equal(firstRepeatDate(rule({ freq: 'weekday', startDate: '2026-10-10', workday: 'weekdays' })).date, '2026-10-12');
  assert.equal(next(rule({ freq: 'weekday' }), { today: '2026-12-31', afterDate: '2026-12-31' }).status, 'calendar_wait');
  assert.equal(firstRepeatDate(rule({ freq: 'weekday', startDate: '2027-01-01', workday: 'weekdays' })).date, '2027-01-01');
});
test('end is inclusive, resume and skip preserve mode semantics', () => {
  assert.equal(next(rule({ endDate: '2026-11-01' })).date, '2026-11-01');
  assert.equal(next(rule({ endDate: '2026-10-31' })).status, 'ended');
  assert.equal(next(rule({ mode: 'after' }), { action: 'resume' }).date, '2026-10-12');
  assert.equal(next(rule({}), { action: 'resume' }).date, '2026-11-01');
});
test('Beijing date and minute reminders are independent of host timezone', () => {
  assert.equal(beijingDate(new Date('2026-10-12T16:01:00Z')), '2026-10-13');
  const item = { repeat: rule({}), date: '2026-10-12', leadDays: 1, notificationEnabled: true };
  assert.equal(repeatDueAt(item), '2026-10-11T01:35:00.000Z');
  assert.equal(repeatDueAt({ ...item, repeat: { ...item.repeat, status: 'paused' } }), '');
  assert.equal(repeatDueAt({ ...item, completed: true }), repeatDueAt(item));
  assert.equal(repeatDueAt({ ...item, completed: true, repeat: { ...item.repeat, mode: 'after', freq: 'custom' } }), '');
});
test('reject malformed rules and never silently accept impossible dates', () => {
  for (const invalid of [{ startDate: '2026-02-30' }, { interval: 0 }, { interval: 1.5 }, { time: '24:01' }, { endDate: '2026-01-01' }, { freq: 'week', weekdays: [] }]) assert.throws(() => rule(invalid));
  assert.equal(normalizeRepeat(null), null);
});

test('minute due highlighting excludes paused and ended series', async () => {
  const { isReminderDue } = await import('../scripts/utils/snooze.js');
  const item = { date: '2026-10-12', hour: 9, repeat: rule({ time: '09:35' }) };
  assert.equal(isReminderDue(item, new Date('2026-10-12T01:34:59Z')), false);
  assert.equal(isReminderDue(item, new Date('2026-10-12T01:35:00Z')), true);
  assert.equal(isReminderDue({ ...item, repeat: { ...item.repeat, status: 'paused' } }, new Date('2026-10-12T02:00:00Z')), false);
});

const cn = value => new Date(`${value}+08:00`);
const fixed = (values={}, patch={}) => ({ id:'active', title:'原事项', date:'2026-10-12', hour:16, leadDays:0, notificationEnabled:true,
  ...patch, repeat: normalizeRepeat({ version:2, seriesId:'series', freq:'day', startDate:'2026-10-12', time:'16:27', scheduledDate:'2026-10-12',
    template:{title:'系列标题',category:'其他',notes:'系列内容',time:'16:27',leadDays:0,notificationEnabled:true}, ...values }) });

test('clock projection shows tomorrow while delayed Cron still owns today; no saved state mutation',()=>{
  const item=fixed(),before=JSON.stringify(item);
  assert.equal(nextFixedOccurrence(item,cn('2026-10-12T16:26:59')).occurrence.repeat.scheduledDate,'2026-10-12');
  assert.equal(nextFixedOccurrence(item,cn('2026-10-12T16:27:00')).occurrence.repeat.scheduledDate,'2026-10-13');
  assert.equal(nextFixedOccurrence(item,cn('2026-10-12T16:28:00')).occurrence.repeat.scheduledDate,'2026-10-13');
  assert.deepEqual(fixedDueOccurrences(item,cn('2026-10-12T16:30:00')).map(x=>x.repeat.scheduledDate),['2026-10-12']);
  assert.equal(fixedDueOccurrences(item,cn('2026-10-12T17:27:00')).length,0);
  assert.equal(JSON.stringify(item),before);
});

test('fixed current completion never stops later slots; after mode keeps completion dependency',()=>{
  const item=fixed({}, {completed:true});
  assert.equal(fixedDueOccurrences(item,cn('2026-10-13T16:30:00'))[0].repeat.scheduledDate,'2026-10-13');
  assert.equal(nextFixedOccurrence(item,cn('2026-10-13T17:00:00')).occurrence.date,'2026-10-14');
  for(const status of ['paused','ended','history']) assert.equal(fixedDueOccurrences(fixed({status}),cn('2026-10-12T16:30:00')).length,0);
  const after=fixed({freq:'custom',mode:'after'});
  assert.equal(fixedDueOccurrences(after,cn('2026-10-13T16:30:00')).length,0);
  assert.equal(nextFixedOccurrence(after,cn('2026-10-13T16:30:00')).occurrence,null);
});

test('v1 saved occurrence is an implicit exception; v2 uses only explicit overrides',()=>{
  const template={title:'系列',time:'09:00',leadDays:0,notificationEnabled:true};
  const legacy=fixed({version:1,time:'20:15',template},{title:'本次',date:'2026-10-15',leadDays:1,notificationEnabled:false});
  const first=fixedOccurrenceForDate(legacy,'2026-10-12');
  assert.equal(first.title,'本次');assert.equal(first.date,'2026-10-15');assert.equal(first.repeat.time,'20:15');assert.equal(first.notificationEnabled,false);
  const later=fixedOccurrenceForDate(legacy,'2026-10-13');assert.equal(later.title,'系列');assert.equal(later.date,'2026-10-13');assert.equal(later.repeat.time,'09:00');assert.equal(later.notificationEnabled,true);
  const v2={...legacy,repeat:{...legacy.repeat,version:2}};
  assert.equal(fixedOccurrenceForDate(v2,'2026-10-12').date,'2026-10-12');
  assert.equal(fixedOccurrenceForDate(v2,'2026-10-12').title,'系列');
});

test('only-once postponement and advance retain independent slot identities and future defaults',()=>{
  const item=fixed({overrides:{'2026-10-12':{date:'2026-10-15',time:'18:00',title:'推迟'},'2026-10-14':{date:'2026-10-13',time:'16:27',title:'提前'}}});
  assert.equal(nextFixedOccurrence(item,cn('2026-10-12T16:00:00')).occurrence.repeat.scheduledDate,'2026-10-13');
  const collisions=fixedDueOccurrences(item,cn('2026-10-13T16:30:00'));
  assert.deepEqual(collisions.map(x=>x.repeat.scheduledDate),['2026-10-13','2026-10-14']);
  assert.equal(collisions[1].title,'提前');
  const postponed=fixedDueOccurrences(item,cn('2026-10-15T18:05:00'));
  assert.equal(postponed[0].repeat.scheduledDate,'2026-10-12');assert.equal(postponed[0].title,'推迟');
});

test('skip excludes only that slot; resume timestamp suppresses past slots without shifting anchor',()=>{
  const item=fixed({skippedDates:['2026-10-12'],resumeAfter:cn('2026-10-13T16:28:00').toISOString()});
  assert.equal(fixedOccurrenceForDate(item,'2026-10-12'),null);
  assert.equal(fixedDueOccurrences(item,cn('2026-10-13T16:30:00')).length,0);
  assert.equal(nextFixedOccurrence(item,cn('2026-10-13T16:28:00')).occurrence.repeat.scheduledDate,'2026-10-14');
  assert.equal(fixedDueOccurrences(item,cn('2026-10-14T16:30:00')).length,1);
});

test('notice time uses lead days across midnight; disabled notices still have a next display occurrence',()=>{
  const item=fixed({template:{time:'00:03',leadDays:2,notificationEnabled:false}});
  const next=nextFixedOccurrence(item,cn('2026-10-10T00:02:00'));
  assert.equal(next.occurrence.date,'2026-10-12');assert.equal(next.dueAt,'2026-10-09T16:03:00.000Z');
  assert.equal(next.occurrence.notificationEnabled,false);
  assert.equal(fixedDueOccurrences(item,cn('2026-10-10T00:05:00')).length,1);
});

test('end boundary includes the last slot and lets its delayed Cron send after next display ended',()=>{
  const item=fixed({endDate:'2026-10-12'});
  assert.equal(nextFixedOccurrence(item,cn('2026-10-12T16:28:00')).status,'ended');
  assert.equal(fixedDueOccurrences(item,cn('2026-10-12T16:30:00')).length,1);
  assert.equal(fixedDueOccurrences(item,cn('2026-10-13T16:30:00')).length,0);
});

test('fixed months, leap years, N-week slots and makeup workdays retain calendar anchors',()=>{
  assert.equal(nextFixedOccurrence(fixed({freq:'month',startDate:'2026-01-31'}),cn('2026-02-01T00:00:00')).occurrence.date,'2026-03-31');
  assert.equal(nextFixedOccurrence(fixed({freq:'year',startDate:'2024-02-29'}),cn('2025-03-01T00:00:00')).occurrence.date,'2028-02-29');
  const weekly=fixed({freq:'custom',unit:'week',interval:2,weekdays:[1,5]});
  assert.equal(nextFixedOccurrence(weekly,cn('2026-10-16T17:00:00')).occurrence.date,'2026-10-26');
  const work=fixed({freq:'weekday',startDate:'2026-10-09',workday:'actual'});
  assert.equal(fixedOccurrenceForDate(work,'2026-10-10').date,'2026-10-10');assert.equal(fixedOccurrenceForDate(work,'2026-10-11'),null);
});

test('unknown future workday calendar does not swallow the last known due; v1 unknown dates are never trusted',()=>{
  const item=fixed({freq:'weekday',startDate:'2026-12-31',workday:'actual'});
  assert.equal(nextFixedOccurrence(item,cn('2026-12-31T16:28:00')).status,'calendar_wait');
  assert.equal(fixedDueOccurrences(item,cn('2026-12-31T16:30:00'))[0].repeat.scheduledDate,'2026-12-31');
  const legacy=fixed({version:1,freq:'weekday',startDate:'2027-01-01',scheduledDate:'2027-01-01',workday:'actual',status:'calendar_wait'},{date:'2027-01-01'});
  assert.equal(fixedOccurrenceForDate(legacy,'2027-01-01'),null);
  assert.equal(fixedDueOccurrences(legacy,cn('2027-01-01T16:30:00')).length,0);
  assert.equal(nextFixedOccurrence(legacy,cn('2027-01-01T16:28:00')).status,'calendar_wait');
});

test('template and override allowlists cannot replace identity or scheduling fields; malformed times fail closed',()=>{
 const item=fixed({template:{id:'injected',repeat:{status:'ended'},date:'2099-01-01',title:'safe',time:'09:00',leadDays:0,notificationEnabled:true},overrides:{'2026-10-12':{id:'other',repeat:{status:'paused'}}}});
 const slot=fixedOccurrenceForDate(item,'2026-10-12');assert.equal(slot.id,'active');assert.equal(slot.date,'2026-10-12');assert.equal(slot.repeat.status,'active');
 assert.equal(Object.hasOwn(item.repeat.template,'id'),false);assert.equal(Object.hasOwn(item.repeat.overrides['2026-10-12'],'id'),false);
 for(const template of [{time:''},{time:'25:00'},{leadDays:-1},{leadDays:'bad'}])assert.throws(()=>fixed({template}));
});
