# basedchat backend

Node.js + Express + PostgreSQL backend for the basedchat frontend: accounts, video feed,
likes/comments/reposts with XP & levels, a leaderboard, and DMs/groupchats over WebSockets.

## Stack
- **Express** — REST API
- **PostgreSQL** (`pg`) — database
- **Socket.io** — real-time messaging
- **Multer** — video/image uploads to local disk (`/uploads`, served statically). Swap for
  S3 later by changing `src/middleware/upload.js`'s storage engine — nothing else needs to change.
- **JWT** (`jsonwebtoken`) + **bcryptjs** — auth

## Setup

```bash
cd basedchat-backend
npm install
cp .env.example .env        # then edit JWT_SECRET and DATABASE_URL
```

Create the database (adjust to your local Postgres setup):

```bash
createdb basedchat
```

Run migrations:

```bash
npm run migrate
```

Start the server:

```bash
npm run dev      # auto-restarts on file changes
# or
npm start
```

**Now just open `http://localhost:4000` in your browser.** The backend serves the wired
`basedchat.html` frontend itself (from `public/`), already pointed at this exact server —
no separate frontend server, no CORS config, no editing URLs. Every time you restart the
backend and reload that page, you're testing against your local database.

The API is at `http://localhost:4000/api`, and uploaded files are served at
`http://localhost:4000/uploads/...`.

If you'd rather host the frontend somewhere else (a separate static server, a different
port, etc.), that still works — copy `public/basedchat.html` anywhere, and either set
`CLIENT_ORIGIN` in `.env` to that origin, or override the API target on the page with
`<script>window.BASEDCHAT_API_BASE = 'http://localhost:4000'</script>` before the app's
own script tag.

## Database schema

See `migrations/001_init.sql`. Tables: `users`, `videos`, `likes`, `comments`, `reposts`,
`xp_events` (audit log of every XP award), `conversations`, `conversation_participants`,
`messages`. User-facing IDs (`#10001` style) come from a sequence starting at 10001, separate
from the internal primary key.

## XP & levels

Defined in `src/utils/xp.js`, matching the frontend's level card:

| Level | Label | XP |
|---|---|---|
| 1 | rook | 0 |
| 2 | uploader | 250 |
| 3 | regular | 500 |
| 4 | cool mf | 1000 |
| 5 | rising star | 2000 |
| 6 | verified | 4000 |
| 7 | swag | 8000 |
| 8 | elite | 16000 |
| 9 | based | 32000 |
| 10 | based god | 64000 |

XP is awarded to a **video's author** (not the person taking the action) when someone likes
(+50), comments (+150), or reposts (+450) their video. Every award is logged in `xp_events`.
Un-liking/un-reposting does not claw back XP already earned — adjust `toggleLike`/`toggleRepost`
in `videosController.js` if you want different behavior.

## REST API

All authenticated routes expect `Authorization: Bearer <token>`.

**Auth**
- `POST /api/auth/register` `{ handle, email, password }` → `{ token, user }`
- `POST /api/auth/login` `{ email, password }` → `{ token, user }`
- `GET /api/auth/me` (auth) → `{ user }`

**Users**
- `GET /api/users?q=term` → search by handle or public ID
- `GET /api/users/:handleOrId` → profile (accepts `@handle` value without the `@`, or the numeric ID)
- `GET /api/users/leaderboard?sort=xp|posts` → top 50

**Videos**
- `GET /api/videos?cursor=&limit=` → paginated feed, newest first
- `GET /api/videos/:id` → single video
- `POST /api/videos` (auth, multipart: `video` file + `caption`, `trackLabel`, `durationSeconds`)
- `POST /api/videos/:id/like` (auth) → toggles, awards XP to author on like
- `POST /api/videos/:id/repost` (auth) → toggles, awards XP to author on repost
- `GET /api/videos/:id/comments`
- `POST /api/videos/:id/comments` (auth) `{ body }` → awards XP to author

**Conversations (DMs & groupchats)**
- `GET /api/conversations` (auth) → mine, most recent first
- `POST /api/conversations` (auth) `{ handles: ["alice"], isGroup?, name? }` → creates or reuses a DM
- `GET /api/conversations/:id/messages?before=&limit=` (auth)
- `POST /api/conversations/:id/messages` (auth) `{ body }` → also broadcasts over the socket
- `POST /api/conversations/:id/background` (auth, multipart `image`) → groupchat wallpaper

## WebSocket (Socket.io)

Connect with the JWT from login/register:

```js
import { io } from 'socket.io-client';
const socket = io('http://localhost:4000', { auth: { token: jwtToken } });

socket.on('message:new', (msg) => { /* append to thread */ });
socket.on('typing', ({ conversationId, user }) => { /* show typing indicator */ });

socket.emit('typing', { conversationId });
socket.emit('message:send', { conversationId, body: 'yo' }, (ack) => {
  if (!ack.ok) console.error(ack.error);
});
```

On connect, a socket auto-joins the rooms for every conversation the user is already in.
After creating a brand-new conversation via REST, join it live with:
`socket.emit('conversation:join', { conversationId })`.

## Frontend

`public/basedchat.html` is already fully wired to this API — auth, feed, likes/comments/
reposts, leaderboard, profile lookup, DMs/groupchats, and file uploads all call the
endpoints above. It stores its JWT in `localStorage` and opens a Socket.io connection
after login. There's nothing left to connect; just run the server and open it.

## Deploying to a real server

The app is a single Node process (Express + Socket.io) plus a Postgres database. Two paths,
pick whichever fits:

### Option A — managed platform (fastest, no server admin)

Works well on Railway, Render, or Fly.io — steps are nearly identical on all three.

1. Push this project to a GitHub repo.
2. Create a new app on the platform, pointing at that repo.
3. Add a Postgres database from the platform's marketplace/add-ons — it gives you a
   `DATABASE_URL` automatically.
4. Set environment variables on the platform (mirror `.env.example`):
   `DATABASE_URL` (from step 3), `JWT_SECRET` (generate one — see below), `NODE_ENV=production`.
   Leave `CLIENT_ORIGIN` unset unless you're hosting the frontend separately.
5. Set the build command to `npm install` and the start command to `npm start`.
6. After the first deploy, run the migration once — most platforms give you a one-off
   shell/console against the deployed app:
   ```bash
   npm run migrate
   ```
7. Open the URL the platform gives you (e.g. `https://your-app.up.railway.app`) — that's
   your live app, frontend and API both served from it.

**Important caveat:** these platforms typically use an *ephemeral filesystem* — uploaded
videos saved to local disk can disappear on redeploy/restart. Fine for early testing;
before real users upload real videos, switch `src/middleware/upload.js`'s storage engine
to S3-compatible storage (the platform's docs will have an object-storage add-on, or use
AWS S3 / Cloudflare R2 directly — only that one file needs to change).

### Option B — your own VPS (Ubuntu 22.04/24.04, e.g. DigitalOcean/EC2/Linode)

```bash
# 1. On the server: install Node, Postgres, and nginx
sudo apt update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs postgresql nginx
sudo npm install -g pm2

# 2. Create the database
sudo -u postgres createuser --pwprompt basedchat   # set a password when prompted
sudo -u postgres createdb -O basedchat basedchat

# 3. Get the code onto the server and install
git clone <your-repo-url> basedchat && cd basedchat-backend   # or scp/unzip this folder
npm install --omit=dev

# 4. Configure
cp .env.example .env
nano .env
#   DATABASE_URL=postgres://basedchat:<password>@localhost:5432/basedchat
#   JWT_SECRET=<paste a long random string>
#   NODE_ENV=production
#   PORT=4000
# Generate a strong JWT_SECRET with:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 5. Run migrations
npm run migrate

# 6. Start it under pm2 so it survives reboots and crashes
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # follow the one printed command to enable pm2 on boot

# 7. Put nginx in front of it (reverse proxy + lets you add HTTPS)
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/basedchat
sudo nano /etc/nginx/sites-available/basedchat   # set server_name to your domain
sudo ln -s /etc/nginx/sites-available/basedchat /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 8. Point your domain's DNS A record at the server's IP, then add HTTPS:
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

Your app is now live at `https://your-domain.com` — same "one server, one URL" model as
local dev, just reachable from anywhere. To deploy an update later:

```bash
git pull            # or re-upload changed files
npm install --omit=dev
npm run migrate     # only if you added new migration files
pm2 restart basedchat-backend
```

Useful pm2 commands: `pm2 logs basedchat-backend` (tail logs), `pm2 status`, `pm2 restart basedchat-backend`.

### Either way, before real users touch it
- `JWT_SECRET` must be a long random value you generated (never the placeholder).
- Set `NODE_ENV=production`.
- Set `CLIENT_ORIGIN` to your real domain instead of leaving CORS wide open, *unless* you're
  serving the frontend from this same backend (then it's same-origin and doesn't matter).
- Move file storage off local disk if you're on a platform with an ephemeral filesystem, or
  if you'll ever run more than one server instance (local disk isn't shared between them).
- The rate limits in `src/index.js` (`authLimiter`, `writeLimiter`) are conservative
  defaults — tune the numbers for your expected traffic.


