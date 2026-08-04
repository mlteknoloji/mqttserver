function parseNetRelayEvent(message, client, topic, now = () => new Date()) {
  try {
    const event=JSON.parse(message),received=()=>now().toISOString();
    if(event.type==='netrelay_relay_event'&&Number.isInteger(event.relay)&&event.relay>=1&&event.relay<=4&&(event.position===0||event.position===1))return {type:event.type,username:client.authenticatedUsername,clientId:client.id,topic,ipAddress:String(event.ipAddress||''),hostname:String(event.hostname||''),relay:event.relay,position:event.position,deviceUptimeMs:Number(event.deviceUptimeMs)||0,serverReceivedAt:received()};
    if(event.type==='netrelay_input_event'&&Number.isInteger(event.input)&&event.input>=1&&event.input<=4&&(event.io===0||event.io===1))return {type:event.type,mqttUsername:client.authenticatedUsername,deviceId:client.id,mqttEventTopic:topic,ipAddress:String(event.ipAddress||''),hostname:String(event.hostname||''),topic:String(event.topic||''),subtopic:String(event.subtopic||''),input:event.input,inputName:String(event.inputName||`input${event.input}`),io:event.io,voltage:Number(event.voltage)||0,deviceUptimeMs:Number(event.deviceUptimeMs)||0,serverReceivedAt:received()};
    const validStates=states=>Array.isArray(states)&&states.length===4&&states.every(x=>x===0||x===1),validInputs=Array.isArray(event.inputs)&&event.inputs.length===4&&event.inputs.every((x,i)=>x.input===i+1&&(x.io===0||x.io===1));
    if(event.type==='netrelay_device_status'&&validStates(event.relays)&&validInputs)return {type:event.type,mqttUsername:client.authenticatedUsername,deviceId:client.id,mqttEventTopic:topic,ipAddress:String(event.ipAddress||''),hostname:String(event.hostname||''),topic:String(event.topic||''),subtopic:String(event.subtopic||''),deviceUptimeMs:Number(event.deviceUptimeMs)||0,voltage:Number.isFinite(Number(event.voltage))?Number(event.voltage):null,temperature:Number.isFinite(Number(event.temperature))?Number(event.temperature):null,relays:event.relays,inputs:event.inputs.map(x=>({input:x.input,name:String(x.name||`input${x.input}`),io:x.io,voltage:Number(x.voltage)||0})),serverReceivedAt:received()};
  } catch {}
  const match=String(message).match(/NetRelay olay bilgisidir\.\s*Olay\s+(\d+)\s*-\s*(input\d+)\s*,?\s*=\s*([01])\s+oldu\.?/i);
  if(!match)return null;
  return {type:'netrelay_event',username:client.authenticatedUsername,clientId:client.id,topic,eventId:Number(match[1]),input:match[2].toLowerCase(),value:Number(match[3]),timestamp:now().toISOString()};
}
module.exports={parseNetRelayEvent};
