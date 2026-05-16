import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import Lenis from 'lenis';
import { io as socketIO } from 'socket.io-client';
import GoalForm from './components/GoalForm';
import LiveFeed from './components/LiveFeed';
import ResultSection from './components/ResultSection';
import Loader from './components/Loader';
import TaskHistory from './components/TaskHistory';
import DotsBackground from './components/DotsBackground';
import Toast from './components/Toast';
import Integrations from './components/Integrations';
import AuthModal from './components/AuthModal';
import PrivacyPolicy from './components/PrivacyPolicy';
import TermsOfService from './components/TermsOfService';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'https://orian-ondq.onrender.com';

const LogoIcon = () => (
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="1.5" strokeLinecap="round">
    <line x1="12" y1="2" x2="12" y2="22" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
  </svg>
);

function App() {
  const [showApp, setShowApp] = useState(false);
  const [legalPage, setLegalPage] = useState(null);
  const [view, setView] = useState('input');
  const [agentMessages, setAgentMessages] = useState([]);
  const [finalResult, setFinalResult] = useState('');
  const [loaderStep, setLoaderStep] = useState(0);
  const [tasks, setTasks] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toast, setToast] = useState(null);
  const [activeGoalId, setActiveGoalId] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('orian_token') || null);
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem('orian_user')); } catch { return null; } });
  const socketRef = useRef(null);
  const activeTaskRef = useRef(null);

  useEffect(() => {
    const socket = socketIO(BACKEND_URL, { autoConnect: false });
    socketRef.current = socket;

    socket.on('agent_activity', (data) => {
      if (data.goalId !== activeTaskRef.current) return;
      const agentName = data.agent?.toLowerCase();
      const stepMap = { planner: 0, router: 1, web_agent: 2, critic: 3, summarizer: 4 };
      const step = stepMap[agentName];
      if (step !== undefined) setLoaderStep(step);
      if (data.action !== 'error') {
        setAgentMessages(prev => [...prev, { agent: agentName, message: data.action?.replace(/_/g, ' ') }]);
      }
    });

    socket.on('task_update', (data) => {
      if (data.goalId !== activeTaskRef.current) return;
      const stageMap = { planning: 0, routing: 1, execution_in_progress: 2, quality_review: 3, summarization: 4 };
      const step = stageMap[data.stage];
      if (step !== undefined) setLoaderStep(step);
      setAgentMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.message === data.message) return prev;
        return [...prev, { agent: data.stage?.split('_')[0] || 'system', message: data.message }];
      });
    });

    socket.on('task_cancelled', (data) => {
      if (data.goalId !== activeTaskRef.current) return;
      setTasks(prev => prev.map(t => t.id === activeTaskRef.current ? { ...t, status: 'cancelled' } : t));
      setToast('task stopped.');
      setView('input');
    });

    socket.on('task_complete', (data) => {
      if (data.goalId !== activeTaskRef.current) return;
      const r = data.result || {};
      const report = r.report?.content || r.summary?.main || '';
      const artifacts = r.artifacts || { code: [], files: [] };
      setTasks(prev => prev.map(t => t.id === activeTaskRef.current ? { ...t, status: 'completed', result: report, artifacts } : t));
      setToast('task completed successfully!');
      setTimeout(() => { setFinalResult({ report, artifacts }); setView('result'); }, 800);
    });

    socket.on('task_error', (data) => {
      if (data.goalId !== activeTaskRef.current) return;
      setTasks(prev => prev.map(t => t.id === activeTaskRef.current ? { ...t, status: 'failed' } : t));
      setToast(data.error || 'something went wrong. please try again.');
      setView('input');
    });

    socket.on('workflow-complete', (data) => {
      if (data.goalId !== activeTaskRef.current) return;
      const report = data.report || '';
      setTasks(prev => prev.map(t => t.id === activeTaskRef.current ? { ...t, status: 'completed', result: report } : t));
      setToast('task completed successfully!');
      setTimeout(() => { setFinalResult(report); setView('result'); }, 800);
    });

    socket.on('workflow-error', (data) => {
      if (data.goalId !== activeTaskRef.current) return;
      setTasks(prev => prev.map(t => t.id === activeTaskRef.current ? { ...t, status: 'failed' } : t));
      setToast(data.error || 'something went wrong. please try again.');
      setView('input');
    });

    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    if (showApp) return;
    const lenis = new Lenis({ duration: 1.2, easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
    function raf(time) { lenis.raf(time); requestAnimationFrame(raf); }
    requestAnimationFrame(raf);
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); }
      });
    }, { threshold: 0.1 });
    document.querySelectorAll('.animate-on-scroll').forEach(el => observer.observe(el));
    return () => { lenis.destroy(); observer.disconnect(); };
  }, [showApp]);

  useEffect(() => {
    const handle = document.getElementById('resize-handle');
    const sidebar = document.getElementById('sidebar');
    if (!handle || !sidebar) return;
    let dragging = false;
    const onMouseDown = () => {
      if (sidebarCollapsed) return;
      dragging = true;
      document.body.style.cursor = 'col-resize';
    };
    const onMouseMove = (e) => {
      if (!dragging) return;
      const newWidth = Math.min(Math.max(e.clientX, 160), 480);
      sidebar.style.width = newWidth + 'px';
    };
    const onMouseUp = () => { dragging = false; document.body.style.cursor = ''; };
    handle.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      handle.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [showApp, sidebarCollapsed]);

  useEffect(() => {
    const navbar = document.getElementById('navbar');
    const header = document.getElementById('header-wrapper');
    if (!navbar || !header) return;
    let ticking = false;
    function onScroll() {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          if (!showApp && window.scrollY > 50) {
            navbar.classList.add('scrolled');
            header.classList.add('floating');
          } else {
            navbar.classList.remove('scrolled');
            header.classList.remove('floating');
          }
          ticking = false;
        });
        ticking = true;
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [showApp]);

  if (legalPage === 'privacy') return <PrivacyPolicy onBack={() => setLegalPage(null)} />;
  if (legalPage === 'terms') return <TermsOfService onBack={() => setLegalPage(null)} />;

  const handleGetStarted = () => setShowApp(true);

  const handleAuth = (u, t) => { setUser(u); setToken(t); setShowApp(true); };
  const handleLogout = () => {
    localStorage.removeItem('orian_token');
    localStorage.removeItem('orian_user');
    setToken(null);
    setUser(null);
    setShowApp(false);
    setView('input');
    setTasks([]);
    setAgentMessages([]);
    setFinalResult('');
  };

  const handleSubmitGoal = async (goal) => {
    const newTask = { id: null, goal, status: 'processing', time: new Date().toLocaleTimeString() };
    setAgentMessages([]);
    setLoaderStep(0);
    setView('loader');

    try {
      const res = await fetch(`${BACKEND_URL}/api/goal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ goal }),
      });
      const data = await res.json();
      if (res.status === 401) {
        handleLogout();
        setToast('session expired. please sign in again.');
        return;
      }
      if (!res.ok) throw new Error(data.error || 'failed to submit goal');

      newTask.id = data.goalId;
      activeTaskRef.current = data.goalId;
      setActiveGoalId(data.goalId);
      setTasks(prev => [newTask, ...prev]);

      if (socketRef.current) {
        if (!socketRef.current.connected) socketRef.current.connect();
        socketRef.current.emit('subscribe_goal', data.goalId);
      }
    } catch (err) {
      setToast('failed to connect to server.');
      setView('input');
    }
  };

  const handleStopGoal = async () => {
    const goalId = activeTaskRef.current;
    if (!goalId) return;
    setTasks(prev => prev.map(t => t.id === goalId ? { ...t, status: 'cancelled' } : t));
    setToast('task stopped.');
    setView('input');
    try {
      await fetch(`${BACKEND_URL}/api/goal/${goalId}/cancel`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
    } catch (_) {}
  };

  const handleSelectTask = (task) => {
    if (task.result) {
      setFinalResult({ report: task.result, artifacts: task.artifacts || { code: [], files: [] } });
      setView('result');
    }
  };

  const handleNewGoal = () => {
    setView('input');
    setAgentMessages([]);
    setFinalResult({ report: '', artifacts: { code: [], files: [] } });
    setLoaderStep(0);
  };

  if (showApp) {
    return (
      <div className="app">
        <DotsBackground />
        {!token && <AuthModal onAuth={handleAuth} />}
        <div className="app-layout">
          <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`} id="sidebar">
            <div className="sidebar-header">
              {!sidebarCollapsed && (
                <div className="sidebar-logo">
                  <LogoIcon />
                  <h1>orian</h1>
                </div>
              )}
              <button className="sidebar-collapse-btn" onClick={() => {
                const sidebar = document.getElementById('sidebar');
                if (sidebar) sidebar.style.width = '';
                setSidebarCollapsed(o => !o);
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {sidebarCollapsed
                    ? <><polyline points="9 18 15 12 9 6" /></>
                    : <><polyline points="15 18 9 12 15 6" /></>}
                </svg>
              </button>
            </div>
            {!sidebarCollapsed && (
              <>
                <div className="sidebar-top">
                  <TaskHistory tasks={tasks} onSelect={handleSelectTask} />
                </div>
                <div className="sidebar-bottom">
                  <Integrations token={token} />
                  <button className="taskhistory-new-btn" style={{ marginTop: '0.75rem' }} onClick={handleNewGoal}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    new goal
                  </button>
                  <div className="sidebar-user">
                    <span className="sidebar-user-email">{user?.email}</span>
                    <button className="sidebar-logout-btn" onClick={handleLogout}>sign out</button>
                  </div>
                </div>
              </>
            )}
          </aside>
          <div className="resize-handle" id="resize-handle">
            <div className="resize-dots">
              <span /><span /><span />
            </div>
          </div>
          <main className="app-main">
            <button className="hamburger-btn" onClick={() => setDrawerOpen(o => !o)}>
              <span /><span /><span />
            </button>
            {view === 'input' && <GoalForm onSubmit={handleSubmitGoal} />}
            {view === 'loader' && <Loader currentStep={loaderStep} messages={agentMessages} onStop={handleStopGoal} />}
            {view === 'result' && <ResultSection result={finalResult} onNewGoal={handleNewGoal} />}
          </main>
        </div>
        {drawerOpen && (
          <div className="drawer-overlay" onClick={() => setDrawerOpen(false)}>
            <div className="drawer" onClick={e => e.stopPropagation()}>
              <div className="drawer-header">
                <div className="sidebar-logo">
                  <LogoIcon />
                  <h1>orian</h1>
                </div>
                <button className="drawer-close" onClick={() => setDrawerOpen(false)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
              <TaskHistory tasks={tasks} onSelect={handleSelectTask} />
                <Integrations token={token} />
            </div>
          </div>
        )}
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      </div>
    );
  }

  return (
    <div className="app">
      <DotsBackground />
      <div className="container">
        <div className="header-wrapper" id="header-wrapper">
          <nav className="navbar" id="navbar">
            <div className="logo">
              <LogoIcon />
              <h1>orian</h1>
            </div>
            <div className="nav-links">
              <a href="#features">features</a>
              <a href="#about">about</a>
              <a href="#docs" style={{ marginRight: '1.5rem' }}>docs</a>
            </div>
          </nav>
          <button className="nav-cta-external" onClick={handleGetStarted}>
            get started <span>↗</span>
          </button>
        </div>

        <section className="hero animate-on-scroll">
          <h1 className="hero-title">multi-agent autonomy that ships real work, end-to-end.</h1>
          <p className="hero-subtitle">just tell us what you want. we'll make it happen.</p>
          <p className="hero-codename">/ codename: cortex /</p>
          <button className="hero-cta" onClick={handleGetStarted}>
            start building <span>↗</span>
          </button>
        </section>

        <section className="features animate-on-scroll" id="features">
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-number">1.</div>
              <h3 className="feature-title">planner</h3>
              <p className="feature-codename">/ codename: architect /</p>
              <p className="feature-description">breaks down complex goals into actionable subtasks using advanced llm reasoning</p>
            </div>
            <div className="feature-card">
              <div className="feature-number">2.</div>
              <h3 className="feature-title">router</h3>
              <p className="feature-codename">/ codename: dispatcher /</p>
              <p className="feature-description">intelligently assigns each subtask to the right specialist agent for optimal execution</p>
            </div>
            <div className="feature-card">
              <div className="feature-number">3.</div>
              <h3 className="feature-title">web agent</h3>
              <p className="feature-codename">/ codename: scout /</p>
              <p className="feature-description">searches the internet using tavily api to gather real-time information</p>
            </div>
            <div className="feature-card">
              <div className="feature-number">4.</div>
              <h3 className="feature-title">file agent</h3>
              <p className="feature-codename">/ codename: scribe /</p>
              <p className="feature-description">handles document creation, file operations, and data persistence</p>
            </div>
            <div className="feature-card">
              <div className="feature-number">5.</div>
              <h3 className="feature-title">code agent</h3>
              <p className="feature-codename">/ codename: forge /</p>
              <p className="feature-description">generates and executes code to solve computational tasks</p>
            </div>
            <div className="feature-card">
              <div className="feature-number">6.</div>
              <h3 className="feature-title">critic</h3>
              <p className="feature-codename">/ codename: sentinel /</p>
              <p className="feature-description">reviews output quality and requests retries when needed for autonomous excellence</p>
            </div>
          </div>
        </section>

        <section className="about animate-on-scroll" id="about">
          <div className="about-grid">
            <div className="about-left">
              <h2 className="section-title">about orian</h2>
              <p className="section-text">orian is multi-agent autonomy that ships real work, end-to-end.</p>
              <p className="section-text" style={{ marginTop: '1rem', fontSize: '1rem', color: '#555555' }}>tell orian what you want. a network of specialist agents plans, searches, writes, and executes — autonomously, without you lifting a finger.</p>
            </div>
            <div className="about-right">
              <div className="about-stat">
                <span className="about-stat-number">6</span>
                <span className="about-stat-label">specialist agents</span>
              </div>
              <div className="about-stat">
                <span className="about-stat-number">∞</span>
                <span className="about-stat-label">possible goals</span>
              </div>
              <div className="about-stat">
                <span className="about-stat-number">0</span>
                <span className="about-stat-label">manual steps</span>
              </div>
            </div>
          </div>
          <div className="about-pills">
            <span className="about-pill">groq llm</span>
            <span className="about-pill">tavily search</span>
            <span className="about-pill">bullmq</span>
            <span className="about-pill">socket.io</span>
            <span className="about-pill">react</span>
            <span className="about-pill">autonomous execution</span>
          </div>
        </section>

        <section className="docs animate-on-scroll" id="docs">
          <h2 className="section-title">documentation</h2>
          <p className="section-text" style={{ marginBottom: '3rem' }}>everything you need to build with orian.</p>
          <div className="docs-grid">
            <div className="doc-card">
              <div className="doc-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                </svg>
              </div>
              <h3 className="doc-card-title">quick start</h3>
              <p className="doc-card-text">get up and running with orian in under 5 minutes. set up your api keys and run your first goal.</p>
            </div>
            <div className="doc-card">
              <div className="doc-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
                </svg>
              </div>
              <h3 className="doc-card-title">agent api</h3>
              <p className="doc-card-text">full reference for the planner, router, and specialist agent apis. configure and extend each agent.</p>
            </div>
            <div className="doc-card">
              <div className="doc-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
                </svg>
              </div>
              <h3 className="doc-card-title">integrations</h3>
              <p className="doc-card-text">connect groq, tavily, and custom tools. build pipelines that interact with external services.</p>
            </div>
            <div className="doc-card">
              <div className="doc-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
              </div>
              <h3 className="doc-card-title">examples</h3>
              <p className="doc-card-text">real-world goal examples — research reports, code generation, data analysis and more.</p>
            </div>
          </div>
        </section>

        <footer className="footer animate-on-scroll">
          <h3 className="footer-heading">join the autonomous revolution</h3>
          <p className="footer-text">powered by groq, tavily & multi-agent intelligence</p>
          <button className="footer-cta" onClick={handleGetStarted}>
            try it now <span>↗</span>
          </button>
          <p className="footer-links">built with react · socket.io · bullmq</p>
          <p className="footer-links" style={{ marginTop: '0.75rem' }}>
            <button onClick={() => setLegalPage('privacy')} style={{ background: 'none', border: 'none', color: '#999', fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'inherit', textTransform: 'lowercase', textDecoration: 'underline', textUnderlineOffset: '3px' }}>privacy policy</button>
            {' · '}
            <button onClick={() => setLegalPage('terms')} style={{ background: 'none', border: 'none', color: '#999', fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'inherit', textTransform: 'lowercase', textDecoration: 'underline', textUnderlineOffset: '3px' }}>terms of service</button>
          </p>
        </footer>
      </div>
    </div>
  );
}

export default App;
