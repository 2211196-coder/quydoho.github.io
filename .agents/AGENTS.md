# Project Rules

## Auto-deploy to Vercel
After making code changes to the project files, automatically stage, commit, and push to GitHub so Vercel deploys the latest version. Steps:
1. `git add <changed files>`
2. `git commit -m "<descriptive commit message>"`
3. `git push origin main`

Do this proactively without asking. Use separate commands (not chained with `&&`) since the shell is PowerShell.
