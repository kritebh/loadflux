---
sidebar_position: 3
---

# Authentication

LoadFlux protects the dashboard with username/password authentication.

![Login Page](/img/screenshots/login.png)

## Setting up auth

Pass credentials in the configuration:

```typescript
app.use(loadflux({
  auth: {
    username: "admin",
    password: "your-secure-password",
  },
}));
```

Or use environment variables:

```typescript
app.use(loadflux({
  auth: {
    username: process.env.LOADFLUX_USERNAME || "admin",
    password: process.env.LOADFLUX_PASSWORD || "password",
  },
}));
```

## How it works

1. **Password hashing** — Passwords are hashed with bcrypt (10 rounds) and stored in the database. The plain-text password is never stored.
2. **Session tokens** — On login, an HMAC-SHA256 token is generated and set as an HttpOnly cookie. Tokens are also accepted via the `Authorization: Bearer <token>` header.
3. **Token expiry** — Tokens expire after 24 hours. Users must re-login after expiry.
4. **HMAC secret** — A random secret is generated on first startup and persisted in the database. This means tokens survive server restarts.

## Password sync on restart

If you change the password in your configuration (e.g., update the `.env` file) and restart the server, LoadFlux automatically detects the mismatch and updates the stored hash. This prevents lockouts when rotating credentials.

The sync happens at startup:
- If the configured password matches the stored hash: no action
- If the configured password differs from the stored hash: the hash is updated
- If no user exists: a new user is created

## Without auth config

If you don't provide `auth` in the configuration, the dashboard shows a setup screen on first visit, prompting you to create an admin account. The credentials you enter are stored in the database.

## API authentication

All LoadFlux API endpoints (except `/api/login` and `/api/logout`) require authentication. The token is validated on every request:

- **Cookie**: `__loadflux_token` (HttpOnly, SameSite=Strict)
- **Header**: `Authorization: Bearer <token>`

Unauthenticated requests receive a `401 Unauthorized` response.
