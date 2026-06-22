import { useLocation } from "wouter";

export default function Privacy() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background text-white px-5 py-12 max-w-2xl mx-auto">
      <button
        onClick={() => setLocation("/")}
        className="text-white/40 hover:text-white/70 text-sm transition-colors mb-8 block"
      >
        ← Back
      </button>

      <h1 className="font-display text-4xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-white/40 text-sm mb-10">Last updated: June 2026 — Form version: v1</p>

      <Section title="1. Who we are">
        <p>
          The Beast Bar is the data controller for the personal data you submit through this service.
          We are based in Indonesia and our service is operated by The Beast Bar team.
        </p>
        <p className="mt-3">
          For privacy-related questions or to exercise your rights, contact us at:{" "}
          <a href="mailto:privacy@thebestbar.com" className="text-orange-400 underline">
            privacy@thebestbar.com
          </a>
        </p>
      </Section>

      <Section title="2. What data we collect">
        <ul className="list-disc list-inside space-y-1 text-white/70">
          <li>Your first name (optional — only if you provide it)</li>
          <li>Your email address (only when you place a cocktail order)</li>
          <li>Your consent choices and the timestamp at which they were given</li>
          <li>Your IP address (recorded at the time of consent for audit purposes)</li>
        </ul>
        <p className="mt-3">
          Your quiz answers are used only to generate your personalised cocktail recipes. They are
          processed in real time and are <strong className="text-white">never stored</strong> on our servers.
        </p>
      </Section>

      <Section title="3. Why we collect it and our legal basis">
        <div className="space-y-3 text-white/70">
          <div>
            <p className="text-white font-semibold">To prepare your cocktail</p>
            <p>Legal basis: performance of a service you requested (Art. 6(1)(b) GDPR).</p>
          </div>
          <div>
            <p className="text-white font-semibold">Marketing communications</p>
            <p>
              If you tick the communications checkbox, we may send you emails about The Beast Bar
              events, offers, and news. Legal basis: your consent (Art. 6(1)(a) GDPR).
            </p>
          </div>
          <div>
            <p className="text-white font-semibold">Sharing with third-party partners</p>
            <p>
              If you tick the data-sharing checkbox, your name and email may be shared with
              carefully selected partners in the hospitality and events sector for marketing
              purposes. Legal basis: your consent (Art. 6(1)(a) GDPR).
            </p>
          </div>
        </div>
      </Section>

      <Section title="4. How long we keep your data">
        <p className="text-white/70">
          Your email and consent record are kept for a maximum of 3 years from the date of
          collection, or until you withdraw your consent — whichever comes first.
        </p>
      </Section>

      <Section title="5. Your rights">
        <p className="text-white/70 mb-3">Under GDPR you have the right to:</p>
        <ul className="list-disc list-inside space-y-1 text-white/70">
          <li>Access the personal data we hold about you</li>
          <li>Request correction of inaccurate data</li>
          <li>Request deletion of your data</li>
          <li>
            <strong className="text-white">Withdraw consent at any time</strong> — this will not
            affect the lawfulness of processing before withdrawal
          </li>
          <li>Lodge a complaint with the Belgian Data Protection Authority (GBA)</li>
        </ul>
        <p className="mt-3 text-white/70">
          To exercise any of these rights, email{" "}
          <a href="mailto:privacy@thebestbar.com" className="text-orange-400 underline">
            privacy@thebestbar.com
          </a>
          . We will respond within 30 days.
        </p>
      </Section>

      <Section title="6. Withdrawing your consent">
        <p className="text-white/70">
          You can withdraw your consent to receive marketing communications or to have your data
          shared with third parties at any time — no questions asked. Simply send an email to{" "}
          <a href="mailto:privacy@thebestbar.com" className="text-orange-400 underline">
            privacy@thebestbar.com
          </a>{" "}
          with the subject line <em>"Withdraw consent"</em> and your email address.
        </p>
      </Section>

      <Section title="7. Belgian Data Protection Authority (GBA)">
        <p className="text-white/70">
          If you believe your rights have not been respected, you can file a complaint with the GBA
          at{" "}
          <a
            href="https://www.dataprotectionauthority.be"
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-400 underline"
          >
            www.dataprotectionauthority.be
          </a>
          .
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="font-display text-xl font-bold text-white mb-3">{title}</h2>
      <div className="text-white/70 leading-relaxed">{children}</div>
    </div>
  );
}
