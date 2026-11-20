import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { find, get } from "./store.mjs";

export const cookieName = "arknp_session";
export const digest = (value) => createHash("sha256").update(value).digest("hex");
export const nonce = () => randomBytes(32).toString("hex");
export function equal(left, right) {
  return typeof left === "string" && typeof right === "string" && timingSafeEqual(Buffer.from(digest(left), "hex"), Buffer.from(digest(right), "hex"));
}
export function signature(raw, header, secret) {
  return Boolean(secret && equal(header, "sha256=" + createHmac("sha256", secret).update(raw).digest("hex")));
}
export function hashPassword(password, salt = nonce()) {
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function authenticate(email, password) {
  const user = find("users",(row)=>row.email===email && row.active);
  const expected = user?.password || "unregistered:invalid";
  return equal(expected, hashPassword(password, expected.split(":")[0])) ? user : null;
}
export function session(token) {
  if (!token) return null;
  const entry = get("sessions",digest(token));
  const user = entry?.expires > Date.now() ? get("users",entry.user_id) : null;
  if (!user?.active) return undefined;
  const {id,name,email,role} = user;
  return {id,name,email,role};
}
export function localWorkspaceUser(headers) {
  if (process.env.NODE_ENV !== "development") return null;
  const loopback = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;
  const host = headers.get("host");
  const forwardedHost = headers.get("x-forwarded-host");
  if (!loopback.test(host || "") || (forwardedHost && !loopback.test(forwardedHost))) return null;
  const admin = get("users", 1);
  return {
    id: 1,
    name: admin?.name || "Local workspace",
    email: admin?.email || "",
    role: "ADMIN",
  };
}
export function workspaceUser(token, headers) {
  return localWorkspaceUser(headers) || session(token);
}
export function text(value, length) {
  return typeof value === "string" ? value.trim().slice(0, length) : "";
}
export function phone(value) {
  const number = text(value, 40).replace(/[+ ()-]/g, "");
  return /^[1-9]\d{6,14}$/.test(number) ? number : null;
}
export function email(value) {
  const result = text(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result) ? result : null;
}
export const canAccess = (user, row) => Boolean(user && row && (user.role === "ADMIN" || row.agent_id === user.id));
export const windowOpen = (stamp, now = Date.now()) => Boolean(stamp && stamp <= now && now - stamp < 86400000);
export function clientKey(headers) {
  const header = process.env.TRUSTED_CLIENT_IP_HEADER;
  return digest(header ? headers.get(header)?.split(",")[0]?.trim() || "unknown" : "shared");
}
