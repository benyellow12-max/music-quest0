// Wait for Firebase to be configured
if (!window.firebaseExports) {
  console.error('Firebase not initialized. Make sure firebase-config.js loads first.');
}

// Don't destructure immediately - access dynamically to allow async initialization
function getFirebase() {
  return window.firebaseExports || {};
}

// Use getter functions for DOM elements to ensure they're fresh
function getInput() {
  return document.getElementById("search-input");
}

function getResults() {
  return document.getElementById("results");
}

function getMainContent() {
  return document.getElementById("main-content");
}

function getContent() {
  return document.getElementById("content");
}

let currentUser = null;

let activeQuests = [];
let allArtists = [];
let allAlbums = [];
let allSongs = [];
let allPlatforms = [];
let allGenres = [];
let allQuestTemplates = [];
let navigationHistory = [{ type: "home" }]; // Initialize with home page
let dataLoaded = false;

const DEVELOPER_MODE_KEY = "musicQuestDeveloperMode";
const storedDeveloperPref = localStorage.getItem(DEVELOPER_MODE_KEY);
let developerModeEnabled = storedDeveloperPref === null
  ? true // default to developer mode enabled for now
  : storedDeveloperPref === "true";

// Persist the default if it was missing
if (storedDeveloperPref === null) {
  localStorage.setItem(DEVELOPER_MODE_KEY, "true");
}

function ensureDeveloperTabVisible() {
  const devTabButton = document.getElementById("dev-tab-btn");
  if (!devTabButton) return;
  devTabButton.style.display = developerModeEnabled ? "block" : "none";
  if (developerModeEnabled) {
    devTabButton.hidden = false;
    devTabButton.removeAttribute("aria-hidden");
  }
}

function setDeveloperMode(enabled) {
  developerModeEnabled = enabled;
  localStorage.setItem(DEVELOPER_MODE_KEY, enabled ? "true" : "false");
  ensureDeveloperTabVisible();
}

// Wait for DOM to be ready before setting initial visibility
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensureDeveloperTabVisible);
} else {
  ensureDeveloperTabVisible();
}

async function loadAllData() {
  const [artistRes, albumRes, songRes, questRes, platformRes, genreRes, templateRes] = await Promise.all([
    fetch("/artists"),
    fetch("/albums"),
    fetch("/songs"),
    fetch("/quests"),
    fetch("/platforms"),
    fetch("/genres"),
    fetch("/quest-templates").catch(() => null)
  ]);
  allArtists = await artistRes.json();
  allAlbums = await albumRes.json();
  allSongs = await songRes.json();
  activeQuests = await questRes.json();
  allPlatforms = await platformRes.json();
  allGenres = await genreRes.json();
  allQuestTemplates = templateRes ? await templateRes.json() : [];
  console.log("Data loaded:", { 
    artistCount: allArtists.length, 
    albumCount: allAlbums.length, 
    songCount: allSongs.length,
    questCount: activeQuests.length,
    platformCount: allPlatforms.length,
    genreCount: allGenres.length,
    templateCount: allQuestTemplates.length
  });
  dataLoaded = true;
}

loadAllData().then(() => {
  loadQuests().catch(err => {
    console.error('Error loading quests:', err);
  });
});

function getSongsWithoutQuests() {
  if (!dataLoaded) return [];

  return allSongs.filter(song => {
    const rewarding = getQuestsRewardingSong(song);
    const matching = getQuestsForSong(song);
    return rewarding.length === 0 && matching.length === 0;
  });
}

function renderSongsWithoutQuests() {
  const container = document.getElementById("songs-without-quests");
  if (!container) return;

  if (!dataLoaded) {
    container.innerHTML = "<p><em>Data is still loading. Try again once everything finishes loading.</em></p>";
    return;
  }

  const missing = getSongsWithoutQuests();

  if (missing.length === 0) {
    container.innerHTML = "<p><strong>All songs are connected to quests.</strong></p>";
    return;
  }

  const rows = missing.map(song => {
    const songArtists = (song.artist_ids && Array.isArray(song.artist_ids))
      ? song.artist_ids.map(id => (allArtists || []).find(a => a && a.id === id)).filter(Boolean)
      : [];
    const artistNames = songArtists.map(a => a.name).join(", ");
    return `<div class="list-item">
      <img src="/images/song.png" alt="song">
      <div class="item-info">
        <div>${song.title || 'Unknown'}</div>
        <div class="subtitle">${artistNames || 'Unknown artist'} • ${song.variant || 'Unknown version'} • ${song.year || 'Year unknown'}</div>
      </div>
    </div>`;
  }).join("");

  container.innerHTML = `<p><strong>${missing.length}</strong> song${missing.length !== 1 ? 's' : ''} have no quests yet.</p><div class="items-list">${rows}</div>`;
}

async function eraseCache() {
  const statusEl = document.getElementById("erase-cache-status");
  const cacheButton = document.getElementById("erase-cache-btn");
  const setStatus = (msg) => {
    if (statusEl) statusEl.textContent = msg;
  };

  setStatus("Clearing caches...");
  if (cacheButton) cacheButton.disabled = true;

  try {
    await fetch("/developer/cache/clear", { method: "POST" });
  } catch (err) {
    console.error("Server cache clear failed", err);
    setStatus(`Server cache clear failed: ${err.message}`);
  }

  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    }
  } catch (err) {
    console.error("CacheStorage clear failed", err);
    setStatus(`Browser cache clear encountered an issue: ${err.message}`);
  }

  try {
    if (navigator?.serviceWorker?.getRegistrations) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(reg => reg.unregister()));
    }
  } catch (err) {
    console.error("Service worker unregister failed", err);
  }

  try {
    await loadAllData();
    await loadQuests();
    renderSongsWithoutQuests();
    setStatus("Caches cleared and data reloaded.");
    setTimeout(() => setStatus(""), 4000);
  } catch (err) {
    console.error("Reload after cache clear failed", err);
    setStatus(`Reload failed: ${err.message}`);
  } finally {
    if (cacheButton) cacheButton.disabled = false;
  }
}

function eraseStoredMemory() {
  const statusEl = document.getElementById("erase-storage-status");
  const storageButton = document.getElementById("erase-storage-btn");
  const setStatus = (msg) => {
    if (statusEl) statusEl.textContent = msg;
  };

  setStatus("Clearing local storage...");
  if (storageButton) storageButton.disabled = true;

  try {
    localStorage.clear();
    // Keep developer mode on by default after clearing
    setDeveloperMode(true);
    setStatus("Stored memory cleared.");
    setTimeout(() => setStatus(""), 3000);
  } catch (err) {
    console.error("Local storage clear failed", err);
    setStatus(`Failed to clear stored memory: ${err.message}`);
  } finally {
    if (storageButton) storageButton.disabled = false;
  }
}

// Quest matching logic - matches server-side recordingMatchesQuest
function recordingMatchesQuestParams(recording, questParams) {
  if (!questParams) return true;

  // Artist match: use artist_ids array from data
  const recArtistIds = recording.artist_ids || recording.artistIds || [];
  if (questParams.artistId && !recArtistIds.includes(questParams.artistId)) {
    return false;
  }

  // Year window match
  const recYear = recording.year;
  if (questParams.startYear !== undefined && recYear < questParams.startYear) {
    return false;
  }

  if (questParams.endYear !== undefined && recYear > questParams.endYear) {
    return false;
  }

  return true;
}

function questImpactForSong(song) {
  let completes = 0;
  let advances = 0;

  activeQuests.forEach(quest => {
    if (quest.state.status !== "active") return;

    const alreadyMatched =
      quest.state.matchedRecordingIds.includes(song.song_id);

    if (alreadyMatched) return;

    // Reuse quest matching logic consistent with server
    if (!recordingMatchesQuestParams(song, quest.params)) return;

    const required = (quest.params && quest.params.requiredCount) || 1;
    const current = quest.state.matchedRecordingIds.length;
    if (current + 1 >= required) {
      completes++;
    } else {
      advances++;
    }
  });

  return { completes, advances };
}

function setupSearchListener() {
  const input = document.getElementById("search-input");
  const results = document.getElementById("results");
  
  if (!input) return;
  
  let searchTimeout = null;
  let searchAbortController = null;

  // Show all artists and albums when input is focused or on load
  const loadAllArtistsAndAlbums = async () => {
    if (!dataLoaded) {
      results.innerHTML = "<p>Loading data, please wait...</p>";
      return;
    }
    
    try {
      if (searchAbortController) searchAbortController.abort();
      searchAbortController = new AbortController();
      const res = await fetch(`/search?q=`, { signal: searchAbortController.signal });
      const data = await res.json();
      renderResults(data);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Search error', err);
      }
    }
  };

  input.addEventListener("focus", () => {
    if (input.value.trim() === "") {
      loadAllArtistsAndAlbums();
    }
  });

  input.addEventListener("input", () => {
    if (!dataLoaded) {
      results.innerHTML = "<p>Loading data, please wait...</p>";
      return;
    }

    const q = input.value.trim();
    if (searchTimeout) clearTimeout(searchTimeout);

    if (!q) {
      loadAllArtistsAndAlbums();
      return;
    }

    searchTimeout = setTimeout(async () => {
      try {
        if (searchAbortController) searchAbortController.abort();
        searchAbortController = new AbortController();
        const res = await fetch(`/search?q=${encodeURIComponent(q)}`, { signal: searchAbortController.signal });
        const data = await res.json();
        renderResults(data);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Search error', err);
        }
      }
    }, 150);
  });

  // Load all artists and albums on initial setup if data is loaded
  if (dataLoaded) {
    loadAllArtistsAndAlbums();
  }
}

setupSearchListener();

console.log('[app.js] setupSearchListener completed');

// Reusable DOM template fragments for search results
const resultTemplates = {
  createArtistItem: (item, idx) => {
    const div = document.createElement("div");
    div.className = "result-item";
    div.innerHTML = `<img src="/images/artist.png" alt="artist"><div><div>${item.name}</div></div>`;
    return div;
  },
  createAlbumItem: (item, idx) => {
    const div = document.createElement("div");
    div.className = "result-item";
    div.innerHTML = `<img src="/images/album.png" alt="album"><div><div>${item.title}</div></div>`;
    return div;
  },
  createSongItem: (item, idx) => {
    const div = document.createElement("div");
    div.className = "result-item";
    div.innerHTML = `<img src="/images/song.png" alt="song"><div><div>${item.title}</div></div>`;
    return div;
  }
};

function renderResults({ artists, albums, songs }) {
  const results = document.getElementById("results");
  if (!results) return;
  
  results.innerHTML = "";
  
  // Store search context for onclick handlers
  window._searchResults = { artists, albums, songs };

  if (artists && artists.length > 0) {
    const group = document.createElement("div");
    group.className = "result-group";
    const h3 = document.createElement("h3");
    h3.textContent = "Artists";
    group.appendChild(h3);
    artists.forEach((item, idx) => {
      const div = resultTemplates.createArtistItem(item, idx);
      div.onclick = () => showArtist(window._searchResults.artists[idx]);
      group.appendChild(div);
    });
    results.appendChild(group);
  }

  if (albums && albums.length > 0) {
    const group = document.createElement("div");
    group.className = "result-group";
    const h3 = document.createElement("h3");
    h3.textContent = "Albums";
    group.appendChild(h3);
    albums.forEach((item, idx) => {
      const div = resultTemplates.createAlbumItem(item, idx);
      div.onclick = () => showAlbum(window._searchResults.albums[idx]);
      group.appendChild(div);
    });
    results.appendChild(group);
  }

  if (songs && songs.length > 0) {
    const group = document.createElement("div");
    group.className = "result-group";
    const h3 = document.createElement("h3");
    h3.textContent = "Songs";
    group.appendChild(h3);
    songs.forEach((item, idx) => {
      const div = resultTemplates.createSongItem(item, idx);
      div.onclick = () => showSong(window._searchResults.songs[idx]);
      group.appendChild(div);
    });
    results.appendChild(group);
  }
}

function getPlatformsForEntity(entityType, entityId) {
  return allPlatforms.filter(p => p.entityType === entityType && p.entityId === entityId);
}

function renderPlatformLinks(platforms) {
  if (!platforms || platforms.length === 0) return '';
  
  const platformNames = {
    'youtube': 'YouTube',
    'spotify': 'Spotify',
    'apple_music': 'Apple Music',
    'wikipedia': 'Wikipedia',
    'bandcamp': 'Bandcamp',
    'soundcloud': 'SoundCloud'
  };
  
  let html = '<p><strong>Links:</strong> ';
  html += platforms.map(p => {
    const name = platformNames[p.platform] || p.platform;
    const note = p.notes ? ` (${p.notes})` : '';
    return `<a href="${p.url}" target="_blank" class="platform-link">${name}${note}</a>`;
  }).join(' • ');
  html += '</p>';
  return html;
}

function showArtist(artist) {
  try {
    console.log("showArtist called with:", artist);
    console.log("allAlbums available:", allAlbums.length, "allSongs available:", allSongs.length);
    
    const results = document.getElementById("results");
    if (results) results.innerHTML = "";
    getMainContent().innerHTML = "";
    navigationHistory.push({ type: "artist", data: artist });
    updateBackButton();

    const artistAlbums = (allAlbums || []).filter(a => a && a.artistIds && Array.isArray(a.artistIds) && a.artistIds.includes(artist.id));
    // Sort albums chronologically by year
    artistAlbums.sort((a, b) => (a.year || 0) - (b.year || 0));
    
    const artistSongs = (allSongs || []).filter(s => s && s.artist_ids && Array.isArray(s.artist_ids) && s.artist_ids.includes(artist.id));
    // Sort songs alphabetically by title (case-insensitive)
    artistSongs.sort((a, b) => (a?.title || '').localeCompare((b?.title || ''), undefined, { sensitivity: 'base' }));
    const artistPlatforms = getPlatformsForEntity('artist', artist.id);

    console.log("Filtered albums:", artistAlbums.length, "songs:", artistSongs.length);

    let html = `<h1>${artist.name}</h1>`;

    if (artist.notes) {
      html += `<p>${artist.notes}</p>`;
    }

    html += renderPlatformLinks(artistPlatforms);

    if (artistAlbums.length > 0) {
      html += `<h3>Albums (${artistAlbums.length})</h3><div class="items-grid">`;
      artistAlbums.forEach((album, idx) => {
        html += `<div class="item-card" onclick="window.showAlbumDirect(${idx}, 'artist')">
          <img src="/images/album.png" alt="album">
          <div>${album.title}</div>
          <div class="subtitle">${album.year}</div>
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p><em>No albums found</em></p>`;
    }

    if (artistSongs.length > 0) {
      html += `<h3>Songs (${artistSongs.length})</h3><div class="items-list">`;
      artistSongs.forEach((song, idx) => {
        html += `<div class="list-item" onclick="window.showSongDirect(${idx}, 'artist')">
          <img src="/images/song.png" alt="song">
          <div class="item-info">
            <div>${song.title}</div>
            <div class="subtitle">${song.variant} • ${song.year}</div>
          </div>
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p><em>No songs found</em></p>`;
    }

    getMainContent().innerHTML = html;
    
    // Store current context for item navigation
    window._currentArtistContext = { albums: artistAlbums, songs: artistSongs };
  } catch(err) {
    console.error("Error in showArtist:", err);
    getMainContent().innerHTML = `<h1>Error</h1><p>${err.message}</p>`;
  }
}

function showAlbum(album) {
  try {
    if (!album) {
      getMainContent().innerHTML = `<h1>Error</h1><p>No album data provided</p>`;
      return;
    }
    
    const results = document.getElementById("results");
    if (results) results.innerHTML = "";
    getMainContent().innerHTML = "";
    navigationHistory.push({ type: "album", data: album });
    updateBackButton();

    const albumArtists = (album.artistIds && Array.isArray(album.artistIds)) ? album.artistIds.map(id => (allArtists || []).find(a => a && a.id === id)).filter(Boolean) : [];
    const albumSongs = (album.recordingIds && Array.isArray(album.recordingIds)) ? album.recordingIds.map(id => (allSongs || []).find(s => s && s.song_id === id)).filter(Boolean) : [];
    const albumPlatforms = getPlatformsForEntity('album', album.id);

    let html = `<h1>${album.title || 'Unknown Album'}</h1>`;
    
    if (albumArtists.length > 0) {
      html += `<p><strong>Artists:</strong> ${albumArtists.map((a, idx) => `<span class="link" onclick="window.showArtistDirect(${idx}, 'album')">${a.name || 'Unknown'}</span>`).join(", ")}</p>`;
    }

    html += `<p><strong>Year:</strong> ${album.year || 'Unknown'}</p>`;
    
    html += renderPlatformLinks(albumPlatforms);

    if (albumSongs.length > 0) {
      html += `<h3>Tracks (${albumSongs.length})</h3><div class="items-list">`;
      albumSongs.forEach((song, index) => {
        html += `<div class="list-item" onclick="window.showSongDirect(${index}, 'album')">
          <div class="item-number">${index + 1}</div>
          <div class="item-info">
            <div>${song.title || 'Unknown'}</div>
            <div class="subtitle">${song.variant || 'Unknown'}</div>
          </div>
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p><em>No tracks found</em></p>`;
    }

    getMainContent().innerHTML = html;
    
    // Store current context for item navigation
    window._currentAlbumContext = { artists: albumArtists, songs: albumSongs };
  } catch(err) {
    console.error("Error in showAlbum:", err);
    getMainContent().innerHTML = `<h1>Error</h1><p>${err.message}</p><pre>${err.stack}</pre>`;
  }
}

function getQuestsRewardingSong(song) {
  if (!song || !song.song_id) return [];
  
  return activeQuests.filter(quest => {
    try {
      return quest && quest.reward && quest.reward.type === 'song' && quest.reward.entityId === song.song_id;
    } catch(err) {
      console.error("Error filtering reward quest for song:", err);
      return false;
    }
  });
}

function getQuestsForSong(song) {
  if (!song || !song.song_id) return [];
  
  return activeQuests.filter(quest => {
    try {
      // Check if song is already matched
      if (quest && quest.state && quest.state.matchedRecordingIds && quest.state.matchedRecordingIds.includes(song.song_id)) {
        return true;
      }
      // Check if song matches quest criteria
      if (!quest || !quest.state || quest.state.status !== "active") return false;
      
      const p = quest.params;
      if (!p) return false;
      
      if (p.artistId && song.artist_ids && Array.isArray(song.artist_ids) && !song.artist_ids.includes(p.artistId)) return false;
      if (p.startYear !== undefined && song.year < p.startYear) return false;
      if (p.endYear !== undefined && song.year > p.endYear) return false;
      return true;
    } catch(err) {
      console.error("Error filtering quest for song:", err);
      return false;
    }
  });
}

function showSong(song) {
  try {
    if (!song) {
      getMainContent().innerHTML = `<h1>Error</h1><p>No song data provided</p>`;
      return;
    }
    
    const results = document.getElementById("results");
    if (results) results.innerHTML = "";
    getMainContent().innerHTML = "";
    navigationHistory.push({ type: "song", data: song });
    updateBackButton();

    const songArtists = (song.artist_ids && Array.isArray(song.artist_ids)) ? song.artist_ids.map(id => (allArtists || []).find(a => a && a.id === id)).filter(Boolean) : [];
    const songAlbumIds = Array.isArray(song.album_id) ? song.album_id : (song.album_id ? [song.album_id] : []);
    const songAlbums = songAlbumIds.map(id => (allAlbums || []).find(a => a && a.id === id)).filter(Boolean);
    const songGenres = (song.genre_ids && Array.isArray(song.genre_ids)) ? song.genre_ids.map(id => (allGenres || []).find(g => g && g.id === id)).filter(Boolean) : [];
    const songPlatforms = getPlatformsForEntity('recording', song.song_id);
    const rewardQuests = getQuestsRewardingSong(song);
    const relatedQuests = getQuestsForSong(song);

    let html = `<h1>${song.title || 'Unknown Song'}</h1>`;

    if (song.variant) {
      html += `<p><strong>Variant:</strong> ${song.variant}</p>`;
    }

    if (songArtists.length > 0) {
      html += `<p><strong>Artists:</strong> ${songArtists.map((a, idx) => `<span class="link" onclick="window.showArtistDirect(${idx}, 'song')">${a.name || 'Unknown'}</span>`).join(", ")}</p>`;
    }

    if (songAlbums.length > 0) {
      html += `<p><strong>Albums:</strong> ${songAlbums.map((a, idx) => `<span class="link" onclick="window.showAlbumDirect(${idx}, 'song')">${a.title || 'Unknown'}</span>`).join(", ")}</p>`;
    }

    html += `<p><strong>Year:</strong> ${song.year || 'Unknown'}</p>`;
    
    if (songGenres.length > 0) {
      html += `<p><strong>Genres:</strong> ${songGenres.map((g, idx) => `<span class="link" onclick="window.showGenreDirect(${idx}, 'song')">${g.name || 'Unknown'}</span>`).join(", ")}</p>`;
    }
    
    html += renderPlatformLinks(songPlatforms);

    html += `<div style="margin-top:1rem">
      <button id="listen-btn" class="primary-btn">${currentUser ? 'Mark as listened' : 'Login to track progress'}</button>
      <span id="listen-status" style="margin-left: 0.5rem; color: #9aa0b5;"></span>
    </div>`;

    if (rewardQuests.length > 0) {
      window._rewardQuests = rewardQuests;
      html += `<div class="section-card"><h3>🎁 Rewards Quest (${rewardQuests.length})</h3><p class="muted">Unlocked by completing:</p><div class="quest-list-inline">`;
      rewardQuests.forEach((quest, idx) => {
        const isCompleted = quest && quest.state && quest.state.status === 'completed';
        const done = quest.state.matchedRecordingIds.length;
        const total = quest.params.requiredCount || 1;
        const progress = Math.round((done / total) * 100);
        html += `<div class="quest-item ${isCompleted ? 'completed' : 'active'}" onclick="showQuest(window._rewardQuests[${idx}])">
          <strong>${renderQuestTitle(quest)}</strong><br>
          <div class="quest-mini-progress">
            <div class="progress-fill" style="width: ${progress}%"></div>
          </div>
          <span class="quest-status">${isCompleted ? '✓ Completed' : `${done}/${total}`}</span>
        </div>`;
      });
      html += `</div></div>`;
    }

    if (relatedQuests.length > 0) {
      window._relatedQuests = relatedQuests;
      html += `<div class="section-card"><h3>⚡ Related Quests (${relatedQuests.length})</h3><p class="muted">Can advance by listening:</p><div class="quest-list-inline">`;
      relatedQuests.forEach((quest, idx) => {
        const isMatched = quest && quest.state && quest.state.matchedRecordingIds && quest.state.matchedRecordingIds.includes(song.song_id);
        const done = quest.state.matchedRecordingIds.length;
        const total = quest.params.requiredCount || 1;
        const progress = Math.round((done / total) * 100);
        html += `<div class="quest-item ${isMatched ? 'matched' : 'pending'}" onclick="showQuest(window._relatedQuests[${idx}])"><strong>${renderQuestTitle(quest)}</strong><br>
          <div class="quest-mini-progress">
            <div class="progress-fill" style="width: ${progress}%"></div>
          </div>
          <span class="quest-status">${isMatched ? '✓ Matched' : `${done}/${total}`}</span></div>`;
      });
      html += `</div></div>`;
    }

    if (song.audio) {
      html += `<h3>Audio Details</h3><p>
        <strong>Duration:</strong> ${Math.floor(song.audio.duration_seconds / 60)}:${String(song.audio.duration_seconds % 60).padStart(2, '0')}<br>
        <strong>BPM:</strong> ${song.audio.bpm}<br>
        <strong>Key:</strong> ${song.audio.key}<br>
        <strong>Time Signature:</strong> ${song.audio.time_signature}
      </p>`;
    }

    getMainContent().innerHTML = html;
    const listenBtn = document.getElementById("listen-btn");
    if (listenBtn) {
      listenBtn.onclick = () => markSongListened(song);
    }
    
    // Store current context for item navigation
    window._currentSongContext = { artists: songArtists, albums: songAlbums, genres: songGenres };
  } catch(err) {
    console.error("Error in showSong:", err);
    getMainContent().innerHTML = `<h1>Error</h1><p>${err.message}</p><pre>${err.stack}</pre>`;
  }
}

async function markSongListened(song) {
  const statusEl = document.getElementById('listen-status');
  const setStatus = (msg) => {
    if (statusEl) statusEl.textContent = msg;
  };

  // Check if user is logged in
  if (!currentUser) {
    const shouldLogin = confirm('You need to login to track your listening progress. Go to Profile tab to login?');
    if (shouldLogin) {
      showProfileTab();
    }
    return;
  }

  try {
    setStatus('Processing...');
    
    // Get Firebase auth token
    const token = await currentUser.getIdToken();
    
    // POST to server to register listen
    const res = await fetch(`/listen/${encodeURIComponent(song.song_id)}`, { 
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error('Failed to mark listened', errorText);
      if (res.status === 401) {
        setStatus('Authentication failed');
        alert('Please login to track your listening progress');
        showProfileTab();
      } else {
        setStatus('Failed to mark as listened');
        alert('Failed to mark song as listened: ' + errorText);
      }
      return;
    }
    
    setStatus('✓ Marked as listened!');
    
    // Refresh quests in sidebar and in memory
    const qRes = await fetch('/quests');
    activeQuests = await qRes.json();
    await loadQuests();
    
    // Re-render current song to reflect updated related/reward quests
    setTimeout(() => {
      showSong(song);
    }, 1000);
  } catch (err) {
    console.error('Error marking song listened:', err);
    setStatus('Error occurred');
    alert('Failed to mark song as listened. Please try again.');
  }
}

// Helper functions for navigation from inline onclick handlers
window.showArtistDirect = (idx, context) => {
  const ctx = window[`_current${context.charAt(0).toUpperCase() + context.slice(1)}Context`];
  if (ctx && ctx.artists && ctx.artists[idx]) {
    showArtist(ctx.artists[idx]);
  }
};

window.showAlbumDirect = (idx, context) => {
  const ctx = window[`_current${context.charAt(0).toUpperCase() + context.slice(1)}Context`];
  if (ctx && ctx.albums && ctx.albums[idx]) {
    showAlbum(ctx.albums[idx]);
  }
};

window.showSongDirect = (idx, context) => {
  const ctx = window[`_current${context.charAt(0).toUpperCase() + context.slice(1)}Context`];
  if (ctx && ctx.songs && ctx.songs[idx]) {
    showSong(ctx.songs[idx]);
  }
};

window.showGenreDirect = (idx, context) => {
  const ctx = window[`_current${context.charAt(0).toUpperCase() + context.slice(1)}Context`];
  if (ctx && ctx.genres && ctx.genres[idx]) {
    showGenre(ctx.genres[idx]);
  }
};

window.showSubgenreDirect = (idx, context) => {
  const ctx = window[`_current${context.charAt(0).toUpperCase() + context.slice(1)}Context`];
  if (ctx && ctx.subgenres && ctx.subgenres[idx]) {
    showGenre(ctx.subgenres[idx]);
  }
};

function showGenre(genre) {
  try {
    if (!genre) {
      getMainContent().innerHTML = `<h1>Error</h1><p>No genre data provided</p>`;
      return;
    }
    
    const results = document.getElementById("results");
    if (results) results.innerHTML = "";
    getMainContent().innerHTML = "";
    navigationHistory.push({ type: "genre", data: genre });
    updateBackButton();

    const genreSongs = (allSongs || []).filter(s => s && s.genre_ids && Array.isArray(s.genre_ids) && s.genre_ids.includes(genre.id));
    const subgenres = (allGenres || []).filter(g => g && g.parentId === genre.id);

    let html = `<h1>${genre.name}</h1>`;
    
    if (genre.parentId) {
      const parentGenre = allGenres.find(g => g.id === genre.parentId);
      if (parentGenre) {
        html += `<p><strong>Parent Genre:</strong> <span class="link" onclick="showGenre(${JSON.stringify(parentGenre).replace(/"/g, '&quot;')})">${parentGenre.name}</span></p>`;
      }
    }

    if (subgenres.length > 0) {
      html += `<h3>Subgenres (${subgenres.length})</h3><div class="items-list">`;
      subgenres.forEach((subgenre, idx) => {
        const subgenreSongCount = (allSongs || []).filter(s => s && s.genre_ids && Array.isArray(s.genre_ids) && s.genre_ids.includes(subgenre.id)).length;
        html += `<div class="list-item" onclick="window.showSubgenreDirect(${idx}, 'genre')">
          <div class="item-info">
            <div>${subgenre.name || 'Unknown'}</div>
            <div class="subtitle">${subgenreSongCount} song${subgenreSongCount !== 1 ? 's' : ''}</div>
          </div>
        </div>`;
      });
      html += `</div>`;
    }

    if (genreSongs.length > 0) {
      html += `<h3>Songs (${genreSongs.length})</h3><div class="items-list">`;
      genreSongs.forEach((song, idx) => {
        const songArtists = (song.artist_ids && Array.isArray(song.artist_ids)) ? song.artist_ids.map(id => (allArtists || []).find(a => a && a.id === id)).filter(Boolean) : [];
        const artistNames = songArtists.map(a => a.name).join(", ");
        html += `<div class="list-item" onclick="window.showSongDirect(${idx}, 'genre')">
          <img src="/images/song.png" alt="song">
          <div class="item-info">
            <div>${song.title || 'Unknown'}</div>
            <div class="subtitle">${artistNames} • ${song.variant || 'Unknown'} • ${song.year}</div>
          </div>
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p><em>No songs found</em></p>`;
    }

    getMainContent().innerHTML = html;
    
    // Store current context for item navigation
    window._currentGenreContext = { songs: genreSongs, subgenres: subgenres };
  } catch(err) {
    console.error("Error in showGenre:", err);
    getMainContent().innerHTML = `<h1>Error</h1><p>${err.message}</p><pre>${err.stack}</pre>`;
  }
}

async function loadQuests() {
  try {
    const res = await fetch("/quests");
    const quests = await res.json();

    const list = document.getElementById("quest-list");
    if (!list) {
      console.warn('quest-list element not found');
      return;
    }
    
    list.innerHTML = "";

    quests.forEach(quest => {
      const card = document.createElement("div");
      card.className = "quest-card";

      if (quest.state.status === "completed") {
        card.classList.add("completed");
      } else if (quest.state.status === "active") {
        card.classList.add("active");
      }

      const done = quest.state.matchedRecordingIds.length;
      const total = quest.params.requiredCount || 1;
      const progress = Math.round((done / total) * 100);

      const title = document.createElement("div");
      title.className = "quest-title";
      title.textContent = renderQuestTitle(quest);

      const progressBar = document.createElement("div");
      progressBar.className = "quest-progress-bar";
      progressBar.innerHTML = `<div class="progress-fill" style="width: ${progress}%"></div>`;

      const progressText = document.createElement("div");
      progressText.className = "quest-progress-text";
      progressText.textContent = renderQuestProgress(quest);

      card.appendChild(title);
      card.appendChild(progressBar);
      card.appendChild(progressText);

      card.onclick = () => showQuest(quest);
      list.appendChild(card);
    });
  } catch (err) {
    console.error('Error in loadQuests:', err);
  }
}

function renderQuestTitle(quest) {
  const p = quest.params;
  const template = allQuestTemplates.find(t => t.id === quest.templateId);

  let title = "";

  // Handle different quest types based on template
  if (template) {
    switch (template.type) {
      case 'listen_count':
        const count = p.requiredCount || 1;
        title = `Listen to ${count} song${count > 1 ? 's' : ''}`;
        if (p.artistId) {
          const artist = allArtists.find(a => a && a.id === p.artistId);
          title += ` by ${artist ? artist.name : p.artistId}`;
        }
        break;
      
      case 'listen_by_year':
        const reqCount = p.requiredCount || 1;
        title = `Listen to ${reqCount} song${reqCount > 1 ? 's' : ''}`;
        if (p.artistId) {
          const artist = allArtists.find(a => a && a.id === p.artistId);
          title += ` by ${artist ? artist.name : p.artistId}`;
        }
        if (p.startYear !== undefined && p.endYear !== undefined) {
          title += ` (${p.startYear}–${p.endYear})`;
        }
        break;
      
      case 'listen_by_genre':
        const genreCount = p.requiredCount || 1;
        title = `Listen to ${genreCount} song${genreCount > 1 ? 's' : ''}`;
        if (p.genreId) {
          const genre = allGenres.find(g => g && g.id === p.genreId);
          if (genre) {
            title += ` in ${genre.name}`;
          }
        }
        if (p.artistId) {
          const artist = allArtists.find(a => a && a.id === p.artistId);
          title += ` by ${artist ? artist.name : p.artistId}`;
        }
        break;
      
      case 'listen_between_time':
        const timeCount = p.requiredCount || 1;
        title = `Listen to ${timeCount} song${timeCount > 1 ? 's' : ''}`;
        if (p.artistId) {
          const artist = allArtists.find(a => a && a.id === p.artistId);
          title += ` by ${artist ? artist.name : p.artistId}`;
        }
        if (p.startTime && p.endTime) {
          title += ` (${p.startTime}–${p.endTime})`;
        }
        break;
      
      case 'travel_amount':
        title = `Travel to ${p.number || 1} place${(p.number || 1) > 1 ? 's' : ''}`;
        break;
      
      case 'listen_to_album':
        const albumSongs = p.songs || 1;
        title = `Listen to ${albumSongs} song${albumSongs > 1 ? 's' : ''}`;
        if (p.albumId) {
          const album = allAlbums.find(a => a && a.id === p.albumId);
          if (album) {
            title += ` from ${album.title}`;
          }
        }
        if (p.artistId) {
          const artist = allArtists.find(a => a && a.id === p.artistId);
          title += ` by ${artist ? artist.name : p.artistId}`;
        }
        break;
      
      default:
        // Fallback for unknown types
        if (p.requiredCount) {
          title = `Listen to ${p.requiredCount} song${p.requiredCount > 1 ? 's' : ''}`;
        } else {
          title = "Complete quest";
        }
        if (p.artistId) {
          const artist = allArtists.find(a => a && a.id === p.artistId);
          title += ` by ${artist ? artist.name : p.artistId}`;
        }
    }
  } else {
    // Fallback if template not found
    const fallbackCount = p.requiredCount || 1;
    title = `Listen to ${fallbackCount} song${fallbackCount > 1 ? 's' : ''}`;
    if (p.artistId) {
      const artist = allArtists.find(a => a && a.id === p.artistId);
      title += ` by ${artist ? artist.name : p.artistId}`;
    }
  }

  return title;
}

function renderQuestProgress(quest) {
  const done = quest.state.matchedRecordingIds.length;
  const total = quest.params.requiredCount || 1;

  return quest.state.status === "completed"
    ? "Completed"
    : `${done} / ${total} completed`;
}

function showQuest(quest) {
  const p = quest.params;
  const questArtist = p.artistId ? allArtists.find(a => a && a.id === p.artistId) : null;
  const template = allQuestTemplates.find(t => t.id === quest.templateId);
  
  const done = quest.state.matchedRecordingIds.length;
  const total = quest.params.requiredCount || 1;
  const progress = Math.round((done / total) * 100);
  
  let html = `
    <h1>${renderQuestTitle(quest)}</h1>
    <div class="quest-detail-header">
      <div class="status-badge ${quest.state.status}">${quest.state.status === 'completed' ? '✓ Completed' : quest.state.status === 'active' ? '⚡ Active' : quest.state.status}</div>
    </div>
    
    <div class="quest-progress-container">
      <div class="progress-bar-large">
        <div class="progress-fill" style="width: ${progress}%"></div>
      </div>
      <p class="progress-info">${done} of ${total} songs completed</p>
    </div>
  `;
  
  if (template) {
    html += `<p class="quest-template-type"><strong>Quest Type:</strong> ${template.type.replace(/_/g, ' ')}</p>`;
  }
  
  if (questArtist) {
    html += `<p><strong>Artist:</strong> <span class="link" onclick="showArtist(window._questArtist)">${questArtist.name}</span></p>`;
    window._questArtist = questArtist;
  }
  
  if (p.startYear !== undefined && p.endYear !== undefined) {
    html += `<p><strong>Time Period:</strong> ${p.startYear}–${p.endYear}</p>`;
  }
  
  if (p.genreId) {
    const genre = allGenres.find(g => g && g.id === p.genreId);
    if (genre) {
      html += `<p><strong>Genre:</strong> ${genre.name}</p>`;
    }
  }

  if (quest.reward && quest.reward.type === 'song' && quest.reward.entityId) {
    const rewardSong = allSongs.find(s => s && s.song_id === quest.reward.entityId);
    
    if (rewardSong) {
      const songArtists = (rewardSong.artist_ids && Array.isArray(rewardSong.artist_ids)) ? rewardSong.artist_ids.map(id => (allArtists || []).find(a => a && a.id === id)).filter(Boolean) : [];
      const artistNames = songArtists.map(a => a.name).join(", ");
      
      html += `<h3>Reward Song</h3><div class="items-list">`;
      html += `<div class="list-item" onclick="showSong(window._questRewardSong)">
        <img src="/images/song.png" alt="song">
        <div class="item-info">
          <div>${rewardSong.title || 'Unknown'}</div>
          <div class="subtitle">${artistNames} • ${rewardSong.variant || 'Unknown'} • ${rewardSong.year}</div>
        </div>
      </div>`;
      html += `</div>`;
      
      window._questRewardSong = rewardSong;
    }
  }
  
  // Show matched songs
  if (quest.state.matchedRecordingIds.length > 0) {
    html += `<h3>Matched Songs (${quest.state.matchedRecordingIds.length})</h3><div class="items-list">`;
    quest.state.matchedRecordingIds.forEach(songId => {
      const song = allSongs.find(s => s && s.song_id === songId);
      if (song) {
        const songArtists = (song.artist_ids && Array.isArray(song.artist_ids)) ? song.artist_ids.map(id => (allArtists || []).find(a => a && a.id === id)).filter(Boolean) : [];
        const artistNames = songArtists.map(a => a.name).join(", ");
        html += `<div class="list-item" onclick="showSong(window._matchedSongs['${songId}'])">
          <img src="/images/song.png" alt="song">
          <div class="item-info">
            <div>${song.title || 'Unknown'}</div>
            <div class="subtitle">${artistNames} • ${song.variant || 'Unknown'} • ${song.year}</div>
          </div>
          <div class="matched-indicator">✓</div>
        </div>`;
        window._matchedSongs = window._matchedSongs || {};
        window._matchedSongs[songId] = song;
      }
    });
    html += `</div>`;
  }

  getMainContent().innerHTML = html;
  
  const results = document.getElementById("results");
  if (results) results.innerHTML = "";
  navigationHistory.push({ type: "quest", data: quest });
  
  updateBackButton();
}

function goBack() {
  console.log('[goBack] called, navigationHistory length:', navigationHistory.length);
  if (navigationHistory.length <= 1) return;
  navigationHistory.pop(); // Remove current page
  const previous = navigationHistory[navigationHistory.length - 1];
  
  if (previous.type === "artist") {
    navigationHistory.pop();
    showArtist(previous.data);
  } else if (previous.type === "album") {
    navigationHistory.pop();
    showAlbum(previous.data);
  } else if (previous.type === "song") {
    navigationHistory.pop();
    showSong(previous.data);
  } else if (previous.type === "quest") {
    navigationHistory.pop();
    showQuest(previous.data);
  } else if (previous.type === "genre") {
    navigationHistory.pop();
    showGenre(previous.data);
  } else if (previous.type === "developer") {
    navigationHistory.pop();
    showDeveloperTab();
  } else if (previous.type === "collection") {
    showCollectionTab();
  } else if (previous.type === "profile") {
    showProfileTab();
  } else if (previous.type === "home") {
    getMainContent().innerHTML = `
      <h1>Music Quest</h1>
      <p>Select a quest or explore the catalog.</p>

      <div id="search">
        <input
          id="search-input"
          type="text"
          placeholder="Search artists, albums, or songs..."
        />
      </div>

      <div id="results"></div>
    `;
    setupSearchListener();
    updateBackButton();
  }
}

function updateBackButton() {
  const backBtn = document.getElementById("back-btn");
  if (!backBtn) {
    console.warn("Back button element not found");
    return;
  }
  if (navigationHistory.length > 1) {
    backBtn.style.display = "block";
  } else {
    backBtn.style.display = "none";
  }
}

function showSearchTab() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => tab.classList.remove('active'));
  tabs[0].classList.add('active');
  
  getMainContent().innerHTML = `
    <h1>Music Quest</h1>
    <p>Select a quest or explore the catalog.</p>

    <div id="search">
      <input
        id="search-input"
        type="text"
        placeholder="Search artists, albums, or songs..."
      />
    </div>

    <div id="results"></div>
  `;
  
  setupSearchListener();
  navigationHistory = [{ type: "home" }];
  updateBackButton();
}

function showCollectionTab() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => tab.classList.remove('active'));
  tabs[1].classList.add('active');
  
  // Get all completed quests
  const completedQuests = activeQuests.filter(q => q.state && q.state.status === 'completed');
  
  // Get all songs rewarded by completed quests
  const collectedSongs = completedQuests
    .filter(q => q.reward && q.reward.type === 'song' && q.reward.entityId)
    .map(q => allSongs.find(s => s && s.song_id === q.reward.entityId))
    .filter(Boolean);
  
  let html = `<h1>Your Collection</h1>`;
  
  if (collectedSongs.length > 0) {
    html += `<p>You have collected ${collectedSongs.length} song${collectedSongs.length !== 1 ? 's' : ''}.</p>`;
    html += `<div class="items-list">`;
    collectedSongs.forEach((song, idx) => {
      const songArtists = (song.artist_ids && Array.isArray(song.artist_ids)) ? song.artist_ids.map(id => (allArtists || []).find(a => a && a.id === id)).filter(Boolean) : [];
      const artistNames = songArtists.map(a => a.name).join(", ");
      html += `<div class="list-item" onclick="window.showCollectionSong(${idx})">
        <img src="/images/song.png" alt="song">
        <div class="item-info">
          <div>${song.title || 'Unknown'}</div>
          <div class="subtitle">${artistNames} • ${song.variant || 'Unknown'} • ${song.year}</div>
        </div>
      </div>`;
    });
    html += `</div>`;
  } else {
    html += `<p><em>You haven't collected any songs yet. Complete quests to unlock songs!</em></p>`;
  }
  
  getMainContent().innerHTML = html;
  
  // Store collection context
  window._collectionSongs = collectedSongs;
  
  navigationHistory = [{ type: "collection" }];
  updateBackButton();
}

window.showCollectionSong = (idx) => {
  if (window._collectionSongs && window._collectionSongs[idx]) {
    showSong(window._collectionSongs[idx]);
  }
};

async function showProfileTab() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => tab.classList.remove('active'));
  tabs[2].classList.add('active');

  const isLoggedIn = currentUser !== null;

  getMainContent().innerHTML = `
    <h1>Your Profile</h1>
    <div style="margin: 0.5rem 0 1rem 0">
      ${isLoggedIn 
        ? `<button id="logout-btn" class="primary-btn">Logout</button>`
        : `<button id="login-btn" class="primary-btn">Login with Google</button>`
      }
    </div>
    <div id="profile-content">${isLoggedIn ? '<p>Loading...</p>' : '<p><em>Please login to view your profile</em></p>'}</div>
    <div class="section-card">
      <h3>Clear stored memory</h3>
      <p class="muted">Clears local storage (preferences, cached settings, etc.).</p>
      <div class="button-row">
        <button id="clear-memory-btn" class="danger-btn">Clear memory</button>
        <span id="clear-memory-status" class="muted"></span>
      </div>
    </div>
    <div class="section-card">
      <h3>Developer mode</h3>
      <p class="muted">Show tools to erase caches and audit songs without quests.</p>
      <button id="developer-toggle-btn" class="primary-btn">${developerModeEnabled ? 'Disable developer mode' : 'Enable developer mode'}</button>
      <p class="muted" style="margin-top: 0.35rem;">${developerModeEnabled ? 'Developer tab is visible in the bottom bar.' : 'Enable to reveal the developer tab.'}</p>
    </div>
  `;

  if (isLoggedIn) {
    try {
      const fb = getFirebase();
      const userDoc = await fb.getDoc(fb.doc('users', currentUser.uid));
      const userData = userDoc.exists() ? userDoc.data() : {};
      
      const el = document.getElementById('profile-content');
      if (!el) return;

      const providerRows = (userData.providers || []).map(p => {
        const status = p.linked ? 'Linked' : 'Not linked';
        return `<div class="list-item">
          <div class="item-info">
            <div>${p.name}</div>
            <div class="subtitle">${status}</div>
          </div>
          <div>
            <button class="primary-btn" disabled>${p.linked ? 'Manage' : 'Link'}</button>
          </div>
        </div>`;
      }).join('');

      el.innerHTML = `
        <p><strong>Email:</strong> ${currentUser.email}</p>
        <p><strong>User ID:</strong> ${currentUser.uid}</p>
        <h3>Linked Accounts</h3>
        <div class="items-list">${providerRows || '<p><em>No music accounts linked yet</em></p>'}</div>
      `;
    } catch (err) {
      console.error('Failed to load profile', err);
      const el = document.getElementById('profile-content');
      if (el) el.innerHTML = `<p><em>Could not load profile data</em></p>`;
    }
  }

  navigationHistory = [{ type: "profile" }];
  updateBackButton();

  // Wire up login/logout buttons
  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) {
    loginBtn.onclick = async () => {
      // Show loading state
      loginBtn.disabled = true;
      loginBtn.textContent = 'Initializing...';
      
      // Wait for Firebase to be initialized (with timeout)
      let attempts = 0;
      while (!window.firebaseInitialized && attempts < 20) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      
      try {
        const fb = getFirebase();
        console.log('[Login] Firebase state:', { 
          auth: !!fb.auth, 
          googleProvider: !!fb.googleProvider,
          googleProviderType: fb.googleProvider ? fb.googleProvider.constructor.name : 'undefined'
        });
        
        // Check if Firebase is initialized
        if (!window.firebaseExports || !fb.auth || !fb.googleProvider) {
          loginBtn.disabled = false;
          loginBtn.textContent = 'Login with Google';
          alert('Firebase authentication is not available. Check browser console for details.');
          console.error('[Login] Firebase not initialized:', { 
            firebaseExports: !!window.firebaseExports, 
            auth: !!fb.auth, 
            googleProvider: !!fb.googleProvider,
            firebaseSDK: typeof firebase
          });
          return;
        }

        loginBtn.textContent = 'Opening login...';
        console.log('[Login] Calling signInWithPopup with provider:', fb.googleProvider);
        const result = await fb.signInWithPopup(fb.googleProvider);
        currentUser = result.user;
        
        // Create user document if it doesn't exist
        if (fb.db && fb.doc && fb.getDoc && fb.setDoc) {
          const userRef = fb.doc('users', result.user.uid);
          const userDoc = await fb.getDoc(userRef);
          if (!userDoc.exists()) {
            await fb.setDoc(userRef, {
              email: result.user.email,
              displayName: result.user.displayName,
              createdAt: new Date(),
              providers: []
            });
          }
        }
        
        showProfileTab();
      } catch (err) {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login with Google';
        console.error('Login failed:', err);
        if (err.code === 'auth/popup-closed-by-user') {
          // User closed the popup, don't show error
          return;
        }
        alert('Login failed: ' + err.message);
      }
    };
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      try {
        const fb = getFirebase();
        await fb.signOut();
        currentUser = null;
        showProfileTab();
      } catch (err) {
        console.error('Logout failed:', err);
      }
    };
  }

  const developerToggleBtn = document.getElementById('developer-toggle-btn');
  if (developerToggleBtn) {
    developerToggleBtn.onclick = () => {
      const next = !developerModeEnabled;
      setDeveloperMode(next);

      // If the developer tab was active and we just disabled it, return to Search
      const devTabButton = document.getElementById('dev-tab-btn');
      if (!next && devTabButton && devTabButton.classList.contains('active')) {
        showSearchTab();
      }

      showProfileTab();
    };
  }

  const clearMemoryBtn = document.getElementById('clear-memory-btn');
  if (clearMemoryBtn) {
    clearMemoryBtn.onclick = () => {
      const statusEl = document.getElementById('clear-memory-status');
      const setStatus = (msg) => {
        if (statusEl) statusEl.textContent = msg;
      };

      setStatus('Clearing...');
      clearMemoryBtn.disabled = true;

      try {
        localStorage.clear();
        // Keep developer mode on by default after clearing
        setDeveloperMode(true);
        setStatus('Memory cleared.');
        setTimeout(() => setStatus(''), 3000);
      } catch (err) {
        console.error('Local storage clear failed', err);
        setStatus(`Failed: ${err.message}`);
      } finally {
        clearMemoryBtn.disabled = false;
      }
    };
  }
}

function showDeveloperTab() {
  if (!developerModeEnabled) {
    alert('Enable developer mode in your profile to access these tools.');
    return;
  }

  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => tab.classList.remove('active'));
  const devTabButton = document.getElementById('dev-tab-btn');
  if (devTabButton) devTabButton.classList.add('active');

  getMainContent().innerHTML = `
    <h1>Developer Mode</h1>
    <p class="muted">Utilities for cache management and quest coverage checks.</p>

    <div class="section-card">
      <h3>Erase cache</h3>
      <p class="muted">Clears browser caches, unregisters service workers, requests a server cache reset, and reloads data.</p>
      <div class="button-row">
        <button id="erase-cache-btn" class="danger-btn">Erase cache</button>
        <span id="erase-cache-status" class="muted"></span>
      </div>
    </div>

    <div class="section-card">
      <h3>Reset quest progress</h3>
      <p class="muted">Resets all quest progress to the beginning (clears matched songs and completion status).</p>
      <div class="button-row">
        <button id="reset-quests-btn" class="danger-btn">Reset quests</button>
        <span id="reset-quests-status" class="muted"></span>
      </div>
    </div>

    <div class="section-card">
      <h3>Songs without quests</h3>
      <p class="muted">Recordings that are not rewarded by or matched to any quest.</p>
      <div id="songs-without-quests"></div>
      <div class="button-row" style="margin-top: 0.75rem;">
        <button id="refresh-songs-without-quests" class="secondary-btn">Refresh list</button>
      </div>
    </div>

    <div class="section-card">
      <h3>Erase stored memory</h3>
      <p class="muted">Clears local storage and keeps developer mode enabled.</p>
      <div class="button-row">
        <button id="erase-storage-btn" class="secondary-btn">Erase stored memory</button>
        <span id="erase-storage-status" class="muted"></span>
      </div>
    </div>
  `;

  const eraseBtn = document.getElementById('erase-cache-btn');
  if (eraseBtn) eraseBtn.onclick = eraseCache;

  const resetQuestsBtn = document.getElementById('reset-quests-btn');
  if (resetQuestsBtn) {
    resetQuestsBtn.onclick = async () => {
      const statusEl = document.getElementById('reset-quests-status');
      const setStatus = (msg) => {
        if (statusEl) statusEl.textContent = msg;
      };

      if (!confirm('Reset all quest progress? This cannot be undone.')) {
        return;
      }

      setStatus('Resetting...');
      resetQuestsBtn.disabled = true;

      try {
        const res = await fetch('/developer/quests/reset', { method: 'POST' });
        const data = await res.json();
        
        if (data.success) {
          await loadAllData();
          await loadQuests();
          renderSongsWithoutQuests();
          setStatus('Quests reset successfully.');
          setTimeout(() => setStatus(''), 3000);
        } else {
          setStatus(`Failed: ${data.error || 'Unknown error'}`);
        }
      } catch (err) {
        console.error('Quest reset failed', err);
        setStatus(`Failed: ${err.message}`);
      } finally {
        resetQuestsBtn.disabled = false;
      }
    };
  }

  const refreshBtn = document.getElementById('refresh-songs-without-quests');
  if (refreshBtn) refreshBtn.onclick = renderSongsWithoutQuests;

  const eraseStorageBtn = document.getElementById('erase-storage-btn');
  if (eraseStorageBtn) eraseStorageBtn.onclick = eraseStoredMemory;

  navigationHistory = [{ type: "developer" }];
  updateBackButton();
  renderSongsWithoutQuests();
}


// Listen for auth state changes
function initAuthListener() {
  const fb = getFirebase();
  if (fb.onAuthStateChanged) {
    fb.onAuthStateChanged((user) => {
      currentUser = user;
      console.log('Auth state changed:', user ? user.email : 'Not logged in');
    });
  } else {
    console.warn('Firebase auth not available yet, will retry...');
    // Retry after Firebase initialization
    setTimeout(initAuthListener, 500);
  }
}
initAuthListener();

// Expose functions to window for HTML onclick handlers
console.log('[app.js] About to expose functions to window');
window.showSearchTab = showSearchTab;
window.showCollectionTab = showCollectionTab;
window.showProfileTab = showProfileTab;
window.showDeveloperTab = showDeveloperTab;
window.showArtist = showArtist;
window.showAlbum = showAlbum;
window.showSong = showSong;
window.showGenre = showGenre;
window.showQuest = showQuest;
window.goBack = goBack;
window.markSongListened = markSongListened;
console.log('[app.js] Functions exposed to window, goBack is:', typeof window.goBack);

// Fallback in case the initial visibility set runs before layout is ready
ensureDeveloperTabVisible();
