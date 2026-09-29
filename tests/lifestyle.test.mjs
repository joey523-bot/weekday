import test from 'node:test';
import assert from 'node:assert/strict';
import { greetingFor, isWeatherFresh, moonFor, moonPhaseInfo, clothingFor } from '../scripts/utils/lifestyle.js';
const now=new Date('2026-09-29T07:00:00Z');
const fresh={timezone:'Asia/Shanghai',observedAt:'2026-09-29T15:00',rain:1};
test('freshness uses weather timezone, rejects stale, future and unknown timestamps',()=>{
 assert.equal(isWeatherFresh(fresh,now),true);
 for(const data of [{...fresh,observedAt:'2026-09-29T10:00'},{...fresh,observedAt:'2026-09-29T16:00'},{...fresh,timezone:'invalid'},{}])assert.equal(isWeatherFresh(data,now),false);
 assert.equal(isWeatherFresh({timezone:'America/New_York',observedAt:'2026-09-29T03:00'},now),true);
});
test('greeting priority payday then rain then stable time fallback',()=>{
 assert.match(greetingFor({salaryDay:5,weather:{...fresh,observedAt:'2026-09-30T12:00'},now:new Date(2026,8,30,12)}),/发薪/);
 assert.match(greetingFor({salaryDay:15,weather:fresh,now}),/雨伞/);
 assert.doesNotMatch(greetingFor({salaryDay:15,weather:{...fresh,observedAt:'2026-09-28T15:00'},now}),/雨/);
 assert.equal(greetingFor({salaryDay:15,now}),greetingFor({salaryDay:15,now}));
});
test('lunar phase handles key shapes and missing values',()=>{
 assert.equal(moonPhaseInfo(0).name,'新月');assert.equal(moonPhaseInfo(.25).name,'上弦月');assert.equal(moonPhaseInfo(.5).illumination,100);assert.equal(moonPhaseInfo(.75).name,'下弦月');
 for(const value of [null,undefined,NaN,-.1,1.1])assert.equal(moonPhaseInfo(value),null);
});
test('moon pairs late rise with next local day set and avoids stale cloud data',()=>{
 const report={...fresh,nightCloudCover:42,dailyForecast:[{date:'2026-09-29',moonPhase:.6,moonrise:'2026-09-29T19:02',moonset:'2026-09-29T08:13'},{date:'2026-09-30',moonPhase:.625,moonrise:'2026-09-30T19:46',moonset:'2026-09-30T09:23'}]};
 assert.equal(moonFor(report,now).set,'2026-09-30T09:23');assert.equal(moonFor(report,now).cloud,42);
 assert.equal(moonFor({...report,observedAt:'2026-09-28T15:00'},now).cloud,null);
 assert.equal(moonFor({...report,timezone:'invalid'},now),null);
 assert.equal(moonFor({...report,dailyForecast:report.dailyForecast.slice(0,1)},now).set,'');
});
test('daytime rise stays daytime and missing lunar data does not fabricate a phase',()=>{
 const report={...fresh,dailyForecast:[{date:'2026-09-29',moonPhase:.25,moonrise:'2026-09-29T12:00',moonset:'2026-09-29T23:00'}]};
 assert.equal(moonFor(report,now).rise,'2026-09-29T12:00');assert.equal(moonFor(report,now).set,'2026-09-29T23:00');assert.equal(moonFor({...fresh,dailyForecast:[]},now),null);
});
test('clothing uses feels-like, daily range, wind and rain without treating missing temperature as zero',()=>{
 assert.equal(clothingFor({}),null);assert.equal(clothingFor({temperature:null}),null);
 const outfit=clothingFor({temperature:28,apparentTemperature:14,windSpeed:30,rainProbability:60,dailyForecast:[{low:10,high:22}]});
 assert.equal(outfit.kind,'warm');for(const word of ['温差','防风','带伞'])assert.ok(outfit.detail.includes(word));
 assert.equal(clothingFor({temperature:25}).kind,'light');assert.equal(clothingFor({temperature:20}).kind,'layer');
});
