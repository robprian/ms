# MuseAI EN — English portable build

A standalone, portable Windows build of the **MuseAI** AI-companion tools:
**Background · Chat · Adventure · Bond · Settings**.

- Frontend: the client code from [yejiming/dsh-museai-tavern](https://github.com/yejiming/dsh-museai-tavern),
  translated from Chinese to English and adapted to run standalone (no DeepSeek Harness required).
- Backend: the Tauri (Rust) app core from [yejiming/MuseAI](https://github.com/yejiming/MuseAI),
  pinned at upstream SHA `85c1ea76c565e697f510cc45d82ebcb352458dd6`.

## Download & run

1. Go to the [Releases](../../releases) page and download
   `MuseAI-portable-win64-v<version>-en.zip`.
2. Unzip anywhere — no installer, no admin rights needed.
3. Run `MuseAI.exe`.

**Requirements:** Windows 10 1803+ / 11 with **WebView2**
(preinstalled on Windows 10 1803 and later / Windows 11).

## First-run model setup

The app ships without API keys. On first launch:

1. Open **Settings → Model Configuration**.
2. Click **Add model** (or edit a preset) and fill in:
   - **Name** (e.g. `OpenAI`), **Provider** (e.g. `OpenAI`)
   - **Interface**: `OpenAI-compatible` or `Anthropic-compatible`
   - **Base URL** (e.g. `https://api.openai.com/v1`)
   - **API key**, **Model** (e.g. `gpt-4o-mini`)
3. Press **Test connection** to verify, then select the model with the radio button.

Built-in presets: OpenAI (`https://api.openai.com/v1`, `gpt-4o-mini`) and
DeepSeek (`https://api.deepseek.com/v1`, `deepseek-chat`).

## Data storage

User data (sessions, settings, model configs) is stored under:

```
%APPDATA%\com.robprian.museai-en
```

Delete that folder to reset the app to factory defaults.

## DSH plugin note

If you run the **DeepSeek Harness** client, use the original plugin instead:
[yejiming/dsh-museai-tavern](https://github.com/yejiming/dsh-museai-tavern).
This portable build is for everyone else — same tools, no harness required.

## Build from source

Pushing a tag like `v0.9.8` triggers the GitHub Actions workflow
(`.github/workflows/release.yml`), which:

1. Fetches the pinned upstream Tauri backend (`src-tauri`) from
   `yejiming/MuseAI` at the SHA recorded in the workflow.
2. Builds the Windows NSIS bundle.
3. Packages `MuseAI-portable-win64-v<version>-en.zip`.
4. Publishes a GitHub release with the ZIP and the installer.

## Translation notes

- All UI strings and the Settings/System default prompts were translated from
  Chinese to English.
- Runtime placeholders (e.g. character-card / world-book variable names the
  backend expects) were preserved — translation never changes wire formats.

## Credits

- Client/tools: [yejiming/dsh-museai-tavern](https://github.com/yejiming/dsh-museai-tavern)
- Tauri backend: [yejiming/MuseAI](https://github.com/yejiming/MuseAI)
- English adaptation + portable packaging: robprian
