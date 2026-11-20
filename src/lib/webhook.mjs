import { get, put, find, insert, remove, audit, pruneCache } from "./store.mjs";
import { digest, equal, phone, signature, text } from "./security.mjs";

export function verify(request, token = process.env.WHATSAPP_VERIFY_TOKEN) {
  const query = new URL(request.url).searchParams;
  const challenge = query.get("hub.challenge");
  if (!token || query.get("hub.mode") !== "subscribe" || !equal(query.get("hub.verify_token"), token) || challenge === null) {
    if (query.get("hub.mode") === "subscribe") console.warn("[WhatsApp webhook] Verification rejected: check the verify token and challenge");
    return new Response("Forbidden", { status: 403 });
  }
  put("webhook_meta","verification",{key:"verification",stamp:Date.now()});
  console.info("[WhatsApp webhook] Verification succeeded");
  return new Response(challenge, { headers: { "Content-Type": "text/plain" } });
}
const array = (value) => Array.isArray(value) ? value : [];
const rank = { sent: 1, failed: 2, delivered: 3, read: 4 };
const timestamp = (value, now) => {
  const stamp = Number(value) * 1000;
  return Number.isSafeInteger(stamp) && stamp > 0 ? Math.min(stamp, now) : now;
};
export function ingest(payload, { waba, phoneId }, now = Date.now(), deliveryKey = null) {
  pruneCache(now);
  {
    put("webhook_meta","delivery",{key:"delivery",stamp:now});
    if (payload?.object !== "whatsapp_business_account") return;
    for (const entry of array(payload.entry)) {
      if (entry?.id !== waba) {
        console.warn("[WhatsApp webhook] Event ignored: WABA ID does not match META_WABA_ID");
        continue;
      }
      for (const change of array(entry.changes)) {
        const value = change?.value;
        if (change?.field !== "messages") continue;
        if (value?.metadata?.phone_number_id !== phoneId) {
          console.warn("[WhatsApp webhook] Messages event ignored: phone number ID does not match WHATSAPP_PHONE_NUMBER_ID");
          continue;
        }
        for (const message of array(value.messages)) {
          const number = phone(message?.from);
          const id = text(message?.id, 512);
          if (!number || !id) {
            console.warn("[WhatsApp webhook] Incoming message ignored: missing sender phone number or message ID");
            continue;
          }
          const key = digest(id);
          if (get("inbound_keys",key)) {
            console.info("[WhatsApp webhook] Duplicate incoming message ignored");
            continue;
          }
          const receivedStamp = Number(message.timestamp) * 1000;
          const inboundStamp = Number.isSafeInteger(receivedStamp) && receivedStamp > 0 && receivedStamp <= now + 120000
            ? Math.min(receivedStamp, now) : null;
          const stamp = inboundStamp ?? now;
          const name = text(array(value.contacts).find((contact) => contact?.wa_id === number)?.profile?.name, 160);
          const contact = find("contacts",(row)=>row.wa_id===number) ||
            insert("contacts",{wa_id:number,created:now,notes:"",tags:""});
          if (name) contact.name = name;
          const thread = find("conversations",(row)=>row.contact_id===contact.id && row.phone_id===phoneId) ||
            insert("conversations",{contact_id:contact.id,phone_id:phoneId,status:"Open",agent_id:null,unread:0,last_message:stamp,last_inbound:null});
          if (inboundStamp !== null) thread.last_inbound = Math.max(thread.last_inbound || 0,inboundStamp);
          thread.last_message = Math.max(thread.last_message,stamp);
          thread.unread += 1;
          const kind = text(message.type, 40) || "unknown";
          const media = ["image","document","audio","video"].includes(kind) ? text(message[kind]?.id, 80) : "";
          const body = message.text?.body ?? message.interactive?.button_reply?.title ??
            message.interactive?.list_reply?.title ?? message.button?.text ?? (media ? message[kind]?.caption || message[kind]?.filename : "");
          insert("messages",{conversation_id:thread.id,meta_id:id,direction:"in",kind,body:text(body,4096),
            media:/^\d+$/.test(media) ? media : null,reply_to:text(message.context?.id,512) || null,status:"received",stamp});
          put("inbound_keys",key,now);
          console.info("[WhatsApp webhook] Incoming message saved", { conversationId: thread.id });
        }
        for (const receipt of array(value.statuses)) {
          const id = text(receipt?.id, 512);
          const status = receipt?.status;
          if (!id || !Object.hasOwn(rank,status)) continue;
          const stamp = timestamp(receipt.timestamp, now);
          const previous = get("receipts",id);
          if (previous && (rank[previous.status] > rank[status] || (previous.status === status && previous.stamp >= stamp))) continue;
          const error = receipt.errors?.[0]?.code;
          const code = Number.isSafeInteger(error) ? String(error) : null;
          put("receipts",id,{status,stamp,error_code:code});
          if (status === "failed") console.warn("[WhatsApp webhook] Outbound delivery failed", { code });
          const correlation = text(receipt.biz_opaque_callback_data,80);
          const outgoing = find("messages",(row)=>row.direction==="out" &&
            (row.meta_id===id || (!row.meta_id && correlation && row.request_id===correlation)));
          if (outgoing) Object.assign(outgoing,{meta_id:id,status,status_stamp:stamp,error_code:code});
        }
      }
    }
  }
  if (deliveryKey) remove("webhook_failures",deliveryKey);
}
export async function receive(request) {
  console.info("[WhatsApp webhook] POST received");
  const { META_APP_SECRET: secret, META_WABA_ID: waba, WHATSAPP_PHONE_NUMBER_ID: phoneId } = process.env;
  if (!secret || !waba || !phoneId) {
    console.error("[WhatsApp webhook] Missing configuration", {
      hasAppSecret: Boolean(secret), hasWabaId: Boolean(waba), hasPhoneNumberId: Boolean(phoneId),
    });
    return new Response("Webhook unavailable", { status: 503 });
  }
  let raw;
  try { raw = await boundedBody(request, 1024 * 1024); } catch {
    console.error("[WhatsApp webhook] Could not read request body");
    return new Response("Could not read request body", { status: 503 });
  }
  if (!raw) {
    console.warn("[WhatsApp webhook] POST rejected: payload too large");
    return new Response("Payload too large", { status: 413 });
  }
  if (!signature(raw, request.headers.get("x-hub-signature-256"), secret)) {
    console.warn("[WhatsApp webhook] POST rejected: missing or invalid signature");
    return new Response("Forbidden", { status: 403 });
  }
  let payload;
  try { payload = JSON.parse(raw.toString("utf8")); } catch {
    console.warn("[WhatsApp webhook] POST rejected: invalid JSON");
    return new Response("Invalid JSON", { status: 400 });
  }
  const key = digest(raw);
  try { ingest(payload, { waba, phoneId }, Date.now(), key); } catch {
    console.error("[WhatsApp webhook] Processing failed; Meta can retry delivery");
    try {
      const attempts = (get("webhook_failures",key)?.attempts || 0)+1;
      put("webhook_failures",key,{attempts,stamp:Date.now()});
      if (attempts === 1 || attempts === 5) audit(attempts === 5 ? "webhook_repeated_failure" : "webhook_processing_failed", null, key);
    } catch { console.error("WhatsApp webhook storage unavailable"); }
    return new Response("Retry delivery", { status: 503 });
  }
  return new Response("OK");
}
export async function boundedBody(request, maximum) {
  if (Number(request.headers.get("content-length")) > maximum) return null;
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) return Buffer.concat(chunks);
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); return null; }
    chunks.push(value);
  }
}
