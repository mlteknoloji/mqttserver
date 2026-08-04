const Database=require('better-sqlite3');
function createHomeAssistantDiscovery({databasePath}){
  const db=new Database(databasePath);
  db.exec(`CREATE TABLE IF NOT EXISTS home_assistant_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0,prefix TEXT NOT NULL DEFAULT 'homeassistant',updated_at INTEGER NOT NULL DEFAULT 0);INSERT OR IGNORE INTO home_assistant_settings(id)VALUES(1);`);
  const columns=db.prepare('PRAGMA table_info(home_assistant_settings)').all().map(x=>x.name);
  if(!columns.includes('mqtt_username'))db.exec("ALTER TABLE home_assistant_settings ADD COLUMN mqtt_username TEXT NOT NULL DEFAULT 'homeassistant'");
  const get=()=>{const r=db.prepare('SELECT * FROM home_assistant_settings WHERE id=1').get();return{enabled:r.enabled===1,prefix:r.prefix,mqttUsername:r.mqtt_username,updatedAt:r.updated_at}};
  function save(input){const prefix=String(input.prefix||'homeassistant').trim(),mqttUsername=String(input.mqttUsername||'homeassistant').trim();if(!/^[a-zA-Z0-9_/-]{1,100}$/.test(prefix))throw new Error('Discovery prefix geçersiz.');if(!/^[A-Za-z0-9._-]{1,100}$/.test(mqttUsername))throw new Error('Home Assistant MQTT kullanıcı adı geçersiz.');db.prepare('UPDATE home_assistant_settings SET enabled=?,prefix=?,mqtt_username=?,updated_at=? WHERE id=1').run(input.enabled?1:0,prefix,mqttUsername,Date.now());return get();}
  function messages(username){const s=get();if(!s.enabled)return[];const eventTopic=`netrelay/${username}/events`,device={identifiers:[`netrelay_${username}`],name:`NetRelay ${username}`,manufacturer:'NetRelay',model:'4 Input / 4 Relay'};
    const relays=[1,2,3,4].map(relay=>({topic:`${s.prefix}/switch/netrelay_${username}_relay_${relay}/config`,payload:{name:`${username} Röle ${relay}`,unique_id:`netrelay_${username}_relay_${relay}`,command_topic:`netrelay/${username}/command`,state_topic:eventTopic,payload_on:JSON.stringify({type:'netrelay',command:'set',targetUsername:username,relays:[relay],position:1,delay:0}),payload_off:JSON.stringify({type:'netrelay',command:'set',targetUsername:username,relays:[relay],position:0,delay:0}),value_template:`{{ value_json.relays[${relay-1}] if value_json.type == 'netrelay_device_status' else none }}`,state_on:'1',state_off:'0',device}}));
    const inputs=[1,2,3,4].map(input=>({topic:`${s.prefix}/binary_sensor/netrelay_${username}_input_${input}/config`,payload:{name:`${username} Input ${input}`,unique_id:`netrelay_${username}_input_${input}`,state_topic:eventTopic,payload_on:'1',payload_off:'0',value_template:`{{ value_json.io if value_json.type == 'netrelay_input_event' and value_json.input == ${input} else value_json.inputs[${input-1}].io if value_json.type == 'netrelay_device_status' else none }}`,device}}));
    return [...relays,...inputs];
  }
  return{get,save,messages,close:()=>db.close()};
}
module.exports={createHomeAssistantDiscovery};
