# SmartCook (随煮)

> An AI-powered cooking assistant that turns your fridge inventory into a complete meal plan — and walks you through prep and cooking, step by step.

SmartCook is a React Native (Expo) mobile app that takes the ingredients and seasonings you already have at home, asks a few questions (number of people, meal type, calorie preference), and generates a full, ready-to-follow recipe: dishes, nutrition estimates, a shopping list for missing items, prep steps, and cooking steps. A built-in recipe chat assistant can even answer questions and modify the recipe on the fly.

**Privacy-first architecture:** the app has no backend. All data lives on-device, and the AI is called directly from the app using the user's own API key (DeepSeek or any OpenAI-compatible endpoint). No account, no server, no tracking.

## Features

- **AI menu generation** — streamed (SSE) recipe generation based on real inventory, with "chain-of-thought" reasoning display, retry with exponential backoff, and timeout handling.
- **Inventory management** — track ingredient weights and seasoning status (sufficient / low / out), with import/export (JSON) and a date-picker for storage dates.
- **Three-stage cooking flow** — Menu → Prep → Cooking, swipeable in a pager, with progress persistence and resume.
- **Recipe chat assistant** — ask questions about the recipe, or grant permission for the AI to modify ingredients and steps via a function-calling tool (with confirm/cancel).
- **Shopping list** — auto-detects missing ingredients/seasonings and persists checked state.
- **Nutrition tracking** — per-dish and per-meal estimates (calories / protein / fat / carbs), draggable floating ball.
- **Dietary memory** — remembers recently cooked dishes to avoid repetition.
- **Custom alerts & UI** — themed component library, custom dialogs, side drawer settings.

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | React Native (Expo SDK 54) |
| Language | TypeScript |
| Routing | Expo Router (file-based) |
| Animation | react-native-reanimated 4 |
| Storage | AsyncStorage / SecureStore |
| AI | DeepSeek / OpenAI-compatible API (streamed via SSE) |
| Validation | Zod |

## Architecture

The app follows a clean layered architecture: **routing (app/)** → **components (src/components)** → **state (src/contexts)** → **services (src/services)** → **utils (src/utils)**, with shared types and constants. State is managed with React Context + `useReducer`.

For a detailed breakdown of the data flow and state management, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Getting Started

### Prerequisites

- Node.js 18+
- Expo Go app (for development on a physical device), or an Android/iOS emulator

### Install & run

```bash
npm install
npx expo start
```

Then scan the QR code with Expo Go, or press `a` / `i` to open an emulator.

### Configure the AI

Open the app → Settings → enter your API key and endpoint.

- Default endpoint: `https://api.deepseek.com`
- Any OpenAI-compatible endpoint is supported (model name is configurable).

> Your API key is stored locally (SecureStore when available) and sent only to the endpoint you configure.

### Build an APK

```bash
npx expo prebuild --platform android   # generate the native android/ project (gitignored)
npx eas build --platform android --profile preview
```

## Project Structure

```
SmartCook_demo/
├── app/                    # Expo Router screens (file-based routing)
│   ├── (tabs)/             # bottom-tab screens: inventory, cooking entry
│   ├── cooking/            # cooking flow: pager, menu/prep/cooking stages, shopping list
│   └── history/            # recipe history list + detail
├── src/
│   ├── components/         # reusable UI components (CookingPager, progress bar, chat sheet, ...)
│   ├── contexts/           # state management (React Context + useReducer)
│   ├── services/           # business logic + AI/storage services
│   ├── constants/          # colors, typography, spacing, stage config
│   ├── types/              # TypeScript types & interfaces
│   └── utils/              # helpers (SSE stream, nutrition calc, validation, ...)
├── docs/                   # design decisions & development records (ADR)
├── app.json                # Expo config
└── package.json
```

## Development Records

See [docs/CHANGELOG.md](docs/CHANGELOG.md) for the update history, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a deep dive into the architecture and data flow.

## About this project

SmartCook began as a personal project. I wanted to learn cooking, and although AI could generate recipes, plain-text output was too awkward to follow in the kitchen — so I built this app to guide me from fridge to table, step by step.

It is developed with AI-assisted coding tools (Trae IDE) and is currently pre-release: expect rough edges and occasional changes. Feedback and contributions are welcome.

## License

[MIT](LICENSE) © citoufav
