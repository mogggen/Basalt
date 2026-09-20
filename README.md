# Basalt

Obsidian-flavoured markdown vault as a desktop **Electron** app (the same UI also runs as a local web server).

## Run

```sh
npm install
npm start          # Electron app (Linux: uses --no-sandbox)
npm run web        # browser → http://localhost:3000
```

- Notes live in `./notes/` — override with `NOTES_DIR=/path/to/vault npm start`
- **Vim motions** are on by default (CodeMirror vim keymap)
- Notes **autosave** and **renumber ordered lists** as you go
- Images, tables, fenced code, and mermaid render **inline** when the cursor is not on that block (click the preview to edit)
- **Ctrl+N** creates `Unnamed.md` (does not open a new window)
- **Ctrl+B** bold, **Ctrl+I** italic, **Ctrl+U** underline, **Ctrl+Shift+X** strikethrough
- **Import / Export** zip or markdown; **Share** uploads an encrypted copy to [wormhole.app](https://wormhole.app) and shows a QR code plus a share button
