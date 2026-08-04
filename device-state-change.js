function numberChanged(previous,next,tolerance){if(previous==null&&next==null)return false;if(previous==null||next==null)return true;return Math.abs(Number(previous)-Number(next))>=tolerance;}
function deviceStateChanges(previous,event,{voltageTolerance=0.1,temperatureTolerance=0.2,inputVoltageTolerance=0.1}={}){
  if(!previous||!Array.isArray(previous.relays)||!Array.isArray(previous.inputs))return ['initial'];
  const changes=[];
  if(JSON.stringify(previous.relays)!==JSON.stringify(event.relays))changes.push('relays');
  for(let i=0;i<event.inputs.length;i++){const before=previous.inputs[i],after=event.inputs[i];if(!before||before.io!==after.io||before.name!==after.name||numberChanged(before.voltage,after.voltage,inputVoltageTolerance))changes.push(`input${i+1}`);}
  if(numberChanged(previous.voltage,event.voltage,voltageTolerance))changes.push('voltage');
  if(numberChanged(previous.temperature,event.temperature,temperatureTolerance))changes.push('temperature');
  if(String(previous.hostname||'')!==String(event.hostname||''))changes.push('hostname');
  if(String(previous.ipAddress||'')!==String(event.ipAddress||''))changes.push('ipAddress');
  return changes;
}
module.exports={deviceStateChanges,numberChanged};
