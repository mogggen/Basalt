# Basalt

Obsidian-flavoured markdown vault as a desktop **Electron** app (the same UI also runs as a local web server).

## Run

```sh
npm install
npm start          # Electron app (Linux: uses --no-sandbox)
npm run web        # browser → http://localhost:3000
```

- Notes live in `./notes/` (packaged Electron uses the app user-data folder) — override with `NOTES_DIR=/path/to/vault`
- **Vim motions** are on by default (CodeMirror vim keymap)
- Notes **autosave in vim normal mode** (not while inserting) and **renumber ordered lists**
- Images, tables, fenced code, and mermaid render **inline** when the cursor is not on that block (click the preview to edit)
- **Ctrl+N** creates `Unnamed.md` (does not open a new window)
- **Ctrl+B** bold, **Ctrl+I** italic, **Ctrl+U** underline, **Ctrl+Shift+X** strikethrough
- Paste HTML from a browser or word processor is converted to markdown
- **Import / Export** zip or markdown; **Share** uploads an encrypted copy to [wormhole.app](https://wormhole.app) and shows a QR code plus a share button

## Tests & packaging

```sh
npm test
npm run dist    # local Electron build
```

GitHub Actions runs unit tests on every push/PR, and builds a Linux AppImage, macOS zip, and Windows installer on version tags (`v*`) or manual workflow dispatch.
