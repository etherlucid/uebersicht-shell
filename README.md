# uebersicht-shell

An interactive desktop terminal and `fastfetch` widget for [Übersicht](https://tracesof.net/uebersicht/) on macOS, styled with an inherited **iTerm2 color theme**.

---

## Features

- **iTerm2 Theme Integration**: Automatically styled with the exact color palette (background, foreground, cursor, and full 16-color ANSI spectrum) from your terminal profile.
- **PTY ANSI Engine**: Renders full-color terminal output (`fastfetch`, `git status`, `ls -G`, `top -l 1`) in rich styled text.
- **Single Command & Interactive Modes**: Configure a recurring command (e.g. customized `fastfetch`) or run as an interactive shell prompt (`❯`).
- **Command History & Lifecycle**: Up/Down arrow key history, active execution state indicator, and cancel support (`Esc` / `Ctrl+C`).
- **Draggable & Resizable**: Drag by the window header and resize using the bottom-right grip. Position and size persist in `localStorage`.
- **Zero Background Daemons**: Runs 100% inside Übersicht's standard native environment—no open ports, no listening sockets, fully enterprise EDR compliant.

---

## Requirements

- [Übersicht](https://tracesof.net/uebersicht/)
- [fastfetch](https://github.com/fastfetch-cli/fastfetch) (recommended for the default system spec display):
  ```bash
  brew install fastfetch
  ```

---

## Installation

1. Clone or copy the widget to your Übersicht widgets folder:
   ```bash
   git clone https://github.com/etherlucid/uebersicht-shell.git
   cp -r uebersicht-shell/shell.widget "$HOME/Library/Application Support/Übersicht/widgets/"
   ```

   *Or symlink:*
   ```bash
   ln -s "$(pwd)/uebersicht-shell/shell.widget" "$HOME/Library/Application Support/Übersicht/widgets/shell.widget"
   ```

2. (Optional) Copy `main.css` to `~/Library/Application Support/Übersicht/widgets/main.css` for shared font/backdrop styling.

3. Refresh Übersicht.

---

## Configuration

Customize colors, typography, single command vs interactive prompt, and refresh frequency in `shell.widget/lib/config.js`.
