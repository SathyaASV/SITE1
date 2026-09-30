# Deploy (works with your laptop OFF)

1. **Phone**: install the free **ntfy** app, subscribe to a long random topic, e.g. `tharika-9f3k2x-private`.
2. **Push this folder to GitHub** (`.env` and `data/` are git-ignored).
3. **Pick one host** (SQLite needs a persistent disk, so serverless like Vercel won't work):
   - **Render**: New > Blueprint > pick the repo (uses `render.yaml`; the disk needs the paid Starter plan, about $7/mo).
   - **Fly.io**: `fly launch --no-deploy`, then `fly volumes create data --size 1`, then `fly secrets set ADMIN_PASSWORD=... NOTIFY_URL=https://ntfy.sh/<topic>`, then `fly deploy`.
4. **Env vars** on the host: `ADMIN_PASSWORD` (12+ chars), `NOTIFY_URL=https://ntfy.sh/<your-topic>`, and `PUBLIC_URL` if it isn't auto-detected.
5. **Test**: open `https://<your-site>/admin`, log in, press **Send test notification**. Your phone should buzz. Tap it.

When she submits, you get a push with no answers in it. Tapping opens `/report/<id>?k=<signed token>`, a private read-only page for that one submission. `/admin` (password) lists everything. Failed sends are retried automatically.
