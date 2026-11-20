/** @typedef {{version:string, token:string, waba:string, phone:string}} MetaConfig */
export class GraphError extends Error {
  constructor(status, code) {
    super("Meta API request failed");
    this.status = status;
    this.code = code;
  }
}
/** @returns {MetaConfig} */
export function config() {
  const values = {
    WHATSAPP_GRAPH_API_VERSION: process.env.WHATSAPP_GRAPH_API_VERSION || "v25.0",
    WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
    META_WABA_ID: process.env.META_WABA_ID,
    WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  };
  const missing = Object.keys(values).filter((key) => !values[key]);
  if (missing.length) throw new Error("Missing " + missing.join(", "));
  if (!/^v\d+\.0$/.test(values.WHATSAPP_GRAPH_API_VERSION) ||
      !/^\d+$/.test(values.META_WABA_ID) || !/^\d+$/.test(values.WHATSAPP_PHONE_NUMBER_ID)) {
    throw new Error("Invalid Meta Graph version, WABA ID or phone number ID");
  }
  return { version: values.WHATSAPP_GRAPH_API_VERSION, token: values.WHATSAPP_ACCESS_TOKEN,
    waba: values.META_WABA_ID, phone: values.WHATSAPP_PHONE_NUMBER_ID };
}
export async function graph(path, body, fetcher = fetch) {
  const { version, token } = config();
  const multipart = body instanceof FormData;
  const response = await fetcher("https://graph.facebook.com/" + version + "/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: "Bearer " + token, ...(multipart ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined || multipart ? body : JSON.stringify(body),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000),
  });
  return graphResult(response);
}
async function graphResult(response) {
  const result = await response.json();
  if (!response.ok || result.error) {
    throw new GraphError(response.status, Number.isSafeInteger(result.error?.code) ? String(result.error.code) : "http_" + response.status);
  }
  return result;
}
export async function uploadTemplateImage(file) {
  const appId = process.env.META_APP_ID;
  if (!/^\d+$/.test(appId || "")) throw new Error("Missing Meta app ID");
  const query = new URLSearchParams({file_name:file.name,file_length:String(file.size),file_type:file.type});
  const session = await graph(appId + "/uploads?" + query,{});
  if (typeof session.id !== "string" || !session.id.startsWith("upload:")) throw new Error("Invalid upload session");
  const {version,token} = config();
  const result = await graphResult(await fetch("https://graph.facebook.com/" + version + "/" + session.id, {
    method:"POST", headers:{Authorization:"OAuth " + token,file_offset:"0","Content-Type":"application/octet-stream"},
    body:await file.arrayBuffer(),redirect:"error",signal:AbortSignal.timeout(15000),
  }));
  if (typeof result.h !== "string" || !result.h) throw new Error("Missing sample image handle");
  return result.h;
}
export async function templates() {
  const result = [];
  let after = "";
  do {
    const page = await graph(config().waba + "/message_templates?limit=100&fields=id,name,language,category,status,components" + after);
    result.push(...(page.data || []));
    after = page.paging?.next && page.paging.cursors?.after ? "&after=" + encodeURIComponent(page.paging.cursors.after) : "";
  } while (after && result.length < 2000);
  return result;
}
export const eligibleTemplate = (template, optIn) =>
  template?.status === "APPROVED" && (["UTILITY","AUTHENTICATION"].includes(template.category) ||
    (template.category === "MARKETING" && optIn === "yes"));

export function templatePayload(template, values = []) {
  const body = template.components?.find((component) => component.type === "BODY")?.text || "";
  const indexes = [...new Set([...body.matchAll(/{{(\d+)}}/g)].map((match) => Number(match[1])))].sort((a,b) => a-b);
  const unsupported = template.components?.some((component) =>
    (component.type === "HEADER" && (component.format !== "TEXT" || component.text?.includes("{{"))) ||
    (component.type === "BUTTONS" && component.buttons?.some((button) => button.type === "COPY_CODE" || button.url?.includes("{{"))));
  if (unsupported || /{{[^\d]/.test(body) || indexes.some((value,i) => value !== i+1)) throw new Error("This template requires unsupported parameter types");
  if (values.length !== indexes.length || values.some((value) => typeof value !== "string" || !value.trim() || value.length > 1024)) throw new Error("Enter all template variables");
  return { name: template.name, language: { code: template.language }, ...(values.length ? {
    components: [{ type: "body", parameters: values.map((value) => ({ type: "text", text: value.trim() })) }],
  } : {}) };
}
export function send(to, type, content, correlation, reply, fetcher) {
  return graph(config().phone + "/messages", {
    messaging_product: "whatsapp", recipient_type: "individual", to, type, [type]: content,
    biz_opaque_callback_data: correlation, ...(reply ? { context: { message_id: reply } } : {}),
  }, fetcher);
}
export function markRead(id) {
  return graph(config().phone + "/messages", { messaging_product: "whatsapp", status: "read", message_id: id });
}
export const mediaType = {
  "image/jpeg": ["image", 5], "image/png": ["image", 5], "application/pdf": ["document", 16],
  "audio/mpeg": ["audio", 16], "audio/ogg": ["audio", 16], "video/mp4": ["video", 16],
};
