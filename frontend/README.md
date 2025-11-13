# Meeting ASR Frontend

React + TypeScript client that delivers the Meeting ASR user experience: upload recordings, monitor processing progress, review transcripts, craft summaries, and chat with the AI copilot.

## UX Highlights
- Authenticated dashboard for job submission and history
- Segment-aware transcript editor with click-to-seek audio playback
- Rich-text meeting minutes workspace with inline references
- AI copilot chat docked to the UI for instant follow-up questions
- Public share links with configurable permissions and access codes
- Responsive layout that adapts to desktop and tablet breakpoints

## Stack & Tooling
- React 19 with TypeScript, bootstrapped by `create-react-app`
- React Router for navigation and protected routes
- React Bootstrap + custom CSS modules for layout and styling
- Quill and Markdown tooling (`@uiw/react-markdown-editor`, `turndown`) for editing flows
- Axios API client with retry logic and automatic auth header injection
- Jest + React Testing Library fixtures (via `react-scripts test`)

## Prerequisites
- Node.js 18+ (LTS recommended for React 19)
- npm 9+ or yarn (examples below use npm)
- Backend service running locally or remotely (`backend/README.md`)

## Setup & Development
```bash
cd frontend
npm install
```

Create a `.env.local` file with at least:
```env
REACT_APP_API_URL=http://localhost:8000
FORK_TS_CHECKER_MEMORY_LIMIT=4096
```
Adjust the API origin for your deployment and update the memory limit if TypeScript diagnostics consume too much RAM.

Start the development server:
```bash
npm start
```
The app runs on `http://localhost:3030` by default. Override the port with `PORT=4000 npm start` when needed.

## Available npm Scripts
- `npm start` development server with hot reload and proxy configuration
- `npm test` watch mode unit/integration tests (use `CI=true npm test` in pipelines)
- `npm run build` optimized production build under `build/`
- `npm run eject` expose CRA tooling (irreversible; only for advanced customization)

## Configuration Notes
- REST calls use `REACT_APP_API_URL`; ensure it matches the backend origin configured in `CORS_ORIGINS`
- WebSocket status updates default to `ws://localhost:8000`; change the default in `src/websocket.ts` or pass a custom base URL when instantiating `JobWebSocketClient`
- OAuth login buttons require the backend to expose Google OAuth audiences (`GOOGLE_CLIENT_ID`)
- Static assets served from `public/` during development; production builds output to `build/`

## Directory Overview
- `src/api.ts` axios configuration, streaming helpers, and share API wrappers
- `src/components/` reusable UI pieces (transcript editor, summary editor, assistant chat, upload dialogs)
- `src/pages/` route-level views (`JobDetailPage`, dashboard, auth screens)
- `src/api/user.ts` user-related requests (auth, profile, admin operations)
- `src/utils/` formatting helpers, guards, and UI utilities
- `public/` CRA static assets and HTML shell

## Working With Authentication
- Tokens are stored in `localStorage` and appended to every request via interceptors
- 401 responses redirect to `/login`; clearing local storage forces re-auth
- Use the backend `create_super_admin.py` script to bootstrap credentials if running locally

## Production Build & Deployment
- Run `npm run build` and serve `build/` via nginx, Vercel, CloudFront, etc.
- Set `REACT_APP_API_URL` during build time to point at the production backend
- Ensure the backend exposes HTTPS and matching CORS origins
- Configure reverse proxy rewrites so `/` serves the SPA and `/static/*` matches build assets

## Troubleshooting
- **White screen on start**: check browser console for mixed-content or CORS errors; verify `REACT_APP_API_URL`
- **Jobs never update**: ensure WebSocket port is reachable; update the base URL in `JobWebSocketClient`
- **TypeScript out-of-memory**: lower `FORK_TS_CHECKER_MEMORY_LIMIT` or disable parallel type checking temporarily
- **OAuth button hidden**: backend must advertise Google client IDs; confirm `.env` is loaded server-side
- **API 404s**: backend path prefix changed? update `src/api.ts` base URL accordingly

## Further Reading
Backend endpoints, job lifecycle, and deployment considerations are covered in `backend/README.md`.
