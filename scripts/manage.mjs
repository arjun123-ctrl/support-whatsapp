import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { readFile, writeFile } from "node:fs/promises";
import { email, hashPassword, text } from "../src/lib/security.mjs";

const address = email(process.argv[2]);
const name = text(process.argv[3],120).replace(/[\r\n]/g," ");
if (!address || !name || /['\\$]/.test(address+name)) throw new Error('Usage: npm run admin -- email "Display Name" (without single quotes, backslashes or dollar signs)');
const output = new Writable({ write(_chunk,_encoding,callback) { callback(); } });
process.stdout.write("Administrator password (hidden, 14–256 characters): ");
const input = createInterface({input:process.stdin,output,terminal:Boolean(process.stdin.isTTY)});
const password = await input.question("Password: ");
input.close();
console.log();
if (password.length < 14 || password.length > 256) throw new Error("Password must have 14–256 characters");

const file = ".env.local";
let existing = "";
try { existing = await readFile(file,"utf8"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const rest = existing.split(/\r?\n/).filter((line)=>!/^\s*(?:export\s+)?ADMIN_(?:EMAIL|NAME|PASSWORD_HASH)\s*=/.test(line)).join("\n").trimEnd();
await writeFile(file,`${rest ? rest+"\n" : ""}ADMIN_EMAIL='${address}'\nADMIN_NAME='${name}'\nADMIN_PASSWORD_HASH=${hashPassword(password)}\n`,{ mode:0o600 });
console.log("Administrator configured. Start or restart Next.js to load it.");
