# Ashmarch — Tithe of Iron
11
Dark medieval inventory MMO: grid loot, mortal wayfarers, a city vault that outlives the body, a shared crier's board, companies, and realtime speech.

This is an original setting. Nothing here is copied from existing games.

## The law of the road

- Ten rounds to a region, a boss on the tenth, then a **city**.
- The **vault** (storage) opens **only in the city**. The pack dies with you. Crowns, vault, auction nails, and banners do not.
- Gear has a **required level**. A new Level 1 soul may hold a king's axe in the chest and still be too weak to lift it.
- Combat is server-side. Loot instances are unique. Chat item seals use `ITEM_LINK:<item_instance_id>` — stats cannot be forged in text.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43217](http://127.0.0.1:43217).

SQLite lives in `data/ashmarch.sqlite` (created on first boot, seeded automatically).

### Demo ledgers

| Role | Email | Password |
| --- | --- | --- |
| Wayfarer | wayfarer@ashmarch.local | Wayfarer#1 |
| Seneschal (admin) | seneschal@ashmarch.local | Ashmarch#Seneschal |

The seneschal starts with region 30 charted and enough crowns to found a company (founding otherwise requires highest region ≥ 30 and 500 000 crowns — see `server/config.ts`).

Password reset tokens are printed in the server log (no mailer in this slice).

## Stack

- Express + WebSocket game server (authoritative combat, economy, auction locks)
- SQLite (`better-sqlite3`)
- Vite + React client, original Dark Medieval Fantasy UI (wood, iron, parchment)

Balance knobs: `server/config.ts`.
