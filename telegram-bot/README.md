# Telegram Bot

## Overview

The Telegram bot is part of the **Smart Fire Detection and Automatic Suppression System for Electrical Distribution Boards**.

It provides remote access to the latest system condition and sends automatic alerts when important fire-risk or actuator conditions occur.

According to the final project report, the Telegram bot was implemented using:

- **Node.js**
- **TypeScript**
- **Supabase / PostgreSQL backend data**

## Main Functions

The bot is designed to:

- Display the latest temperature readings.
- Display the smoke sensor value.
- Display the flame sensor state.
- Display the current sensor reading.
- Display the cooling-fan state/speed.
- Display the buzzer state.
- Display the fire-suppression state.
- Display the overall system status.
- Provide actuator/system status information on demand.
- Send automatic Telegram alerts when an important abnormal condition occurs.

## System Communication

The final communication architecture is:

```text
Sensors
   ↓
NI DAQ
   ↓
LabVIEW
   ↓
HTTP PUT / JSON
   ↓
Supabase / PostgreSQL
   ↓
Telegram Bot
   ↓
User
```

LabVIEW sends the latest sensor and actuator information to the cloud backend.

The Telegram bot then reads the latest values from the backend whenever the user requests the system status. It can also push an alert automatically when an important event occurs.

## Example Data Used by the System

```json
{
  "temperatureInside": 26,
  "temperatureOutside": 24,
  "smoke": 110,
  "flame": 0,
  "current": 1.0,
  "fanSpeed": 40,
  "buzzer": false,
  "fireSuppression": false
}
```

## Recommended Source-Code Structure

When adding the actual Telegram bot source code, use a structure similar to:

```text
telegram-bot/
│
├── src/
│   ├── bot.ts
│   ├── commands/
│   ├── services/
│   └── utils/
│
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

The exact file names can be changed to match the real source code.

## Environment Variables

Do not upload private credentials to GitHub.

Typical variables may include:

```env
TELEGRAM_BOT_TOKEN=
SUPABASE_URL=
SUPABASE_ANON_KEY=
```

Only add variables actually used by the real implementation.

## Running the Bot

After copying the actual source code and `package.json` into this folder, the typical workflow for a Node.js + TypeScript project is:

```bash
npm install
npm run dev
```

or:

```bash
npm start
```

Use the command defined in the actual `package.json`.

## Telegram Bot Link

Add the real bot link here:

```text
https://t.me/YOUR_BOT_USERNAME
```

The uploaded project report documents the Telegram bot functionality, but the bot username/link is not included in the report text, so it should be added manually once confirmed.

## Security

Never commit:

- Telegram bot token
- Supabase private/service key
- Passwords
- Private API credentials
- Production `.env` files

Keep secrets in environment variables.
