// Swappable WhatsApp sender, following the same shape as config/mailer.ts
// (SendGrid wrapped in small named exports there; here it's an interface plus
// a singleton implementation instead, since more than one provider will
// exist over time — a real one gets dropped in later without touching any
// caller).

export interface WhatsAppSender {
  send(params: {
    toPhone: string;
    message: string;
    templateType: string;
    payload?: any;
  }): Promise<{ status: "SENT" | "FAILED"; providerMessageId?: string }>;
}

// No real WhatsApp Business / Twilio / Meta Cloud API account exists yet, so
// this mock is the ONLY implementation today. It just logs what would have
// been sent and always reports success, so callers (and the message log
// they write) can be built and exercised end-to-end before a real provider
// is wired up.
//
// Swapping in a real provider later means: implement WhatsAppSender (e.g.
// `class TwilioWhatsAppSender implements WhatsAppSender { ... }`) and change
// the `whatsAppSender` export below to `new TwilioWhatsAppSender()`. No
// changes are needed in whatsapp.service.ts or any other caller.
export class MockWhatsAppSender implements WhatsAppSender {
  async send(params: {
    toPhone: string;
    message: string;
    templateType: string;
    payload?: any;
  }): Promise<{ status: "SENT" | "FAILED"; providerMessageId?: string }> {
    console.log(
      `[MockWhatsApp] to=${params.toPhone} templateType=${params.templateType} message="${params.message}"`,
      params.payload !== undefined ? { payload: params.payload } : "",
    );
    return { status: "SENT" };
  }
}

export const whatsAppSender: WhatsAppSender = new MockWhatsAppSender();
