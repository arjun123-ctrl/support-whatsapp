import { receive, verify } from "@/lib/webhook.mjs";
import { sharedStorageConfigured, withWorkspaceStore, WorkspaceStorageError } from "@/lib/store.mjs";
export const runtime = "nodejs";
async function handle(request, handler) {
  try { return await withWorkspaceStore(() => handler(request)); }
  catch (error) {
    if (!(error instanceof WorkspaceStorageError)) throw error;
    console.error("[WhatsApp webhook] Shared storage unavailable",error.message);
    return new Response("Shared storage unavailable. Retry delivery.",{status:503});
  }
}
export function GET(request) { return sharedStorageConfigured() ? handle(request,verify) : verify(request); }
export function POST(request) { return handle(request,receive); }
