// 规则ID: rule_1767156799205_vw3xfvtqg
// 自动生成，请勿手动修改
// 最后更新: 2026-01-02T13:26:56.578Z
// 包含函数: process2Recognition, popCurrentTimestamp, formatCurrentTime, getRelativeTimeDescription, showCustomTimestampAlert, quickPopTimestamp, getCurrentTimestampInfo

/**
 * 处理默认关键字识别2规则的关键字
 * 功能：这是用来测试的，主要功能是直接弹出当前时间戳
 * @param {string} aiContent - AI回复的完整文本内容
 * @param {string} ruleId - 规则ID
 * @param {Array<string>} keywords - 检测到的关键字数组
 * @param {Array<object>} matches - 匹配详情数组
 * @returns {Promise<object>} 处理结果，必须包含 success 字段
 */
export async function process2Recognition(aiContent, ruleId, keywords, matches) {
    console.log(`[关键字识别-默认关键字识别2] 开始处理，规则ID: ${ruleId}`);
    
    try {
        // 参数验证
        if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
            console.warn(`[关键字识别-默认关键字识别2] 关键字数组为空`);
            return { success: false, message: '关键字数组为空' };
        }
        
        console.log(`[关键字识别-默认关键字识别2] 检测到 ${keywords.length} 个关键字，弹出当前时间戳`);
        
        // 直接获取当前时间戳并弹出
        const result = await popCurrentTimestamp();
        
        return {
            success: true,
            message: `已弹出当前时间戳，检测到 ${keywords.length} 个关键字`,
            timestamp: result.timestamp,
            formattedTime: result.formattedTime,
            keywordCount: keywords.length
        };
    } catch (err) {
        console.error(`[关键字识别-默认关键字识别2] 处理失败:`, err);
        return {
            success: false,
            message: '弹出时间戳时发生错误',
            error: err.message
        };
    }
}

/**
 * 直接弹出当前时间戳
 * @returns {Promise<object>} 包含时间戳和格式化时间的对象
 */
export async function popCurrentTimestamp() {
    // 获取当前时间
    const now = new Date();
    const timestamp = now.getTime();
    
    // 格式化时间
    const formattedTime = formatCurrentTime(now);
    
    // 创建显示消息
    const message = `🕒 当前时间戳信息：
    
📅 日期时间：${formattedTime.dateTime}
⏱️ 时间戳：${timestamp}
📊 星期：${formattedTime.weekday}
⌛ 相对时间：${formattedTime.relativeTime}

💡 检测到关键字触发，当前时间已记录。`;

    // 弹出提示框
    try {
        if (typeof alert === 'function') {
            alert(message);
        } else {
            console.log('[时间戳]', message);
            // 如果alert不可用，尝试其他方式
            showCustomTimestampAlert(message);
        }
    } catch (err) {
        console.error('[时间戳] 弹出失败:', err);
        // 回退到console.log
        console.log('[时间戳] 当前时间信息:', {
            timestamp,
            formattedTime: formattedTime.dateTime,
            message
        });
    }
    
    // 同时记录到控制台
    console.log(`[时间戳] 弹出时间戳: ${timestamp} (${formattedTime.dateTime})`);
    
    return {
        timestamp,
        formattedTime: formattedTime.dateTime,
        fullInfo: formattedTime,
        poppedAt: now.toISOString()
    };
}

/**
 * 格式化当前时间为易读格式
 * @param {Date} date - 日期对象
 * @returns {object} 包含多种格式的时间信息
 */
export function formatCurrentTime(date) {
    const now = date || new Date();
    
    // 获取各个时间部分
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    
    // 星期几
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const weekday = weekdays[now.getDay()];
    
    // 创建格式化字符串
    const dateTime = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    const dateTimeFull = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
    const chineseDateTime = `${year}年${month}月${day}日 ${hours}时${minutes}分${seconds}秒`;
    
    // 获取相对时间描述
    const relativeTime = getRelativeTimeDescription(now);
    
    return {
        dateTime,           // 标准格式: 2024-01-02 14:30:45
        dateTimeFull,       // 包含毫秒: 2024-01-02 14:30:45.123
        chineseDateTime,    // 中文格式: 2024年01月02日 14时30分45秒
        weekday,            // 星期几
        relativeTime,       // 相对时间描述
        year,
        month,
        day,
        hours,
        minutes,
        seconds,
        milliseconds
    };
}

/**
 * 获取相对时间描述（今天、昨天等）
 * @param {Date} date - 日期对象
 * @returns {string} 相对时间描述
 */
export function getRelativeTimeDescription(date) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    const diffDays = Math.floor((today - targetDate) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return '今天';
    if (diffDays === 1) return '昨天';
    if (diffDays === 2) return '前天';
    if (diffDays < 0) return '未来';
    if (diffDays < 7) return `${diffDays}天前`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}个月前`;
    return `${Math.floor(diffDays / 365)}年前`;
}

/**
 * 自定义时间戳提示框（当alert不可用时使用）
 * @param {string} message - 要显示的消息
 */
export function showCustomTimestampAlert(message) {
    try {
        // 尝试使用浏览器的Notification API
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('🕒 当前时间戳', {
                body: message.split('\n')[0], // 只显示第一行
                icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyIDIyQzE3LjUyMiAyMiAyMiAxNy41MjIgMjIgMTJDMjIgNi40Nzc5IDE3LjUyMiAyIDEyIDJDNi40Nzc5IDIgMiA2LjQ3NzkgMiAxMkMyIDE3LjUyMiA2LjQ3NzkgMjIgMTIgMjJaIiBmaWxsPSIjMzM5OEVGIi8+CjxwYXRoIGQ9Ik0xMiA2VjEyTDE2IDE0IiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPgo8L3N2Zz4K',
                silent: true
            });
        }
        
        // 尝试在页面上显示一个临时div
        if (typeof document !== 'undefined') {
            const alertDiv = document.createElement('div');
            alertDiv.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 15px 20px;
                border-radius: 10px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                z-index: 9999;
                max-width: 300px;
                font-family: Arial, sans-serif;
                animation: slideIn 0.3s ease-out;
            `;
            
            // 添加动画
            const style = document.createElement('style');
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `;
            document.head.appendChild(style);
            
            alertDiv.innerHTML = `
                <div style="display: flex; align-items: center; margin-bottom: 10px;">
                    <span style="font-size: 24px; margin-right: 10px;">🕒</span>
                    <strong>当前时间戳</strong>
                </div>
                <div style="font-size: 12px; opacity: 0.9;">
                    ${message.split('\n').slice(0, 3).join('<br>')}
                </div>
            `;
            
            document.body.appendChild(alertDiv);
            
            // 5秒后自动移除
            setTimeout(() => {
                if (alertDiv.parentNode) {
                    alertDiv.style.animation = 'slideIn 0.3s ease-out reverse';
                    setTimeout(() => {
                        if (alertDiv.parentNode) {
                            document.body.removeChild(alertDiv);
                        }
                    }, 300);
                }
            }, 5000);
        }
    } catch (err) {
        console.warn('自定义提示框失败:', err);
    }
}

/**
 * 快速弹出时间戳的辅助函数（可以在其他地方直接调用）
 * @returns {object} 时间戳信息
 */
export function quickPopTimestamp() {
    return popCurrentTimestamp();
}

/**
 * 获取当前时间戳信息（不弹出）
 * @returns {object} 时间戳信息对象
 */
export function getCurrentTimestampInfo() {
    const now = new Date();
    const timestamp = now.getTime();
    const formatted = formatCurrentTime(now);
    
    return {
        timestamp,
        formatted,
        isoString: now.toISOString(),
        localeString: now.toLocaleString(),
        unixTimestamp: Math.floor(timestamp / 1000)
    };
}