# DeskTag

> 轻量、跨平台、支持端到端加密 WebDAV 云同步的独立开源桌面贴边待办与便签工具。  
> **An independent, open-source, lightweight cross-platform edge-docked sticky-note & todo companion with E2EE WebDAV cloud sync.**

DeskTag 基于 **Tauri v2 + Rust + React 19 + TypeScript** 构建，面向 **Windows、macOS (Apple Silicon & Intel) 与 Android**，兼顾极低内存占用、贴边无打扰交互与安全可控的自托管云同步。

---

## 核心特性 / Key Features

### 1. 贴边停靠与轻盈交互 (Edge Docking & Side Tabs)
- **6 种贴边停靠模式**：支持 `右侧 / 左侧 / 顶部` × `外露页签停靠 / 完全贴边隐藏`（`right_tabs` / `right_hide` / `left_tabs` / `left_hide` / `top_tabs` / `top_hide`），自动适配多显示器工作区边界并防止跨屏溢出。
- **外露侧边页签栏**：无需展开主面板即可一眼切换「待办」「便签」「四象限」与自定义清单；支持自定义页签统一宽度、鼠标贴边自动滑出/收起、窗口置顶与系统托盘驻留。
- **全局快捷键与低内存优化**：默认 `Alt+Shift+D` 展开/收起面板、`Alt+Shift+N` 快速新建待办；Windows 端启用 WebView2 隐藏态低内存策略，日常常驻轻盈省资源。

### 2. 待办管理与自然语言识别 (Todos, Subtasks & Custom Lists)
- **子任务与进度胶囊**：每个待办支持多级子任务、独立子任务备注与图片附件，列表内实时展示可视化进度胶囊（如 `2/5`）。
- **自然语言识别 (NL Parser) & 批量粘贴**：输入如「明天下午3点 评审方案 紧急」自动提取日期、时间与优先级；支持多行文本一键批量创建待办。
- **自定义清单**：自由创建、重命名、配色、排序清单，并一键固定到外露侧边页签栏。
- **标签、筛选与全局搜索**：支持优先级（高/中/低）、标签、排序、归档与跨待办/便签快速检索（`Ctrl+K`）。

### 3. 普通与时间轴便签 (Normal & Timeline Notes)
- **双模式便签**：支持常规结构化便签（Normal）与按时间倒序记录的流水账/日志便签（Timeline）。
- **结构化编辑体验**：支持可折叠标题、自动目录大纲（Outline）、Markdown 表格、图片/文件/音频附件，以及通过 `@` 双向关联待办与便签。
- **独立便签窗与隐私锁**：支持将常用便签弹出为独立窗口查看，支持单篇便签分组隐私加锁保护。

### 4. 日历、四象限与智能提醒 (Calendar, Quadrants & Reminders)
- **独立日历窗口**：内置完整中国**农历、传统节日与二十四节气**，直观查看每日待办安排。
- **四象限视图 (Eisenhower Matrix)**：按「重要且紧急 / 重要不紧急 / 紧急不重要 / 不重要不紧急」高效分流任务。
- **标准与重复提醒 + 免打扰时段**：支持单次及按日/周/月/年/自定义周期的重复提醒、系统原生通知与通知中心气泡，并可设置免打扰（DND）静默时段。

### 5. 11 款原创内置主题与排版定制 (Themes & Typography)
- 内置 **11 款原创主题皮肤**（10 款浅色 + 1 款深色）：
  `晨光亚麻` · `牛皮手账` · `晴云杏桃` · `竹影青露` · `琥珀乌龙` · `烘焙摩卡` · `暮色樱云` · `银杏微光` · `冰川海雾` · `素墨极简` · `暗夜余烬`
- 支持面板透明度调节、字号缩放与 6 套中英文字体方案（系统默认 / 微软雅黑 / 苹方·思源黑体 / 温润宋体 / 手写楷体 / 等宽清晰）。

### 6. 本地备份与多格式导出 (Local Backup & Export)
- 支持自定义本地数据存储目录，一键导出/恢复含附件与配置的本地备份包（JSON / ZIP）。
- 支持将待办与便签导出为 **Word (`.docx`)、PDF、HTML、Markdown (`.md`) 与 CSV**。

---

## 端到端加密 WebDAV 云同步 (E2EE WebDAV Cloud Sync)

借鉴 [Magpie](https://github.com/yetone/magpie) 的高可靠 WebDAV 同步设计思路，DeskTag 内置零依赖 Rust 同步引擎，数据主权完全归你所有：

- **端到端加密 (E2EE)**：采用 **AES-256-GCM** 认证加密 + **PBKDF2-SHA256**（默认 `600,000` 次迭代，每次封包生成独立 16 字节随机 Salt 与 12 字节随机 Nonce），远端仅存储密文封包 `desktag.desktag-backup`，云盘服务商无法读取任何明文内容。
- **逐项三方合并 + 删除墓碑 (3-Way Merge with Tombstones)**：基于本地、远端与上次同步基线逐条比对合并待办、清单、便签与提醒，配合墓碑机制避免「已删内容复活」或多设备并发编辑互相覆盖；内建跨进程文件锁 `sync.lock` 与同步前自动轮转快照。
- **广泛兼容主流 WebDAV 服务**：内置预置配置与协议兼容处理（Basic/Digest 认证、ETag/`If-Match`/`If-None-Match` 条件请求、`Retry-After` 退避重试、短写完整性校验）：
  - **坚果云 (Nutstore)**
  - **123云盘 (123pan)**
  - **TeraCLOUD / InfiniCLOUD**
  - **群晖 Synology NAS**
  - **Alist / OpenList**
  - **Nextcloud** 及任意标准 WebDAV 服务
- **同步预览与一键撤销 (Preview & UndoSync)**：支持同步前预览新增/修改/删除/冲突明细；同步后如结果不符预期，可一键 `UndoSync` 回滚至同步前本地状态，亦提供「强制上传」与「从云端恢复」应急工具。
- **一行口令快速配置移动端 (`desktag-sync:...`)**：在桌面端导出 `desktag-sync:<base64url>` 配置串，粘贴至 Android 或其他桌面端即可一键填入 WebDAV 地址与凭据；**出于安全设计，配置串绝不包含端到端加密口令**，需在新设备手动输入加密口令后解锁同步。
- **自动同步策略**：启动延迟 20 秒检查、本地变更 5 秒防抖自动推送，以及可配置的定时轮询（手动 / 3 / 15 / 30 / 60 分钟）。

---

## 支持平台与下载 / Supported Platforms

| 平台 (Platform) | 架构 / 产物 (Architectures & Artifacts) | 说明 (Notes) |
| --- | --- | --- |
| **Windows** | `x64` — NSIS 安装包 (`.exe`)、MSI 安装包 (`.msi`)、绿色便携版 (`.exe`) | Windows 10/11（需系统内置 WebView2） |
| **macOS** | Apple Silicon (`aarch64`) & Intel (`x86_64`) — `.dmg` | 首次打开未签名版本若提示已损坏，请执行 `xattr -cr /Applications/DeskTag.app` |
| **Android** | ARM64 (`aarch64`) — `.apk` | 移动端专属底部导航与自适应触控布局 |

前往本仓库的 [Releases](../../releases) 页面即可下载各平台预编译安装包。

---

## 本地开发与构建 / Local Development & Build

### 环境要求 (Prerequisites)
- **Node.js** `22+` 与 **pnpm** (`12+`)
- **Rust** `stable` 工具链（含 `cargo` / `rustup`）
- 平台依赖：
  - **Windows**：Visual Studio Build Tools (MSVC) + WebView2 Runtime
  - **macOS**：Xcode Command Line Tools
  - **Android**：JDK 17 + Android SDK + Android NDK r27（并配置 `JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME`）

### 常用命令 (Commands)

```bash
# 1. 安装前端依赖 / Install dependencies
pnpm install

# 2. 启动桌面开发模式 / Start desktop dev mode (with HMR)
pnpm tauri dev

# 3. 类型检查、前端构建与 Rust 单元测试 / Typecheck, frontend build & Rust tests
pnpm typecheck
pnpm build
cargo test --lib --manifest-path src-tauri/Cargo.toml

# 4. 构建当前桌面平台安装包 / Build desktop release bundle (Windows / macOS)
pnpm tauri build

# 5. 初始化并构建 Android ARM64 APK / Build Android ARM64 APK
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
pnpm tauri android init --ci
pnpm tauri android build --apk --target aarch64
```

---

## English Overview

**DeskTag** is an independent, open-source, cross-platform edge-docked sticky-note & todo companion powered by **Tauri v2, Rust, React 19, and TypeScript**, targeting **Windows, macOS (Apple Silicon & Intel), and Android**.

- **Desktop Edge Docking**: 6 docking modes (`Left / Right / Top` × `Protruding Side Tabs / Full Auto-Hide`), multi-monitor work-area clamping, system tray, and global hotkeys (`Alt+Shift+D`, `Alt+Shift+N`).
- **Productivity Suite**: Todos with subtasks, progress pills, natural-language date/priority parsing, batch paste, custom pinned lists, Normal & Timeline notes (collapsible headings, outline, Markdown tables, attachments, `@` cross-links, privacy lock), standalone Calendar with Chinese lunar dates & solar terms, Four Quadrants (Eisenhower Matrix), standard & recurring reminders with DND quiet hours, 11 original built-in themes, and local backup/export to **Word (`.docx`), PDF, HTML, Markdown, and CSV**.
- **E2EE WebDAV Sync**: Client-side `AES-256-GCM` + `PBKDF2-SHA256` (600,000 iterations) encryption, 3-way per-item merge with tombstones, hardened compatibility for Nutstore, 123pan, TeraCLOUD, Synology NAS, Alist/OpenList, and Nextcloud, plus Dry-Run `Preview`, one-click `UndoSync`, and `desktag-sync:...` one-paste mobile onboarding (excluding the encryption passphrase).

---

## 独立声明 / Independence Disclaimer

DeskTag 是一个完全独立的开源项目，与任何第三方待办事项、便签或效率类商业软件均无隶属、合作或背书关系。  
*DeskTag is an independent open-source project and is not affiliated with, endorsed by, or associated with any third-party sticky-note or todo applications.*

---

## 致谢与开源协议 / Acknowledgements & License

- WebDAV 端到端加密与三方合并同步架构思路致敬 **[yetone/magpie](https://github.com/yetone/magpie)**（MIT License）。
- 本项目基于 **[MIT License](./LICENSE)** 开源发布，欢迎提交 Issue 与 Pull Request。
