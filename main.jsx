import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import pkceChallenge from "pkce-challenge";
import mqtt from "mqtt";
import "./styles.css";

const CLIENT_ID =
  import.meta.env.VITE_YOTO_CLIENT_ID ||
  "JIeC71AIb1RrHPFr5g8iEWtQJJpbLqbe";

const AUTH_URL = "https://login.yotoplay.com/authorize";
const TOKEN_URL = "https://login.yotoplay.com/oauth/token";
const DEVICES_URL = "https://api.yotoplay.com/device-v2/devices/mine";
const MQTT_URL =
  "wss://aqrphjqbp3u2z-ats.iot.eu-west-2.amazonaws.com/mqtt";
const SCOPES = "family:devices:view family:devices:control offline_access";

const storage = {
  getTokens() {
    try {
      return JSON.parse(localStorage.getItem("yoto_tokens") || "null");
    } catch {
      return null;
    }
  },
  setTokens(tokens) {
    localStorage.setItem("yoto_tokens", JSON.stringify(tokens));
  },
  clear() {
    localStorage.removeItem("yoto_tokens");
    sessionStorage.removeItem("pkce_code_verifier");
  },
};

function redirectUri() {
  return `${window.location.origin}/callback`;
}

function tokenExpired(tokens) {
  if (!tokens?.access_token) return true;
  const expiresAt = Number(tokens.expires_at || 0);
  return expiresAt && Date.now() >= expiresAt - 60_000;
}

async function refreshTokens(tokens) {
  if (!tokens?.refresh_token) throw new Error("No refresh token is available.");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: tokens.refresh_token,
    }),
  });

  if (!response.ok) {
    throw new Error(`Yoto login refresh failed (${response.status}).`);
  }

  const next = await response.json();
  const merged = {
    ...tokens,
    ...next,
    refresh_token: next.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + Number(next.expires_in || 7200) * 1000,
  };
  storage.setTokens(merged);
  return merged;
}

async function beginLogin() {
  const { code_verifier, code_challenge } = await pkceChallenge();
  sessionStorage.setItem("pkce_code_verifier", code_verifier);

  const params = new URLSearchParams({
    audience: "https://api.yotoplay.com",
    scope: SCOPES,
    response_type: "code",
    client_id: CLIENT_ID,
    code_challenge,
    code_challenge_method: "S256",
    redirect_uri: redirectUri(),
  });

  window.location.assign(`${AUTH_URL}?${params.toString()}`);
}

async function completeLogin() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return null;

  const verifier = sessionStorage.getItem("pkce_code_verifier");
  if (!verifier) {
    throw new Error("The login verifier was lost. Tap Connect to Yoto and try again.");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code_verifier: verifier,
      code,
      redirect_uri: redirectUri(),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Yoto login failed (${response.status}). ${detail}`);
  }

  const tokens = await response.json();
  tokens.expires_at = Date.now() + Number(tokens.expires_in || 7200) * 1000;
  storage.setTokens(tokens);
  sessionStorage.removeItem("pkce_code_verifier");
  window.history.replaceState({}, "", "/");
  return tokens;
}

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const mins = Math.floor(value / 60);
  const secs = Math.floor(value % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function App() {
  const [tokens, setTokens] = useState(storage.getTokens());
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState("");
  const [connection, setConnection] = useState("disconnected");
  const [event, setEvent] = useState({});
  const [status, setStatus] = useState({});
  const [volume, setVolume] = useState(35);
  const [livePosition, setLivePosition] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);
  const clientRef = useRef(null);
  const volumeTimerRef = useRef(null);
  const volumePendingUntilRef = useRef(0);
  const playbackAnchorRef = useRef({ position: 0, receivedAt: Date.now() });
  const mqttSessionIdRef = useRef(
    sessionStorage.getItem("yoto_mqtt_session") ||
      `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  );

  if (!sessionStorage.getItem("yoto_mqtt_session")) {
    sessionStorage.setItem("yoto_mqtt_session", mqttSessionIdRef.current);
  }

  const selectedDevice = useMemo(
    () => devices.find((device) => device.deviceId === deviceId),
    [devices, deviceId]
  );

  useEffect(() => {
    async function initialize() {
      try {
        const callbackTokens = await completeLogin();
        let current = callbackTokens || storage.getTokens();
        if (current && tokenExpired(current)) current = await refreshTokens(current);
        setTokens(current);
      } catch (error) {
        storage.clear();
        setTokens(null);
        setMessage(error.message);
      } finally {
        setBusy(false);
      }
    }
    initialize();
  }, []);

  useEffect(() => {
    if (!tokens?.access_token) return;

    async function loadDevices() {
      try {
        const response = await fetch(DEVICES_URL, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });

        if (response.status === 401 && tokens.refresh_token) {
          const next = await refreshTokens(tokens);
          setTokens(next);
          return;
        }

        if (!response.ok) {
          throw new Error(`Could not load Yoto Players (${response.status}).`);
        }

        const data = await response.json();
        const list = data.devices || [];
        setDevices(list);
        const saved = localStorage.getItem("selected_yoto_device");
        setDeviceId(
          list.find((device) => device.deviceId === saved)?.deviceId ||
            list[0]?.deviceId ||
            ""
        );
      } catch (error) {
        setMessage(error.message);
      }
    }

    loadDevices();
  }, [tokens?.access_token]);

  useEffect(() => {
    if (!tokens?.access_token || !deviceId) return;

    localStorage.setItem("selected_yoto_device", deviceId);
    clientRef.current?.end(true);
    setConnection("connecting");
    setEvent({});
    setStatus({});
    setLivePosition(0);
    playbackAnchorRef.current = { position: 0, receivedAt: Date.now() };

    const client = mqtt.connect(MQTT_URL, {
      keepalive: 300,
      port: 443,
      protocol: "wss",
      username: `${deviceId}?x-amz-customauthorizer-name=PublicJWTAuthorizer`,
      password: tokens.access_token,
      reconnectPeriod: 1000,
      clientId: `DASH${deviceId}-${mqttSessionIdRef.current}`,
      ALPNProtocols: ["x-amzn-mqtt-ca"],
      queueQoSZero: true,
      clean: true,
    });

    clientRef.current = client;
    const base = `device/${deviceId}`;
    const topics = [
      `${base}/data/events`,
      `${base}/data/status`,
      `${base}/response`,
    ];

    client.on("connect", () => {
      setConnection("connected");
      setMessage("");
      client.subscribe(topics, (error) => {
        if (error) {
          setMessage(`Could not subscribe to the Player: ${error.message}`);
          return;
        }
        client.publish(`${base}/command/events/request`, "{}", { qos: 1 });
        client.publish(`${base}/command/status/request`, "", { qos: 1 });
      });
    });

    client.on("reconnect", () => setConnection("connecting"));
    client.on("offline", () => setConnection("offline"));
    client.on("error", (error) =>
      setMessage(`Player connection error: ${error.message}`)
    );

    client.on("message", (topic, payload) => {
      try {
        const data = JSON.parse(payload.toString());
        if (topic.endsWith("/data/events")) {
          setEvent((previous) => ({ ...previous, ...data }));
          if (Number.isFinite(Number(data.position))) {
            const reportedPosition = Number(data.position);
            playbackAnchorRef.current = {
              position: reportedPosition,
              receivedAt: Date.now(),
            };
            setLivePosition(reportedPosition);
          }
        } else if (topic.endsWith("/data/status")) {
          const playerStatus = data.status || {};
          setStatus((previous) => ({ ...previous, ...playerStatus }));
          const reportedVolume = Number(
            playerStatus.userVolume ?? playerStatus.volume
          );
          if (
            Date.now() >= volumePendingUntilRef.current &&
            Number.isFinite(reportedVolume) &&
            reportedVolume >= 0 &&
            reportedVolume <= 100
          ) {
            setVolume(reportedVolume);
          }
        } else if (topic.endsWith("/response")) {
          const volumeResult = data?.status?.volume;
          if (volumeResult === "FAIL") {
            volumePendingUntilRef.current = 0;
            setMessage("The Yoto Player rejected the volume command.");
          }
        }
      } catch {
        // Ignore acknowledgements that are not useful JSON for this interface.
      }
    });

    const refresh = window.setInterval(() => {
      if (client.connected) {
        client.publish(`${base}/command/events/request`, "{}", { qos: 1 });
      }
    }, 295_000);

    return () => {
      window.clearInterval(refresh);
      client.end(true);
    };
  }, [tokens?.access_token, deviceId]);

  useEffect(() => {
    const paused =
      event.playbackStatus === "paused" ||
      String(status.playingStatus || "").toLowerCase().includes("pause");

    if (paused || !event.cardId) {
      playbackAnchorRef.current = {
        position: livePosition,
        receivedAt: Date.now(),
      };
      return;
    }

    const timer = window.setInterval(() => {
      const anchor = playbackAnchorRef.current;
      const elapsed = (Date.now() - anchor.receivedAt) / 1000;
      const trackLength = Number(event.trackLength || 0);
      const calculated = anchor.position + elapsed;
      setLivePosition(
        trackLength > 0 ? Math.min(calculated, trackLength) : calculated
      );
    }, 250);

    return () => window.clearInterval(timer);
  }, [
    event.playbackStatus,
    event.cardId,
    event.trackLength,
    status.playingStatus,
  ]);

  function publish(command, payload = {}) {
    const client = clientRef.current;
    if (!client?.connected || !deviceId) {
      setMessage("The Yoto Player is not connected yet.");
      return false;
    }
    client.publish(
      `device/${deviceId}/command/${command}`,
      JSON.stringify(payload),
      { qos: 1 }
    );
    return true;
  }

  function togglePlayback() {
    const paused =
      event.playbackStatus === "paused" ||
      String(status.playingStatus || "").toLowerCase().includes("pause");
    playbackAnchorRef.current = {
      position: livePosition,
      receivedAt: Date.now(),
    };
    publish(paused ? "card/resume" : "card/pause");
    setEvent((previous) => ({
      ...previous,
      playbackStatus: paused ? "playing" : "paused",
    }));
  }

  function setPlayerVolume(nextValue) {
    const next = Math.max(0, Math.min(100, Math.round(Number(nextValue))));
    setVolume(next);
    setMessage("");
    window.clearTimeout(volumeTimerRef.current);
    volumeTimerRef.current = window.setTimeout(() => {
      volumePendingUntilRef.current = Date.now() + 2500;
      const sent = publish("volume/set", { volume: next });
      if (sent) {
        window.setTimeout(() => publish("status/request"), 700);
      }
    }, 120);
  }

  function seek(delta) {
    const cardId = event.cardId || status.activeCard;
    const chapterKey = event.chapterKey;
    const trackKey = event.trackKey;
    const currentPosition = Number(livePosition);

    if (!cardId || !chapterKey || !trackKey || !Number.isFinite(currentPosition)) {
      setMessage(
        "Yoto has not reported enough playback information yet. Start a card, then tap Refresh and try again."
      );
      publish("events/request");
      return;
    }

    const target = Math.max(
      0,
      Math.min(Number(event.trackLength || Infinity), currentPosition + delta)
    );

    publish("card/start", {
      uri: `yoto:#${cardId}`,
      chapterKey,
      trackKey,
      secondsIn: Math.floor(target),
    });

    playbackAnchorRef.current = {
      position: target,
      receivedAt: Date.now(),
    };
    setEvent((previous) => ({ ...previous, position: target }));
    setLivePosition(target);
  }

  function refreshPlayer() {
    publish("events/request");
    publish("status/request");
  }

  function logout() {
    clientRef.current?.end(true);
    storage.clear();
    setTokens(null);
    setDevices([]);
    setDeviceId("");
    setEvent({});
    setStatus({});
    setLivePosition(0);
    playbackAnchorRef.current = { position: 0, receivedAt: Date.now() };
  }

  if (busy) {
    return (
      <main className="shell">
        <section className="card loading">Opening remote…</section>
      </main>
    );
  }

  if (!tokens?.access_token) {
    return (
      <main className="shell">
        <section className="card welcome">
          <div className="logo">Y</div>
          <p className="eyebrow">MASON'S</p>
          <h1>Yoto Remote</h1>
          <p className="muted">Control playback and volume from your phone.</p>
          {message && <div className="notice error">{message}</div>}
          <button className="primary connect" onClick={beginLogin}>
            Connect to Yoto
          </button>
          <p className="privacy">
            Your password is entered only on Yoto's website. Login tokens stay
            in this browser.
          </p>
        </section>
      </main>
    );
  }

  const isPaused = event.playbackStatus === "paused";
  const online = selectedDevice?.online !== false;
  const position = Number(livePosition || 0);
  const trackLength = Number(event.trackLength || 0);

  return (
    <main className="shell">
      <section className="card remote">
        <header>
          <div>
            <p className="eyebrow">MASON'S</p>
            <h1>Yoto Remote</h1>
          </div>
          <button
            className="iconButton"
            onClick={refreshPlayer}
            aria-label="Refresh player"
          >
            ↻
          </button>
        </header>

        {devices.length > 1 && (
          <label className="deviceSelect">
            Player
            <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              {devices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.name || device.deviceId}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="connectionRow">
          <span
            className={`dot ${
              connection === "connected" && online ? "good" : ""
            }`}
          />
          <span>
            {selectedDevice?.name || "Yoto Player"} ·{" "}
            {connection === "connected" && online ? "Connected" : connection}
          </span>
          {Number.isFinite(Number(status.batteryLevel)) && (
            <span className="battery">{status.batteryLevel}%</span>
          )}
        </div>

        <div className="nowPlaying">
          <p className="label">NOW PLAYING</p>
          <h2>{event.trackTitle || "Start a card on the Yoto"}</h2>
          <p>{event.chapterTitle || "Playback details will appear here"}</p>
          <div className="progressTrack">
            <div
              className="progressFill"
              style={{
                width: trackLength
                  ? `${Math.min(100, (position / trackLength) * 100)}%`
                  : "0%",
              }}
            />
          </div>
          <div className="timeRow">
            <span>{formatTime(position)}</span>
            <span>{trackLength ? formatTime(trackLength) : "--:--"}</span>
          </div>
        </div>

        <div className="transport">
          <button className="seekButton" onClick={() => seek(-15)}>
            <span className="seekIcon">↶</span>
            <span>15</span>
          </button>

          <button
            className="playButton"
            onClick={togglePlayback}
            aria-label={isPaused ? "Play" : "Pause"}
          >
            {isPaused ? "▶" : "Ⅱ"}
          </button>

          <button className="seekButton" onClick={() => seek(15)}>
            <span className="seekIcon">↷</span>
            <span>15</span>
          </button>
        </div>

        <div className="volumeBox">
          <div className="volumeHeader">
            <span>Volume</span>
            <strong>{volume}%</strong>
          </div>
          <div className="volumeControls">
            <button
              onClick={() => setPlayerVolume(volume - 5)}
              aria-label="Volume down"
            >
              −
            </button>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={volume}
              onChange={(e) => setPlayerVolume(e.target.value)}
              aria-label="Volume"
            />
            <button
              onClick={() => setPlayerVolume(volume + 5)}
              aria-label="Volume up"
            >
              +
            </button>
          </div>
        </div>

        {message && <div className="notice error">{message}</div>}

        <footer>
          <button className="textButton" onClick={logout}>
            Disconnect
          </button>
        </footer>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
