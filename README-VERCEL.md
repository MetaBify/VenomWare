# Vercel Key-Gated Script Endpoint

This repo includes:

- `/api/script`: Lua endpoint used by loaders.
- `/api/ip`: shows the detected caller IP.
- `/admin`: browser admin panel.
- `/api/admin`: admin API used by the panel.

## Required Vercel Setup

Create a Vercel Blob store for the project. Vercel creates `BLOB_READ_WRITE_TOKEN` automatically when the store is connected.

Create a Neon Postgres database, then add its connection string to the Vercel project as `DATABASE_URL`.

Set these environment variables:

```text
ADMIN_KEY=your_admin_password
DATABASE_URL=postgresql://...
```

Optional fallback script variables:

```text
SCRIPT_BODY=plain_lua_source
SCRIPT_BODY_BASE64=base64_lua_source
```

The admin panel stores requests, generated keys, approved IPs, revokes, and usage counts in Neon Postgres.

The admin panel stores the real script body in private Vercel Blob storage. Paste the obfuscated Lua there after deployment.
Saving a new script body overwrites `venom-host/script.lua`, so the previous script is replaced.

## Flow

1. User runs the first loader without a key:

```lua
loadstring(game:HttpGet("https://your-domain.vercel.app/api/script"))()
```

2. `/api/script` logs their IP and returns a harmless pending-access Lua response.
3. You open `/admin`, enter `ADMIN_KEY`, and log in.
4. Click `Approve` next to their IP. The panel generates a key tied to that IP.
5. Give them this loader:

```lua
loadstring(game:HttpGet("https://your-domain.vercel.app/api/script?null=GENERATED_KEY"))()
```

The generated key only works from the approved IP.

The landing page also has a small tutorial and a keyed-loader copy box. Paste the generated key there to build the executor loader.

## Notes

- Do not commit private scripts into a public GitHub repo.
- Paste obfuscated code into the admin panel after deploy.
- A key inside a client loader can be copied, but copied keys only work from the approved IP.
- `/api/script` is limited to 50 requests per IP in a rolling 24-hour window.
- Home and mobile IPs can change; if that happens, approve the new IP and revoke the old key.
