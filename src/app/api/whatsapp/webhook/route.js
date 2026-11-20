import { receive, verify } from "@/lib/webhook.mjs";
export const runtime = "nodejs";
export function GET(request) { return verify(request); }
export function POST(request) { return receive(request); }
