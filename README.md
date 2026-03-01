# Pomodoro Timer

Minimal web app for the [Pomodoro Technique](https://en.wikipedia.org/wiki/Pomodoro_Technique).

## Features

- **Work and break mode** – Separate timers for each phase
— **Controls** – Start/pause, restart, and skip to the next phase
- **Presets** – Choose a standard 30-minute or 1-hour sprint
- **Customizable durations** — Edit times directly (supports `M:SS`, `5m`, `30s`, `4m30s`, etc.)
- **Progress indicator** – Visual bar showing elapsed time and graphic pulse as timer approaches zero
- **End of phase chimes** – Plays when work or break finishes; mute toggle in the corner
- **Today log** – Editable list of completed pomodoros (and partial/skipped work) with durations and timestamps
- **Persistence** – Timer state, presets, and today log survive reloads (localStorage)

## Tech stack

- Vanilla HTML, CSS, and JavaScript
- [Vite](https://vitejs.dev/) for dev server and build
- No database or backend

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) (or npm/yarn)

## Getting started

```bash
# Install dependencies
pnpm install

# Start dev server (default: http://localhost:5173)
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview
```

## License

Private project for <a href="https://www.buttonschool.com">Making Your Own Apps</a>.
