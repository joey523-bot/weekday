import assert from 'node:assert/strict';
import test from 'node:test';
import { rankReminderTitles } from '../scripts/utils/reminder-suggestions.js';
test('frequency first then latest saved occurrence, trim duplicates and cap five', () => {
 const history = ['甲','乙','丙','丁','戊','己'].map((title,i)=>({title,createdAt:`2026-09-${10+i}`}));
 history.push({title:' 甲 ',createdAt:'2026-09-01'});
 assert.deepEqual(rankReminderTitles(history),['甲','己','戊','丁','丙']);
});
test('blank, empty and separate account histories; input filter', () => {
 assert.deepEqual(rankReminderTitles([]),[]);
 assert.deepEqual(rankReminderTitles([{title:' '}]),[]);
 assert.deepEqual(rankReminderTitles([{title:'账户乙'}]),['账户乙']);
 assert.deepEqual(rankReminderTitles([{title:'账户甲'}],'乙'),[]);
 assert.deepEqual(rankReminderTitles([{title:'续费手机'}],'手机'),['续费手机']);
});
test('completed history counts and stable ordering is independent of input order', () => {
 const history=[{title:'甲',createdAt:'2026-09-01',completed:true},{title:'乙',createdAt:'2026-09-02'}];
 assert.deepEqual(rankReminderTitles(history),['乙','甲']);
 assert.deepEqual(rankReminderTitles([...history].reverse()),['乙','甲']);
});
