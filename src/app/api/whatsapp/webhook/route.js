import { receive, verify } from "@/lib/webhook.mjs";
import { withWorkspaceStore, WorkspaceStorageError } from "@/lib/store.mjs";
export const runtime = "nodejs";
async function handle(request, handler) {
  try { return await withWorkspaceStore(() => handler(request)); }
  catch (error) {
    if (!(error instanceof WorkspaceStorageError)) throw error;
    console.error("[WhatsApp webhook] Workspace storage unavailable",error.message,error.cause?.code || "");
    return new Response("Workspace storage unavailable. Retry delivery.",{status:503});
  }
}
export function GET(request) { return handle(request,verify); }
export function POST(request) { return handle(request,receive); }
