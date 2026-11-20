# ARKNP WhatsApp workspace

The Next.js App Router app serves ARKNP’s public pages and a restricted WhatsApp inbox using the official Meta Cloud API. The current testing setup stores messages, contacts, team members, sessions, requests, and logs in server process memory. A restart or development reload can clear this data. Run one Next.js instance so the webhook and dashboard share the same cache. Any previous SQLite files can remain on disk and are outside this app's runtime.

## Run locally on Windows

```powershell
npm.cmd ci
# Optional: configure a password for production sign-in.
# npm.cmd run admin -- admin@example.com "ARKNP Administrator"
npm.cmd run dev
```

Open http://localhost:3000/dashboard/conversations. Local development opens the workspace directly and listens on loopback. Production requires sign-in. The admin command prompts for a password and updates the bootstrap account and password hash in the ignored `.env.local` file. Restart Next.js to apply the bootstrap configuration. Configure Meta credentials in `.env.local`. Skip dependency installation if dependencies are already present.

## Verification

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:smoke
```

Tests use a temporary process cache, synthetic inbound events, and mocked Meta sends.

## Public HTTPS testing

Set `APP_BASE_URL` to the public HTTPS origin. Build with `npm.cmd run build` and run `npm.cmd start` behind an HTTPS reverse proxy. Supply business policy values at build time because public pages are prerendered. Enable streaming and disable buffering on the SSE route. Set `TRUSTED_CLIENT_IP_HEADER` only for an edge-controlled header that is stripped or overwritten before the app receives it.

Webhook deduplication and retry diagnostics live in the process cache. Meta can retry failed deliveries. Review unconfirmed outgoing status before sending again. Approved templates support numbered body variables and compatible static components.

Admins receive in-app request notifications. Verify customer's account control before recording verification. Erasure removes local contact, conversation and attachment references. Media streams from Meta. Provider-side copies require a separate operating procedure. Both deletion and anonymization requests currently use the local erasure workflow.

Set `MESSAGE_RETENTION_DAYS` if you want older cached messages pruned during runtime activity. Restarts clear all cached history. Use this setup for temporary testing until long-term conversation history and operational records are required.

See [WhatsApp setup](WHATSAPP_SETUP.md) and the [Meta submission checklist](META_SUBMISSION_CHECKLIST.md).
