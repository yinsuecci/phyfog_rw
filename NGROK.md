# ngrok 联机指南

## 房主操作（只需做一次配置）

### 1. 安装 ngrok

1. 打开 https://ngrok.com/download 下载 Windows 版
2. 解压后将 `ngrok.exe` 加入 PATH，或放到项目目录

### 2. 注册并获取 Authtoken

1. 注册 https://dashboard.ngrok.com/signup
2. 复制 Authtoken：https://dashboard.ngrok.com/get-started/your-authtoken
3. 在 PowerShell 中执行（每次新开终端需重新设置，或写入系统环境变量）：

```powershell
$env:NGROK_AUTHTOKEN = "你的authtoken"
```

### 3. 启动服务器 + ngrok

在项目目录打开 PowerShell：

```powershell
cd "d:\PhyFog Radiant War"
npm install
.\start-ngrok.ps1
```

或分两个终端：

```powershell
# 终端 1
npm start

# 终端 2
ngrok start phyfog --config ngrok.yml
```

### 4. 复制公网地址

ngrok 窗口会显示类似：

```
Forwarding   https://a1b2c3d4.ngrok-free.app -> http://localhost:3000
```

把 **`https://a1b2c3d4.ngrok-free.app`** 和 **6 位房间号** 发给朋友。

---

## 其他玩家（客户端）操作

1. 浏览器打开房主发来的 **ngrok 地址**（不要用 localhost）
2. 首页「服务器地址」填入同一地址，例如 `https://a1b2c3d4.ngrok-free.app`
3. 点击 **加入房间**
4. 输入昵称 + 房主给的 **6 位房间号**
5. 点击 **准备**，等房主开始游戏

> 首次打开 ngrok 免费域名可能弹出 “Visit Site” 提示，点一次即可。

---

## 房主创建房间

1. 浏览器打开 `http://localhost:3000` 或 ngrok 地址均可
2. **创建房间** → 导入地图 JSON → 获得房间号
3. 分享：**ngrok 地址 + 房间号**

---

## 常见问题

| 问题 | 解决 |
|------|------|
| 连接失败 | 确认服务器地址与 ngrok Forwarding 完全一致（含 `https://`） |
| 房主关 ngrok | 隧道断开，需重新启动并分享新地址 |
| 免费版地址变化 | 每次重启 ngrok 地址会变，需重新告知玩家 |
