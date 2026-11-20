import Link from "next/link";
import { PublicForm } from "./public-form";
import { Brand } from "./brand";

export const business = {
  name: process.env.BUSINESS_LEGAL_NAME || "ARKNP [legal entity pending confirmation]",
  email: process.env.BUSINESS_CONTACT_EMAIL,
  phone: process.env.BUSINESS_CONTACT_PHONE,
  address: process.env.BUSINESS_ADDRESS,
  date: process.env.POLICY_EFFECTIVE_DATE || "[effective date pending]",
  law: process.env.BUSINESS_GOVERNING_LAW || "[governing law pending confirmation]",
  retention: process.env.MESSAGE_RETENTION_DAYS ? process.env.MESSAGE_RETENTION_DAYS + " days at most for cached message history" : "[message retention period pending approval]",
  deletion: process.env.DELETION_PROCESSING_TIMELINE || "[processing timeline pending approval]",
};
export const links = [["Privacy policy","/privacy-policy"],["Terms of service","/terms-of-service"],["Data deletion","/data-deletion"],["Contact","/contact"]];
export function PublicLayout({children}) {
  return <div className="public"><header className="public-nav"><Brand/><nav><Link href="/contact">Contact</Link><Link className="button secondary" href="/login">Team sign in</Link></nav></header>
    <main>{children}</main><footer><Brand/><nav aria-label="Legal">{links.map(([label,href]) => <Link key={href} href={href}>{label}</Link>)}</nav></footer></div>;
}
export function ContactDetails() {
  return <dl className="facts"><dt>Business</dt><dd>{business.name}</dd><dt>Email</dt><dd>{business.email ? <a href={"mailto:"+business.email}>{business.email}</a> : "[business email pending confirmation]"}</dd><dt>Phone</dt><dd>{business.phone || "[business phone pending confirmation]"}</dd><dt>Address</dt><dd>{business.address || "[business address pending confirmation]"}</dd></dl>;
}
export function LegalPage({ type }) {
  const articles = {
    privacy: ["Privacy policy", [
      ["Business identity and policy updates", <>This policy describes how ARKNP handles customer information. Effective {business.date}. Updates will appear here with a revised effective date.<ContactDetails/></>],
      ["Information we collect", "We store WhatsApp numbers and identifiers, customer-provided names, inbound and outbound messages, message and delivery timestamps, replies, and attachment references. WhatsApp hosts attachments accessed through the restricted workspace. Support and privacy forms collect information you provide and a request reference. Technical records include API error codes, operational timestamps and rate-limit identifiers."],
      ["Why we use this information", "We use customer information to respond to enquiries, provide support, manage communications, protect our systems, and process privacy requests. Depending on applicable law and the circumstances, the basis may include fulfilling a service request, legitimate operational interests, legal obligations, or consent."],
      ["WhatsApp, providers and disclosures", "We use the WhatsApp Business Platform. Meta processes messaging information as an external service provider. Hosting providers may process information to run the service. We may disclose information when legally required. Providers may handle information in other countries, subject to applicable transfer requirements."],
      ["Storage, security and retention", <>We restrict message and attachment access to authorized team members and use authenticated sessions and signed webhooks. Message retention is {business.retention}. Request and technical record retention depends on the purpose, operational requirements and applicable law. Message records are held in temporary server memory. A server restart clears local records.</>],
      ["Consent, rights and deletion", <>When customers opt in to marketing, staff may record the decision, its source and timestamp. Contact us to change communication preferences or request access, correction or deletion as applicable. Use the <Link href="/data-deletion">data deletion request form</Link> to submit a deletion request. We verify identity before processing.</>],
    ]],
    terms: ["Terms of service", [
      ["Business and service", "ARKNP offers NFC products and business technology services. The website provides business information and a way to request support. ARKNP may communicate with customers through WhatsApp."],
      ["Eligibility and acceptable use", "Use the service only where legally permitted and provide accurate information. If acting for an organization, you are responsible for having authority to do so."],
      ["Customer communications", "By contacting ARKNP, you may receive replies about your enquiry. Marketing preferences are handled separately. Keep shared information relevant to your request."],
      ["Prohibited activities", "Do not use the service for fraud, harassment, spam, unlawful material, impersonation, unauthorized access, or interference with the service."],
      ["Intellectual property and third parties", "ARKNP branding and site materials are subject to applicable intellectual property rights. WhatsApp and other external platforms are subject to their own terms."],
      ["Availability and limitations", "Service availability may vary due to maintenance, hosting, or third-party interruptions. Applicable statutory rights and liabilities apply."],
      ["Termination and governing law", <>ARKNP may restrict use in response to abuse or where required by law. Governing law is {business.law}.</>],
      ["Contact", <ContactDetails key="contact"/>],
    ]],
    deletion: ["Data deletion", [
      ["What you can request", "You can ask ARKNP to delete or anonymize WhatsApp contact details, stored conversation history, internal notes, tags and attachment references associated with you."],
      ["How to submit a request", "Use the form below and retain your reference. Provide your international WhatsApp number. A team member will contact you to verify control of the account before making any changes."],
      ["After verification", <>An authorized administrator processes the verified request and records the outcome. Some records may need to be held where required by law. Target processing time is {business.deletion}. Contact ARKNP about any copies held independently by third-party services.</>],
      ["Contact", <ContactDetails key="contact"/>],
    ]],
    contact: ["Contact ARKNP", [["Business details", <ContactDetails key="business-details"/>]]],
  };
  const [title, sections] = articles[type];
  return <PublicLayout><article className="legal"><h1>{title}</h1>{sections.map(([label,content]) => <section key={label}><h2>{label}</h2><div>{content}</div></section>)}
  {(type === "deletion" || type === "contact") && <section><h2>{type === "deletion" ? "Submit a privacy request" : "Send a support request"}</h2><PublicForm deletion={type === "deletion"}/></section>}</article></PublicLayout>;
}
