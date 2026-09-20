/** Upload a zip buffer to wormhole.app and return a share URL. */
const nodeCrypto = require("crypto");
const { Readable } = require("stream");

if (!globalThis.crypto || !globalThis.crypto.subtle) {
  globalThis.crypto = nodeCrypto.webcrypto;
}

const API = "https://wormhole.app";
const TRACKER = "wss://wormhole.app/websocket";
const B2_BUCKET = "socket-dev-prod";

function b64url(b64) {
  return String(b64).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function streamToBuffer(stream) {
  const reader = stream.getReader();
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function bufferToWebStream(buf) {
  return Readable.toWeb(Readable.from(buf));
}

function pieceLengthFor(n) {
  let s = Math.min(5e6, Math.max(n, 1));
  s = 16384 * Math.ceil(s / 16384);
  return Math.max(16384, s);
}

async function api(method, path, { body, auth } = {}) {
  const headers = {
    Accept: "application/json",
    Origin: "https://wormhole.app",
    Referer: "https://wormhole.app/",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) headers.Authorization = auth;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || text || res.statusText;
    throw new Error(`wormhole.app ${method} ${path} failed (${res.status}): ${msg}`);
  }
  return data;
}

function createTorrentAsync(payload, opts) {
  const createTorrent = require("create-torrent");
  return new Promise((resolve, reject) => {
    createTorrent(payload, opts, (err, torrent) => (err ? reject(err) : resolve(torrent)));
  });
}

async function uploadToWormholeApp(zipBuf, fileName = "basalt-vault.zip") {
  const { Keychain } = await import("wormhole-crypto");
  const parseTorrent = require("parse-torrent");

  const keychain = new Keychain();
  const encrypted = await keychain.encryptStream(bufferToWebStream(zipBuf));
  const encBuf = await streamToBuffer(encrypted);
  const pieceLength = pieceLengthFor(encBuf.length);

  const torrentBuf = await createTorrentAsync(encBuf, {
    name: fileName,
    pieceLength,
    private: true,
    announce: TRACKER,
    announceList: [[TRACKER]],
    createdBy: "Basalt",
  });
  const parsed = parseTorrent(torrentBuf);
  const encryptedMeta = Buffer.from(await keychain.encryptMeta(new Uint8Array(torrentBuf)));

  const room = await api("POST", "/api/room", {
    body: {
      readerToken: await keychain.authTokenB64(),
      salt: keychain.saltB64,
    },
  });
  const id = room.id;
  const writerToken = room.writerToken;
  keychain.setAuthToken(writerToken);
  const auth = await keychain.authHeader();

  await api("PATCH", `/api/room/${id}`, {
    auth,
    body: {
      infoHash: parsed.infoHash,
      encryptedTorrentFile: encryptedMeta.toString("base64"),
      multiFile: false,
      sizeMb: Math.max(1, Math.ceil(zipBuf.length / 1e6)),
    },
  });

  const nPieces = Math.ceil(encBuf.length / pieceLength);
  const tokens = await api("POST", `/api/room/${id}/b2/auth-upload`, {
    auth,
    body: { numTokens: Math.min(5, nPieces) },
  });
  const tokenList = Array.isArray(tokens) ? tokens : (tokens.tokens || tokens.uploadAuth || []);
  if (!tokenList.length || !tokenList[0].uploadUrl) {
    throw new Error("wormhole.app did not return B2 upload tokens");
  }

  let tokenIdx = 0;
  async function nextToken() {
    let t = tokenList[tokenIdx % tokenList.length];
    tokenIdx++;
    if (!t || !t.uploadUrl) {
      const extra = await api("POST", `/api/room/${id}/b2/auth-upload`, {
        auth,
        body: { numTokens: 1 },
      });
      const list = Array.isArray(extra) ? extra : extra.tokens || [];
      t = list[0];
    }
    return t;
  }

  for (let i = 0; i < nPieces; i++) {
    const piece = encBuf.subarray(i * pieceLength, Math.min(encBuf.length, (i + 1) * pieceLength));
    const sha1 = nodeCrypto.createHash("sha1").update(piece).digest("hex");
    const t = await nextToken();
    const fileNamePath = [id, String(i)].map(encodeURIComponent).join("/");
    const put = await fetch(t.uploadUrl, {
      method: "POST",
      headers: {
        Authorization: t.authorizationToken,
        "X-Bz-Content-Sha1": sha1,
        "X-Bz-File-Name": fileNamePath,
        "Content-Type": "application/octet-stream",
      },
      body: piece,
    });
    if (!put.ok) {
      const errText = await put.text().catch(() => "");
      throw new Error(`B2 upload failed for piece ${i}: ${put.status} ${errText}`);
    }
  }

  await api("POST", `/api/room/${id}/b2/finish-upload`, {
    auth,
    body: { success: true },
  });

  const url = `https://wormhole.app/${id}#${b64url(keychain.keyB64)}`;
  return {
    url,
    id,
    expiresAtTimestampMs: room.expiresAtTimestampMs,
    remainingDownloads: room.remainingDownloads,
  };
}

module.exports = { uploadToWormholeApp };
