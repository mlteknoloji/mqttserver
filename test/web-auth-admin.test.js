const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createWebAuthStore}=require('../web-auth');

function store(){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'netrelay-admin-'));const auth=createWebAuthStore({databasePath:path.join(directory,'auth.db')});return{auth,close(){auth.close();fs.rmSync(directory,{recursive:true,force:true})}}}
const password='Guvenli-Test-123!';

test('son aktif yönetici pasif yapılamaz veya kullanıcı rolüne düşürülemez',()=>{
  const fixture=store();try{const actor=fixture.auth.listUsers()[0];
    assert.throws(()=>fixture.auth.saveUser({...actor,role:'user',enabled:true,password:''},actor));
    assert.throws(()=>fixture.auth.saveUser({...actor,role:'admin',enabled:false,password:''},actor));
    assert.equal(fixture.auth.listUsers().filter(user=>user.role==='admin'&&user.enabled).length,1);
  }finally{fixture.close()}
});

test('başka aktif yönetici varken yönetici hesabı kaldırılabilir',()=>{
  const fixture=store();try{const actor=fixture.auth.listUsers()[0],secondId=fixture.auth.saveUser({username:'admin2@example.com',displayName:'Admin 2',password,role:'admin',enabled:true,permissions:[]},actor),second=fixture.auth.listUsers().find(user=>user.id===secondId);
    fixture.auth.removeUser(actor.id,second);
    assert.equal(fixture.auth.listUsers().filter(user=>user.role==='admin'&&user.enabled).length,1);
  }finally{fixture.close()}
});
