# Movie Watch Party

Private watch party for up to 4 people. The host signs in with Google, creates a party and shares the invite link
(WhatsApp, Telegram, Instagram or any app). Friends open the link, type a name and join with no account.
Everyone in the room can upload the movie. Playback, chat and voice stay in sync.

## 1. Google sign-in (host only, about 3 minutes)
1. Open https://console.cloud.google.com/apis/credentials and create a project.
2. Configure the OAuth consent screen (External). While the app is in Testing, add every Gmail you want to use as a test user. Or click Publish app: basic Google sign-in needs no review.
3. Create Credentials > OAuth client ID > Web application.
4. Under Authorized JavaScript origins add your site URL (https://your-site.com) and http://localhost:3000 for testing.
5. Copy the Client ID.

## 2. Run locally
    cp .env.example .env     # fill in GOOGLE_CLIENT_ID, JWT_SECRET, OWNER_EMAILS; set NODE_ENV=development locally
    npm install
    npm start
Open http://localhost:3000. Requires Node 20.6 or newer.

## 3. Deploy (needs a host that runs Node and keeps a persistent disk)
- **Render / Railway / Fly.io:** create a Web Service from this folder (or a GitHub repo). Build: `npm install`.
  Start: `npm run start:prod`. Add the environment variables from `.env.example` in the dashboard.
  Attach a disk mounted at `/opt/render/project/src/uploads` (path differs per host) so uploaded movies survive restarts.
- **Your own VPS:** install Node 20+, run `npm install`, run with pm2 (`pm2 start server.js`), and put Caddy or Nginx in
  front for HTTPS. Voice (microphone) only works over HTTPS.
- After deploying, add the live URL to Authorized JavaScript origins in Google Cloud.

## Notes
- Limit of 4 people is MAX_MEMBERS. Upload size limit is MAX_UPLOAD_MB (default 2048). Hosts and reverse proxies may set their own, lower limits.
- Parties are kept in memory. A restart ends all parties. Empty rooms and their movie files are deleted after 10 minutes.
- Voice uses a public STUN server. A few strict networks need a TURN server too (add one in public/index.html, `iceServers`).
- Only upload movies you have the right to share.
