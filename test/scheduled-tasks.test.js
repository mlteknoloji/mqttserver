const test=require('node:test');const assert=require('node:assert/strict');
const {compileCron,parseField}=require('../scheduled-tasks');
test('parseField aralık, liste, adım ve pazar alias değerlerini ayrıştırır',()=>{assert.deepEqual([...parseField('1-5/2,9',0,10)],[1,3,5,9]);assert.deepEqual([...parseField('7',0,7,true)],[0]);});
test('parseField geçersiz değerleri reddeder',()=>{assert.throws(()=>parseField('8',0,7));assert.throws(()=>parseField('5-2',0,7));assert.throws(()=>parseField('*/0',0,7));});
test('compileCron beş alanı derler',()=>{const cron=compileCron('*/15 8-17 * * 1-5');assert(cron[0].has(45));assert(cron[1].has(12));assert(cron[4].has(5));assert(!cron[4].has(0));});
test('compileCron eksik ifadeyi reddeder',()=>assert.throws(()=>compileCron('* * * *')));
