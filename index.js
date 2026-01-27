// Load environment variables from .env if present (local development)
require('dotenv').config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const { verifyToken } = require('./server-firebase');
const { clearCache } = require("./lib/db");

console.log("[STARTUP] Starting server initialization...");

const app = express();
const PORT = process.env.PORT || 3000;

console.log(`[STARTUP] Using PORT: ${PORT}`);

function loadJSON(filePath) {
  try {
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    console.error(`Error loading ${filePath}:`, err.message);
    throw err;
  }
}

// Logging middleware - configurable for performance
const ENABLE_REQUEST_LOGGING = process.env.LOG_REQUESTS === 'true';
app.use((req, res, next) => {
  if (ENABLE_REQUEST_LOGGING) {
    console.log(`[${new Date().toISOString()}] REQUEST: ${req.method} ${req.url} from ${req.ip}`);
  }
  next();
});

// Serve static assets with caching for better performance
app.use(express.static("public", { maxAge: "1h", etag: true }));
// Data paths
const songsPath = path.join(__dirname, "data", "songs.json");
const artistsPath = path.join(__dirname, "data", "artists.json");
const albumsPath = path.join(__dirname, "data", "albums.json");
const platformsPath = path.join(__dirname, "data", "platforms.json");
const genresPath = path.join(__dirname, "data", "genres.json");
const questsPath = path.join(__dirname, "data", "quests.json");
const questTemplatesPath = path.join(__dirname, "data", "questTemplates.json");

let songs = [];
let artists = [];
let albums = [];
let platforms = [];
let genres = [];
let quests = [];
let questTemplates = [];

// Lookup maps for O(1) access instead of repeated .find()
const artistsMap = new Map();
const songsMap = new Map();
const albumsMap = new Map();
const platformsByEntity = new Map();
let lastPlatformsLength = -1; // Track platforms changes

function loadDataFile(filePath, label) {
  try {
    const data = loadJSON(filePath);
    console.log(`Loaded ${data.length} ${label}`);
    return data;
  } catch (err) {
    console.error(`Failed to load ${label}:`, err.message);
    return [];
  }
}

function rebuildIndexes() {
  artistsMap.clear();
  songsMap.clear();

  artists.forEach(a => a?.id && artistsMap.set(a.id, a));
  songs.forEach(s => s?.song_id && songsMap.set(s.song_id, s));
  albums.forEach(a => a?.id && albumsMap.set(a.id, a));

  // Only rebuild platform index if platforms array changed
  if (lastPlatformsLength !== platforms.length) {
    platformsByEntity.clear();
    platforms.forEach(p => {
      const key = `${p.entityType}:${p.entityId}`;
      if (!platformsByEntity.has(key)) {
        platformsByEntity.set(key, []);
      }
      platformsByEntity.get(key).push(p);
    });
    lastPlatformsLength = platforms.length;
  }
}

function reloadDataFromDisk() {
  artists = loadDataFile(artistsPath, "artists");
  songs = loadDataFile(songsPath, "songs");
  albums = loadDataFile(albumsPath, "albums");
  platforms = loadDataFile(platformsPath, "platform links");
  genres = loadDataFile(genresPath, "genres");
  quests = loadDataFile(questsPath, "quests");
  questTemplates = loadDataFile(questTemplatesPath, "quest templates");

  rebuildIndexes();
}

// Initial load
reloadDataFromDisk();

// Helper functions
const validateId = (id, prefix) => id.startsWith(prefix);

const getArtistById = id =>
  validateId(id, "art_") ? artistsMap.get(id) : null;

const getSongById = id =>
  validateId(id, "rec_") ? songsMap.get(id) : null;

const getAlbumById = id =>
  validateId(id, "alb_") ? albumsMap.get(id) : null;

const getAlbumsByIds = ids =>
  ids.map(getAlbumById).filter(Boolean);

const getPlatformLinksFor = (entityType, entityId) =>
  platformsByEntity.get(`${entityType}:${entityId}`) || [];
  
const { applyListenEvent } = require("./logic/questEngine");
const { questsThatGrantRecording } = require("./logic/rewardLookup");

// Simple in-memory rate limiter for /listen per user (or IP fallback)
const listenRate = new Map();
function isRateLimited(key, limit = 60, windowMs = 60_000) {
  const now = Date.now();
  const entry = listenRate.get(key);
  if (!entry || (now - entry.ts) > windowMs) {
    listenRate.set(key, { ts: now, count: 1 });
    return false;
  }
  if (entry.count >= limit) return true;
  entry.count += 1;
  return false;
}

// Queue for batching file writes to avoid blocking
let questWritePending = false;
function scheduleQuestWrite() {
  if (questWritePending) return;
  questWritePending = true;
  
  setImmediate(() => {
    fs.writeFile(questsPath, JSON.stringify(quests, null, 2), (err) => {
      if (err) console.error("Error writing quests:", err);
      questWritePending = false;
    });
  });
}

app.post("/listen/:recordingId", verifyToken, (req, res) => {
  const recordingId = req.params.recordingId;
  const userId = req.user.uid; // Available from verifyToken middleware
  
  // Basic rate limit to prevent abuse
  const rateKey = userId || req.ip;
  if (isRateLimited(rateKey)) {
    return res.status(429).json({ error: "Rate limit exceeded" });
  }

  // Use cached data instead of reloading from disk
  const recording = songsMap.get(recordingId);

  if (!recording) {
    return res.status(404).json({ error: "Recording not found" });
  }

  // TODO: In the future, load user-specific quests from Firestore
  // For now, still using global quests.json
  quests.forEach(quest => {
    applyListenEvent(quest, recording);
  });

  // Use async write instead of blocking sync write
  scheduleQuestWrite();

  res.json({ success: true, quests });
});



// Routes
app.get("/test", (req, res) => {
  res.send("Server is alive");
});

// Serve Firebase config from environment (no hardcoded keys)
app.get("/api/firebase-config", (req, res) => {
  // Require environment variables - no hardcoded fallbacks
  if (!process.env.FIREBASE_API_KEY) {
    return res.status(500).json({ 
      error: "Firebase configuration not set. Please configure environment variables." 
    });
  }
  
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID
  });
});

app.get("/songs", (req, res) => {
  res.json(songs);
});

app.get("/artists", (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(artists);
});

app.get("/platforms", (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(platforms);
});

app.get("/profile", (req, res) => {
  // Mock profile data for now; later replace with real user session
  res.json({
    username: "Demo User",
    providers: [
      { name: "Spotify", linked: false },
      { name: "Apple Music", linked: false },
      { name: "YouTube", linked: false }
    ]
  });
});

app.get("/genres", (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(genres);
});

app.get("/songs/search", (req, res) => {
  const query = (req.query.q || "").toLowerCase();
  const results = Array.from(songsMap.values()).filter(song =>
    song.title.toLowerCase().includes(query)
  );
  res.json(results);
});

app.get("/songs/:id", (req, res) => {
  const songId = req.params.id;

  if (!validateId(songId, "rec_")) {
    return res.status(400).json({ error: "Invalid recording ID format" });
  }

  const song = songsMap.get(songId);

  if (!song) {
    return res.status(404).json({ error: "Recording not found" });
  }

  const songArtists = song.artistIds
    .map(id => artistsMap.get(id))
    .filter(Boolean);

  const songAlbums = song.albumIds
    .map(id => albumsMap.get(id))
    .filter(Boolean);

  const links = getPlatformLinksFor("recording", song.id);

  // Also include quests granting this recording without extra disk I/O
  const grantingQuests = questsThatGrantRecording(quests, songId).map(q => ({
    id: q.id,
    status: q.state?.status,
    templateId: q.templateId
  }));

  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    ...song,
    artists: songArtists,
    albums: songAlbums,
    links,
    grantedByQuests: grantingQuests
  });
});

app.get("/artists/:id", (req, res) => {
  const artistId = req.params.id;

  if (!validateId(artistId, "art_")) {
    return res.status(400).json({ error: "Invalid artist ID format" });
  }

  const artist = artistsMap.get(artistId);

  if (!artist) {
    return res.status(404).json({ error: "Artist not found" });
  }

  const links = getPlatformLinksFor("artist", artist.id);

  res.json({
    ...artist,
    links
  });
});

app.get("/artists/search", (req, res) => {
  const q = (req.query.q || "").toLowerCase();
  const results = Array.from(artistsMap.values()).filter(artist =>
    artist.name.toLowerCase().includes(q)
  );
  res.json(results);
});

app.get("/albums", (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(albums);
});

app.get("/albums/:id", (req, res) => {
  const albumId = req.params.id;

  if (!validateId(albumId, "alb_")) {
    return res.status(400).json({ error: "Invalid album ID format" });
  }

  const album = albumsMap.get(albumId);

  if (!album) {
    return res.status(404).json({ error: "Album not found" });
  }

  const albumRecordings = album.recordingIds
    .map(id => songsMap.get(id))
    .filter(Boolean);

  res.json({
    ...album,
    recordings: albumRecordings
  });
});

app.get("/quests", (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(quests);
});

app.get("/quest-templates", (req, res) => {
  res.json(questTemplates);
});

app.get("/quests/:id", (req, res) => {
  const quest = quests.find(q => q.id === req.params.id);

  if (!quest) {
    return res.status(404).json({ error: "Quest not found" });
  }

  const template = questTemplates.find(
    t => t.id === quest.templateId
  );

  res.json({
    ...quest,
    template
  });
});

app.get("/search", (req, res) => {
  const qRaw = req.query.q || "";
  if (qRaw.length > 100) {
    return res.status(400).json({ error: "Query too long" });
  }
  const q = qRaw.toLowerCase();

  if (!q) {
    // Return all artists and albums when query is empty
    return res.json({ 
      artists: Array.from(artistsMap.values()),
      albums: Array.from(albumsMap.values()),
      songs: []
    });
  }

  const searchArtists = Array.from(artistsMap.values()).filter(a => 
    a.name.toLowerCase().includes(q)
  );

  const searchAlbums = Array.from(albumsMap.values()).filter(a => 
    a.title.toLowerCase().includes(q)
  );

  const searchSongs = Array.from(songsMap.values()).filter(s => 
    s.title.toLowerCase().includes(q)
  );

  res.json({ artists: searchArtists, albums: searchAlbums, songs: searchSongs });
});

// Developer utilities
app.post("/developer/cache/clear", (req, res) => {
  try {
    clearCache();
    reloadDataFromDisk();

    res.json({
      success: true,
      counts: {
        songs: songs.length,
        artists: artists.length,
        albums: albums.length,
        quests: quests.length,
        questTemplates: questTemplates.length,
        platforms: platforms.length,
        genres: genres.length,
      }
    });
  } catch (err) {
    console.error("[DEV] Cache clear failed:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/developer/quests/reset", (req, res) => {
  try {
    // Reset all quest progress
    quests.forEach(quest => {
      quest.state = {
        status: "active",
        matchedRecordingIds: [],
        matchedRecordingIdsSet: {}
      };
    });
    
    fs.writeFileSync(questsPath, JSON.stringify(quests, null, 2));
    
    res.json({
      success: true,
      message: "Quest progress reset",
      questCount: quests.length
    });
  } catch (err) {
    console.error("[DEV] Quest reset failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({ error: err.message });
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[${new Date().toISOString()}] Server started on port ${PORT}`);
  console.log(`[${new Date().toISOString()}] Listening on http://localhost:${PORT}`);
  console.log('[SERVER] Ready to accept connections');
});

// Verify the server is actually listening
setTimeout(() => {
  if (server.listening) {
    console.log('[CHECK] Server.listening is true');
  } else {
    console.log('[CHECK] Server.listening is FALSE');
  }
}, 100);

server.on("error", (err) => {
  console.error("Server error:", err);
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use`);
  }
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('[ERROR] Uncaught Exception:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[ERROR] Unhandled Rejection:', reason);
  if (reason instanceof Error) {
    console.error(reason.stack);
  }
  process.exit(1);
});
// 404 fallback for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});
