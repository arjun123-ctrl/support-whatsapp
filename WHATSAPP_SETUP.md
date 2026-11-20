# Set up ARKNP on Meta

## Where to find the environment values

Set these in the ignored `.env.local` file.

| Setting | Where it comes from |
| --- | --- |
| `META_APP_ID` | The existing ARKNP app ID is `1590874105306623`. |
| `META_APP_SECRET` | Meta App Dashboard → App Settings → Basic → App Secret. Reset the secret if it was placed in a shared file or a commit. |
| `META_WABA_ID` | WhatsApp → API Setup → WhatsApp Business Account ID. Also visible in Business Settings → Accounts → WhatsApp Accounts. |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp → API Setup → Phone number ID for the selected sender. |
| `WHATSAPP_ACCESS_TOKEN` | Use the temporary token from API Setup for testing. For ongoing use, generate a system user token with access to the app and WhatsApp assets. |
| `WHATSAPP_VERIFY_TOKEN` | Generate your own with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Use the same value in Meta's webhook settings. |
| `WHATSAPP_GRAPH_API_VERSION` | Keep the configured `v25.0`. |
| `WHATSAPP_WEBHOOK_URL` | Your public HTTPS origin plus `/api/whatsapp/webhook`. A public HTTPS tunnel also works for local webhook testing. Set `APP_BASE_URL` to the same origin when using the application through that URL. |
| `WHATSAPP_TEST_RECIPIENT` | An authorized test handset with country code and digits only. Add the handset to Meta's permitted test recipients if using the Meta test number. |
| `BUSINESS_LEGAL_NAME`, `BUSINESS_CONTACT_EMAIL`, `BUSINESS_CONTACT_PHONE`, `BUSINESS_ADDRESS` | ARKNP's confirmed legal and public contact details. |
| `BUSINESS_GOVERNING_LAW`, `POLICY_EFFECTIVE_DATE`, `DELETION_PROCESSING_TIMELINE` | ARKNP's approved policy values. |
| `MESSAGE_RETENTION_DAYS` | Optional maximum age for cached message history during runtime activity. The cache clears on restart. |

## Manual Meta Dashboard steps

1. Open the [existing ARKNP app](https://developers.facebook.com/apps/1590874105306623/) and confirm the app ID is `1590874105306623`.
2. Confirm the app and WhatsApp assets are assigned to the Arknp NFC business portfolio, ID `1130426199990309`.
3. In App Settings → Basic, confirm the display name, developer contact email, app domain, and required business details. Confirm the public legal contact separately.
4. Enter the deployed HTTPS `/privacy-policy` URL in Privacy Policy URL.
5. Enter the HTTPS `/terms-of-service` URL where required.
6. Select Data Deletion Instructions URL and enter the HTTPS `/data-deletion` URL. If another enabled Meta product requires a signed deletion callback, add that integration separately.
7. Upload the 1024×1024 PNG from `public/arknp.png`. It uses the emblem from the supplied ARKNP logo.
8. Select the category that describes the actual app from the options shown in Meta.
9. Add or open the WhatsApp use case. Complete the applicable business onboarding and register the intended sender phone number. Start with an approved test recipient where available.
10. Copy the WhatsApp Business Account ID into `META_WABA_ID`.
11. Copy the Phone Number ID into `WHATSAPP_PHONE_NUMBER_ID`.
12. In business settings, create or select a system user, assign the app and WhatsApp assets, and generate an app token. Store the token as `WHATSAPP_ACCESS_TOKEN` in the deployment secret store.
13. Grant the system user and token the applicable `whatsapp_business_messaging` and `whatsapp_business_management` permissions. Follow Meta’s review requirements for the app’s access level and customer assets. Set `META_APP_SECRET` separately.
14. Deploy Next.js over public HTTPS and set `WHATSAPP_WEBHOOK_URL` to the deployed `/api/whatsapp/webhook` URL.
15. Generate a strong random `WHATSAPP_VERIFY_TOKEN`. Enter the same value in Meta’s webhook configuration and save the callback URL. Keep it separate from the Graph token.
16. Subscribe to the WhatsApp Business Account `messages` field in the App Dashboard. Subscribe the app to the WABA using Meta’s `POST /{WABA_ID}/subscribed_apps` procedure with the appropriate token if the account is not already subscribed. Confirm with the GET edge.
17. Configure `WHATSAPP_TEST_RECIPIENT` to a consenting authorized test phone. In the dashboard, test connectivity and use the test message action if the WABA has approved `hello_world` in `en_US`. Otherwise follow Meta’s test procedure with an approved test template.
18. Reply to the connected number from the test phone. Confirm the inbound event and conversation appear in the dashboard. Assign the conversation to a test agent.
19. Send a reply from the dashboard inside the 24-hour window. Confirm it reaches the handset and the delivery/read statuses update as the handset reports them. Verify an approved template send with suitable consent.
20. Complete the submission checklist and confirm all required Meta verification, review, account settings, and production limits in the app dashboard.

References

- [WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview)
- [Webhook configuration](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/)
- [WABA subscribed apps](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/subscribed_apps/)
- [Supported Graph API versions](https://developers.facebook.com/docs/graph-api/changelog/versions/)

Graph API defaults to supported `v25.0` and can be changed with `WHATSAPP_GRAPH_API_VERSION`. Credentials, consent evidence, account review, and live delivery depend on the deployed business and Meta account.
