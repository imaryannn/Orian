# Orian

Orian is a React + Node.js assistant for conversation and agent workflows. Normal chat answers directly with conversation context. Tasks use a planner, router, research/writing/code/app specialists, critic, and summarizer, with live progress and persisted results.

## Run locally

Use Node.js 20 or newer. From the repository root:

```bash
npm run setup
```

Copy `server/.env.example` to `server/.env` and `frontend/.env.example` to `frontend/.env` if you don't already have them. Keep existing keys when updating an existing installation.

```bash
npm start
```

Open [Orian](http://localhost:3001). The API listens on [port 3000](http://localhost:3000/health). Both processes run from one root command; Ctrl+C stops them. You can also run `npm start` separately in `server` and `frontend`.

The backend requires reachable MongoDB and Redis instances. MongoDB stores goals, conversation context, results, files, and user settings; BullMQ uses Redis for task processing. They may be local instances or hosted services. There is no PostgreSQL dependency despite the legacy filename `server/db/sqlite.js`.

## Keys and settings

Real credentials belong only in the ignored `server/.env` and `frontend/.env` files locally, and in the hosting provider's environment settings in production. Commit the `.env.example` templates with blank credentials. Every `REACT_APP_*` value is bundled into the public website; only public URLs and Clerk's publishable key belong there. Keep API keys, database credentials, and Clerk's secret key on the backend.

Git ignores local agent settings, hosting account settings, generated uploads/code, builds, logs, and private certificate files. Ignoring a file does not remove copies already present in Git history; rotate any credential that was previously published.

Backend (`server/.env`):

```dotenv
MONGODB_URI=mongodb://localhost:27017/orian
REDIS_URL=redis://localhost:6379
FRONTEND_URL=http://localhost:3001
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openrouter/free
CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
# Optional: research and connected apps
TAVILY_API_KEY=
COMPOSIO_API_KEY=
# Optional: public backend URL used for OAuth callbacks behind a proxy
BACKEND_URL=
# Optional tracing
OMIUM_API_KEY=
OMIUM_PROJECT=orian
```

Frontend (`frontend/.env`):

```dotenv
REACT_APP_BACKEND_URL=http://localhost:3000
REACT_APP_CLERK_PUBLISHABLE_KEY=
```

Clerk's frontend and backend keys must belong to the same application. Restart the frontend after changing its environment. Without Tavily, chat, writing, and app actions still work; web research requires its key. Tavily searches use basic depth to conserve its quota. Optional app/trace services have their own quotas and pricing.

### Free AI only

The default is [OpenRouter's free router](https://openrouter.ai/openrouter/free), which selects currently available free models. The model selector also offers NVIDIA Nemotron's free variant. A retired selected model falls back to the free router. Saved references to the removed MiniMax free ID are ignored.

Every inference request has a zero prompt/completion price ceiling. Paid model overrides are rejected; there is no paid fallback. Free models have availability and rate limits. You do not need to buy credits for the default model, and quota errors are shown instead of switching to a paid model. Create a key at [OpenRouter](https://openrouter.ai/settings/keys).

## Connect Notion, Google Docs, and other apps

1. Set `COMPOSIO_API_KEY` on the backend and sign in to Orian.
2. Click **connect** beside an app in the sidebar. Allow the popup, authenticate, and grant access to the desired workspace/documents.
3. Set optional destination settings under **config**, such as a Notion parent page or Slack channel.
4. Ask for a concrete action, for example “Find my Notion project page and add these meeting notes” or “Create a Google Doc summarizing the notes above.”

Connections belong to the signed-in Clerk user. Orian discovers real Composio tools and their input schemas, selects tools for the task, and uses tool results to discover IDs and complete subsequent steps. Supported apps: Notion, Google Docs, Slack, GitHub, Linear, and Airtable. The app uses its own connections; it does not inherit connectors from Codex.

A connected app is used when requested. Reports are not automatically sent to every connected app. GitHub commits/pushes and repository file writes are disabled. Connector writes are not automatically replayed by BullMQ after a failure. If a workflow fails after a successful write, inspect the destination before manually retrying.

The OAuth callback is `<BACKEND_URL>/integrations/composio/callback`. Existing expired, revoked, or inactive connections must be reconnected. Use an externally reachable backend URL for hosted OAuth environments.

## Workflow behavior

- When essential details are missing, Orian asks one concise question before acting. Your next answer continues the original request using conversation history.
- A visible current-work panel shows the assigned agent, latest action, and stage progress. Activity is stored with the goal and recovered by polling when the socket is unavailable.
- App confirmations are brief and link to resulting items; workspace search results are not echoed as repeated links.
- Conversation history passes through the API, queue, intent classification, and planner.
- Plan dependencies are validated and earlier results feed later specialists.
- Analysis uses the model directly; it does not automatically perform a web search.
- Files are saved beneath `server/uploads/<goalId>/` and included in results. Generated filenames cannot escape that directory.
- Code tasks generate code. The active workflow does not execute model-generated code on the server.
- Connector results, including returned links, appear in the final response.
- The critic records output quality. An assessment can require revision; completion alone does not guarantee approval.
- Cancellation prevents later model/tool steps and completion updates. An external action already in flight cannot be undone by cancellation.
- Goal history, task queries, cancellation, and socket subscriptions require the goal owner's authenticated session.
- Socket subscriptions replay persisted terminal results. The frontend also polls while working to recover missed completion messages.

## Coding workspace

Coding tasks open a split chat and project workspace with a file browser, code editor, and sandboxed live preview. Switch between Code and Preview, select Desktop or Mobile, and use Save (or Cmd/Ctrl+S) to save edits to the conversation. Download file exports the selected source file. Download ZIP exports the entire current workspace, including unsaved edits, preserving all relative folder paths. ZIP creation happens locally in the browser without uploading the project. Changes update the preview after a short delay.

Follow-up requests include the current files, including unsaved edits. AI revisions replace changed files and preserve the other files. Reopening a coding conversation restores the saved workspace; older code artifacts are adapted into files. Save manual changes before navigating away.

The workspace keeps Orian’s existing background and translucent glass styling. Old projects whose HTML entry was replaced by a test harness recover the app source from saved artifacts when available; a repair action is offered if no interface can be found. Test pages are kept under `tests/` rather than replacing the app entry.

The preview runs static HTML/CSS/JavaScript and supports local stylesheets, script files and acyclic local ES module imports. It does not install npm packages, run a backend, or execute Python. Projects requiring those runtimes can still be edited and downloaded. Preview pages are isolated from Orian's authenticated app, and their runtime errors appear in the workspace.

## Checks

```bash
npm test           # regression tests, mocked external services
npm run build      # backend syntax check and frontend production build
npm run diagnose   # live free-model request and read-only connector discovery
```

For a live database + AI workflow check:

```bash
npm --prefix server run smoke
```

The smoke check tests conversation memory and a local report workflow, removes its own temporary records/files, and never writes to connected apps. Live checks consume free API quota.

## Deployment

Backend: use `server` as the root, `npm ci && npm run build` to build, and `npm start` to run. Set all backend variables in the hosting service. Configure `PORT`, `FRONTEND_URL`, `BACKEND_URL`, MongoDB, Redis, and Clerk for that environment.

Frontend: use `frontend` as the root, `npm ci` to install, `npm run build` to build, and `build` as the output directory. Set the production backend URL and Clerk publishable key before building. Backend and frontend fixes must both be deployed for hosted users to receive them.

## API

All goal, task, webhook-trigger, model-setting, and integration endpoints require a Clerk session token. The OAuth callback validates its connection state.

```text
GET    /health
POST   /api/goal
GET    /api/goal
GET    /api/goal/:goalId
POST   /api/goal/:goalId/cancel
GET    /api/tasks/:goalId/status
GET    /api/tasks/:goalId/logs
POST   /api/webhook/trigger
GET    /api/settings/model
POST   /api/settings/model
POST   /api/settings/model/test
GET    /integrations/list
POST   /integrations/connect
POST   /integrations/:provider/config
DELETE /integrations/:provider
```

The older `server/src` workflow experiment is retained on disk but is not mounted by the main server. Browser submissions and webhook triggers use the same authenticated queue and executor.
