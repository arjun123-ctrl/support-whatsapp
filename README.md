# ARKNP WhatsApp workspace

This Next.js app serves ARKNP?s public pages and a WhatsApp inbox using the Meta Cloud API. Local development defaults to in-memory storage. Vercel uses shared Redis storage so webhook deliveries and dashboard requests can read the same data across instances.

## Run locally on Windows

```powershell
npm.cmd ci
# Optional: configure a password for production sign-in.
# npm.cmd run admin -- admin@example.com "ARKNP Administrator"
npm.cmd run dev
```

Open http://localhost:3000/dashboard/conversations. Local development opens the workspace directly and listens on loopback. The production Conversations dashboard is public. Visitors can read retained messages and send replies. Administration endpoints require an administrator session. The admin command prompts for a password and updates the bootstrap account and password hash in the ignored `.env.local` file. Restart Next.js to apply the bootstrap configuration. Configure Meta credentials in `.env.local`. Skip dependency installation if dependencies are already present.

## Verification

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:smoke
```

Tests use a temporary process cache, synthetic inbound events, and mocked Meta sends.

## Vercel deployment

Connect a Redis database with the Upstash REST API, then add its HTTPS `UPSTASH_REDIS_REST_URL` and write-capable `UPSTASH_REDIS_REST_TOKEN` to Vercel?s Production environment variables and redeploy. Set `APP_BASE_URL` to the deployed origin and point Meta to `/api/whatsapp/webhook` on that origin. Use a dedicated database for the deployment. Webhook writes return 503 when shared storage is unavailable so Meta can retry. Conversations that existed only in a previous instance?s memory are outside the shared store.

## Public HTTPS testing

Set `APP_BASE_URL` to the public HTTPS origin. Build with `npm.cmd run build` and run `npm.cmd start` behind an HTTPS reverse proxy. Supply business policy values at build time because public pages are prerendered. When using local memory, enable streaming and disable buffering on the SSE route. The dashboard polls when using shared storage. Set `TRUSTED_CLIENT_IP_HEADER` only for an edge-controlled header that is stripped or overwritten before the app receives it.

Webhook deduplication and retry diagnostics use the configured workspace store. Meta can retry failed deliveries. Review unconfirmed outgoing status before sending again. Approved templates support numbered body variables and compatible static components.

Admins receive in-app request notifications. Verify customer's account control before recording verification. Erasure removes local contact, conversation and attachment references. Media streams from Meta. Provider-side copies require a separate operating procedure. Both deletion and anonymization requests currently use the local erasure workflow.

Set `MESSAGE_RETENTION_DAYS` if you want older cached messages pruned during runtime activity. Restarts clear all cached history. Use this setup for temporary testing until long-term conversation history and operational records are required.

See [WhatsApp setup](WHATSAPP_SETUP.md) and the [Meta submission checklist](META_SUBMISSION_CHECKLIST.md).
