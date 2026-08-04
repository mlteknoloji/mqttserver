const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const english=JSON.parse(read('public/locales/en.json')).translations;
const turkish=JSON.parse(read('public/locales/tr.json'));

function viewFiles(){return fs.readdirSync(path.join(root,'views'),{recursive:true}).filter(file=>file.endsWith('.ejs')).map(file=>path.join(root,'views',file))}
function clientFiles(){return fs.readdirSync(path.join(root,'public')).filter(file=>file.endsWith('.js')).map(file=>path.join(root,'public',file))}

function collectRequiredMessages(){
  const messages=new Set();
  for(const file of viewFiles()){
    let source=fs.readFileSync(file,'utf8').replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<%[\s\S]*?%>/g,'');
    for(const match of source.matchAll(/>([^<>]+)</g)){
      const text=match[1].replace(/\s+/g,' ').trim();
      if(text.length>1&&/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(text)&&!/[{}=]/.test(text))messages.add(text);
    }
    for(const match of source.matchAll(/(?:placeholder|title|aria-label|data-tooltip)="([^"]+)"/g)){
      const text=match[1].trim();if(text&&!/[<%>]/.test(text))messages.add(text);
    }
  }
  for(const file of [...viewFiles(),...clientFiles()]){
    const source=fs.readFileSync(file,'utf8');
    for(const expression of [/(?:netrelayAlert|netrelayConfirm|confirm|alert)\(\s*['`]([^'`$]+)['`]/g,/(?:title|confirmButtonText|cancelButtonText)\s*:\s*['`]([^'`$]+)['`]/g]){
      for(const match of source.matchAll(expression)){const text=match[1].trim();if(text)messages.add(text)}
    }
  }
  return messages;
}

test('Türkçe kaynak katalog ve İngilizce katalog yapılandırması geçerli',()=>{
  assert.equal(turkish.sourceLanguage,true);
  assert.equal(turkish.catalogKeysFrom,'en.json');
  assert.ok(Object.keys(english).length>=400);
});

test('menü, açıklama, tooltip, placeholder ve Swal metinleri İngilizce kataloğunda eksiksiz',()=>{
  const required=collectRequiredMessages();
  const missing=[...required].filter(message=>!Object.hasOwn(english,message));
  assert.deepEqual(missing,[],`Eksik i18n anahtarları:\n${missing.join('\n')}`);
});

test('çeviri kataloglarında boş değer bulunmaz',()=>{
  const empty=Object.entries(english).filter(([key,value])=>!key.trim()||!String(value).trim());
  assert.deepEqual(empty,[]);
});

test('dinamik bölüm yetkisi adları dil kataloğunda bulunur',()=>{
  const permissionLabels=['Genel bakış ve cihazlar','Röle komutu','Zamanlanmış görevler','Firmware güncelleme','E-posta ayarları','MQTT blacklist','Sunucu logları','Kullanıcı yönetimi'];
  const missing=permissionLabels.filter(label=>!Object.hasOwn(english,label));
  assert.deepEqual(missing,[]);
});

test('dinamik cihaz grubu sayıları için çoğul çeviri şablonları bulunur',()=>{
  for(const key of ['{{count}} cihaz','{{name}} · {{count}} cihaz','{{name}} ({{count}} cihaz)'])assert.ok(Object.hasOwn(english,key),key);
});

test('sunucu logları için dil şablonları bulunur',()=>{
  const logTemplates=['Abonelik engellendi | Kullanıcı: {{user}} | Topic: {{topic}}','Yayın engellendi | Kullanıcı: {{user}} | Topic: {{topic}}','Kullanıcı: {{user}} | Client ID: {{clientId}}','Kullanıcı: {{user}} | Topic: {{topic}} | Mesaj: {{message}}'];
  const missing=logTemplates.filter(message=>!Object.hasOwn(english,message));
  assert.deepEqual(missing,[]);
});

test('header ve cihaz I/O durum metinleri çevrilebilir',()=>{
  for(const key of ['Canlı bağlantı aktif','Sistem Yöneticisi','Cihazdan henüz JSON verisi alınmadı.'])assert.ok(Object.hasOwn(english,key),key);
  assert.match(read('views/device-io.ejs'),/id="json" data-i18n-translate/);
});
