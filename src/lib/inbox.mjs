import { rows, get, find, put, insert, update, newest, audit, limited, pruneCache } from "./store.mjs";
import { canAccess, text, windowOpen } from "./security.mjs";
import { config, eligibleTemplate, GraphError, graph, mediaType, send, templatePayload, templates } from "./meta.mjs";

function summarize(row) {
  const {id: contactId,...contact} = get("contacts",row.contact_id);
  const latest = rows("messages").filter((message)=>message.conversation_id===row.id).sort(newest)[0];
  return { ...contact,...row,contact_id:contactId,agent:get("users",row.agent_id)?.name,
    preview:latest?.body || latest?.kind };
}
export function thread(user,id) {
  const row = get("conversations",id);
  return canAccess(user,row) ? summarize(row) : null;
}
export function list(user,{query="",filter="",page=0}={}) {
  pruneCache();
  const search = text(query,80).toLowerCase();
  return rows("conversations").filter((row)=>{
    if (!canAccess(user,row) || (filter==="unread" && !row.unread) ||
        (filter==="mine" && row.agent_id!==user.id)) return false;
    const contact = get("contacts",row.contact_id);
    return contact.wa_id.includes(search) || contact.name?.toLowerCase().includes(search);
  }).sort((a,b)=>b.last_message-a.last_message || b.id-a.id)
    .slice(page*30,page*30+31).map(summarize);
}
export function timeline(id,before) {
  const messages = rows("messages").filter((row)=>row.conversation_id===id).sort(newest);
  const start = before ? messages.findIndex((row)=>row.id===before)+1 : 0;
  const quotes = new Map(messages.filter((row)=>row.meta_id).map(({meta_id,id,body,kind,media}) =>
    [meta_id,{id,body,kind,media:Boolean(media)}]));
  return messages.slice(start,start+51).reverse().map((row)=>({...row,quoted:quotes.get(row.reply_to)}));
}
export function snapshot(user, id, query, filter, page, before) {
  pruneCache();
  const selected = id ? thread(user,id) : null;
  if (id && !selected) return null;
  const messages = selected ? timeline(id,before).map(({starred_by,...message}) => ({
    ...message, starred: Boolean(starred_by?.includes(user.id)),
  })) : [];
  return { items: list(user, { query, filter, page }), selected, messages };
}
export async function outbound(user, id, form, fetcher) {
  const current = thread(user, id);
  if (!current) return { status: 404, error: "Conversation unavailable" };
  const key = text(form.get("requestId"), 80);
  if (!/^[0-9a-f-]{36}$/i.test(key)) return { status: 400, error: "Invalid request reference" };
  const previous = find("messages",(row)=>row.request_id===key && row.conversation_id===id);
  if (previous) return { status: 200, delivery: previous.status };
  if (limited("send:" + user.id, 25, 60000)) return { status: 429, error: "Sending limit reached" };
  let kind = "text";
  let content;
  let uploaded;
  const reply = text(form.get("reply"),512);
  if (reply && !find("messages",(row)=>row.conversation_id===id && row.meta_id===reply && row.direction==="in")) {
    return { status: 400, error: "Reply message unavailable" };
  }
  let body = text(form.get("body"), 4096);
  const templateId = text(form.get("template"), 80);
  const file = form.get("attachment");
  try {
    if (current.phone_id !== config().phone) throw new Error("Conversation uses a different sending number");
    if (templateId) {
      const template = (await templates()).find((item) => item.id === templateId);
      if (!eligibleTemplate(template, current.opt_in)) throw new Error("Approved template or required marketing consent unavailable");
      content = templatePayload(template, form.getAll("variable"));
      kind = "template";
      const source = template.components?.find((component) => component.type === "BODY")?.text || template.name;
      body = source.replace(/{{(\d+)}}/g, (_, index) => content.components?.[0]?.parameters[Number(index)-1]?.text || "");
    } else {
      if (!windowOpen(current.last_inbound)) throw new Error("Customer service window expired. Send an approved WhatsApp template to continue.");
      if (file instanceof File && file.size) {
        const spec = mediaType[file.type];
        if (!spec || file.size > spec[1] * 1024 * 1024) throw new Error("Attachment format or size is unsupported");
        kind = spec[0];
        uploaded = new FormData();
        uploaded.set("messaging_product", "whatsapp");
        uploaded.set("file", file);
      } else {
        if (!body) throw new Error("Enter a message");
        content = { body };
      }
    }
  } catch (error) {
    if (error instanceof GraphError) audit("meta_template_lookup_failed", user.id, error.code);
    return { status: 400, error: error instanceof GraphError ? "Template lookup failed" : error.message };
  }
  const reserved = (() => {
    const latest = thread(user, id);
    if (!latest) return { status: 404, error: "Conversation unavailable" };
    if (kind !== "template" && !windowOpen(latest.last_inbound)) return { status: 409, error: "Customer service window expired" };
    if (kind === "template" && latest.opt_in !== current.opt_in) return { status: 409, error: "Consent changed. Review before sending." };
    const existing = find("messages",(row)=>row.request_id===key);
    if (existing) return {status:200,delivery:existing.conversation_id===id ? existing.status : "duplicate"};
    const stamp = Date.now();
    insert("messages",{conversation_id:id,request_id:key,direction:"out",kind,body,
      reply_to:kind==="template" ? null : reply || null,status:"pending",stamp});
    update("conversations",id,{last_message:Math.max(latest.last_message,stamp)});
    audit("message_requested", user.id, key);
    return null;
  })();
  if (reserved) return reserved;
  let sendStarted = false;
  try {
    if (uploaded) {
      const result = await graph(config().phone + "/media", uploaded);
      if (!/^\d+$/.test(result.id)) throw new Error("Missing media ID");
      content = { id: result.id };
      if (kind === "document") content.filename = text(file.name, 180);
      if (body && ["document","image","video"].includes(kind)) content.caption = body.slice(0,1024);
      const message = find("messages",(row)=>row.request_id===key);
      if (message) message.media = result.id;
    }
    const latest = thread(user, id);
    if (!latest || (kind === "template" ? latest.opt_in !== current.opt_in : !windowOpen(latest.last_inbound))) throw new Error("Conversation eligibility changed");
    sendStarted = true;
    const result = await send(current.wa_id, kind, content, key, kind === "template" ? null : reply, fetcher);
    const metaId = result.messages?.[0]?.id;
    if (!metaId) throw new Error("Missing message ID");
    const receipt = get("receipts",metaId);
    const message = find("messages",(row)=>row.request_id===key);
    if (message) Object.assign(message,{meta_id:metaId,status:receipt?.status || "sent",
      status_stamp:receipt?.stamp || Date.now(),error_code:receipt?.error_code || null});
    put("webhook_meta","outbound",{key:"outbound",stamp:Date.now()});
    return { status: 200, delivery: "accepted" };
  } catch (error) {
    const uncertain = sendStarted && (!(error instanceof GraphError) || error.status >= 500);
    const code = error instanceof GraphError ? error.code : uncertain ? "unconfirmed" : "pre_send_failed";
    const message = find("messages",(row)=>row.request_id===key && row.status==="pending");
    if (message) Object.assign(message,{status:uncertain ? "unknown" : "failed",error_code:code});
    audit("meta_send_failed", user.id, code);
    return { status: 502, error: uncertain ? "Delivery unconfirmed. Check message status before attempting another send." : "Message failed. Review the conversation and try again if appropriate." };
  }
}

