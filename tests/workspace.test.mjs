import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verify, receive, ingest } from "../src/lib/webhook.mjs";
import { rows, find, get, put, insert, update } from "../src/lib/store.mjs";
import { authenticate, digest, hashPassword, session, windowOpen } from "../src/lib/security.mjs";
import { snapshot, outbound } from "../src/lib/inbox.mjs";
import { eligibleTemplate, GraphError, send, templatePayload } from "../src/lib/meta.mjs";
import { validateRequest, submitRequest, reviewRequest } from "../src/lib/requests.mjs";

const admin = { id:1, role:"ADMIN" };
const agent = { id:2, role:"AGENT" };
const scope = { waba:"11",phoneId:"22" };
const now = Date.now();
const stamp = Math.floor(now/1000);
const payload = (value) => ({
  object:"whatsapp_business_account",
  entry:[{id:scope.waba,changes:[{field:"messages",value:{metadata:{phone_number_id:scope.phoneId},...value}}]}],
});
const message = { id:"wamid.inbound",from:"919999999999",type:"text",text:{body:"Hello"},timestamp:String(stamp) };
const signed = (value, signedWith = "test-secret") => {
  const raw = JSON.stringify(value);
  return new Request("http://localhost/api/whatsapp/webhook",{method:"POST",body:raw,headers:{
    "x-hub-signature-256":"sha256="+createHmac("sha256",signedWith).update(raw).digest("hex"),
  }});
};
const threadId = () => rows("conversations")[0].id;
before(() => {
  Object.assign(process.env,{ ADMIN_EMAIL:"",ADMIN_PASSWORD_HASH:"",META_APP_SECRET:"test-secret",META_WABA_ID:"11",
    WHATSAPP_PHONE_NUMBER_ID:"22",WHATSAPP_ACCESS_TOKEN:"fake-token",WHATSAPP_GRAPH_API_VERSION:"v25.0" });
  insert("users",{name:"Admin",email:"admin@example.test",role:"ADMIN",password:hashPassword("example test password"),active:1});
  insert("users",{name:"Agent",email:"agent@example.test",role:"AGENT",password:hashPassword("example agent password"),active:1});
});

test("verification returns the exact challenge and rejects unmatched tokens",async () => {
  const url = "http://localhost/?hub.mode=subscribe&hub.verify_token=abc&hub.challenge=0009";
  assert.equal(await verify(new Request(url),"abc").text(),"0009");
  assert.equal(verify(new Request(url),"xyz").status,403);
  assert.equal(verify(new Request("http://localhost/?hub.mode=subscribe&hub.verify_token=abc"),"abc").status,403);
});

test("signed inbound is stored once and invalid signatures are rejected",async () => {
  const event = payload({messages:[message],contacts:[{wa_id:message.from,profile:{name:"Test customer"}}]});
  assert.equal((await receive(signed(event,"wrong-secret"))).status,403);
  assert.equal((await receive(signed(event))).status,200);
  assert.equal((await receive(signed(event))).status,200);
  assert.equal(get("conversations",threadId()).unread,1);
  assert.equal(rows("messages")[0].body,"Hello");
  assert.equal(rows("contacts")[0].name,"Test customer");
});

test("sessions reject missing, invalid and disabled accounts",() => {
  assert.equal(session(null),null);
  assert.equal(authenticate("admin@example.test","wrong"),null);
  assert.equal(authenticate("admin@example.test","example test password").role,"ADMIN");
  put("sessions",digest("test"),{user_id:2,expires:now+60000});
  assert.equal(session("test").role,"AGENT");
  update("users",2,{active:0});
  assert.equal(session("test"),undefined);
  update("users",2,{active:1});
});

test("inbox snapshots only include authorized conversations and search is escaped",() => {
  assert.equal(snapshot(admin,0,"","",0,null).items.length,1);
  assert.equal(snapshot(admin,0,"%","",0,null).items.length,0);
  assert.equal(snapshot(agent,0,"","",0,null).items.length,0);
  assert.equal(snapshot(agent,threadId(),"","",0,null),null);
  update("conversations",threadId(),{agent_id:2});
  assert.equal(snapshot(agent,threadId(),"Test","",0,null).messages.length,1);
  update("conversations",threadId(),{agent_id:null});
  assert.equal(snapshot(agent,threadId(),"","",0,null),null);
});

test("delivery status never regresses on out-of-order callback",() => {
  insert("messages",{conversation_id:threadId(),meta_id:"wamid.out",direction:"out",kind:"text",status:"sent",stamp:now});
  ingest(payload({statuses:[{id:"wamid.out",status:"read",timestamp:stamp}]}),scope,now);
  ingest(payload({statuses:[{id:"wamid.out",status:"delivered",timestamp:stamp}]}),scope,now);
  assert.equal(find("messages",(row)=>row.meta_id==="wamid.out").status,"read");
});

test("Graph send request and errors use only mocked fetch",async () => {
  const result = await send(message.from,"text",{body:"Hi"},"ref",message.id,async (url, options) => {
    assert.equal(url,"https://graph.facebook.com/v25.0/22/messages");
    assert.equal(options.headers.Authorization,"Bearer fake-token");
    const data = JSON.parse(options.body);
    assert.equal(data.context.message_id,message.id);
    assert.equal(data.to,message.from);
    assert.equal(data.messaging_product,"whatsapp");
    return Response.json({messages:[{id:"fake"}]});
  });
  assert.equal(result.messages[0].id,"fake");
  await assert.rejects(send(message.from,"text",{body:"Hi"},"ref",null,async () =>
    Response.json({error:{code:131047}},{status:400})),(error)=>error instanceof GraphError && error.code==="131047");
});

test("outbound prevents unauthorized sends and enforces the 24-hour window",async () => {
  assert.ok(windowOpen(now-86399999,now));
  assert.ok(!windowOpen(now-86400000,now));
  const form = new FormData();
  form.set("requestId","c58ab64f-48f4-4ddc-833c-dd60e018a62a");
  form.set("body","Hello");
  assert.equal((await outbound(agent,threadId(),form)).status,404);
  update("conversations",threadId(),{last_inbound:now-86401000});
  assert.match((await outbound(admin,threadId(),form)).error,/window expired/);
});

test("approved template variables and consent are validated",() => {
  const template = { status:"APPROVED",category:"MARKETING",name:"test",language:"en_US",
    components:[{type:"BODY",text:"Hi {{1}}"}] };
  assert.equal(eligibleTemplate(template,"no"),false);
  assert.equal(eligibleTemplate(template,"yes"),true);
  assert.equal(eligibleTemplate({...template,status:"PENDING"},"yes"),false);
  assert.throws(()=>templatePayload(template,[]),/variables/);
  assert.equal(templatePayload(template,["Customer"]).components[0].parameters[0].text,"Customer");
});

test("outbound stores Meta acceptance and prevents duplicate API sends",async () => {
  update("conversations",threadId(),{last_inbound:Date.now()});
  const form = new FormData();
  const reference = "c58ab64f-48f4-4ddc-833c-dd60e018a62a";
  form.set("requestId",reference);
  form.set("body","Test response");
  let calls = 0;
  const mock = async (_url, options) => {
    calls += 1;
    assert.equal(JSON.parse(options.body).biz_opaque_callback_data,reference);
    return Response.json({messages:[{id:"wamid.accepted"}]});
  };
  assert.equal((await outbound(admin,threadId(),form,mock)).delivery,"accepted");
  assert.equal((await outbound(admin,threadId(),form,mock)).delivery,"sent");
  assert.equal(calls,1);
  assert.equal(find("messages",(row)=>row.request_id===reference).meta_id,"wamid.accepted");
});

test("deletion validates inputs and erases local data only after verification",() => {
  const form = new FormData();
  form.set("kind","Delete my data");
  form.set("name","Test");
  form.set("phone","+91 99999 99999");
  assert.equal(validateRequest(form),null);
  form.set("consent","yes");
  form.set("website","spam");
  assert.equal(validateRequest(form),null);
  form.delete("website");
  const ref = submitRequest(validateRequest(form));
  assert.equal(reviewRequest(ref,"complete",admin.id),false);
  assert.equal(reviewRequest(ref,"verify",admin.id),true);
  assert.equal(reviewRequest(ref,"complete",admin.id),true);
  assert.equal(rows("contacts").length,0);
  assert.equal(rows("messages").length,0);
  assert.equal(get("requests",ref).phone,null);
  ingest(payload({messages:[message]}),scope,now);
  assert.equal(rows("contacts").length,0);
});
