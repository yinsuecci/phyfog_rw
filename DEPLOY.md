# 一键部署到 GitHub + rw.udclass.top

## 第一次使用（本机 Windows）

### 1. 安装依赖

- [Git for Windows](https://git-scm.com/download/win)
- Windows **OpenSSH 客户端**（设置 → 应用 → 可选功能 → OpenSSH 客户端）

### 2. 配置 SSH 密钥登录服务器

```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\id_ed25519
type $env:USERPROFILE\.ssh\id_ed25519.pub
```

把公钥内容追加到香港服务器 `~/.ssh/authorized_keys`：

```bash
ssh root@rw.udclass.top
mkdir -p ~/.ssh && chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys   # 粘贴公钥
chmod 600 ~/.ssh/authorized_keys
```

### 3. 填写部署配置

复制并编辑：

```powershell
copy deploy.config.example.json deploy.config.json
notepad deploy.config.json
```

重点修改：

- `sshKeyPath`：你的私钥路径，如 `C:\Users\你的用户名\.ssh\id_ed25519`
- `sshHost`：`rw.udclass.top`
- `remotePath`：服务器上的项目目录，默认 `/var/www/phyfog`

### 4. 服务器首次初始化（仅一次）

SSH 登录香港服务器后执行：

```bash
curl -fsSL https://raw.githubusercontent.com/yinsuecci/phyfog_rw/master/server-init.sh | bash
```

或手动上传 `server-init.sh` 后：

```bash
bash server-init.sh
```

并配置 Nginx + HTTPS 指向 `127.0.0.1:3000`（域名 `rw.udclass.top`）。

---

## 日常发布

### 推荐：`deployMode: "direct"`（无需访问 GitHub）

国内网络常无法连接 `github.com:443`。默认已改为 **直连上传**：

1. 本地 `git commit`（可选）
2. 通过 **SCP** 把代码直接传到 `rw.udclass.top`
3. 服务器 `npm install` + `pm2 restart`

双击 **`一键部署.bat`** 即可。

`deploy.config.json` 关键项：

```json
{
  "deployMode": "direct",
  "sshHost": "rw.udclass.top",
  "sshKeyPath": "C:\\Users\\你的用户名\\.ssh\\id_ed25519",
  "fallbackDirectDeploy": true
}
```

### 使用代理连接 GitHub（推荐有梯子用户）

编辑 `deploy.config.json`：

```json
{
  "deployMode": "git",
  "gitHttpProxy": "http://127.0.0.1:7890",
  "fallbackDirectDeploy": true,
  "sshKeyPath": "C:\\Users\\你的用户名\\.ssh\\id_ed25519",
  "sshHost": "rw.udclass.top"
}
```

| 字段 | 说明 |
|------|------|
| `deployMode` | 设为 `"git"`：先 push GitHub，再服务器 `git pull` |
| `gitHttpProxy` | 代理地址，常见见下表 |
| `fallbackDirectDeploy` | push 失败时自动改用 SCP 直连（建议保持 `true`） |

**常见本地代理端口**（在代理软件设置里查看 HTTP 端口）：

| 软件 | 典型 HTTP 代理 |
|------|----------------|
| Clash / Clash Verge | `http://127.0.0.1:7890` |
| v2rayN | `http://127.0.0.1:10809` |
| Surge | `http://127.0.0.1:6152` |

若只有 SOCKS5 端口（如 `7891`），可填：

```json
"gitHttpProxy": "socks5://127.0.0.1:7891"
```

**测试代理是否生效**（PowerShell）：

```powershell
$env:HTTP_PROXY="http://127.0.0.1:7890"
$env:HTTPS_PROXY="http://127.0.0.1:7890"
git ls-remote https://github.com/yinsuecci/phyfog_rw.git
```

能列出远程分支即表示 GitHub 已通。

也可全局配置 Git（可选，不必与 deploy 重复）：

```powershell
git config --global http.proxy http://127.0.0.1:7890
git config --global https.proxy http://127.0.0.1:7890
```

### 若能访问 GitHub（deploy.config 摘要）

### 方式 B：生成真正的 `.exe`

```powershell
.\build-deploy-exe.ps1
```

生成 `Deploy.exe`，之后双击即可部署。

### 方式 C：PowerShell 带说明

```powershell
.\deploy.ps1 -Message "修复手机端发射"
```

仅推 Git、不部署服务器：

```powershell
.\deploy.ps1 -GitOnly
```

仅部署服务器（不 commit）：

```powershell
.\deploy.ps1 -ServerOnly
```

---

## 玩家访问

部署成功后，所有人打开：

**https://rw.udclass.top**

服务器地址填：`https://rw.udclass.top`

---

## 故障排查

| 问题 | 处理 |
|------|------|
| 找不到 git | 安装 Git 并重启终端 |
| SSH 连接失败 | 检查 `deploy.config.json` 中的密钥路径、服务器 IP、22 端口 |
| 服务器无 .git | 在服务器执行 `server-init.sh` |
| push 要密码 | 配置 GitHub Personal Access Token 或 SSH key |
| 网站能开但联机断 | 确认 Nginx 已配置 WebSocket 升级头 |
