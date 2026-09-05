# GitHub ZIP Pusher

A small Express app that uploads a ZIP and pushes its files to an existing GitHub repository.

## Requirements

- Node.js 18+
- A GitHub token stored server-side in `.env`
- The token needs permission to write to the target repository.

## Setup

```bash
npm install
```

Copy `.env.example` to `.env` and set:

```env
GITHUB_TOKEN=your_token
GITHUB_OWNER=your_username
PORT=3000
```

Then:

```bash
npm start
```

Open `http://localhost:3000`.

## Important

Never commit `.env` or expose your GitHub token in frontend JavaScript.
Add `.env` to `.gitignore`.

The app targets an existing repository and updates the selected branch. It does not create a new repository.
