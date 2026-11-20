import { NextResponse } from "next/server";
import { rows, get, find, put, remove, insert, update, users, pendingRequests, audit, limited } from "@/lib/store.mjs";
import { authenticate, clientKey, cookieName, digest, email, hashPassword, localWorkspaceUser, nonce, phone, text, windowOpen, workspaceUser } from "@/lib/security.mjs";
import { messageReactions, reactionLifetime } from "@/lib/message-reactions.mjs";
import { outbound, snapshot, thread, timeline } from "@/lib/inbox.mjs";
import { config, graph, GraphError, markRead, send, templates, uploadTemplateImage } from "@/lib/meta.mjs";
import { boundedBody } from "@/lib/webhook.mjs";
import { reviewRequest, submitRequest, validateRequest } from "@/lib/requests.mjs";

export const runtime = "nodejs";
const json = (data, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (status, error) => json({ error }, status);
const token = (request) => request.cookies.get(cookieName)?.value;
const int = (value) => /^\d{1,9}$/.test(value || "") ? Number(value) : 0;
const cookie = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" };
const admin = (user) => user.role === "ADMIN";
const siteOrigin = (request) => new URL(process.env.APP_BASE_URL || request.url).origin;

function readQuery(request) {
  const q = request.nextUrl.searchParams;
  return [int(q.get("id")),q.get("q") || "",q.get("filter") || "",Math.min(int(q.get("page")),10000),int(q.get("before")) || null];
}
function events(request, args) {
  let stop = () => {};
  const body = new ReadableStream({
    start(controller) {
      let previous;
      const timer = setInterval(tick, 2200);
      const expiry = setTimeout(close, 55000);
      stop = close;
      function close() {
        clearInterval(timer);
        clearTimeout(expiry);
        request.signal.removeEventListener("abort",close);
        try { controller.close(); } catch {}
      }
      function tick() {
        try {
          const user = workspaceUser(token(request), request.headers);
          const data = user && snapshot(user,...args);
          if (!data) {
            controller.enqueue("event: unavailable\ndata: {}\n\n");
            close();
            return;
          }
          const next = JSON.stringify(data);
          controller.enqueue(next === previous ? ": heartbeat\n\n" : "data: " + next + "\n\n");
          previous = next;
        } catch { close(); }
      }
      request.signal.addEventListener("abort",close,{ once:true });
      tick();
    },
    cancel() { stop(); },
  }).pipeThrough(new TextEncoderStream());
  return new Response(body,{ headers: { "Content-Type":"text/event-stream","Cache-Control":"no-store, no-transform","X-Accel-Buffering":"no" } });
}
const metaFailure = (user, error) => {
  audit("meta_api_error",user.id,error instanceof GraphError ? error.code : "request_failed");
  if (error instanceof GraphError && error.code === "190") return fail(502,"Meta rejected the WhatsApp access token. Update WHATSAPP_ACCESS_TOKEN with a valid token that has whatsapp_business_management permission.");
  return fail(502,error instanceof GraphError ? "Meta request failed, code " + error.code : "Check Meta configuration and connectivity.");
};
export async function GET(request, { params }) {
  const { resource } = await params;
  const user = workspaceUser(token(request), request.headers);
  if (!user) return fail(401,"Sign in required");
  const q = request.nextUrl.searchParams;
  if (resource === "inbox" || resource === "events") {
    if (limited(resource + ":" + user.id,resource === "events" ? 60 : 120,60000)) return fail(429,"Too many requests");
    const args = readQuery(request);
    const data = snapshot(user,...args);
    if (!data) return fail(404,"Conversation unavailable");
    return resource === "events" ? events(request,args) : json(data);
  }
  if (resource === "templates") {
    if (limited("templates:" + user.id,20,60000)) return fail(429,"Too many requests");
    try { return json((await templates()).filter((item) => admin(user) || item.status === "APPROVED")); }
    catch (error) { return metaFailure(user,error); }
  }
  if (resource === "media") {
    if (limited("media:" + user.id,60,60000)) return fail(429,"Too many requests");
    const message = get("messages",int(q.get("id")));
    if (!message?.media || !thread(user,message.conversation_id)) return fail(404,"Attachment unavailable");
    try {
      const info = await graph(message.media + "?phone_number_id=" + config().phone);
      const url = new URL(info.url);
      if (url.protocol !== "https:" || url.port || url.username || url.password ||
          !["lookaside.fbsbx.com","lookaside.facebook.com"].includes(url.hostname)) return fail(502,"Invalid media location");
      const response = await fetch(url,{ headers: { Authorization:"Bearer " + config().token },redirect:"error",signal:AbortSignal.timeout(12000),cache:"no-store" });
      if (!response.ok) return fail(502,"Attachment expired or unavailable");
      const type = response.headers.get("content-type")?.split(";")[0] || "";
      const inline = ["image/jpeg","image/png","audio/mpeg","audio/ogg","video/mp4"].includes(type);
      return new Response(response.body,{ headers: { "Content-Type":inline ? type : "application/octet-stream",
        "Content-Disposition":inline ? "inline" : "attachment", "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox" } });
    } catch (error) { return metaFailure(user,error); }
  }
  if (!admin(user)) return fail(403,"Administrator access required");
  if (resource === "request-count") return json({total:pendingRequests()});
  if (resource === "team") return json(users().slice(0,250));
  if (resource === "requests") return json(rows("requests").sort((a,b)=>Number(Boolean(a.resolved))-Number(Boolean(b.resolved)) || b.created-a.created).slice(0,150));
  if (resource === "logs") return json(rows("audit").reverse().slice(0,100));
  if (resource === "settings") return json({
    appId:process.env.META_APP_ID || "1590874105306623", waba:process.env.META_WABA_ID || "",
    phoneId:process.env.WHATSAPP_PHONE_NUMBER_ID || "", version:process.env.WHATSAPP_GRAPH_API_VERSION || "v25.0",
    webhook:process.env.WHATSAPP_WEBHOOK_URL || siteOrigin(request) + "/api/whatsapp/webhook",
    activity:Object.fromEntries(rows("webhook_meta").map((row) => [row.key,row.stamp])),
    deliveredTemplates:rows("messages").filter((row)=>row.kind==="template" && ["delivered","read"].includes(row.status)).length,
    repeatedWebhookFailures:rows("webhook_failures").filter((row)=>row.attempts>=5).length,
    errors:rows("audit").reverse().filter((row)=>/^(meta_|webhook_)/.test(row.event)).slice(0,10),
  });
  return fail(404,"Unknown resource");
}
export async function POST(request,{ params }) {
  const { resource } = await params;
  const origin = request.headers.get("origin");
  const localOrigin = localWorkspaceUser(request.headers) && origin === "http://" + request.headers.get("host");
  if (origin !== siteOrigin(request) && !localOrigin) return fail(403,"Invalid request origin");
  const publicRoute = ["login","public"].includes(resource);
  const user = workspaceUser(token(request), request.headers);
  if (!publicRoute && !user) return fail(401,"Sign in required");
  if (["team","requests","settings","templates"].includes(resource) && !admin(user)) return fail(403,"Administrator access required");
  const actor = user?.id || clientKey(request.headers);
  if (limited(resource + ":post:" + actor,publicRoute ? (resource === "login" ? 12 : 5) : 60,publicRoute ? 900000 : 60000)) return fail(429,"Too many requests. Try again later.");
  const maximum = resource === "send" ? 17*1024*1024 : resource === "templates" ? 4*1024*1024 : 24*1024;
  const raw = await boundedBody(request,maximum);
  if (!raw) return fail(413,"Submission too large");
  let form;
  try { form = await new Response(raw,{ headers: { "Content-Type":request.headers.get("content-type") || "" } }).formData(); }
  catch { return fail(400,"Invalid form"); }
  if (resource === "templates") {
    const name = text(form.get("name"),513);
    const language = text(form.get("language"),10);
    const category = form.get("category");
    const body = text(form.get("body"),1025);
    if (!/^[a-z0-9_]{1,512}$/.test(name)) return fail(400,"Use lowercase letters, numbers or underscores in the template name.");
    if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)) return fail(400,"Enter a Meta language code such as en_US or hi.");
    if (!["UTILITY","MARKETING"].includes(category)) return fail(400,"Select Utility or Marketing.");
    if (!body || body.length > 1024) return fail(400,"Enter a message body of up to 1024 characters.");
    const placeholder = /{{([1-9]\d*)}}/g;
    const indexes = [...new Set([...body.matchAll(placeholder)].map((match) => Number(match[1])))].sort((a,b) => a-b);
    const examples = String(form.get("examples") || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (/{{|}}/.test(body.replace(placeholder,"")) || indexes.some((index,i) => index !== i+1) ||
        examples.length !== indexes.length || examples.some((example) => example.length > 1024)) {
      return fail(400,"Use consecutive variables like {{1}} and {{2}}, with one example per variable in order.");
    }
    const component = {type:"BODY",text:body};
    if (examples.length) component.example = {body_text:[examples]};
    const footer = text(form.get("footer"),61);
    if (footer.length > 60 || /[\r\n]/.test(footer)) return fail(400,"Use up to 60 characters on one line for the footer.");
    const image = form.get("image");
    if (image?.size && (!["image/png","image/jpeg"].includes(image.type) || image.size > 3500000)) {
      return fail(400,"Choose a PNG or JPEG image up to 3.5 MB.");
    }
    const labels = form.getAll("buttonLabel");
    const types = form.getAll("buttonType");
    const targets = form.getAll("buttonTarget");
    const samples = form.getAll("buttonSample");
    if (labels.length > 10 || [types,targets,samples].some(values => values.length !== labels.length)) return fail(400,"Invalid template buttons.");
    const buttons = [];
    for (let i = 0; i < labels.length; i++) {
      const label = text(labels[i],21);
      const target = text(targets[i],301);
      if (!label || label.length > 20 || /[\r\n{}]/.test(label)) return fail(400,"Enter a button label of up to 20 characters.");
      if (types[i] === "URL") {
        const dynamic = target.endsWith("{{1}}");
        const base = dynamic ? target.slice(0,-5) : target;
        const sample = text(samples[i],301);
        if (target.length > 300 || !/^https:\/\/[^\s{}]+$/.test(base) ||
            (dynamic && (!sample.startsWith(base) || sample === base || /[\s{}]/.test(sample) || sample.length > 300))) {
          return fail(400,"Use an HTTPS button URL. For a URL ending in {{1}}, provide its full sample URL.");
        }
        buttons.push({type:"URL",text:label,url:target,...(dynamic ? {example:[sample]} : {})});
      } else if (types[i] === "PHONE_NUMBER" && /^\+?[1-9]\d{6,14}$/.test(target)) {
        buttons.push({type:"PHONE_NUMBER",text:label,phone_number:"+" + target.replace(/^\+/,"")});
      } else if (types[i] === "QUICK_REPLY") {
        buttons.push({type:"QUICK_REPLY",text:label});
      } else return fail(400,"Enter a phone number with country code or choose a valid button type.");
    }
    if (buttons.filter(button => button.type === "URL").length > 2 ||
        buttons.filter(button => button.type === "PHONE_NUMBER").length > 1 ||
        buttons.filter(button => button.type === "QUICK_REPLY").length > 8) return fail(400,"Too many buttons of the same type.");
    const id = form.get("templateId");
    if (id && (typeof id !== "string" || !/^\d+$/.test(id))) return fail(400,"Invalid template ID.");
    try {
      if (id && !(await templates()).some(item => String(item.id) === id && item.name === name && item.language === language)) {
        return fail(404,"Template unavailable on this WhatsApp account.");
      }
      const components = [component];
      if (image?.size) components.unshift({type:"HEADER",format:"IMAGE",example:{header_handle:[await uploadTemplateImage(image)]}});
      if (footer) components.push({type:"FOOTER",text:footer});
      if (buttons.length) components.push({type:"BUTTONS",buttons});
      const result = id ? await graph(id,{category,components}) :
        await graph(config().waba + "/message_templates",{name,language,category,components});
      audit("template_submitted",user.id,name);
      return json({id:result.id || id,status:result.status},id ? 200 : 201);
    } catch (error) { return metaFailure(user,error); }
  }
  if (resource === "login") {
    const address = email(form.get("email"));
    const password = form.get("password");
    if (!address || typeof password !== "string" || password.length > 256 || limited("login:account:" + digest(address),8,900000)) return fail(401,"Invalid credentials or sign-in temporarily unavailable");
    const match = authenticate(address,password);
    if (!match) return fail(401,"Invalid credentials or sign-in temporarily unavailable");
    const key = nonce();
    put("sessions",digest(key),{user_id:match.id,expires:Date.now()+28800000});
    audit("sign_in",match.id);
    const res = json({ ok:true });
    res.cookies.set(cookieName,key,{ ...cookie,maxAge:28800 });
    return res;
  }
  if (resource === "logout") {
    remove("sessions",digest(token(request)));
    const res = json({ ok:true });
    res.cookies.set(cookieName,"",{ ...cookie,maxAge:0 });
    return res;
  }
  if (resource === "public") {
    const input = validateRequest(form);
    if (!input) return fail(400,"Check your contact details and required fields.");
    if (limited("request:phone:" + digest(input.number),3,3600000)) return fail(429,"Request limit reached");
    return json({ reference:submitRequest(input) },201);
  }
  const id = int(form.get("id"));
  if (resource === "message-action") {
    const current = thread(user,id);
    const message = get("messages",int(form.get("message")));
    if (!current || !message || message.conversation_id !== id) return fail(404,"Message unavailable");
    const action = form.get("action");
    if (action === "star" || action === "unstar") {
      const starredBy = new Set(message.starred_by || []);
      if (action === "star") starredBy.add(user.id);
      else starredBy.delete(user.id);
      update("messages",message.id,{starred_by:[...starredBy]});
      return json({ok:true});
    }
    if (action !== "react") return fail(400,"Invalid message action");
    const emoji = form.get("emoji");
    if (emoji !== "" && !messageReactions.includes(emoji)) return fail(400,"Choose a supported reaction");
    if (!windowOpen(current.last_inbound) || !message.meta_id || message.kind === "reaction" ||
        ["pending","unknown","failed"].includes(message.status) || Date.now()-message.stamp >= reactionLifetime) {
      return fail(409,"This message is no longer eligible for reactions");
    }
    if (current.phone_id !== configSafePhone()) return fail(409,"Conversation uses a different WhatsApp number");
    if (limited("reaction:" + user.id,25,60000)) return fail(429,"Reaction limit reached");
    try {
      const result = await send(current.wa_id,"reaction",{message_id:message.meta_id,emoji});
      if (!result.messages?.[0]?.id) return fail(502,"Meta did not confirm the reaction");
      update("messages",message.id,{reaction:emoji});
      return json({ok:true});
    } catch (error) { return metaFailure(user,error); }
  }
  if (resource === "send") {
    const { status,...result } = await outbound(user,id,form);
    return json(result,status);
  }
  if (resource === "conversation") {
    const current = thread(user,id);
    if (!current) return fail(404,"Conversation unavailable");
    if (form.get("action") === "read") {
      update("conversations",id,{unread:0});
      const message = timeline(id,null).findLast((row)=>row.direction==="in");
      if (message && configSafePhone() === current.phone_id) {
        try { await markRead(message.meta_id); } catch (error) { audit("meta_read_failed",user.id,error instanceof GraphError ? error.code : "request_failed"); }
      }
    } else {
      const status = form.get("status");
      if (!["Open","Pending","Closed"].includes(status)) return fail(400,"Invalid conversation status");
      const agent = int(form.get("agent")) || null;
      if (admin(user) && agent && !get("users",agent)?.active) return fail(400,"Invalid assignee");
      const consent = form.get("consent");
      const source = text(form.get("source"),200);
      if (admin(user) && ["yes","no"].includes(consent) && !source) return fail(400,"Provide the source of the consent decision");
      update("contacts",current.contact_id,{notes:text(form.get("notes"),4000),tags:text(form.get("tags"),400)});
      update("conversations",id,{status,agent_id:admin(user) ? agent : current.agent_id});
      if (admin(user)) {
        if (["yes","no"].includes(consent)) update("contacts",current.contact_id,{opt_in:consent,opt_source:source,opt_at:Date.now()});
        if (consent==="clear") update("contacts",current.contact_id,{opt_in:null,opt_source:null,opt_at:null});
      }
      audit("conversation_updated",user.id,String(id));
    }
    return json({ok:true});
  }
  if (resource === "team") {
    const address = email(form.get("email"));
    const name = text(form.get("name"),120);
    const role = form.get("role");
    const password = form.get("password");
    if (form.get("action") === "disable") {
      if (id === user.id) return fail(400,"You cannot disable your own account");
      update("users",id,{active:0});
      audit("team_disabled",user.id,String(id));
    } else {
      if (!address || !name || !["ADMIN","AGENT"].includes(role) || typeof password !== "string" || password.length < 14 || password.length > 256) return fail(400,"Provide name, email, role and a password of 14–256 characters.");
      if (find("users",(row)=>row.email===address)) return fail(409,"Email already exists");
      const created = insert("users",{name,email:address,role,password:hashPassword(password),active:1});
      audit("team_created",user.id,String(created.id));
    }
    return json({ok:true});
  }
  if (resource === "requests") {
    if (["verify","complete"].includes(form.get("action")) && form.get("acknowledged") !== "yes") return fail(400,"Confirm the review action");
    return reviewRequest(text(form.get("ref"),80),form.get("action"),user.id) ? json({ok:true}) : fail(409,"Invalid request transition");
  }
  if (resource === "settings") {
    try {
      const c = config();
      if (form.get("action") === "test") {
        const to = phone(process.env.WHATSAPP_TEST_RECIPIENT);
        if (!to) return fail(400,"Configure the authorized test recipient");
        const template = (await templates()).find((item) => item.status === "APPROVED" && item.name === "hello_world" && item.language === "en_US" && item.category !== "MARKETING");
        if (!template) return fail(400,"Approved hello_world (en_US) test template unavailable");
        const key = nonce();
        await send(to,"template",{name:template.name,language:{code:template.language}},key);
        audit("meta_test_accepted",user.id,key);
        put("webhook_meta","outbound",{key:"outbound",stamp:Date.now()});
        return json({accepted:true});
      }
      const number = await graph(c.phone + "?fields=display_phone_number,verified_name,quality_rating");
      const result = { number };
      try { result.templateAccess = Boolean((await graph(c.waba + "/message_templates?limit=1")).data); }
      catch (error) { result.templateAccess = false; audit("meta_template_access_failed",user.id,error instanceof GraphError ? error.code : "request_failed"); }
      try {
        const subscriptions = await graph(c.waba + "/subscribed_apps");
        const appId = process.env.META_APP_ID || "1590874105306623";
        result.appSubscription = subscriptions.data?.some((item) => item.whatsapp_business_api_data?.id === appId || item.id === appId) || false;
      } catch { result.appSubscription = null; }
      audit("meta_connection_checked",user.id);
      return json(result);
    } catch (error) { return metaFailure(user,error); }
  }
  return fail(404,"Unknown resource");
}
function configSafePhone() { return process.env.WHATSAPP_PHONE_NUMBER_ID; }
