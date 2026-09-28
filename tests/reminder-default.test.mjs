import assert from 'node:assert/strict';
import test from 'node:test';
import { createReminderTimeDefault } from '../scripts/utils/reminder-default.js';
const refs = (date, hour = '9') => ({ reminderDateInput: { value: date }, reminderHourSelect: { value: hour }, reminderDateNotice: { textContent: '' } });
for (const [time, date, hour] of [
  ['2026-09-28T14:23:00', '2026-09-28', '15'],
  ['2026-09-28T14:00:00', '2026-09-28', '15'],
  ['2026-09-28T14:59:59', '2026-09-28', '15'],
  ['2026-09-28T22:59:59', '2026-09-28', '23'],
  ['2026-09-28T23:00:00', '2026-09-29', '0'],
  ['2026-09-28T23:59:59', '2026-09-29', '0'],
  ['2026-09-30T23:23:00', '2026-10-01', '0'],
  ['2026-12-31T23:23:00', '2027-01-01', '0'],
  ['2028-02-29T23:23:00', '2028-03-01', '0'],
  ['2026-09-29T00:00:00', '2026-09-29', '1']
]) test(`next hour ${time}`, () => {
  const r = refs(time.slice(0, 10)); const d = createReminderTimeDefault();
  d.apply(r, false, new Date(time));
  assert.equal(r.reminderDateInput.value, date); assert.equal(r.reminderHourSelect.value, hour);
  if (hour === '0') { assert.match(r.reminderDateNotice.textContent, /次日/); assert.ok(r.reminderDateNotice.textContent.includes(date)); }
  const notice = r.reminderDateNotice.textContent;
  d.apply(r, false, new Date(time)); // native input + change must not undo rollover
  assert.equal(r.reminderHourSelect.value, hour); assert.equal(r.reminderDateNotice.textContent, notice);
});
test('date switches restore 9 for non-today and recalculate today', () => {
  const r = refs('2026-09-28'); const d = createReminderTimeDefault(); const now = new Date('2026-09-28T14:23:00');
  d.apply(r, false, now); r.reminderDateInput.value = '2026-09-30'; d.apply(r, false, now); assert.equal(r.reminderHourSelect.value, '9');
  r.reminderDateInput.value = '2026-09-28'; d.apply(r, false, now); assert.equal(r.reminderHourSelect.value, '15');
});
test('manual hour survives date switches including 23h; reset enables defaults again', () => {
  const r = refs('2026-09-30', '6'); const d = createReminderTimeDefault(); d.markManual();
  r.reminderDateInput.value = '2026-09-28'; d.apply(r, false, new Date('2026-09-28T23:23:00'));
  assert.equal(r.reminderHourSelect.value, '6'); assert.equal(r.reminderDateInput.value, '2026-09-28');
  d.reset(); d.apply(r, false, new Date('2026-09-28T14:23:00')); assert.equal(r.reminderHourSelect.value, '15');
});
test('editing never replaces existing date or time', () => {
  const r = refs('2026-09-28', '0'); createReminderTimeDefault().apply(r, true, new Date('2026-09-28T23:23:00'));
  assert.equal(r.reminderDateInput.value, '2026-09-28'); assert.equal(r.reminderHourSelect.value, '0');
});
