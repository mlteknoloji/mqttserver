function groupsForKey(key,groups){const ids=Array.isArray(key?.allowedGroupIds)?key.allowedGroupIds:[];return ids.length?groups.filter(group=>ids.includes(group.id)):groups;}
function usernamesForKey(key,groups){return new Set(groupsForKey(key,groups).flatMap(group=>group.members||[]).map(username=>String(username).toLowerCase()));}
function canAccessUser(key,groups,username){return usernamesForKey(key,groups).has(String(username||'').toLowerCase());}
function canAccessGroup(key,groups,id){return groupsForKey(key,groups).some(group=>group.id===Number(id));}
function filterDevices(key,groups,devices){const allowed=usernamesForKey(key,groups);return devices.filter(device=>allowed.has(String(device.username).toLowerCase()));}
module.exports={groupsForKey,usernamesForKey,canAccessUser,canAccessGroup,filterDevices};
