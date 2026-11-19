import React, { useState } from 'react';
import OrianLogo from './OrianLogo';
import './LandingContent.css';

const features = [
  ['01', 'a conversation, not a command line', 'ask a question, think through an idea, or pick up where you left off. orian asks for missing details when it needs them.'],
  ['02', 'your apps, part of the conversation', 'connect notion, google docs, slack, and more. turn a request into work in the apps you already use.'],
  ['03', 'an idea with its own workspace', 'build a website, edit its files, and see the browser preview beside your chat. ask for a change and keep creating.'],
  ['04', 'see the work taking shape', 'follow the plan, see which specialist is assigned, and keep track of the current step as your task runs.'],
  ['05', 'research with somewhere to go', 'gather information with sources, turn findings into a document, and continue the conversation with what you learned.'],
  ['06', 'your project goes with you', 'save your edits or download the whole workspace as a zip. your files and folders stay together.'],
];
const questions = [
  ['which model does orian use?', 'free auto is the default. it routes requests to available free models on openrouter. free providers have quotas and availability limits; orian does not fall back to paid models.'],
  ['what can i run in the preview?', 'the live browser preview supports html, css, and javascript. projects that require a backend, python, or an npm build can be edited and downloaded, but need their own runtime.'],
  ['how do i connect my apps?', 'sign in, choose an app in the sidebar, and complete its connection flow. then tell orian what you want to do there. access depends on the permissions you grant.'],
  ['can i take my code elsewhere?', 'yes. download zip exports all current workspace files, including unsaved edits, with their folder paths intact. you can also download an individual file.'],
];

export default function LandingContent({ onStart, onPrivacy, onTerms }) {
  const [demo, setDemo] = useState('build');
  const [count, setCount] = useState(0);
  return <div className="landing-content">
    <section className="hero animate-on-scroll">
      <p className="landing-eyebrow"><span /> free auto models. real possibilities.</p>
      <h1 className="hero-title">from a conversation<br />to something real.</h1>
      <p className="hero-subtitle">a question. a website. a page in notion.<br />one place to think, build, and get things done.</p>
      <div className="landing-hero-actions"><button className="hero-cta" onClick={onStart}>start a conversation <span>↗</span></button><a href="#features">see what’s possible <span>↓</span></a></div>
      <p className="landing-hero-note">specialist agents when you need them. simple chat when you don’t.</p>
    </section>

    <section className="landing-showcase animate-on-scroll" aria-label="Explore an example of Orian">
      <div className="landing-demo-top"><div><OrianLogo size={20} /><span>a look inside orian</span></div><span className="landing-demo-label">interactive examples</span></div>
      <div className="landing-demo-tabs" role="tablist" aria-label="Example workflows">{['build', 'connect', 'research'].map(name => <button key={name} role="tab" id={`demo-tab-${name}`} aria-selected={demo === name} aria-controls="landing-demo-panel" onClick={() => setDemo(name)}>{name}<span>↗</span></button>)}</div>
      <div className="landing-demo-panel" id="landing-demo-panel" role="tabpanel" aria-labelledby={`demo-tab-${demo}`}>
        <div className="landing-demo-chat"><span className="landing-small-label">a little direction is all it takes</span>
          <p className="landing-demo-prompt">{demo === 'build' ? 'build a minimal habit tracker i can make my own' : demo === 'connect' ? 'turn my project notes into a weekly planner in notion' : 'compare free ai coding models and include sources'}</p>
          <div className="landing-demo-response"><OrianLogo size={20} /><p>{demo === 'build' ? 'a project you can edit, preview, and keep refining.' : demo === 'connect' ? 'your connected workspace, with the details that matter.' : 'a clear comparison you can explore and build on.'}</p></div>
          <div className="landing-demo-tags">{(demo === 'build' ? ['editable files', 'live preview', 'download zip'] : demo === 'connect' ? ['your permissions', 'the right destination', 'one conversation'] : ['web research', 'source links', 'follow-up questions']).map(tag => <span key={tag}>{tag}</span>)}</div>
        </div>
        <div className="landing-demo-preview">
          <div className="landing-preview-bar"><span>{demo === 'build' ? 'preview / index.html' : demo === 'connect' ? 'example / weekly planner' : 'example / research brief'}</span><span>◦ ◦ ◦</span></div>
          {demo === 'build' ? <div className="landing-habit"><p className="landing-small-label">small steps, every day</p><h3>make room<br />for a good habit.</h3><p>a tiny example. try checking it off.</p><button onClick={() => setCount(n => n + 1)}><span>{count > 0 ? '✓' : '+'}</span> {count > 0 ? `${count} small ${count === 1 ? 'win' : 'wins'}. keep going.` : 'read a few pages today'} <span>↗</span></button><div className="landing-week">{'mtwtfss'.split('').map((day, i) => <span key={i} className={i < Math.min(count, 7) ? 'checked' : ''}>{day}</span>)}</div></div> : demo === 'connect' ? <div className="landing-planner"><p className="landing-small-label">a plan with breathing room</p><h3>this week,<br />one thing at a time.</h3>{['shape the idea', 'make the first draft', 'leave space to improve'].map((item, i) => <div key={item}><span>{i === 0 ? '✓' : '□'}</span><p>{item}</p><small>{['monday', 'wednesday', 'friday'][i]}</small></div>)}</div> : <div className="landing-research"><p className="landing-small-label">a useful answer has a trail</p><h3>less searching.<br />more understanding.</h3>{['compare what matters', 'keep the sources close', 'ask the next question'].map((item, i) => <div key={item}><span>0{i + 1}</span><p>{item}</p><span>↗</span></div>)}</div>}
        </div>
      </div>
      <p className="landing-demo-caption">an illustration of the experience. your actual work starts with your own conversation.</p>
    </section>

    <section className="features animate-on-scroll" id="features"><div className="landing-section-heading"><p className="landing-eyebrow">/ a few ways to begin /</p><h2>less switching tabs.<br />more moving things forward.</h2><p>from a quick explanation to a project with files of its own.</p></div><div className="features-grid">{features.map(([number, title, description]) => <article className="feature-card" key={number}><div className="feature-number">{number}</div><h3 className="feature-title">{title}</h3><p className="feature-description">{description}</p></article>)}</div></section>

    <section className="about animate-on-scroll" id="about"><div className="landing-section-heading"><p className="landing-eyebrow">/ how it comes together /</p><h2>you bring the idea.<br />orian helps with the next step.</h2></div><div className="landing-steps">{[
      ['01', 'say what you have in mind', 'start naturally. add context, connect an app, or answer a question that helps shape the work.'],
      ['02', 'watch it take shape', 'for tasks, a planner and specialist agents work through the steps. their progress stays visible.'],
      ['03', 'make it yours', 'ask a follow-up, edit the code, save the result, or take your whole project with you.'],
    ].map(([number, title, text]) => <div key={number}><span>{number}</span><h3>{title}</h3><p>{text}</p></div>)}</div><div className="about-pills">{['notion', 'google docs', 'slack', 'github', 'linear', 'airtable'].map(app => <span key={app} className="about-pill">{app}</span>)}</div><p className="landing-integrations-note">connect the apps you want to work in. each connection uses your account permissions.</p></section>

    <section className="docs animate-on-scroll" id="docs"><div className="landing-section-heading"><p className="landing-eyebrow">/ before you begin /</p><h2>a few things worth knowing.</h2></div><div className="landing-faq">{questions.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>

    <footer className="footer animate-on-scroll"><p className="landing-eyebrow">/ your next idea starts here /</p><h3 className="footer-heading">what would you like to make happen?</h3><p className="footer-text">start with a conversation. see where it takes you.</p><button className="footer-cta" onClick={onStart}>let’s begin <span>↗</span></button><p className="footer-links">orian · conversation, connected work, and a little momentum.</p><p className="landing-legal"><button onClick={onPrivacy}>privacy policy</button><span>·</span><button onClick={onTerms}>terms of service</button></p></footer>
  </div>;
}
