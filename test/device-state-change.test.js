const test=require('node:test');const assert=require('node:assert/strict');const {deviceStateChanges}=require('../device-state-change');
const state={relays:[0,0,0,0],inputs:[1,2,3,4].map(input=>({input,name:`input${input}`,io:0,voltage:0})),voltage:12.1,temperature:24,hostname:'kart',ipAddress:'192.168.1.10'};
test('ilk cihaz durumunu kaydeder',()=>assert.deepEqual(deviceStateChanges(null,state),['initial']));
test('aynı periyodik durum paketini değişiklik saymaz',()=>assert.deepEqual(deviceStateChanges(state,{...state,deviceUptimeMs:5000}),[]));
test('röle ve input değişikliklerini bulur',()=>{const next={...state,relays:[1,0,0,0],inputs:state.inputs.map((x,i)=>i===1?{...x,io:1}:x)};assert.deepEqual(deviceStateChanges(state,next),['relays','input2']);});
test('küçük sensör oynamalarını filtreler',()=>{assert.deepEqual(deviceStateChanges(state,{...state,voltage:12.15,temperature:24.1}),[]);assert.deepEqual(deviceStateChanges(state,{...state,voltage:12.3,temperature:24.3}),['voltage','temperature']);});
