import { randomInt, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";

const cacheKey = Symbol.for("arknp.workspace.cache");
const requestStore = new AsyncLocalStorage();
const stateKey = "{arknp-workspace}:state:v1";
const lockKey = "{arknp-workspace}:lock";
const acquire = `
  if not redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', 120000) then return false end
  return {redis.call('GET', KEYS[2]) or ''}
`;
const finish = `
  if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
  if ARGV[2] ~= '' then redis.call('SET', KEYS[2], ARGV[2]) end
  redis.call('DEL', KEYS[1])
  return 1
`;
export class WorkspaceStorageError extends Error {}
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
  const context = requestStore.getStore();
  if (context) return context.state[name];
  globalThis[cacheKey] ??= createCache();
  return globalThis[cacheKey][name];
}
export function sharedStorageRequired() {
  return Boolean(process.env.VERCEL || process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_TOKEN);
}
export function sharedStorageConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}
async function redis(command) {
  try {
    const url = new URL(process.env.UPSTASH_REDIS_REST_URL);
    if (url.protocol !== "https:") throw new Error("HTTPS required");
    const response = await fetch(url,{
      method:"POST",
      headers:{Authorization:"Bearer "+process.env.UPSTASH_REDIS_REST_TOKEN,"Content-Type":"application/json"},
      body:JSON.stringify(command),cache:"no-store",redirect:"error",signal:AbortSignal.timeout(5000),
    });
    const result = await response.json();
    if (!response.ok || result.error || !Object.hasOwn(result,"result")) throw new Error("Redis command failed");
    return result.result;
  } catch { throw new WorkspaceStorageError("Shared workspace storage unavailable"); }
}
function decode(raw) {
  const state = createCache();
  if (!raw) return state;
  try {
    const saved = JSON.parse(raw);
    for (const name of tables) state[name] = new Map(saved[name]);
    return state;
  } catch { throw new WorkspaceStorageError("Invalid shared workspace state"); }
}
function encode(state) {
  return JSON.stringify(Object.fromEntries(tables.map(name => [name,[...state[name]]])));
}
export async function withWorkspaceStore(operation,{readOnly=false}={}) {
  if (requestStore.getStore() || !sharedStorageRequired()) return operation();
  if (!sharedStorageConfigured()) throw new WorkspaceStorageError("Configure shared workspace storage");
  if (readOnly) {
    const state = decode(await redis(["GET",stateKey]));
    return requestStore.run({state,lastPrune:0},operation);
  }
  const owner = randomUUID();
  let acquired;
  for (let i=0;i<12;i++) {
    acquired = await redis(["EVAL",acquire,2,lockKey,stateKey,owner]);
    if (acquired) break;
    await delay(60 + randomInt(60));
  }
  if (!acquired) throw new WorkspaceStorageError("Shared workspace storage is busy");
  let serialized = "";
  let result;
  try {
    const state = decode(acquired[0]);
    const before = encode(state);
    result = await requestStore.run({state,lastPrune:0},operation);
    const after = encode(state);
    if (after !== before) serialized = after;
  } finally {
    if (await redis(["EVAL",finish,2,lockKey,stateKey,owner,serialized]) !== 1) {
      throw new WorkspaceStorageError("Shared workspace write did not commit");
    }
  }
  return result;
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
  const context = requestStore.getStore();
  if (now-(context?.lastPrune ?? lastPrune) < 60000) return;
  if (context) context.lastPrune = now;
  else lastPrune = now;
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
