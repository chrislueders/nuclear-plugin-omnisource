# nuclear-plugin-omnisource

A plugin for [Nuclear Music Player](https://nuclear.js.org) that fans out every search to multiple streaming and metadata sources simultaneously — YouTube, SoundCloud, Bandcamp, and MusicBrainz — and picks the best match automatically.

**Also brings YouTube playlist search to Nuclear's Albums tab**, which is not natively supported.

---

## Features

- **Multi-source streaming** — searches YouTube, SoundCloud, and Bandcamp in parallel for every track; scores candidates by title similarity, duration match, and source quality; plays the best result
- **Multi-source metadata** — combines MusicBrainz, Bandcamp, and SoundCloud results for artist/album/track searches with deduplication
- **YouTube playlist search** — find and browse YouTube playlists directly from Nuclear's Albums tab (see below)
- **Direct stream shortcuts** — tracks from Bandcamp albums and YouTube playlists stream instantly without a second search

---

## Installation

Nuclear loads plugins from a specific directory on your system. Copy the plugin folder there and restart Nuclear.

### macOS

```
~/Library/Application Support/com.nuclearplayer/plugins/nuclear-plugin-omnisource/1.0.0/
```

### Linux

```
~/.config/nuclear/plugins/nuclear-plugin-omnisource/1.0.0/
```

### Windows

```
%APPDATA%\nuclear\plugins\nuclear-plugin-omnisource\1.0.0\
```

**Steps:**

1. Download or clone this repository
2. Copy the entire folder contents into the path above (create the directories if they don't exist)
3. Start (or restart) Nuclear
4. Go to **Settings → Sources**
5. Under **Streaming**, select **OmniSource**
6. Under **Metadata**, select **OmniSource**

---

## YouTube Playlist Search

Nuclear does not have a native Playlists tab in search. OmniSource works around this by surfacing YouTube playlists as albums in the **Albums tab**.

### How to find playlists

1. Open Nuclear and go to the **Search** view
2. Search for any term (e.g. `blackgaze`, `lofi hip hop`, `dark ambient`)
3. Click the **Albums** tab
4. Playlists from YouTube appear alongside regular albums — they are marked with a **▶** prefix in the title and show **YouTube Playlist** as the artist

Example:

| Title | Artist |
|-------|--------|
| ▶ Blackgaze / Blackened Shoegaze | YouTube Playlist |
| ▶ Blackgaze/Post Black Metal playlist | YouTube Playlist |
| The Black Gaze | widowmaker *(Bandcamp album)* |

### Playing a playlist

Click any playlist entry to open it. Nuclear loads all tracks from the playlist. Click any track or use **Play All** to start playback. Each track streams directly from YouTube.

---

## Sources used

| Source | Streaming | Artist search | Album search | Track search |
|--------|-----------|---------------|--------------|--------------|
| YouTube | ✓ | — | ✓ (playlists) | — |
| SoundCloud | ✓ | ✓ | — | ✓ |
| Bandcamp | ✓ | ✓ | ✓ | ✓ |
| MusicBrainz | — | ✓ | ✓ | ✓ |

---

## Requirements

- [Nuclear Music Player](https://nuclear.js.org) — any recent version
- Internet connection (all sources are fetched live; no API keys required)

---

## Notes

- YouTube playlist data is retrieved by scraping YouTube's search page. If YouTube changes their page structure, playlist search may break until the plugin is updated.
- MusicBrainz has a built-in rate limit of ~1 request/second; heavy searching may be slightly slower because of this.

---

## License

AGPL-3.0-only
