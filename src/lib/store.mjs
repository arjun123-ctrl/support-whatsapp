import { randomInt } from "node:crypto";

const cacheKey = Symbol.for("arknp.workspace.cache");
const tables = ["users","sessions","contacts","conversations","messages","receipts","inbound_keys","webhook_meta","webhook_failures","rate_limits","audit","requests"];

function createCache() {
  const state = Object.fromEntries(tables.map((name) => [name,new Map()]));
  const address = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD_HASH;
  if (address && /^[a-f0-9]{64}:[a-f0-9]{128}$/.test(password || "")) {
    state.users.set(1,{id:1,name:process.env.ADMIN_NAME || "Administrator",email:address,password,role:"ADMIN",active:1});
  }
  return state;
}

function table(name) {
  globalThis[cacheKey] ??= createCache();
  return globalThis[cacheKey][name];
}
export const get = (name,key) => table(name).get(key);
export const rows = (name) => [...table(name).values()];
export const find = (name,test) => rows(name).find(test);
export const put = (name,key,value) => table(name).set(key,value);
export const remove = (name,key) => table(name).delete(key);
export function insert(name,value) {
  let id;
  if (name === "conversations" || name === "messages") {
    do { id = randomInt(1,1000000000); } while (get(name,id));
  } else {
    const records = rows(name);
    id = records.length ? records.at(-1).id+1 : 1;
  }
  const row = { ...value,id };
  put(name,id,row);
  return row;
}
export function update(name,key,fields) {
  const row = get(name,key);
  if (row) Object.assign(row,fields);
}
export function trim(name,test) {
  for (const [key,row] of table(name)) if (test(row)) remove(name,key);
}

export function removeConversation(id) {
  for (const message of rows("messages")) {
    if (message.conversation_id !== id) continue;
    remove("receipts",message.meta_id);
    remove("messages",message.id);
  }
  remove("conversations",id);
}
export function audit(event, actor = null, detail = null) {
  insert("audit",{actor,event,detail,stamp:Date.now()});
  const records = rows("audit");
  if (records.length > 1000) remove("audit",records[0].id);
}
export function limited(key,limit,period) {
  const now = Date.now();
  trim("rate_limits",(entry) => entry.expires <= now);
  const entry = get("rate_limits",key) || {count:0,expires:now+period};
  entry.count += 1;
  put("rate_limits",key,entry);
  return entry.count > limit;
}
export function pendingRequests() {
  return rows("requests").filter((item)=>!item.resolved).length;
}
export function users() {
  return rows("users").map(({id,name,email,role,active})=>({id,name,email,role,active})).sort((a,b)=>a.name.localeCompare(b.name));
}
export const newest = (a,b) => b.stamp-a.stamp || b.id-a.id;

let lastPrune = 0;
export function pruneCache(now = Date.now()) {
  if (now-lastPrune < 60000) return;
  lastPrune = now;
  const days = Number(process.env.MESSAGE_RETENTION_DAYS);
  const cutoff = Number.isSafeInteger(days) && days > 0 ? now - days*86400000 : null;
  trim("sessions",(row)=>row.expires <= now);
  trim("inbound_keys",(stamp)=>stamp < now-8*86400000);
  if (cutoff === null) return;
  trim("messages",(row)=>row.stamp < cutoff);
  trim("receipts",(row)=>row.stamp < cutoff);
  trim("webhook_failures",(row)=>row.stamp < cutoff);
  for (const thread of rows("conversations")) {
    if (thread.last_message < cutoff) removeConversation(thread.id);
    else thread.unread = Math.min(thread.unread,rows("messages").filter((m)=>m.conversation_id===thread.id && m.direction==="in").length);
  }
}
