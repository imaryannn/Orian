# Orian

Orian is a multi-agent automation app. A user submits a goal, and the backend plans work, routes subtasks to specialist agents, performs web research, generates reports/files, and streams progress to the frontend in real time.

## Live URLs

- Frontend: https://oriannn.vercel.app
- Backend: https://orian-ondq.onrender.com
- Health check: https://orian-ondq.onrender.com/health

## Tech Stack

- Frontend: React, Socket.io client
- Backend: Node.js, Express, Socket.io, BullMQ
- Data: PostgreSQL
- Queue: Redis/Upstash
- AI/search: Groq, Tavily
- Integrations: Notion, Slack, Google, GitHub, Linear, Discord, Airtable, webhooks

## Project Structure

```text
frontend/   React app
server/     Express API, workers, agents, queues, database modules
```

## Local Setup

### Backend

```bash
cd server
npm install
npm run dev
```

The backend runs on:

```text
http://localhost:3000
```

### Frontend

```bash
cd frontend
npm install
npm start
```

The frontend runs on:

```text
http://localhost:3001
```

## Environment Variables

Create `server/.env` from `server/.env.example`.

Required backend variables:

```text
DATABASE_URL=
REDIS_URL=
FRONTEND_URL=https://oriannn.vercel.app
GROQ_API_KEY=
TAVILY_API_KEY=
JWT_SECRET=
```

Optional integration variables:

```text
NOTION_CLIENT_ID=
NOTION_CLIENT_SECRET=
NOTION_REDIRECT_URI=https://orian-ondq.onrender.com/auth/notion/callback

SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_REDIRECT_URI=https://orian-ondq.onrender.com/auth/slack/callback

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://orian-ondq.onrender.com/auth/google/callback

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=https://orian-ondq.onrender.com/auth/github/callback

LINEAR_CLIENT_ID=
LINEAR_CLIENT_SECRET=
LINEAR_REDIRECT_URI=https://orian-ondq.onrender.com/auth/linear/callback
```

Frontend environment:

```text
REACT_APP_BACKEND_URL=https://orian-ondq.onrender.com
```

## OAuth Redirects

Use the backend callback URLs for OAuth redirect URIs:

```text
https://orian-ondq.onrender.com/auth/notion/callback
https://orian-ondq.onrender.com/auth/slack/callback
https://orian-ondq.onrender.com/auth/google/callback
https://orian-ondq.onrender.com/auth/github/callback
https://orian-ondq.onrender.com/auth/linear/callback
```

For Google, set Authorized JavaScript origins:

```text
https://oriannn.vercel.app
https://orian-ondq.onrender.com
http://localhost:3000
```

## Deployment

### Backend on Render

Use the `server` directory as the root.

```text
Build Command: npm install && npm run build
Start Command: npm start
Node: 20.x
```

Add all backend environment variables in Render. Render does not read local `.env` files.

### Frontend on Vercel

Use the `frontend` directory as the root.

```text
Framework: Create React App
Install Command: npm install
Build Command: npm run build
Output Directory: build
```

Add:

```text
REACT_APP_BACKEND_URL=https://orian-ondq.onrender.com
```

## Useful API Routes

```text
GET  /health
POST /register
POST /login
POST /api/goal
GET  /api/stats/queue
GET  /api/stats/worker
GET  /integrations/list
```

## Notes

- Generated report files are written by the backend file agent and tracked in PostgreSQL.
- Background tasks are processed through BullMQ and Redis.
- Socket.io sends live task progress, completion, and error events to the frontend.
- Keep secrets out of git. Rotate any key that has been pasted into chat, logs, screenshots, or public issues.
