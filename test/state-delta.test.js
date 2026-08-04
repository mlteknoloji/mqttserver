const test=require('node:test');const assert=require('node:assert/strict');const {stateChanges}=require('../state-delta');
test('yalnızca değişen durum alanlarını döndürür',()=>{const previous={type:'state',onlineClients:[{id:'a'}],logs:[1],blacklist:[]},next={type:'state',onlineClients:[{id:'a'}],logs:[2,1],blacklist:[]};assert.deepEqual(stateChanges(previous,next),{logs:[2,1]});});
test('type alanını delta paketine eklemez',()=>assert.deepEqual(stateChanges({type:'state'},{type:'state'}),{}));
