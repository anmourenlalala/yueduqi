/**
 * 测试服务器 - 用于测试上下文API
 * 运行在5555端口，模拟外部AI调用2333端口的上下文API
 * 包含可视化界面和日志显示
 */

const http = require('http');
const url = require('url');
const port = 5555;

// 存储日志
const logs = [];
const MAX_LOGS = 200;

// 添加日志函数
function addLog(type, message, data = null) {
    const logEntry = {
        id: logs.length + 1,
        type: type, // 'info', 'success', 'error', 'warning'
        message: message,
        data: data,
        timestamp: new Date().toLocaleString('zh-CN')
    };
    logs.push(logEntry);
    if (logs.length > MAX_LOGS) {
        logs.shift();
    }
    console.log(`[${logEntry.timestamp}] [${type.toUpperCase()}] ${message}`);
    return logEntry;
}

// 初始化日志
addLog('info', '测试服务器启动', { port: port });

// 测试服务器
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    
    // 设置CORS头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    // 获取日志API
    if (req.method === 'GET' && pathname === '/api/logs') {
        const since = parseInt(parsedUrl.query.since || '0');
        const filteredLogs = logs.filter(log => log.id > since);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
            logs: filteredLogs,
            total: logs.length,
            latestId: logs.length > 0 ? logs[logs.length - 1].id : 0
        }));
        return;
    }
    
    // 清空日志API
    if (req.method === 'POST' && pathname === '/api/logs/clear') {
        logs.length = 0;
        addLog('info', '日志已清空');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, message: '日志已清空' }));
        return;
    }
    
    // 测试获取上下文
    if (req.method === 'GET' && pathname === '/test') {
        const clientIP = req.socket.remoteAddress || '未知';
        const clientPort = req.socket.remotePort || '未知';
        
        addLog('info', '收到测试请求', { ip: clientIP, port: clientPort });
        
        try {
            addLog('info', '正在调用主服务器API...', { url: 'http://localhost:2333/api/views/context' });
            
            const options = {
                hostname: 'localhost',
                port: 2333,
                path: '/api/views/context',
                method: 'GET'
            };
            
            const contextRequest = http.request(options, (contextResponse) => {
                let data = '';
                
                contextResponse.on('data', (chunk) => {
                    data += chunk;
                });
                
                contextResponse.on('end', () => {
                    if (contextResponse.statusCode === 200) {
                        addLog('success', '成功获取上下文', { 
                            length: data.length,
                            statusCode: contextResponse.statusCode
                        });
                        
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({
                            success: true,
                            message: '测试成功',
                            contextLength: data.length,
                            contextPreview: data.substring(0, 500) + (data.length > 500 ? '...' : ''),
                            fullContext: data,
                            timestamp: new Date().toISOString()
                        }, null, 2));
                    } else {
                        addLog('error', '获取上下文失败', { 
                            statusCode: contextResponse.statusCode,
                            data: data.substring(0, 200)
                        });
                        
                        let errorData = '';
                        try {
                            errorData = JSON.parse(data);
                        } catch (e) {
                            errorData = data;
                        }
                        
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({
                            success: false,
                            message: '获取上下文失败',
                            statusCode: contextResponse.statusCode,
                            error: errorData,
                            timestamp: new Date().toISOString()
                        }, null, 2));
                    }
                });
            });
            
            contextRequest.on('error', (error) => {
                addLog('error', '无法连接到主服务器', { 
                    error: error.message,
                    hint: '请确保主服务器正在运行（端口2333）'
                });
                
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: false,
                    message: '无法连接到2333端口',
                    error: error.message,
                    hint: '请确保主服务器正在运行（端口2333）',
                    timestamp: new Date().toISOString()
                }, null, 2));
            });
            
            contextRequest.end();
            
        } catch (error) {
            addLog('error', '发生内部错误', { error: error.message });
            
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                success: false,
                message: '服务器内部错误',
                error: error.message,
                timestamp: new Date().toISOString()
            }, null, 2));
        }
        return;
    }
    
    // 测试上下文信息
    if (req.method === 'GET' && pathname === '/test-info') {
        addLog('info', '收到测试上下文信息请求');
        
        try {
            const options = {
                hostname: 'localhost',
                port: 2333,
                path: '/api/views/context/info',
                method: 'GET'
            };
            
            const infoRequest = http.request(options, (infoResponse) => {
                let data = '';
                
                infoResponse.on('data', (chunk) => {
                    data += chunk;
                });
                
                infoResponse.on('end', () => {
                    try {
                        const info = JSON.parse(data);
                        addLog('success', '获取上下文信息成功', info);
                        
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({
                            success: true,
                            message: '获取上下文信息成功',
                            info: info,
                            timestamp: new Date().toISOString()
                        }, null, 2));
                    } catch (e) {
                        addLog('error', '解析响应失败', { rawData: data.substring(0, 200) });
                        
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({
                            success: false,
                            message: '解析响应失败',
                            rawData: data,
                            timestamp: new Date().toISOString()
                        }, null, 2));
                    }
                });
            });
            
            infoRequest.on('error', (error) => {
                addLog('error', '无法连接到主服务器', { error: error.message });
                
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: false,
                    message: '无法连接到2333端口',
                    error: error.message,
                    timestamp: new Date().toISOString()
                }, null, 2));
            });
            
            infoRequest.end();
        } catch (error) {
            addLog('error', '发生内部错误', { error: error.message });
            
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                success: false,
                message: '服务器内部错误',
                error: error.message,
                timestamp: new Date().toISOString()
            }, null, 2));
        }
        return;
    }
    
    // 返回测试页面
    if (req.method === 'GET' && pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getTestPage());
        return;
    }
    
    // 404
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
        error: 'Not Found',
        message: '请访问 /test 或 /test-info 或 /'
    }, null, 2));
});

// 生成测试页面HTML
function getTestPage() {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>上下文API测试页面 - 可视化测试工具</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container { 
            max-width: 1400px; 
            margin: 0 auto; 
            background: white; 
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 { font-size: 28px; margin-bottom: 10px; }
        .header p { opacity: 0.9; }
        .content { padding: 30px; }
        .button-group {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        .button { 
            background: #4CAF50; 
            color: white; 
            padding: 12px 24px; 
            border: none; 
            border-radius: 6px; 
            cursor: pointer; 
            font-size: 14px;
            font-weight: 500;
            transition: all 0.3s;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        }
        .button:hover { 
            background: #45a049; 
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        }
        .button:active { transform: translateY(0); }
        .button-info { background: #2196F3; }
        .button-info:hover { background: #0b7dda; }
        .button-clear { background: #ff9800; }
        .button-clear:hover { background: #f57c00; }
        .button-danger { background: #f44336; }
        .button-danger:hover { background: #d32f2f; }
        .button:disabled {
            background: #ccc;
            cursor: not-allowed;
            transform: none;
        }
        .main-layout {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-top: 20px;
        }
        @media (max-width: 1200px) {
            .main-layout {
                grid-template-columns: 1fr;
            }
        }
        .panel {
            background: #f9f9f9;
            border-radius: 8px;
            padding: 20px;
            border: 1px solid #e0e0e0;
        }
        .panel h2 {
            margin-bottom: 15px;
            color: #333;
            font-size: 18px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .panel h2::before {
            content: '';
            width: 4px;
            height: 20px;
            background: #667eea;
            border-radius: 2px;
        }
        .result { 
            margin-top: 15px; 
            padding: 15px; 
            background: white; 
            border-radius: 6px; 
            border-left: 4px solid #4CAF50;
            max-height: 500px;
            overflow-y: auto;
        }
        .result.error { 
            border-left-color: #f44336; 
            background: #ffebee; 
        }
        .result.success {
            border-left-color: #4CAF50;
            background: #e8f5e9;
        }
        pre { 
            background: #f5f5f5; 
            padding: 15px; 
            border-radius: 6px; 
            overflow-x: auto;
            font-size: 12px;
            line-height: 1.5;
            margin: 10px 0;
        }
        .status { 
            padding: 12px; 
            margin: 10px 0; 
            border-radius: 6px;
            font-weight: 500;
        }
        .status.success { 
            background: #d4edda; 
            color: #155724; 
            border: 1px solid #c3e6cb;
        }
        .status.error { 
            background: #f8d7da; 
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        .status.info {
            background: #d1ecf1;
            color: #0c5460;
            border: 1px solid #bee5eb;
        }
        .log-container {
            background: #1e1e1e;
            border-radius: 6px;
            padding: 15px;
            max-height: 600px;
            overflow-y: auto;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 12px;
            line-height: 1.6;
        }
        .log-entry {
            margin-bottom: 8px;
            padding: 8px;
            border-radius: 4px;
            border-left: 3px solid;
            background: rgba(255,255,255,0.05);
        }
        .log-entry.info { border-left-color: #2196F3; color: #90caf9; }
        .log-entry.success { border-left-color: #4CAF50; color: #81c784; }
        .log-entry.error { border-left-color: #f44336; color: #e57373; }
        .log-entry.warning { border-left-color: #ff9800; color: #ffb74d; }
        .log-time {
            color: #888;
            margin-right: 10px;
        }
        .log-type {
            font-weight: bold;
            margin-right: 10px;
        }
        .log-message {
            color: #fff;
        }
        .log-data {
            margin-top: 5px;
            padding-left: 20px;
            color: #aaa;
            font-size: 11px;
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 10px;
            margin-bottom: 15px;
        }
        .stat-card {
            background: white;
            padding: 15px;
            border-radius: 6px;
            text-align: center;
            border: 1px solid #e0e0e0;
        }
        .stat-value {
            font-size: 24px;
            font-weight: bold;
            color: #667eea;
        }
        .stat-label {
            font-size: 12px;
            color: #666;
            margin-top: 5px;
        }
        .auto-refresh {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 15px;
        }
        .switch {
            position: relative;
            display: inline-block;
            width: 50px;
            height: 24px;
        }
        .switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }
        .slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: #ccc;
            transition: .4s;
            border-radius: 24px;
        }
        .slider:before {
            position: absolute;
            content: "";
            height: 18px;
            width: 18px;
            left: 3px;
            bottom: 3px;
            background-color: white;
            transition: .4s;
            border-radius: 50%;
        }
        input:checked + .slider {
            background-color: #4CAF50;
        }
        input:checked + .slider:before {
            transform: translateX(26px);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔬 上下文API测试工具</h1>
            <p>测试服务器运行在端口 5555 | 主服务器端口 2333</p>
        </div>
        <div class="content">
            <div class="button-group">
                <button class="button button-info" onclick="testInfo()">📊 测试上下文信息</button>
                <button class="button" onclick="testContext()">🚀 测试获取上下文</button>
                <button class="button button-clear" onclick="clearLogs()">🗑️ 清空日志</button>
                <button class="button button-danger" onclick="clearResult()">❌ 清空结果</button>
            </div>
            
            <div class="auto-refresh">
                <label class="switch">
                    <input type="checkbox" id="autoRefresh" checked>
                    <span class="slider"></span>
                </label>
                <span>自动刷新日志</span>
            </div>
            
            <div class="main-layout">
                <div class="panel">
                    <h2>📋 测试结果</h2>
                    <div id="result">
                        <div class="status info">等待测试...</div>
                    </div>
                </div>
                
                <div class="panel">
                    <h2>📝 实时日志</h2>
                    <div class="stats" id="stats">
                        <div class="stat-card">
                            <div class="stat-value" id="stat-total">0</div>
                            <div class="stat-label">总日志数</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value" id="stat-success">0</div>
                            <div class="stat-label">成功</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value" id="stat-error">0</div>
                            <div class="stat-label">错误</div>
                        </div>
                    </div>
                    <div class="log-container" id="logContainer">
                        <div class="log-entry info">
                            <span class="log-time">等待日志...</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        let lastLogId = 0;
        let autoRefreshInterval = null;
        
        // 初始化
        document.addEventListener('DOMContentLoaded', () => {
            loadLogs();
            setupAutoRefresh();
        });
        
        // 设置自动刷新
        function setupAutoRefresh() {
            const checkbox = document.getElementById('autoRefresh');
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    startAutoRefresh();
                } else {
                    stopAutoRefresh();
                }
            });
            startAutoRefresh();
        }
        
        function startAutoRefresh() {
            if (autoRefreshInterval) clearInterval(autoRefreshInterval);
            autoRefreshInterval = setInterval(loadLogs, 1000); // 每秒刷新
        }
        
        function stopAutoRefresh() {
            if (autoRefreshInterval) {
                clearInterval(autoRefreshInterval);
                autoRefreshInterval = null;
            }
        }
        
        // 加载日志
        async function loadLogs() {
            try {
                const response = await fetch(\`/api/logs?since=\${lastLogId}\`);
                const data = await response.json();
                
                if (data.logs && data.logs.length > 0) {
                    appendLogs(data.logs);
                    lastLogId = data.latestId;
                    updateStats();
                }
            } catch (error) {
                console.error('加载日志失败:', error);
            }
        }
        
        // 追加日志
        function appendLogs(newLogs) {
            const container = document.getElementById('logContainer');
            
            newLogs.forEach(log => {
                const entry = document.createElement('div');
                entry.className = \`log-entry \${log.type}\`;
                entry.innerHTML = \`
                    <div>
                        <span class="log-time">[\${log.timestamp}]</span>
                        <span class="log-type">[\${log.type.toUpperCase()}]</span>
                        <span class="log-message">\${log.message}</span>
                    </div>
                    \${log.data ? \`<div class="log-data">\${JSON.stringify(log.data, null, 2)}</div>\` : ''}
                \`;
                container.appendChild(entry);
            });
            
            // 自动滚动到底部
            container.scrollTop = container.scrollHeight;
            
            // 限制日志数量
            const entries = container.querySelectorAll('.log-entry');
            if (entries.length > 100) {
                entries[0].remove();
            }
        }
        
        // 更新统计
        function updateStats() {
            const container = document.getElementById('logContainer');
            const entries = container.querySelectorAll('.log-entry');
            const total = entries.length;
            const success = container.querySelectorAll('.log-entry.success').length;
            const error = container.querySelectorAll('.log-entry.error').length;
            
            document.getElementById('stat-total').textContent = total;
            document.getElementById('stat-success').textContent = success;
            document.getElementById('stat-error').textContent = error;
        }
        
        // 测试上下文信息
        async function testInfo() {
            const resultDiv = document.getElementById('result');
            resultDiv.innerHTML = '<div class="status info">正在测试上下文信息...</div>';
            
            try {
                const response = await fetch('/test-info');
                const data = await response.json();
                
                if (data.success) {
                    resultDiv.innerHTML = \`
                        <div class="status success">✓ 测试成功</div>
                        <div class="result success">
                            <h3>上下文信息：</h3>
                            <pre>\${JSON.stringify(data.info, null, 2)}</pre>
                        </div>
                    \`;
                } else {
                    resultDiv.innerHTML = \`
                        <div class="status error">✗ 测试失败</div>
                        <div class="result error">
                            <pre>\${JSON.stringify(data, null, 2)}</pre>
                        </div>
                    \`;
                }
            } catch (error) {
                resultDiv.innerHTML = \`
                    <div class="status error">✗ 请求失败</div>
                    <div class="result error">
                        <p>错误: \${error.message}</p>
                    </div>
                \`;
            }
        }
        
        // 测试获取上下文
        async function testContext() {
            const resultDiv = document.getElementById('result');
            resultDiv.innerHTML = '<div class="status info">正在测试获取上下文...</div>';
            
            try {
                const response = await fetch('/test');
                const data = await response.json();
                
                if (data.success) {
                    resultDiv.innerHTML = \`
                        <div class="status success">✓ 测试成功</div>
                        <div class="result success">
                            <h3>测试结果：</h3>
                            <p><strong>上下文长度:</strong> \${data.contextLength} 字符</p>
                            <details>
                                <summary style="cursor: pointer; margin: 10px 0; color: #667eea;">查看上下文预览（前500字符）</summary>
                                <pre>\${data.contextPreview}</pre>
                            </details>
                            \${data.fullContext ? \`
                                <details>
                                    <summary style="cursor: pointer; margin: 10px 0; color: #667eea;">查看完整上下文</summary>
                                    <pre style="max-height: 400px; overflow-y: auto;">\${data.fullContext}</pre>
                                </details>
                            \` : ''}
                        </div>
                    \`;
                } else {
                    resultDiv.innerHTML = \`
                        <div class="status error">✗ 测试失败</div>
                        <div class="result error">
                            <pre>\${JSON.stringify(data, null, 2)}</pre>
                        </div>
                    \`;
                }
            } catch (error) {
                resultDiv.innerHTML = \`
                    <div class="status error">✗ 请求失败</div>
                    <div class="result error">
                        <p>错误: \${error.message}</p>
                    </div>
                \`;
            }
        }
        
        // 清空日志
        async function clearLogs() {
            if (!confirm('确定要清空所有日志吗？')) return;
            
            try {
                const response = await fetch('/api/logs/clear', { method: 'POST' });
                const data = await response.json();
                
                if (data.success) {
                    document.getElementById('logContainer').innerHTML = '<div class="log-entry info"><span class="log-time">日志已清空</span></div>';
                    lastLogId = 0;
                    updateStats();
                }
            } catch (error) {
                alert('清空日志失败: ' + error.message);
            }
        }
        
        // 清空结果
        function clearResult() {
            document.getElementById('result').innerHTML = '<div class="status info">等待测试...</div>';
        }
    </script>
</body>
</html>`;
}

server.listen(port, () => {
    console.log('='.repeat(80));
    console.log('测试服务器已启动');
    console.log('='.repeat(80));
    console.log(`测试服务器运行在: http://localhost:${port}`);
    console.log(`测试端点:`);
    console.log(`  - GET http://localhost:${port}/test - 测试获取上下文`);
    console.log(`  - GET http://localhost:${port}/test-info - 测试上下文信息`);
    console.log(`  - GET http://localhost:${port}/ - 测试页面（浏览器访问）`);
    console.log(`  - GET http://localhost:${port}/api/logs - 获取日志`);
    console.log(`  - POST http://localhost:${port}/api/logs/clear - 清空日志`);
    console.log('='.repeat(80));
    console.log('按 Ctrl+C 停止服务器');
    console.log('');
});
