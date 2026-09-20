# Run it

```sh
mkdir basalt && cd basalt
# …save the files above…
npm install     # postinstall copies browser builds from node_modules
npm start       # → http://localhost:3000
```

- Notes live in `./notes/` — change with `NOTES_DIR=/path/to/vault npm start`
- Expose on your LAN: `HOST=0.0.0.0 PORT=3000 npm start` (no auth — keep it off the public internet)
- **Wormhole**: install the CLI once (`pip install magic-wormhole`, `brew install magic-wormhole`, or `apt install magic-wormhole`). The Wormhole button then zips the vault, runs `wormhole send`, and shows the code in a modal; Cancel kills the transfer. The ZIP button works without it.

## Notes & next steps

- Rendering happens **server-side** (marked + highlight.js) and mermaid client-side — one source of truth, no bundler needed.
- The list fixer only rewrites numbers on lines that are already ordered items, and skips fenced code blocks.
- Sensible forks: `[[wiki-links]]` + backlink pane, folder tree, `POST /api/wormhole` accepting a receiver, or websockets instead of debounced autosave. The API is tiny enough to extend in an afternoon.

Want me to add any of those (wiki-links are the most Obsidian-like next step), or package it as a single `npx basalt-serve` runnable?
