/**
 * 使用统计配置管理模块
 * 负责配置的保存和读取
 */

/**
 * 获取统计配置
 * @returns {Promise<object>} 配置对象 {scanEnabled, scanInterval}
 */
export async function getUsageConfig() {
    try {
        const response = await fetch('/api/log/config');
        if (!response.ok) {
            throw new Error(`获取配置失败: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('获取统计配置失败:', error);
        return {
            scanEnabled: false,
            scanInterval: 2
        };
    }
}

/**
 * 保存统计配置
 * @param {object} config - 配置对象 {scanEnabled, scanInterval}
 * @returns {Promise<object>} 保存结果
 */
export async function saveUsageConfig(config) {
    try {
        const response = await fetch('/api/log/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });
        if (!response.ok) {
            throw new Error(`保存配置失败: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('保存统计配置失败:', error);
        throw error;
    }
}

/**
 * 初始化自动扫描定时器
 * @param {function} scanCallback - 扫描回调函数
 * @returns {object} 控制器对象 {stop, updateInterval, restart}
 */
export function initAutoScan(scanCallback) {
    let scanTimer = null;
    let currentInterval = 2; // 默认2小时
    let isEnabled = false;
    
    async function startAutoScan() {
        const config = await getUsageConfig();
        currentInterval = config.scanInterval || 2;
        isEnabled = config.scanEnabled || false;
        
        // 先停止现有的定时器
        stopAutoScan();
        
        if (isEnabled && scanCallback) {
            // 设置定时器
            const intervalMs = currentInterval * 60 * 60 * 1000; // 转换为毫秒
            scanTimer = setInterval(() => {
                scanCallback();
            }, intervalMs);
        }
    }
    
    function stopAutoScan() {
        if (scanTimer) {
            clearInterval(scanTimer);
            scanTimer = null;
        }
    }
    
    function updateInterval(newInterval) {
        currentInterval = newInterval;
        startAutoScan();
    }
    
    function updateEnabled(enabled) {
        isEnabled = enabled;
        startAutoScan();
    }
    
    // 启动自动扫描
    startAutoScan();
    
    return {
        stop: stopAutoScan,
        updateInterval: updateInterval,
        updateEnabled: updateEnabled,
        restart: startAutoScan
    };
}

