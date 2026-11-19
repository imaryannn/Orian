import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import './Product.css';
import { mergeActivity } from './activity';
import Lenis from 'lenis';
import { io as socketIO } from 'socket.io-client';
import LogoIcon from './components/OrianLogo';
import LandingContent from './components/LandingContent';
import GoalForm from './components/GoalForm';
import ResizableWorkspace from './components/ResizableWorkspace';
import CodeWorkspace from './components/CodeWorkspace';
import { recoverWorkspace } from './workspace';
import { restoreConversation } from './conversation';
import Loader from './components/Loader';
import TaskHistory from './components/TaskHistory';
import DotsBackground from './components/DotsBackground';
import Toast from './components/Toast';
import Integrations from './components/Integrations';
import AuthModal from './components/AuthModal';
import PrivacyPolicy from './components/PrivacyPolicy';
import TermsOfService from './components/TermsOfService';
import { useAuth, useUser, UserButton } from '@clerk/react';

import { BACKEND_URL } from './config';

const userButtonAppearance = {
  variables: {
    colorPrimary: '#0a0a0a',
    colorForeground: '#0a0a0a',
    colorMutedForeground: '#777777',
    colorBackground: 'rgba(255, 255, 255, 0.97)',
    fontFamily: "'Instrument Serif', 'Playfair Display', Georgia, serif",
    borderRadius: '12px',
  },
  elements: {
    userButtonAvatarBox: { width: '26px', height: '26px' },
    userButtonPopoverCard: {
      borderRadius: '14px',
      border: '1px solid rgba(0, 0, 0, 0.08)',
      boxShadow: '0 16px 48px rgba(0, 0, 0, 0.18)',
    },
    userButtonPopoverActionButton: { textTransform: 'lowercase' },
    userButtonPopoverActionButtonText: { textTransform: 'lowercase', fontFamily: 'inherit' },
    userButtonPopoverFooter: { display: 'none' },
    userPreviewMainIdentifier: { textTransform: 'lowercase', fontFamily: 'inherit' },
    userPreviewSecondaryIdentifier: { color: '#777777', textTransform: 'lowercase', fontFamily: 'inherit' },
  },
};

function App() {
  const [showApp, setShowApp] = useState(() => localStorage.getItem('orian_show_app') === '1');
  const [legalPage, setLegalPage] = useState(null);
  const [view, setView] = useState('input');
  const [agentMessages, setAgentMessages] = useState([]);
  const [workspace, setWorkspace] = useState({ files: [], entry: '' });
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const workspaceVersionRef = useRef(null);
  const adoptWorkspace = next => {
    if (!next?.files?.length) return;
    const version = `${next.updatedAt || JSON.stringify(next.files)}:${next.recovered ? 'recovered' : 'original'}`;
    if (workspaceVersionRef.current === version) return;
    workspaceVersionRef.current = version;
    setWorkspace(next);
  };
  const [finalResult, setFinalResult] = useState('');
  const [loaderStep, setLoaderStep] = useState(0);
  const [loaderComplete, setLoaderComplete] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [toast, setToast] = useState(null);
  const [activeGoalId, setActiveGoalId] = useState(null);
  const { isLoaded: authLoaded, isSignedIn, getToken, signOut } = useAuth();
  const { user } = useUser();
  const socketRef = useRef(null);
  const activeTaskRef = useRef(null);
  const conversationRef = useRef(null);
  const historySelectionRef = useRef(0);
  const completedGoalsRef = useRef(new Set());
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  // true only while the user is deliberately viewing the auth modal
  const enteredAuthRef = useRef(false);

  const resetToLanding = () => {
    localStorage.removeItem('orian_show_app');
    setShowApp(false);
    setView('input');
    setTasks([]);
    setAgentMessages([]);
    setFinalResult('');
    setChatHistory([]);
    conversationRef.current = null;
    setWorkspace({ files: [], entry: '' });
    workspaceVersionRef.current = null;
    setActiveGoalId(null);
    activeTaskRef.current = null;
  };

  // Auth is authoritative: signed in => dashboard, signed out => landing
  // (unless the user explicitly opened the auth modal via "get started")
  useEffect(() => {
    if (!authLoaded) return;
    if (isSignedIn) {
      localStorage.setItem('orian_show_app', '1');
      setShowApp(true);
      enteredAuthRef.current = false;
      return;
    }
    if (enteredAuthRef.current) return;
    if (localStorage.getItem('orian_show_app') === '1') resetToLanding();
  }, [authLoaded, isSignedIn]);

  useEffect(() => {
    let closed = false;
    let authRetries = 0;
    let retryTimer;
    const socket = socketIO(BACKEND_URL, {
      autoConnect: false,
      transports: ['polling', 'websocket'],
      auth: async callback => {
        try {
          const token = await getTokenRef.current({ skipCache: true });
          if (!closed) callback({ token });
        } catch (_) { if (!closed) callback({}); }
      },
    });
    socketRef.current = socket;

    socket.on('connect_error', error => {
      if (closed) return;
      console.warn('Live updates reconnecting:', error.message);
      setReconnecting(true);
      // Transport failures retry automatically. A rejected authentication handshake does not.
      if (!socket.active && authRetries < 2) {
        authRetries++;
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => { if (!closed) socket.connect(); }, authRetries * 1000);
      }
    });
    socket.on('disconnect', () => {
      if (!closed && activeTaskRef.current) setReconnecting(true);
    });
    socket.on('connect', () => {
      clearTimeout(retryTimer);
      authRetries = 0;
      setReconnecting(false);
      if (activeTaskRef.current) socket.emit('subscribe_goal', activeTaskRef.current);
    });

    socket.on('agent_activity', (data) => {
      if (data.goalId !== activeTaskRef.current) return;
      const agentName = data.agent?.toLowerCase();
      const stepMap = {
        planner: 0,
        router: 1,
        web_agent: 2,
        web_search: 2,
        file_generation: 2,
        file_agent: 2,
        code_execution: 2,
        code_agent: 2,
        analysis: 2,
        critic: 3,
        summarizer: 4,
      };
      const step = stepMap[agentName];
      if (step !== undefined) setLoaderStep(step);
      setAgentMessages(prev => mergeActivity(prev, [data]));
    });

    socket.on('task_update', (data) => {
      if (data.goalId !== activeTaskRef.current) return;
      const stageMap = { planning: 0, routing: 1, execution_in_progress: 2, quality_review: 3, summarization: 4 };
      const step = stageMap[data.stage];
      if (step !== undefined) setLoaderStep(step);
    });

    socket.on('task_cancelled', (data) => {
      if (data.goalId !== activeTaskRef.current) return;
      setTasks(prev => prev.map(t => t.id === activeTaskRef.current ? { ...t, status: 'cancelled' } : t));
      setToast({ message: 'task stopped.', error: false });
      setView('input');
    });

    socket.on('task_complete', (data) => {
      if (data.goalId !== activeTaskRef.current || completedGoalsRef.current.has(data.goalId)) return;
      completedGoalsRef.current.add(data.goalId);
      const r = data.result || {};
      const report = r.report?.content || r.summary?.main || '';
      const artifacts = r.artifacts || { code: [], files: [] };
      adoptWorkspace(recoverWorkspace({ result: r, workspace: r.workspace }));
      setTasks(prev => prev.map(t => t.id === activeTaskRef.current ? { ...t, status: 'completed', result: report, artifacts } : t));
      setChatHistory(prev => [...prev, { role: 'assistant', content: report }]);
      setFinalResult({ report, artifacts, mode: r.mode });
      setLoaderComplete(true);
      if (!['chat', 'clarification'].includes(r.mode)) setToast({ message: 'task completed successfully!', error: false });
    });

    socket.on('task_error', (data) => {
      if (data.goalId !== activeTaskRef.current) return;
      setTasks(prev => prev.map(t => t.id === (data.goalId || activeTaskRef.current) ? { ...t, status: 'failed' } : t));
      const msg = String(data.error || data.message || data.err || data.reason || '');
      if (/rate.?limit|429|too many|free-models-per-day|add .* credits|quota|exceeded/i.test(msg)) {
        setToast({ message: 'rate limited — try again in a moment.', error: true });
      } else if (msg) {
        setToast({ message: msg.length > 80 ? msg.slice(0, 80) + '...' : msg, error: true });
      } else {
        setToast({ message: 'rate limited — try again in a moment.', error: true });
      }
      setView('input');
      activeTaskRef.current = null;
    });

    socket.on('workflow-complete', (data) => {
      if (data.goalId !== activeTaskRef.current) return;
      const report = data.report || '';
      setTasks(prev => prev.map(t => t.id === activeTaskRef.current ? { ...t, status: 'completed', result: report } : t));
      setChatHistory(prev => [...prev, { role: 'assistant', content: report }]);
      setFinalResult(report);
      setLoaderComplete(true);
      setToast({ message: 'task completed successfully!', error: false });
    });

    socket.on('workflow-error', (data) => {
      if (data.goalId !== activeTaskRef.current) return;
      setTasks(prev => prev.map(t => t.id === activeTaskRef.current ? { ...t, status: 'failed' } : t));
      const msg = String(data.error || '');
      if (/rate.?limit|429|too many|free-models-per-day|add .* credits/i.test(msg)) {
        setToast({ message: 'rate limited — try again in a moment.', error: true });
      } else {
        setToast({ message: msg || 'something went wrong. please try again.', error: true });
      }
      setView('input');
    });

    return () => { closed = true; clearTimeout(retryTimer); socket.disconnect(); };
  }, []);

  useEffect(() => {
    if (!activeGoalId || loaderComplete) return;
    let stopped = false;
    const poll = async () => {
      try {
        const token = await getTokenRef.current();
        if (!token) return;
        const response = await fetch(`${BACKEND_URL}/api/goal/${activeGoalId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok || stopped) return;
        const goal = await response.json();
        if (stopped || activeTaskRef.current !== activeGoalId) return;
        if (goal.workspace) adoptWorkspace(recoverWorkspace(goal));
        if (goal.activity?.length) setAgentMessages(prev => mergeActivity(prev, goal.activity));
        if (goal.status === 'completed' && goal.result && !completedGoalsRef.current.has(activeGoalId)) {
          completedGoalsRef.current.add(activeGoalId);
          const report = goal.result.report?.content || goal.result.summary?.main || '';
          const artifacts = goal.result.artifacts || { code: [], files: [] };
          adoptWorkspace(recoverWorkspace(goal));
          setTasks(prev => prev.map(t => t.id === activeGoalId ? { ...t, status: 'completed', result: report, artifacts } : t));
          setChatHistory(prev => [...prev, { role: 'assistant', content: report }]);
          setFinalResult({ report, artifacts, mode: goal.result.mode });
          setLoaderComplete(true);
        } else if (goal.status === 'failed') {
          setTasks(prev => prev.map(t => t.id === activeGoalId ? { ...t, status: 'failed' } : t));
          setToast({ message: goal.result?.error || 'task failed', error: true });
          activeTaskRef.current = null;
          setView('input');
        } else if (goal.status === 'cancelled') {
          activeTaskRef.current = null;
          setLoaderComplete(true);
        }
      } catch (_) {}
    };
    poll();
    const timer = setInterval(poll, 2500);
    return () => { stopped = true; clearInterval(timer); };
  }, [activeGoalId, loaderComplete]);

  useEffect(() => {
    if (!authLoaded || !isSignedIn) return;
    let stopped = false;
    (async () => {
      try {
        const token = await getTokenRef.current();
        const response = await fetch(`${BACKEND_URL}/api/goal`, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) return;
        const data = await response.json();
        if (!stopped) setTasks((data.goals || []).map(g => ({ id: g.id || g._id, conversationId: g.conversationId || g.id || g._id, goal: g.conversationTitle || g.goal, status: g.status, time: new Date(g.createdAt).toLocaleTimeString(), result: g.result, context: g.context, activity: g.activity, artifacts: g.result?.artifacts })));
      } catch (_) {}
    })();
    return () => { stopped = true; };
  }, [authLoaded, isSignedIn]);

  useEffect(() => {
    if (showApp) return;
    const lenis = new Lenis({ duration: 1.2, easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
    let frame;
    function raf(time) { lenis.raf(time); frame = requestAnimationFrame(raf); }
    frame = requestAnimationFrame(raf);
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); }
      });
    }, { threshold: 0.1 });
    document.querySelectorAll('.animate-on-scroll').forEach(el => observer.observe(el));
    return () => { cancelAnimationFrame(frame); lenis.destroy(); observer.disconnect(); };
  }, [showApp]);

  useEffect(() => {
    const handle = document.getElementById('resize-handle');
    const sidebar = document.getElementById('sidebar');
    if (!handle || !sidebar) return;
    let dragging = false;
    let raf = 0;
    let targetWidth = 0;
    let currentWidth = 0;

    const clamp = (x) => Math.min(Math.max(x, 160), 480);
    const savedWidth = Number(localStorage.getItem('orian_sidebar_width'));
    if (!sidebarCollapsed && savedWidth >= 160) sidebar.style.width = clamp(savedWidth) + 'px';

    const tick = () => {
      const diff = targetWidth - currentWidth;
      if (Math.abs(diff) < 0.5) {
        currentWidth = targetWidth;
        sidebar.style.width = currentWidth.toFixed(2) + 'px';
        if (!dragging) {
          raf = 0;
          sidebar.classList.remove('resizing');
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          return;
        }
      } else {
        currentWidth += diff * 0.4;
        sidebar.style.width = currentWidth.toFixed(2) + 'px';
      }
      raf = window.requestAnimationFrame(tick);
    };

    const ensureLoop = () => {
      if (!raf) raf = window.requestAnimationFrame(tick);
    };

    const onPointerDown = (e) => {
      if (sidebarCollapsed) return;
      e.preventDefault();
      dragging = true;
      currentWidth = sidebar.getBoundingClientRect().width;
      targetWidth = currentWidth;
      sidebar.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      try {
        handle.setPointerCapture(e.pointerId);
      } catch (err) {}
      ensureLoop();
    };
    const onPointerMove = (e) => {
      if (!dragging) return;
      targetWidth = clamp(e.clientX);
      ensureLoop();
    };
    const onPointerUp = (e) => {
      if (!dragging) return;
      dragging = false;
      targetWidth = clamp(e.clientX);
      localStorage.setItem('orian_sidebar_width', String(targetWidth));
      ensureLoop();
    };
    const resetWidth = () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0; dragging = false;
      sidebar.classList.remove('resizing');
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      sidebar.style.width = ''; localStorage.removeItem('orian_sidebar_width');
    };
    handle.addEventListener('dblclick', resetWidth);
    handle.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      handle.removeEventListener('dblclick', resetWidth);
      handle.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      if (raf) window.cancelAnimationFrame(raf);
      if (dragging) { document.body.style.cursor = ''; document.body.style.userSelect = ''; }
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

  const handleGetStarted = () => {
    enteredAuthRef.current = true;
    setShowApp(true);
  };

  const handleLogout = async () => {
    enteredAuthRef.current = false;
    resetToLanding();
    try { await signOut({ redirectUrl: '/' }); } catch (_) {}
  };

  const handleSubmitGoal = async (goal) => {
    const submission = ++historySelectionRef.current;
    if (activeTaskRef.current) socketRef.current?.emit('unsubscribe_goal', activeTaskRef.current);
    activeTaskRef.current = null;
    setActiveGoalId(null);
    setToast(null);
    const currentConversation = conversationRef.current;
    const newTask = { id: null, conversationId: currentConversation?.id, goal: currentConversation?.title || goal, status: 'processing', time: new Date().toLocaleTimeString() };
    setAgentMessages([]);
    setFinalResult({ report: '', artifacts: { code: [], files: [] } });
    setLoaderStep(0);
    setLoaderComplete(false);
    setChatHistory(prev => [...prev, { role: 'user', content: goal }]);
    setView('loader');

    const context = [...chatHistory, { role: 'user', content: goal }];

    try {
      const token = await getToken();
      if (!token) {
        setToast({ message: 'session expired. please sign in again.', error: true });
        handleLogout();
        return;
      }
      const res = await fetch(`${BACKEND_URL}/api/goal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ goal, previousGoalId: currentConversation?.latestGoalId, workspace: workspaceRef.current.files.length ? workspaceRef.current : undefined, context: context.length > 1 ? context : undefined }),
      });
      const data = await res.json();
      if (submission !== historySelectionRef.current) return;
      if (res.status === 401) {
        handleLogout();
        setToast({ message: 'session expired. please sign in again.', error: true });
        return;
      }
      if (!res.ok) throw new Error(data.error || 'failed to submit goal');

      newTask.id = data.goalId;
      newTask.conversationId = data.conversationId || currentConversation?.id || data.goalId;
      newTask.goal = data.conversationTitle || currentConversation?.title || goal;
      conversationRef.current = { id: newTask.conversationId, title: newTask.goal, latestGoalId: data.goalId };
      activeTaskRef.current = data.goalId;
      setActiveGoalId(data.goalId);
      setTasks(prev => [newTask, ...prev.filter(task => (task.conversationId || task.id) !== newTask.conversationId)]);

      if (socketRef.current) {
        if (!socketRef.current.connected) {
          socketRef.current.connect();
        } else {
          socketRef.current.emit('subscribe_goal', data.goalId);
        }
      }
    } catch (err) {
      if (submission !== historySelectionRef.current) return;
      console.error(err);
      setToast({ message: err.message || 'failed to connect to server.', error: true });
      setView('input');
    }
  };

  const handleStopGoal = async (opts = {}) => {
    const { silent = false } = opts;
    const goalId = activeTaskRef.current;
    if (!goalId) return;
    setTasks(prev => prev.map(t => t.id === goalId ? { ...t, status: 'cancelled' } : t));
    setLoaderComplete(true);
    activeTaskRef.current = null;
    if (!silent) setToast('task stopped.');
    try {
      const token = await getToken();
      await fetch(`${BACKEND_URL}/api/goal/${goalId}/cancel`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
    } catch (_) {}
  };

  const handleSelectTask = async (task) => {
    const selection = ++historySelectionRef.current;
    if (activeTaskRef.current) socketRef.current?.emit('unsubscribe_goal', activeTaskRef.current);
    activeTaskRef.current = null;
    setActiveGoalId(null);
    setDrawerOpen(false);
    setLoaderComplete(true);
    setAgentMessages([]);
    setFinalResult({ report: '', artifacts: { code: [], files: [] } });
    setWorkspace({ files: [], entry: '' });
    workspaceVersionRef.current = null;
    setChatHistory([{ role: 'assistant', content: 'Opening conversation…' }]);
    setView('loader');
    try {
      const token = await getToken();
      if (!token) throw new Error('Please sign in again.');
      const response = await fetch(`${BACKEND_URL}/api/goal/${task.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Could not open this conversation. Please try again.');
      const goal = await response.json();
      if (selection !== historySelectionRef.current) return;
      conversationRef.current = { id: goal.conversationId || task.conversationId || goal.id || task.id, title: goal.conversationTitle || task.goal, latestGoalId: task.id };
      const restored = restoreConversation(goal);
      setActiveGoalId(task.id);
      adoptWorkspace(recoverWorkspace(goal));
      setChatHistory(restored.history);
      setFinalResult({ report: restored.reply, artifacts: restored.artifacts, mode: restored.mode });
      setAgentMessages(mergeActivity([], goal.activity || []));
      const pending = ['queued', 'running'].includes(goal.status);
      setLoaderComplete(!pending);
      if (pending) {
        completedGoalsRef.current.delete(task.id);
        activeTaskRef.current = task.id;
        setActiveGoalId(task.id);
        if (socketRef.current) {
          if (!socketRef.current.connected) socketRef.current.connect();
          else socketRef.current.emit('subscribe_goal', task.id);
        }
      }
    } catch (error) {
      if (selection !== historySelectionRef.current) return;
      setChatHistory([{ role: 'assistant', content: error.message }]);
      setToast({ message: error.message, error: true });
    }
  };

  const handleNewGoal = () => {
    historySelectionRef.current++;
    if (activeTaskRef.current) socketRef.current?.emit('unsubscribe_goal', activeTaskRef.current);
    activeTaskRef.current = null;
    setActiveGoalId(null);
    setLoaderComplete(false);
    setView('input');
    setAgentMessages([]);
    setChatHistory([]);
    conversationRef.current = null;
    setWorkspace({ files: [], entry: '' });
    workspaceVersionRef.current = null;
    setFinalResult({ report: '', artifacts: { code: [], files: [] } });
    setLoaderStep(0);
  };

  const saveCodeWorkspace = async next => {
    const selection = historySelectionRef.current;
    if (!activeGoalId) throw new Error('Wait for the project to finish generating');
    const token = await getToken();
    const response = await fetch(`${BACKEND_URL}/api/goal/${activeGoalId}/workspace`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(next),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not save workspace');
    if (selection === historySelectionRef.current) {
      workspaceVersionRef.current = `${data.workspace.updatedAt}:original`;
      setWorkspace(data.workspace);
    }
  };
  const codingSession = workspace.files.length > 0 || agentMessages.some(m => ['code_execution', 'code_agent'].includes(m.agent) || m.agentType === 'code_execution');

  if (showApp) {
    return (
      <div className={`app app-product${codingSession ? ' app-coding' : ''}`}>

        {authLoaded && !isSignedIn && <AuthModal />}
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
                  <Integrations getToken={getToken} />
                  <button className="taskhistory-new-btn" style={{ marginTop: '0.75rem' }} onClick={handleNewGoal}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    new goal
                  </button>
                  <div className="sidebar-user">
                    <div className="sidebar-user-row">
                      <UserButton appearance={userButtonAppearance} />
                      <span className="sidebar-user-email">{user?.primaryEmailAddress?.emailAddress || ''}</span>
                    </div>
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
          <main className={`app-main${view === 'loader' ? ' no-pad' : ''}${view === 'loader' && codingSession ? ' coding-main' : ''}`}>
            <button className="hamburger-btn" onClick={() => setDrawerOpen(o => !o)}>
              <span /><span /><span />
            </button>
            {view === 'input' && <GoalForm onSubmit={handleSubmitGoal} getToken={getToken} />}
            {view === 'loader' && <ResizableWorkspace enabled={codingSession}>
              <Loader reconnecting={reconnecting} coding={codingSession} currentStep={loaderStep} messages={agentMessages} onStop={handleStopGoal} complete={loaderComplete} onNewGoal={handleNewGoal} result={finalResult} chatHistory={chatHistory} onSubmit={handleSubmitGoal} getToken={getToken} />
              {codingSession && <CodeWorkspace onRepair={() => handleSubmitGoal('Fix the app preview: ensure the working user interface is the HTML entry, keep tests in separate files, and repair any preview errors.')} workspace={workspace} onChange={setWorkspace} onSave={saveCodeWorkspace} busy={!loaderComplete} projectId={activeGoalId} />}
            </ResizableWorkspace>}
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
                <Integrations getToken={getToken} />
                <div className="sidebar-user">
                  <div className="sidebar-user-row">
                    <UserButton appearance={userButtonAppearance} />
                    <span className="sidebar-user-email">{user?.primaryEmailAddress?.emailAddress || ''}</span>
                  </div>
                  <button className="sidebar-logout-btn" onClick={handleLogout}>sign out</button>
                </div>
            </div>
          </div>
        )}
        {toast && <Toast message={toast.message} error={toast.error} onClose={() => setToast(null)} />}
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

        <LandingContent onStart={handleGetStarted} onPrivacy={() => setLegalPage('privacy')} onTerms={() => setLegalPage('terms')} />
      </div>
    </div>
  );
}

export default App;
