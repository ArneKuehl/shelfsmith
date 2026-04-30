# Icons

Tauri benötigt PNG/ICNS/ICO-Icons für den Bundle-Build. Die einfachste Variante:

```bash
npx @tauri-apps/cli icon path/to/source.png
```

Das erzeugt automatisch alle in `tauri.conf.json` referenzierten Größen (`32x32.png`,
`128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`).

Für `npm run tauri dev` reicht ein 1024×1024 PNG als Quelle.
