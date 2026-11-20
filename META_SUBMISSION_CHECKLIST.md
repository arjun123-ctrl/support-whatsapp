# ARKNP Meta submission checklist

## Application supplied by this repository

- [x] Public home, privacy, terms, contact, and data deletion instructions routes
- [x] 1024×1024 PNG app icon derived from the supplied ARKNP logo
- [x] Protected administrator and agent workspace
- [x] Webhook challenge, raw-body signature verification, and inbound event deduplication
- [x] Cloud API messaging, supported attachments and template parameters, and delivery receipts
- [x] Local privacy and support request workflow with administrator identity attestation
- [x] Mocked automated tests and setup documentation

## ARKNP and Meta validation required

- [ ] Confirm legal entity, address, phone, email, marketing consent process, governing law, effective date, retention, and deletion timeline.
- [ ] Review published terms against actual processing and confirm routes are publicly accessible over HTTPS.
- [ ] Configure the deployment secret store, HTTPS, trusted proxy, and cache retention. Confirm durable storage requirements before production rollout.
- [ ] Confirm the app, business portfolio, WABA, registered number, system user permissions, and valid Graph token.
- [ ] Set Meta URLs, visible category, and approved app icon.
- [ ] Verify the callback, subscribe the messages field, and confirm app subscription on the WABA.
- [ ] Test an actual opted-in recipient, inbound message, free-form response, approved template, and delivery receipts.
- [ ] Test access with separate admin and agent accounts. Confirm the agent cannot access another agent’s conversation or attachments.
- [ ] Validate the identity verification process, provider-side media handling, legal holds, and backup erasure procedure.
- [ ] Complete any required business verification, access review, and Meta release steps.
- [ ] Check pricing and limits in Meta for the account before rollout.
