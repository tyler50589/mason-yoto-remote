# Mason's Yoto Remote

A simple phone-friendly remote for a Yoto Player.

## Included

- Yoto login using OAuth PKCE
- Automatic Player discovery
- Multiple-Player selection
- Play and pause
- Rewind 15 seconds
- Fast-forward 15 seconds
- Volume slider and volume buttons
- Live title, chapter, position, volume, battery, and connection updates

## Deploy to Vercel without writing code

### 1. Unzip this project

Unzip `mason-yoto-remote.zip` on a computer.

### 2. Put it in GitHub

1. Create a free GitHub account if you do not already have one.
2. Create a new repository named `mason-yoto-remote`.
3. Choose **uploading an existing file**.
4. Upload all files and folders from inside this project folder.
5. Commit the files.

Do not upload the ZIP file by itself. Upload the files inside it.

### 3. Import it into Vercel

1. Sign into Vercel using GitHub.
2. Click **Add New > Project**.
3. Import `mason-yoto-remote`.
4. Vercel should detect **Vite** automatically.
5. Click **Deploy**.

The Client ID Tyler supplied is already included as a fallback. You may also add this Vercel environment variable:

- Name: `VITE_YOTO_CLIENT_ID`
- Value: `JIeC71AIb1RrHPFr5g8iEWtQJJpbLqbe`

This is a public OAuth Client ID, not a client secret.

### 4. Copy the permanent Vercel URL

After deployment, Vercel gives you a URL such as:

`https://mason-yoto-remote.vercel.app`

Use the permanent production domain shown under **Project > Settings > Domains**, not a temporary preview URL.

### 5. Add the callback URL to Yoto

Open your app in the Yoto Developer dashboard and add:

`https://YOUR-EXACT-VERCEL-DOMAIN.vercel.app/callback`

Example:

`https://mason-yoto-remote.vercel.app/callback`

The callback must match exactly, including `https://` and `/callback`.

Confirm that the Yoto app is a **public/browser client** and has these scopes:

- `family:devices:view`
- `family:devices:control`
- `offline_access`

### 6. Open and connect

1. Open the main Vercel URL on your iPhone.
2. Tap **Connect to Yoto**.
3. Sign in on Yoto's secure page.
4. Approve access.
5. Yoto sends you back to the remote.

## Add it to the iPhone Home Screen

In Safari:

1. Tap Share.
2. Tap **Add to Home Screen**.
3. Name it `Yoto Remote`.
4. Tap Add.

## Important note about 15-second seeking

Yoto officially documents pause, resume, volume, current position, and starting a track at a specified number of seconds. Yoto does not currently document a dedicated seek command. This app implements 15-second seeking by restarting the current card, chapter, and track at the adjusted position.

Pause and volume should work independently even if Yoto changes the card URI behavior used for seeking.

## Troubleshooting

### “Callback URL mismatch”

The callback entered in Yoto does not exactly match:

`https://your-domain.vercel.app/callback`

### Player says disconnected

- Confirm the Yoto is online.
- Refresh the page.
- Tap the round refresh button.
- Confirm the app has `family:devices:control`.

### Login loops or fails

Tap **Disconnect**, reconnect, and approve all requested permissions.

### Rewind or fast-forward says playback information is missing

Start a card on the Yoto, wait several seconds, then tap the refresh button and try again.
