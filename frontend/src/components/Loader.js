import React, { useEffect, useRef, useMemo, useState, Fragment } from 'react';
import { normalizeStoredReply } from '../conversation';
import OrianLogo from './OrianLogo';
import ModelSelector from './ModelSelector';
import './Loader.css';
import './GoalForm.css';

function renderMarkdown(text, coding = false) {
  if (!text) return '';
  if (coding && /```/.test(text)) text = text.split('```')[0].trim().slice(0, 400) + '\n\nSource files are in the workspace.';
  let html = normalizeStoredReply(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`(.+?)`/g, '<code>$1</code>');
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, (_, label, url) => /^https?:\/\//i.test(url) ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>` : label);
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  const lines = html.split('\n');
  const result = [];
  let inList = false;
  for (const line of lines) {
    if (line.startsWith('<li>') && !inList) {
      result.push('<ul>');
      inList = true;
    } else if (!line.startsWith('<li>') && inList) {
      result.push('</ul>');
      inList = false;
    }
    if (!line.startsWith('<ul>') && !line.startsWith('</ul>') && !line.startsWith('<li>')) {
      if (line.trim() === '') {
        result.push('<br/>');
      } else if (!line.startsWith('<h') && !line.startsWith('<a')) {
        result.push('<p>' + line + '</p>');
      } else {
        result.push(line);
      }
    } else {
      result.push(line);
    }
  }
  if (inList) result.push('</ul>');
  return result.join('\n');
}

const AGENT_LABELS = {
  assistant: 'assistant',
  notion_action: 'Notion agent',
  google_action: 'Google Docs agent',
  slack_action: 'Slack agent',
  github_action: 'GitHub agent',
  linear_action: 'Linear agent',
  airtable_action: 'Airtable agent',
  planner: 'planner',
  router: 'router',
  web_agent: 'web agent',
  web_search: 'web search',
  file_generation: 'file generation',
  file_agent: 'file agent',
  code_execution: 'code execution',
  code_agent: 'code agent',
  critic: 'critic',
  summarizer: 'summarizer',
  analysis: 'analysis',
  system: 'system',
};

function formatTime(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return '';
  }
}

function Loader({ reconnecting = false, coding = false, currentStep = 0, messages = [], onStop, complete, onNewGoal, result, chatHistory = [], onSubmit, getToken }) {
  const streamRef = useRef(null);
  const inputRef = useRef(null);
  const [input, setInput] = useState('');
  const [thinkingOpen, setThinkingOpen] = useState(true);

  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [chatHistory, complete, messages, thinkingOpen]);

  useEffect(() => {
    if (complete && inputRef.current) inputRef.current.focus();
  }, [complete]);

  const lastMsg = messages[messages.length - 1];
  const activeAgent = lastMsg?.agent || null;

  const assigned = useMemo(() => {
    const list = [];
    messages.forEach(m => {
      if (m.action === 'task_routed' && m.agentType && !list.includes(m.agentType)) {
        list.push(m.agentType);
      }
    });
    return list;
  }, [messages]);

  const roster = useMemo(() => {
    const agents = [...new Set(messages.filter(m => m.agent !== 'system').map(m => m.agent))];
    for (const agent of assigned) if (!agents.includes(agent)) agents.push(agent);
    return agents.map(agent => {
      const events = messages.filter(m => m.agent === agent);
      const latest = events[events.length - 1];
      return { key: agent, agent, label: latest?.message || 'Assigned', status: complete ? 'done' : agent === activeAgent ? 'working' : events.length ? 'done' : 'queued' };
    });
  }, [complete, activeAgent, messages, assigned]);
  const statusSummary = complete ? (result?.mode === 'clarification' ? 'waiting for your answer' : 'finished') : lastMsg?.message || 'Reading your request…';
  const progress = complete ? 100 : [...messages].reverse().find(m => Number.isFinite(m.progress))?.progress || 3;

  const lastUserIndex = useMemo(() => {
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      if (chatHistory[i].role === 'user') return i;
    }
    return -1;
  }, [chatHistory]);

  useEffect(() => { setThinkingOpen(!complete); }, [complete]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    if (!complete && onStop) {
      onStop({ silent: true });
    }
    onSubmit(text);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      handleSubmit(e);
    }
  };

  const hasAgentActivity = useMemo(() => {
    return messages.some(m => m.agent && !['assistant', 'system'].includes(m.agent));
  }, [messages]);

  const showWorkProgress = hasAgentActivity && !['chat', 'clarification'].includes(result?.mode);

  const thinkingBlock = (
    <div className={`loader-thinking${thinkingOpen ? ' open' : ''}`}>
      <button
        className="loader-thinking-head"
        onClick={() => setThinkingOpen(o => !o)}
        aria-expanded={thinkingOpen}
      >
        <svg className="loader-thinking-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="loader-thinking-title">work progress</span>
        <span className="loader-thinking-status">{statusSummary}</span>
      </button>

      {thinkingOpen && (
        <div className="loader-thinking-body">
          <div className="loader-thinking-agents">
            {roster.map(p => (
              <div key={p.key || p.agent} className={`loader-agent-row ${p.status}`}>
                <span className="loader-agent-dot" />
                <span className="loader-agent-name">{AGENT_LABELS[p.agent] || p.agent}</span>
                <span className="loader-agent-phase" title={p.label}>{p.status === 'working' ? 'working now' : p.status === 'done' ? 'finished' : 'assigned'}</span>
                <span className="loader-agent-state">
                  {p.status === 'done' ? 'done' : p.status === 'working' ? 'working' : 'queued'}
                </span>
              </div>
            ))}
            {assigned.length > 0 && (
              <div className="loader-assigned">
                <span className="loader-thinking-label">assigned</span>
                {assigned.map(a => (
                  <span key={a} className="loader-assigned-chip">{AGENT_LABELS[a] || a}</span>
                ))}
              </div>
            )}
          </div>

          <div className="loader-thinking-notes">
            {messages.length === 0 && (
              <p className="loader-note-empty">waiting for the agents to report in...</p>
            )}
            {messages.slice(-12).map((m, i) => (
              <div
                key={m.key || i}
                className={`loader-note${m.agent === activeAgent && !complete ? ' live' : ''}`}
              >
                <span className="loader-note-dot" />
                <span className="loader-note-agent">{AGENT_LABELS[m.agent] || m.agent}</span>
                <span className="loader-note-text">{m.message?.length > 180 ? m.message.slice(0, 177) + '…' : m.message}</span>
                <span className="loader-note-time">{formatTime(m.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="loader-chat">
      {((!complete && showWorkProgress) || result?.mode === 'clarification') && (
        <div className="loader-current-work" role="status" aria-live="polite">
          <div className="loader-current-heading">
            <strong>{complete ? 'Your input needed' : `${AGENT_LABELS[activeAgent] || activeAgent || 'assistant'} · working`}</strong>
            <span>{complete ? 'Reply below to continue' : statusSummary}</span>
          </div>
          {!complete && <div className="loader-progress-track" role="progressbar" aria-label="Work progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${progress}%` }} /></div>}
          {!complete && reconnecting && <p className="loader-connection-note" role="status">Reconnecting live updates. Your task is still running.</p>}
          {!complete && assigned.length > 0 && <div className="loader-current-assigned">Assigned: {assigned.map(a => AGENT_LABELS[a] || a).join(', ')}</div>}
        </div>
      )}
      <div className="loader-thread" ref={streamRef}>
        {lastUserIndex === -1 && showWorkProgress && thinkingBlock}
        {chatHistory.map((msg, i) => (
          <Fragment key={i}>
            {msg.role === 'user' ? (
              <div className="loader-thread-user">
                <div className="loader-thread-bubble">{msg.content}</div>
                <div className="loader-thread-avatar loader-thread-avatar-you">you</div>
              </div>
            ) : (
              <div className="loader-thread-answer">
                <div className="loader-thread-avatar loader-thread-avatar-agent">
                  <OrianLogo size={16} color="currentColor" />
                </div>
                <div className="loader-thread-answer-body">
                  <div className="loader-chat-report-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content, coding) }} />
                </div>
              </div>
            )}

            {i === lastUserIndex && showWorkProgress && thinkingBlock}
          </Fragment>
        ))}

        {!complete && chatHistory.length > 0 && chatHistory[chatHistory.length - 1]?.role === 'user' && (
          <div className="loader-thread-answer">
            <div className="loader-thread-avatar-spacer" />
            <div className="loader-thread-answer-body">
              <div className="loader-chat-dots">
                <span /><span /><span />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="loader-chat-bottom">
        <div className="loader-chat-input-area">
          <form className="goalform-bar loader-chat-input-box" onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              type="text"
              className="loader-chat-input-field"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={result?.mode === 'clarification' ? 'answer to continue...' : complete ? 'ask a follow-up...' : 'type to interrupt...'}
            />
            <div className="loader-chat-input-foot">
              <div className="loader-chat-input-foot-left">
                <ModelSelector getToken={getToken} />
              </div>
              <div className="loader-chat-input-actions">
                {input.trim() ? (
                  <button type="submit" className="goalform-send-btn">
                    <span className="goalform-send-arrow">↗</span>
                    <span className="goalform-send-label">send</span>
                  </button>
                ) : (
                  !complete && onStop && (
                    <button type="button" className="loader-chat-stop" onClick={() => onStop()}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
                    </button>
                  )
                )}
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default Loader;
