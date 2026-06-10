# pi-web × Northstar Suite 安裝與使用手冊

本文件對應 Northstar 控制面操作場景，包含：
- 安裝需求
- 安裝程序（Windows / Linux / macOS）
- 使用手冊
- consumer repo 從 0 到 1 的一條龍流程（搭配 Northstar skill）

---

## 1) 安裝需求

- OS：Windows / Linux / macOS
- Node.js：`>= 22.22.2`
- npm 可用
- 建議安裝 Git + GitHub CLI（`gh`）
- 若要在 pi-web 內執行 Northstar issue actions，需可定位 Northstar 程式根目錄（`NORTHSTAR_ROOT`）

---

## 2) 安裝程序

## A. 使用 release 安裝包（推薦給 operator）

你可以使用 `northstar-suite` 發行資產：
- `northstar-suite-windows.zip`
- `northstar-suite-linux.tar.gz`

解壓後會有：
- `install.ps1`
- `install.sh`
- `packages/*.tgz`

### Windows

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install.ps1
pi-web
```

### Linux / macOS

```bash
chmod +x install.sh
./install.sh
pi-web
```

> 安裝包是跨平台 installer；若本機 npm cache 無相依套件，安裝時仍可能需要網路。

## B. 從原始碼安裝（開發者）

```bash
git clone https://github.com/paulpai0412/pi-web.git
cd pi-web
npm install
npm run build -- --webpack
```

---

## 3) 啟動與設定

### 3.1 `northstar setup` 需要的環境設定

若你會在 consumer repo 走 `/northstar-setup` + `/northstar-execute`，建議先設定：
- `NORTHSTAR_ROOT`：Northstar 程式根目錄（pi-web issue action 也依賴它）
- `GITHUB_TOKEN`：GitHub API token（或至少先 `gh auth login`）
- `NORTHSTAR_CONFIG`（可選）：預設 consumer config 路徑

#### Linux / macOS

```bash
export NORTHSTAR_ROOT=/path/to/northstar
export GITHUB_TOKEN="$(gh auth token)"
export NORTHSTAR_CONFIG=/path/to/consumer-repo/.northstar.yaml  # optional
```

#### Windows PowerShell

```powershell
$env:NORTHSTAR_ROOT = "D:\path\to\northstar"
$env:GITHUB_TOKEN = (gh auth token)
$env:NORTHSTAR_CONFIG = "D:\path\to\consumer-repo\.northstar.yaml"  # optional
```

> `runtime.host_adapter` 若選 codex / opencode / pi，請先在該 SDK 完成登入或金鑰設定，再跑 `npm run skill:doctor`。

### 3.2 一般啟動

```bash
pi-web
```

### 3.3 指定 Northstar 根目錄啟動（建議）

Issue action / run route 需要 Northstar CLI 來源路徑；請設定 `NORTHSTAR_ROOT`。

#### Linux / macOS

```bash
export NORTHSTAR_ROOT=/path/to/northstar
pi-web
```

#### Windows PowerShell

```powershell
$env:NORTHSTAR_ROOT = "D:\path\to\northstar"
pi-web
```

啟動後預設開啟：`http://localhost:30141`

---

## 4) 使用手冊（Northstar Board）

1. 在 pi-web 選擇 consumer repo 目錄（該目錄需有 `.northstar.yaml`）。
2. 進入 Northstar workspace。
3. 檢視 lifecycle columns、issue cards、timeline。
4. 透過 Issue Drawer 執行操作（如 Start/Reconcile/Release/Pause/Resume/Retry Sync）。
5. 若 issue 進入 `release_pending`，由 operator 進行核准放行。

---

## 5) Consumer repo 一條龍（由無到有）

以下用 `consumer-repo` 當例子。

### Step 0 — 先完成安裝

先完成 Northstar + skill 安裝，才執行 setup。

### Step 1 — 安裝 Northstar + skill

在 Northstar repo：

```bash
npm install
npm run skill:sync
npm run skill:install-agents
```

### Step 2 — 生成 consumer 設定

```bash
npm run skill:render-config -- --cwd /path/to/consumer-repo --write --confirmed
npm run skill:doctor -- --config /path/to/consumer-repo/.northstar.yaml --require-ready
```

### Step 3 — 在 agent 執行 `/northstar-setup`

先讓 setup 流程確認：
- config 位置（`.northstar.yaml`）
- `runtime.host_adapter`
- GitHub credential（`GITHUB_TOKEN` 或 gh fallback）
- 是否啟用 Project viewer

### Step 4 — 用 skill 做規劃到 issue

在 consumer repo 的 agent 對話中執行：

- `/northstar-plan`
- `/northstar-grill`
- `/northstar-to-spec`
- `/northstar-to-plan`
- `/northstar-to-issues`

### Step 5 — 執行

- `/northstar-execute`
- 或 CLI watch：

```bash
npm run northstar -- watch --config /path/to/consumer-repo/.northstar.yaml --max-cycles 40 --interval-ms 5000
```

### Step 6 — 在 pi-web 觀察與操作

- 打開 consumer repo 對應 board
- 監看 issue state / timeline
- 視需要執行 Pause（quarantine）或 Resume

### Step 7 — 收斂與驗證

- `/northstar-observe`
- `/northstar-report`
- 用 `gh issue view` / `gh pr view` 交叉驗證結果

---

## 6) 疑難排解

- 看不到 Northstar 資料：先確認 `.northstar.yaml` 路徑與 runtime DB 是否存在。
- 無法執行 issue action：檢查 `NORTHSTAR_ROOT` 是否指向可運作的 Northstar checkout。
- release 卡住：先 inspect/reconcile，再依流程 approve release 或走 recover。
- watch 不動作：先跑 `skill:doctor` 確認 host adapter 與憑證。
