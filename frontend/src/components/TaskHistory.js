import React from 'react';
import './TaskHistory.css';

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ClockIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const XIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const statusIcon = { completed: <CheckIcon />, processing: <ClockIcon />, failed: <XIcon /> };

function TaskHistory({ tasks, onSelect }) {
  return (
    <div className="taskhistory">
      {tasks && tasks.length > 0 && (
        <>
          <h3 className="taskhistory-heading">conversations</h3>
          <ul className="taskhistory-list">
            {tasks.map((task) => (
              <li key={task.id} className="taskhistory-item" onClick={() => onSelect?.(task)}>
                <span className={`taskhistory-status ${task.status}`}>
                  {statusIcon[task.status]}
                </span>
                <div className="taskhistory-info">
                  <p className="taskhistory-goal">{task.goal}</p>
                  <p className="taskhistory-time">{task.time}</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default TaskHistory;
