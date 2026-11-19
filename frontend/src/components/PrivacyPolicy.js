import React from 'react';
import DotsBackground from './DotsBackground';
import './LegalPage.css';

function PrivacyPolicy({ onBack }) {
  return (
    <div className="legal-page">
      <DotsBackground />
      <div className="legal-container">
        <button className="legal-back" onClick={onBack}>
          ← back
        </button>
        <div className="legal-card">
          <h1 className="legal-title">privacy policy</h1>
          <span className="legal-updated">last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>

          <div className="legal-section">
            <h2>1. introduction</h2>
            <p>orian ("we", "us", or "our") operates as an autonomous multi-agent AI platform. this privacy policy explains how we collect, use, and protect your information when you use our service at orian.app.</p>
            <p>by using orian, you agree to the collection and use of information in accordance with this policy.</p>
          </div>

          <div className="legal-section">
            <h2>2. information we collect</h2>
            <p>we collect the following types of information:</p>
            <ul>
              <li>account information: email address and password (hashed) when you register</li>
              <li>goal data: the goals and tasks you submit to the platform for processing</li>
              <li>usage data: logs of agent activity, task results, and workflow execution metadata</li>
              <li>integration settings: per-user settings for connected services (google, github, slack, notion, linear, airtable), while service connections themselves are managed by composio</li>
            </ul>
          </div>

          <div className="legal-section">
            <h2>3. google oauth & google workspace data</h2>
            <p>when you connect your google account, orian requests access to:</p>
            <ul>
              <li>google docs: to create and write documents on your behalf as a delivery output</li>
              <li>google drive (drive.file scope): limited to files created by orian only</li>
            </ul>
            <p>orian's use of google user data is limited to the functionality described above. we do not share google user data with third parties. we do not use google data for advertising or to train AI models. access tokens are stored securely and only used when you explicitly trigger a delivery action.</p>
            <p>orian's use and transfer of information received from google apis adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">google api services user data policy</a>, including the limited use requirements.</p>
          </div>

          <div className="legal-section">
            <h2>4. how we use your information</h2>
            <ul>
              <li>to execute autonomous agent workflows based on your submitted goals</li>
              <li>to deliver results to your connected integrations (google docs, notion, slack, github, etc.)</li>
              <li>to authenticate your account and maintain session security</li>
              <li>to improve the reliability and performance of the platform</li>
            </ul>
          </div>

          <div className="legal-section">
            <h2>5. data storage & security</h2>
            <p>your data is stored in a secured sqlite database. oauth tokens are stored and used only for the purpose of delivering task outputs to your connected services. we implement industry-standard security measures to protect your data.</p>
            <p>we do not sell, trade, or rent your personal information to third parties.</p>
          </div>

          <div className="legal-section">
            <h2>6. data retention</h2>
            <p>we retain your account data and task history for as long as your account is active. you may request deletion of your data at any time by contacting us. disconnecting an integration immediately revokes and deletes the associated access token from our systems.</p>
          </div>

          <div className="legal-section">
            <h2>7. third-party services</h2>
            <p>orian integrates with third-party services including openrouter (llm inference), tavily (web search), and various oauth providers. your use of these services is subject to their respective privacy policies. we only transmit the minimum data necessary to fulfill your requested task.</p>
          </div>

          <div className="legal-section">
            <h2>8. your rights</h2>
            <ul>
              <li>access: request a copy of the data we hold about you</li>
              <li>deletion: request deletion of your account and all associated data</li>
              <li>revocation: disconnect any integration at any time from the integrations panel</li>
              <li>correction: update your account information at any time</li>
            </ul>
          </div>

          <div className="legal-section">
            <h2>9. children's privacy</h2>
            <p>orian is not directed at children under 13. we do not knowingly collect personal information from children under 13.</p>
          </div>

          <div className="legal-section">
            <h2>10. changes to this policy</h2>
            <p>we may update this privacy policy from time to time. we will notify you of any changes by posting the new policy on this page with an updated date.</p>
          </div>

          <div className="legal-contact">
            questions about this privacy policy? contact us through the platform.
          </div>
        </div>
      </div>
    </div>
  );
}

export default PrivacyPolicy;
