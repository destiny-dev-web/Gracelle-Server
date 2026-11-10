# GRACELLE: server files (back end)

One small Node.js server that runs both the storefront and the staff portal. **It has no npm packages**, so there is nothing to `npm install`.

## Run it

1. Install Node.js 18 or newer (nodejs.org).
2. Copy `.env.example` to `.env` and fill it in (see "Settings").
3. In this folder run: `node server.js`  (or `npm start`)
4. First run creates the HR manager from `SEED_HR_EMAIL` / `SEED_HR_CODE`. Log in to the portal with those, then use **Staff & Access → Change code** to set a private key.
5. Check it works: open `http://localhost:3000/api/health`
6. Optional self-test of every rule (permissions, orders, stock, vouchers): `node test.js`

Data is stored in `data/db.json` and uploads in `data/uploads/`. **Back up the `data` folder regularly.**

## Settings (`.env`)

| Setting | Meaning |
|---|---|
| `JWT_SECRET` | Long random string that signs logins. Required for live use. |
| `CORS_ORIGIN` | Your website address(es). Only these may call the server. |
| `SEED_HR_EMAIL`, `SEED_HR_CODE` | First HR manager (first run only) |
| `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM` | Turns on automatic emails (see below) |
| `VOUCHER_THRESHOLD`, `VOUCHER_AMOUNT` | Spend X, earn a voucher of Y |
| `STAFF_IDLE_MINUTES` | Auto logout (default 10) |
| `DATA_DIR`, `STATIC_DIR`, `PORT` | Optional |

## Automatic emails

Create a free account at resend.com, verify your domain, create an API key, then set `MAIL_PROVIDER=resend`, `RESEND_API_KEY=...` and `MAIL_FROM`. After that:
- **HR → GRANT ACCESS** emails the staff member the GRACELLE "STAFF PORTAL ACCESS GRANTED" message (with code and ID) automatically. The **Send** button re-sends it.
- **Forgot password** on the storefront emails customers a 6-digit code.
Until email is set up, the server prints the email text in its console and the portal offers an "Open in my email app" button as a fallback.
To use another provider (Brevo, SendGrid, SMTP), replace the `mail()` function in `server.js`; nothing else changes.

Why the server sends the email: a website page cannot hold a secret email key safely, so sending must happen here.

## Deploy

Any host that runs Node works: a VPS, Render, Railway, Fly.io, cPanel "Node app". Use HTTPS (the host usually provides it). Keep the `data` folder on a persistent disk. Point `config.js` in the site files at this server's address.

## API (for developers)

Public: `GET /api/public/storefront`, `POST /api/auth/signup|login|forgot|reset`, `GET /api/auth/me`, `POST /api/upload/receipt`, `POST /api/orders`, `GET /api/orders/mine`, `POST /api/reviews`, `POST /api/chat`, `GET /api/inbox`.
Staff (Bearer token, refreshed on every call, expires after idle): `POST /api/staff/login`, `GET /api/staff/sync`, `POST|PATCH|DELETE /api/rec/:tool[/:id]`, `POST /api/stock/:id/move`, `POST /api/upload`, HR: `POST /api/hr/users`, `PATCH|DELETE /api/hr/users/:id`, `POST /api/hr/users/:id/send`; workspace: `/api/msgs`, `/api/projects`, `/api/tasks`, `/api/announcements`, `/api/attendance/sign`, `PUT /api/staff/profile`.
`schema.js` lists every department tool, its fields, who may add records (`w`) and who may approve (`ap`), and each department's menu. Edit it to change what a department can do.

## Security built in

- Access codes and customer passwords are stored only as scrypt hashes (never readable, even by HR; "Change code" sets a new one).
- Logins are rate limited. Tokens are signed and staff tokens expire after 10 idle minutes.
- Permissions are enforced on the server, not just hidden in the page. Prices are recomputed on the server at checkout (customers cannot change them); stock is checked and deducted there too.
- Uploads are limited to images, PDF and mp4/webm and stored under random names.

## Honest limits (plan these as the shop grows)

- Storage is a JSON file: fine for a young shop, but move to a database (PostgreSQL) when traffic grows. Everything goes through a few helper functions in `server.js`.
- Phone push reminders and Apple sign-in are not included (reminders work while the portal is open).
- Receipt amounts are checked by Finance by eye (receipt photo shown beside the order total), not by OCR.
- The CEO/GM cannot yet be created from the first-run seed; create them from HR → Staff & Access with department "Executive (CEO / GM)".
