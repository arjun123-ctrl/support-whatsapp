import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { hashPassword } from "../src/lib/security.mjs";

const listener = createServer();
listener.listen(0,"127.0.0.1");
await once(listener,"listening");
const {port} = listener.address();
await new Promise((resolve) => listener.close(resolve));
const origin = "http://127.0.0.1:"+port;
Object.assign(process.env,{
  ADMIN_EMAIL:"admin@example.test",ADMIN_NAME:"Smoke admin",ADMIN_PASSWORD_HASH:hashPassword("smoke test password"),
  APP_BASE_URL:origin,META_APP_SECRET:"fixture-secret",MESSAGE_RETENTION_DAYS:"",
  WHATSAPP_VERIFY_TOKEN:"fixture-token",META_WABA_ID:"11",WHATSAPP_PHONE_NUMBER_ID:"22",WHATSAPP_ACCESS_TOKEN:"",
});
const server = spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p",String(port)],{stdio:["ignore","pipe","pipe"],windowsHide:true});
const stopped = once(server,"exit");
let logs = "";
server.stdout.on("data",(chunk)=>{logs+=chunk;});
server.stderr.on("data",(chunk)=>{logs+=chunk;});
const request = (path, options = {}) => fetch(origin+path,{redirect:"manual",signal:AbortSignal.timeout(12000),...options});
const workspace = (resource,cookie) => request("/api/workspace/"+resource,{headers:cookie ? {cookie} : {}});
async function post(resource, values, cookie) {
  const form = new FormData();
  for (const [key,value] of Object.entries(values)) form.set(key,value);
  return request("/api/workspace/"+resource,{method:"POST",body:form,headers:{origin,...(cookie ? {cookie} : {})}});
}
async function login(account) {
  const response = await post("login",{email:account+"@example.test",password:"smoke test password"});
  assert.equal(response.status,200);
  const header = response.headers.get("set-cookie");
  assert.match(header,/HttpOnly/i);
  assert.match(header,/Secure/i);
  return header.split(";")[0];
}
async function eventFrame(reader, expected) {
  const decoder = new TextDecoder();
  let content = "";
  while (!content.includes(expected)) {
    const chunk = await reader.read();
    assert.equal(chunk.done,false,"Event stream closed unexpectedly");
    content += decoder.decode(chunk.value,{stream:true});
  }
  return content;
}
try {
  let ready = false;
  for (let attempt=0;attempt<45;attempt++) {
    if (server.exitCode !== null) break;
    try { ready = (await request("/")).ok; } catch {}
    if (ready) break;
    await delay(250);
  }
  assert.ok(ready,logs);
  for (const [route,heading] of [["/","Smart NFC"],["/privacy-policy","Privacy policy"],["/terms-of-service","Terms of service"],["/data-deletion","Data deletion"],["/contact","Contact ARKNP"]]) {
    const response = await request(route);
    assert.equal(response.status,200);
    assert.ok((await response.text()).includes(heading),route);
  }
  assert.equal((await request("/dashboard")).status,307);
  assert.equal((await workspace("inbox")).status,401);
  assert.equal((await workspace("events")).status,401);
  const admin = await login("admin");
  assert.equal((await post("team",{email:"agent@example.test",name:"Agent",password:"smoke test password",role:"AGENT"},admin)).status,200);
  const agent = await login("agent");
  assert.equal((await workspace("settings",agent)).status,403);
  assert.equal((await workspace("settings",admin)).status,200);
  for (const route of ["","/conversations","/contacts","/templates","/team","/settings/whatsapp","/deletion-requests","/logs"]) {
    assert.equal((await request("/dashboard"+route,{headers:{cookie:admin}})).status,200,route);
  }
  const webhook = "/api/whatsapp/webhook";
  const verify = await request(webhook+"?hub.mode=subscribe&hub.verify_token=fixture-token&hub.challenge=0001");
  assert.equal(await verify.text(),"0001");
  const value = {metadata:{phone_number_id:"22"},messages:[{from:"919999999999",id:"wamid.smoke",type:"text",text:{body:"Smoke inbound"},timestamp:String(Math.floor(Date.now()/1000))}]};
  const body = JSON.stringify({object:"whatsapp_business_account",entry:[{id:"11",changes:[{field:"messages",value}]}]});
  const signature = "sha256="+createHmac("sha256","fixture-secret").update(body).digest("hex");
  assert.equal((await request(webhook,{method:"POST",body,headers:{"x-hub-signature-256":"invalid"}})).status,403);
  for (let i=0;i<2;i++) assert.equal((await request(webhook,{method:"POST",body,headers:{"x-hub-signature-256":signature}})).status,200);
  const listings = await (await workspace("inbox",admin)).json();
  const id = listings.items[0].id;
  const inbox = await (await workspace("inbox?id="+id,admin)).json();
  assert.equal(inbox.messages.length,1);
  assert.equal(inbox.messages[0].body,"Smoke inbound");
  assert.equal((await workspace("events?id="+id,agent)).status,404);
  assert.equal((await post("conversation",{id,status:"Open",agent:2,notes:"",tags:""},admin)).status,200);
  const sse = await workspace("events?id="+id,agent);
  assert.equal(sse.status,200);
  const reader = sse.body.getReader();
  try {
    assert.match(await eventFrame(reader,"Smoke inbound"),/data: /);
    assert.equal((await post("conversation",{id,status:"Open",agent:"",notes:"",tags:""},admin)).status,200);
    assert.match(await eventFrame(reader,"event: unavailable"),/event: unavailable/);
  } finally { await reader.cancel(); }
  const created = await post("public",{kind:"Delete my data",name:"Smoke tester",phone:"919999999999",consent:"yes"});
  assert.equal(created.status,201);
  const {reference:ref} = await created.json();
  assert.equal((await post("requests",{ref,action:"complete",acknowledged:"yes"},admin)).status,409);
  assert.equal((await post("requests",{ref,action:"verify",acknowledged:"yes"},admin)).status,200);
  assert.equal((await post("requests",{ref,action:"complete",acknowledged:"yes"},admin)).status,200);
  assert.equal((await workspace("inbox?id="+id,admin)).status,404);
  assert.equal((await (await workspace("inbox",admin)).json()).items.length,0);
  console.log("HTTP smoke passed: public pages, protected dashboard, authentication, role checks, webhook persistence, SSE access revocation, deletion.");
} catch (error) {
  process.stderr.write(logs);
  throw error;
} finally {
  server.kill();
  await stopped;
}
