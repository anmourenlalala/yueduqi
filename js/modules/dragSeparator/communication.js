/**
 * 页面间通信管理器
 * 使用BroadcastChannel实现同源页面通信
 */

const channels = new Map(); // {channelId: BroadcastChannel}
const messageHandlers = new Map(); // {channelId: Set<Function>}

/**
 * 建立通信通道
 * @param {string} channelId - 通道ID
 * @returns {BroadcastChannel} 通道对象
 */
export function establishChannel(channelId) {
    if (channels.has(channelId)) {
        return channels.get(channelId);
    }
    
    const channel = new BroadcastChannel(channelId);
    channels.set(channelId, channel);
    
    // 设置消息监听
    channel.addEventListener('message', (event) => {
        const handlers = messageHandlers.get(channelId);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(event.data);
                } catch (error) {
                    console.error('消息处理函数执行失败:', error);
                }
            });
        }
    });
    
    return channel;
}

/**
 * 发送消息
 * @param {string} channelId - 通道ID
 * @param {string} type - 消息类型
 * @param {Object} data - 消息数据
 */
export function sendMessage(channelId, type, data = {}) {
    const channel = channels.get(channelId);
    if (!channel) {
        console.warn(`[通信] 通道 ${channelId} 不存在，无法发送消息类型: ${type}`);
        return;
    }
    
    const message = {
        type,
        timestamp: Date.now(),
        ...data
    };
    
    console.log(`[通信] 发送消息: 类型=${type}, 通道=${channelId}, 数据=`, data);
    channel.postMessage(message);
}

/**
 * 监听消息
 * @param {string} channelId - 通道ID
 * @param {Function} callback - 消息处理回调
 */
export function onMessage(channelId, callback) {
    // 确保通道已建立
    establishChannel(channelId);
    
    // 添加消息处理器
    if (!messageHandlers.has(channelId)) {
        messageHandlers.set(channelId, new Set());
    }
    messageHandlers.get(channelId).add(callback);
}

/**
 * 移除消息监听
 * @param {string} channelId - 通道ID
 * @param {Function} callback - 要移除的回调函数
 */
export function offMessage(channelId, callback) {
    const handlers = messageHandlers.get(channelId);
    if (handlers) {
        handlers.delete(callback);
    }
}

/**
 * 关闭通道
 * @param {string} channelId - 通道ID
 */
export function closeChannel(channelId) {
    const channel = channels.get(channelId);
    if (channel) {
        channel.close();
        channels.delete(channelId);
        messageHandlers.delete(channelId);
    }
}

