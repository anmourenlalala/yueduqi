# 内网穿透使用说明

本项目使用 **Cloudflare Tunnel (cloudflared)** 提供内网穿透功能。

## ⚠️ 重要说明：安全性

**这是通过 Cloudflare 安全隧道，不是直接暴露端口！**

- ✅ **您的本地 IP 和端口不会暴露到公网**
- ✅ **所有流量都经过 Cloudflare 的加密隧道**
- ✅ **外部用户只能通过 Cloudflare 分配的临时域名访问**
- ✅ **不会直接暴露您的真实 IP 地址**

Cloudflare Tunnel 的工作原理：
1. 在您的本地服务器和 Cloudflare 网络之间建立**加密连接**
2. 外部请求先到达 Cloudflare 服务器
3. Cloudflare 通过加密隧道转发到您的本地服务
4. **您的本地端口不会直接暴露在公网上**

## 文件说明

- `启动内网穿透.bat` - 前台运行内网穿透（可以看到实时日志和 URL）
- `启动内网穿透-安全模式.bat` - 安全模式，可选择临时隧道或命名隧道
- `启动内网穿透-后台.bat` - 后台运行内网穿透（输出保存到日志文件）
- `停止内网穿透.bat` - 停止运行中的内网穿透进程
- `启动服务器和内网穿透.bat` - 一键启动服务器和内网穿透

## 使用方法

### 方法一：分步启动（推荐）

1. **先启动服务器**
   ```bash
   启动阅读器.bat
   ```

2. **再启动内网穿透**
   ```bash
   启动内网穿透.bat
   ```
   或使用简化版（更清晰）：
   ```bash
   启动内网穿透-简化版.bat
   ```

3. **查看隧道 URL（重要！）**
   - 等待几秒钟后，会显示类似 `https://xxxx-xxxx-xxxx.trycloudflare.com` 的 URL
   - **这个 URL 就是手机端和电脑端的访问地址！**
   - 在手机浏览器中输入这个 URL 即可访问
   - 示例输出：
     ```
     +--------------------------------------------------------------------------------------------+
     |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
     |  https://xxxx-xxxx-xxxx.trycloudflare.com                                                 |
     +--------------------------------------------------------------------------------------------+
     ```

### 方法二：一键启动

直接运行：
```bash
启动服务器和内网穿透.bat
```

这会自动：
- 启动本地服务器（端口 2333）
- 启动内网穿透隧道
- 在两个独立窗口中运行

### 方法三：后台运行

1. 先启动服务器
2. 运行 `启动内网穿透-后台.bat`
3. 查看 `cloudflared.log` 文件获取隧道 URL

## 停止服务

### 停止内网穿透
- 运行 `停止内网穿透.bat`
- 或直接关闭内网穿透窗口
- 或在任务管理器中结束 `cloudflared.exe` 进程

### 停止服务器
- 关闭服务器窗口
- 或在任务管理器中结束 `node.exe` 进程

## 注意事项

1. **必须先启动服务器**
   - 内网穿透需要本地服务（端口 2333）已经运行
   - 如果服务器未启动，隧道会连接失败

2. **隧道 URL 是临时的**
   - 每次启动 cloudflared 都会生成新的 URL
   - 关闭后重新启动会得到不同的 URL
   - 如果需要固定域名，需要配置 Cloudflare 账户和命名隧道

3. **安全性说明**
   - ✅ **端口不会直接暴露**：所有流量通过 Cloudflare 加密隧道
   - ⚠️ **临时隧道 URL 是公开的**：任何人知道 URL 都可以访问
   - 💡 **建议**：
     - 临时测试：使用临时隧道即可
     - 生产环境：使用命名隧道 + Cloudflare Access 访问控制
     - 敏感数据：配置身份验证和访问策略

4. **网络要求**
   - 需要能够访问 Cloudflare 的服务器
   - 如果网络受限，可能无法使用

## 高级配置：命名隧道（更安全）

### 为什么使用命名隧道？

- ✅ **固定域名**：每次启动使用相同的域名
- ✅ **访问控制**：可以配置 Cloudflare Access 身份验证
- ✅ **更安全**：可以设置访问策略，限制谁可以访问
- ✅ **可管理**：在 Cloudflare 控制台管理

### 配置步骤

1. **登录 Cloudflare**
   ```bash
   cloudflared.exe tunnel login
   ```
   这会打开浏览器，登录您的 Cloudflare 账户

2. **创建命名隧道**
   ```bash
   cloudflared.exe tunnel create my-tunnel
   ```
   将 `my-tunnel` 替换为您想要的隧道名称

3. **配置隧道路由**（可选，如果需要固定域名）
   ```bash
   cloudflared.exe tunnel route dns my-tunnel your-domain.com
   ```

4. **配置访问控制**（推荐）
   - 登录 Cloudflare 控制台
   - 进入 Zero Trust → Access → Applications
   - 创建新的应用程序
   - 设置访问策略（例如：需要邮箱验证、团队成员等）

5. **运行命名隧道**
   ```bash
   cloudflared.exe tunnel run my-tunnel
   ```
   或使用 `启动内网穿透-安全模式.bat` 选择命名隧道模式

### 使用安全模式脚本

运行 `启动内网穿透-安全模式.bat`，选择模式 2（命名隧道），输入您的隧道名称即可。

详细配置请参考 [Cloudflare Tunnel 文档](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)

## 故障排除

### 问题：无法启动内网穿透
- 检查 `cloudflared.exe` 是否在项目根目录
- 检查网络连接是否正常
- 检查防火墙是否阻止了 cloudflared

### 问题：隧道连接失败
- 确认本地服务器（端口 2333）正在运行
- 检查服务器日志是否有错误
- 尝试重启服务器

### 问题：无法访问公网 URL
- 确认隧道已成功启动（查看窗口输出）
- 检查 URL 是否正确复制
- 尝试重新启动内网穿透获取新 URL

