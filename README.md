# Private Browser — Scramjet

PIN-gated Scramjet client and Wisp WebSocket service based on the official MercuryWorkshop Scramjet App and wisp-js projects.

## Render deployment

Create a Node web service from this repository:
- Build command: `npm install`
- Start command: `npm start`
- Region: Ohio (or nearest available)
- Plan: start with Free for testing

Set these environment variables in Render:
- `ACCESS_PIN`: family access code
- `SESSION_SECRET`: random secret of at least 32 characters

The service provides an HTTPS Scramjet frontend and an authenticated Wisp endpoint at `/wisp/`. The access PIN is never embedded in the client code. Successful unlocks receive a signed four-hour session token; five incorrect attempts per IP trigger a temporary cooldown.

Wisp blocks private and loopback IP ranges and direct-IP destinations. It still requires trusted use: do not share the service URL or session tokens publicly, rotate the access PIN if it is disclosed, and monitor bandwidth usage. Game streaming availability depends on the target service, network, and hosting provider.

## Health check

`GET /api/health` returns service status.

## Upstream projects
- https://github.com/MercuryWorkshop/Scramjet
- https://github.com/MercuryWorkshop/Scramjet-App
- https://github.com/MercuryWorkshop/wisp-js
