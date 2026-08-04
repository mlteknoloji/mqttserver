function stateChanges(previous,next){const changes={};for(const [key,value] of Object.entries(next)){if(key!=='type'&&JSON.stringify(value)!==JSON.stringify(previous?.[key]))changes[key]=value;}return changes;}
module.exports={stateChanges};
