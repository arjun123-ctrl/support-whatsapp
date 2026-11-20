import { randomUUID } from "node:crypto";
import { audit, find, get, put, remove, removeConversation, rows } from "./store.mjs";
import { email, phone, text } from "./security.mjs";

export const requestTypes = ["Support", "Delete my data", "Anonymize my data"];
export function validateRequest(form) {
  const kind = text(form.get("kind"), 40);
  const name = text(form.get("name"), 120);
  const number = phone(form.get("phone"));
  const address = text(form.get("email"), 254);
  const details = text(form.get("details"), 2000);
  if (!requestTypes.includes(kind) || !name || !number || (address && !email(address)) ||
      (kind !== "Support" && form.get("consent") !== "yes") || form.get("website")) return null;
  return { kind, name, number, address, details };
}
export function submitRequest({kind,name,number,address,details}) {
  const ref = randomUUID();
  put("requests",ref,{ref,kind,name,phone:number,email:address,details,status:"Pending",created:Date.now(),resolved:null});
  return ref;
}
export function reviewRequest(ref,action,actor) {
  const item = get("requests",ref);
  if (!item || item.resolved) return false;
  function resolve(record,status) {
    Object.assign(record,{name:null,phone:null,email:null,details:null,status,resolved:Date.now()});
  }
  if (action==="verify" && item.kind!=="Support" && item.status==="Pending") {
    item.status = "Verified";
  } else if (action==="complete" && item.kind!=="Support" && item.status==="Verified") {
    const contact = find("contacts",(row)=>row.wa_id===item.phone);
    if (contact) {
      for (const thread of rows("conversations")) if (thread.contact_id===contact.id) removeConversation(thread.id);
      remove("contacts",contact.id);
    }
    const number = item.phone;
    for (const request of rows("requests")) if (request.phone===number) resolve(request,"Completed");
  } else if (action==="close") {
    resolve(item,"Closed");
  } else return false;
  audit("request_"+action,actor,ref);
  return true;
}
