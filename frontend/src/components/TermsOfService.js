import React from 'react';
import DotsBackground from './DotsBackground';
import './LegalPage.css';

function TermsOfService({ onBack }) {
  return (
    <div className="legal-page">
      <DotsBackground />
      <div className="legal-container">
        <button className="legal-back" onClick={onBack}>
          ← back
        </button>
        <div className="legal-card">
          <h1 className="legal-title">terms of service</h1>
          <span className="legal-updated">last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>

          <div className="legal-section">
            <h2>1. acceptance of terms</h2>
            <p>by accessing or using orian ("the service"), you agree to be bound by these terms of service. if you do not agree to these terms, do not use the service.</p>
          </div>

          <div className="legal-section">
            <h2>2. description of service</h2>
            <p>orian is an autonomous multi-agent AI platform that executes goals by orchestrating a network of specialist agents including web search, code generation, file creation, and analysis agents. results can be delivered to connected third-party services.</p>
          </div>

          <div className="legal-section">
            <h2>3. user accounts</h2>
            <ul>
              <li>you must provide a valid email address to create an account</li>
              <li>you are responsible for maintaining the security of your account credentials</li>
              <li>you must notify us immediately of any unauthorized use of your account</li>
              <li>one person may not maintain more than one free account</li>
            </ul>
          </div>

          <div className="legal-section">
            <h2>4. acceptable use</h2>
            <p>you agree not to use orian to:</p>
            <ul>
              <li>generate, distribute, or facilitate illegal content</li>
              <li>harass, abuse, or harm any individual or group</li>
              <li>attempt to circumvent rate limits, security measures, or access controls</li>
              <li>use the service for automated scraping or data harvesting at scale</li>
              <li>impersonate any person or entity</li>
              <li>violate any applicable laws or regulations</li>
            </ul>
          </div>

          <div className="legal-section">
            <h2>5. third-party integrations</h2>
            <p>orian allows you to connect third-party services (google, github, slack, notion, linear, airtable). by connecting these services you authorize orian to act on your behalf within the scopes you grant. you remain responsible for your use of those third-party services and compliance with their terms.</p>
            <p>orian is not affiliated with, endorsed by, or sponsored by google, github, slack, notion, linear, or airtable.</p>
          </div>

          <div className="legal-section">
            <h2>6. ai-generated content</h2>
            <p>orian uses large language models to generate content. you acknowledge that:</p>
            <ul>
              <li>ai-generated content may be inaccurate, incomplete, or outdated</li>
              <li>you are responsible for reviewing and verifying any content before acting on it</li>
              <li>orian does not guarantee the accuracy or fitness of ai-generated outputs for any particular purpose</li>
            </ul>
          </div>

          <div className="legal-section">
            <h2>7. intellectual property</h2>
            <p>you retain ownership of the goals you submit and the outputs generated on your behalf. orian retains ownership of the platform, its code, and its underlying systems. you grant orian a limited license to process your inputs solely for the purpose of executing your requested tasks.</p>
          </div>

          <div className="legal-section">
            <h2>8. disclaimer of warranties</h2>
            <p>the service is provided "as is" without warranties of any kind, express or implied. we do not warrant that the service will be uninterrupted, error-free, or that results will be accurate or reliable. your use of the service is at your sole risk.</p>
          </div>

          <div className="legal-section">
            <h2>9. limitation of liability</h2>
            <p>to the maximum extent permitted by law, orian shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the service, including but not limited to loss of data, loss of profits, or business interruption.</p>
          </div>

          <div className="legal-section">
            <h2>10. termination</h2>
            <p>we reserve the right to suspend or terminate your account at any time for violation of these terms. you may delete your account at any time. upon termination, your data will be deleted in accordance with our privacy policy.</p>
          </div>

          <div className="legal-section">
            <h2>11. changes to terms</h2>
            <p>we may modify these terms at any time. continued use of the service after changes constitutes acceptance of the new terms. we will notify users of material changes via email or a notice on the platform.</p>
          </div>

          <div className="legal-section">
            <h2>12. governing law</h2>
            <p>these terms are governed by applicable law. any disputes shall be resolved through binding arbitration or in the courts of competent jurisdiction.</p>
          </div>

          <div className="legal-contact">
            questions about these terms? contact us through the platform.
          </div>
        </div>
      </div>
    </div>
  );
}

export default TermsOfService;
