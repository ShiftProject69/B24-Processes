# B24-Processes

Server process for Bitrix24 business-process maintenance.

## Setup

Create `.env` from `.env.example`. The project loads it with `dotenv`.

```env
BITRIX_PORTAL_URL=https://glas.bitrix24.eu
BITRIX_USER_ID=1
BITRIX_TOKEN=your_webhook_token
PORT=3000
```

## Commands

Start the server and register the scheduled job:

```bash
npm start
```

Health check:

```bash
GET /health
```

## Scheduled job

Stuck Bitrix24 business-process workflows are restarted daily at 04:00 in the `Europe/Warsaw` timezone.

Workflow is treated as stuck when `OWNED_UNTIL` is older than current time by more than `BITRIX_STUCK_MINUTES` minutes. Default is `5`.
