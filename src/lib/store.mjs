import { randomInt } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { databaseConfigured, databasePool } from "./database.mjs";

const cacheKey = Symbol.for("arknp.workspace.cache");
const databaseRequest = new AsyncLocalStorage();
const storagePath = resolve("data/workspace.json");
let writeQueue = Promise.resolve();
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
  return workspaceState()[name];
}
function workspaceState() {
  const context = databaseRequest.getStore();
  if (context) return context.state;
  if (globalThis[cacheKey]) return globalThis[cacheKey];
  const state = createCache();
  if (!process.env.VERCEL) {
    try {
      const saved = JSON.parse(readFileSync(storagePath,"utf8"));
      for (const name of tables) state[name] = new Map(saved[name]);
      const configuredAdmin = createCache().users.get(1);
      if (configuredAdmin) state.users.set(1,configuredAdmin);
    } catch (error) {
      if (error.code !== "ENOENT") throw new WorkspaceStorageError("Could not read local workspace storage",{cause:error});
    }
  }
  return (globalThis[cacheKey] = state);
}

function encode(state) {
  return JSON.stringify(Object.fromEntries(tables.map(name => [name,[...state[name]]])));
}

function decodeDatabaseState(payload) {
  const state = createCache();
  if (!payload) return state;
  const saved = typeof payload === "string" ? JSON.parse(payload) : payload;
  for (const name of tables) {
    if (Array.isArray(saved[name])) state[name] = new Map(saved[name]);
  }
  return state;
}

async function databaseStore(operation, readOnly) {
  const select = "SELECT payload FROM whatsapp_workspace_state WHERE id = 1";
  let connection;
  let state;
  try {
    const pool = databasePool();
    if (readOnly) {
      const [records] = await pool.query(select);
      state = decodeDatabaseState(records[0]?.payload);
    } else {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      await connection.execute(
        "INSERT INTO whatsapp_workspace_state (id,payload) VALUES (1,?) ON DUPLICATE KEY UPDATE id = id",
        [encode(createCache())],
      );
      const [records] = await connection.query(select + " FOR UPDATE");
      state = decodeDatabaseState(records[0]?.payload);
    }
  } catch (error) {
    if (connection) {
      await connection.rollback().catch(() => {});
      connection.release();
    }
    throw new WorkspaceStorageError("Could not load MySQL workspace storage",{cause:error});
  }
  try {
    const before = readOnly ? null : encode(state);
    const result = await databaseRequest.run({state,lastPrune:0},operation);
    if (connection) {
      try {
        const after = encode(state);
        if (before !== after) {
          await connection.execute("UPDATE whatsapp_workspace_state SET payload = ? WHERE id = 1",[after]);
        }
        await connection.commit();
      } catch (error) {
        throw new WorkspaceStorageError("Could not save MySQL workspace storage",{cause:error});
      }
    }
    return result;
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    throw error;
  } finally { connection?.release(); }
}

export function withWorkspaceStore(operation,{readOnly=false}={}) {
  if (databaseRequest.getStore()) return operation();
  if (databaseConfigured()) return databaseStore(operation,readOnly);
  if (process.env.VERCEL) throw new WorkspaceStorageError("Configure MySQL workspace storage");
  const run = writeQueue.then(async () => {
    const before = encode(workspaceState());
    const result = await operation();
    const after = encode(workspaceState());
    if (before !== after) {
      try {
        mkdirSync(dirname(storagePath),{recursive:true});
        const temp = storagePath + ".tmp";
        writeFileSync(temp,after,{mode:0o600});
        renameSync(temp,storagePath);
      } catch (error) {
        const previous = JSON.parse(before);
        globalThis[cacheKey] = Object.fromEntries(tables.map(name => [name,new Map(previous[name])]));
        throw new WorkspaceStorageError("Could not write local workspace storage",{cause:error});
      }
    }
    return result;
  });
  writeQueue = run.catch(() => {});
  return run;
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
  const context = databaseRequest.getStore();
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
