# Working on Gibstaapp together

There are two of us, each using our own Claude Code. GitHub keeps our changes from stepping on each other.

## Getting access (one time)

1. Andy (the repo owner) opens the repo on GitHub → **Settings → Collaborators → Add people** and enters the friend's GitHub username.
2. The friend accepts the invite from the email, or from the notification on github.com.
3. The friend clones it and sets it up:
   ```bash
   git clone https://github.com/<owner>/gibstaapp.git
   cd gibstaapp
   npm install
   npx playwright install chromium
   ```
4. Create your own `server/data/config.json` (see the README). For development, `"tunnel": false` and `"sources": { "sample": true }` are fast and don't scrape anything.

## Every time you work

```bash
git checkout main
git pull                          # get the latest first
git checkout -b feature/short-name
# ...make changes, run `npm test`...
git add -A
git commit -m "Beer: show happy hour end time"
git push -u origin feature/short-name
```

Then on GitHub, click **Compare & pull request**. The other person looks it over and clicks **Merge**. Delete the branch after merging.

Tip: you can just tell Claude Code "make a branch, commit this, push it, and open a PR."

## If GitHub says there's a conflict

Two people changed the same lines.

```bash
git checkout feature/short-name
git pull origin main              # bring in the latest main
# Open the files it lists, keep the right parts between <<<<<<< and >>>>>>>, delete the markers
git add -A && git commit
git push
```

Claude Code is good at this: ask it to "resolve the merge conflicts with main."

## Rules

- **Never commit `server/data/`.** It holds the passcode, the database and the APK, and it's already gitignored. Don't commit API keys or passwords either.
- **Each of us runs our own local server for development.** Each has their own database, so test data doesn't mix.
- **Only Andy's PC serves the shared public link** for now, until we move hosting to the cloud.
- **No made-up data.** Beer prices must come from a real source and say where they came from. Deals we confirm in person go in `server/beer-seed.json` with `"source": "team"`.
- Run `npm test` before you push.

## Updating the live app on Andy's PC (after merging)

```powershell
cd C:\Gibstaapp
git checkout main
git pull
npm install
npm run build
# restart the server: stop the running node process, then
powershell -ExecutionPolicy Bypass -File scripts/start-server.ps1
```

If the tunnel restarts, the public link changes. The new one shows in Settings → Share with friends.
