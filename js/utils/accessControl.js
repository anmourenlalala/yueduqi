/**
 * 访问控制工具
 * 检测是否为本地访问，用于控制敏感功能（如永久删除）的显示
 */

/**
 * 检测是否为本地访问
 * @returns {Promise<boolean>} 是否为本地访问
 */
export async function isLocalAccess() {
    try {
        // 检查当前访问地址
        const hostname = window.location.hostname;
        const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
        
        // 检查是否为 localhost
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
            // 进一步验证端口是否为 2333
            if (port === '2333' || port === '') {
                // 通过API验证服务器端也认为是本地访问
                const response = await fetch('/api/check-local-access', {
                    method: 'GET',
                    credentials: 'same-origin'
                });
                
                if (response.ok) {
                    const data = await response.json();
                    return data.isLocal === true;
                }
            }
        }
        
        // 检查是否为内网IP（192.168.x.x, 10.x.x.x, 172.16-31.x.x）
        const ipPattern = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/;
        if (ipPattern.test(hostname)) {
            // 验证端口
            if (port === '2333' || port === '') {
                // 通过API验证
                const response = await fetch('/api/check-local-access', {
                    method: 'GET',
                    credentials: 'same-origin'
                });
                
                if (response.ok) {
                    const data = await response.json();
                    return data.isLocal === true;
                }
            }
        }
        
        return false;
    } catch (error) {
        console.error('访问检测失败:', error);
        return false;
    }
}

/**
 * 初始化访问控制
 * 检查访问来源并控制相关功能的显示
 */
export async function initAccessControl() {
    try {
        const isLocal = await isLocalAccess();
        
        // 控制永久删除按钮的显示
        const permanentDeleteButtons = document.querySelectorAll('.permanent-delete-btn, .permanent-delete-all-btn');
        permanentDeleteButtons.forEach(btn => {
            if (isLocal) {
                btn.style.display = '';
            } else {
                btn.style.display = 'none';
            }
        });
        
        // 将状态存储到全局，供其他模块使用
        window.isLocalAccess = isLocal;
        
        // 更新外部AI设置区域的显示
        const externalAiSection = document.getElementById('external-ai-settings-section');
        if (externalAiSection) {
            if (isLocal) {
                externalAiSection.style.display = '';
                // 如果设置页面已渲染，更新开关状态
                const { updateExternalAiToggleState } = await import('../modules/viewManager.js');
                updateExternalAiToggleState();
            } else {
                externalAiSection.style.display = 'none';
            }
        }
        
        // 控制F12日志控制按钮的显示（直接复制永久删除按钮的逻辑）
        const f12LogSections = document.querySelectorAll('#f12-log-settings-section');
        f12LogSections.forEach(section => {
            if (isLocal) {
                section.style.display = '';
            } else {
                section.style.display = 'none';
            }
        });
        
        // 如果设置页面已渲染，更新开关状态
        if (isLocal) {
            try {
                const { updateF12LogToggleState } = await import('../modules/viewManager.js');
                updateF12LogToggleState();
            } catch (err) {
                // 忽略导入错误，可能模块还未加载
            }
        }
        
        return isLocal;
    } catch (error) {
        console.error('访问控制初始化失败:', error);
        // 默认隐藏，确保安全
        const permanentDeleteButtons = document.querySelectorAll('.permanent-delete-btn, .permanent-delete-all-btn');
        permanentDeleteButtons.forEach(btn => {
            btn.style.display = 'none';
        });
        window.isLocalAccess = false;
        return false;
    }
}

