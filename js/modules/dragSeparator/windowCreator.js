/**
 * 独立窗口创建器
 * 负责创建分离窗口并传递快照数据
 */

/**
 * 创建分离窗口
 * @param {string} serializedSnapshot - 序列化的快照数据
 * @param {Object} options - 窗口选项
 * @returns {Promise<Window|null>} 创建的窗口对象
 */
export function createSeparatedWindow(serializedSnapshot, options = {}) {
    return new Promise((resolve, reject) => {
        const {
            width = 800,
            height = 600,
            left = (screen.width - width) / 2,
            top = (screen.height - height) / 2
        } = options;
        
        // 使用sessionStorage临时存储快照数据，避免URL过长
        const snapshotKey = `snapshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        try {
            sessionStorage.setItem(snapshotKey, serializedSnapshot);
        } catch (e) {
            console.error('存储快照数据失败:', e);
            // 如果sessionStorage也失败，尝试使用postMessage
        }
        
        // 生成独立页面URL，只传递key
        const url = `separated-view.html?key=${encodeURIComponent(snapshotKey)}`;
        
        try {
            const newWindow = window.open(
                url,
                `separated-view-${Date.now()}`,
                `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
            );
            
            if (!newWindow) {
                // 清理临时数据
                try {
                    sessionStorage.removeItem(snapshotKey);
                } catch (e) {}
                reject(new Error('弹窗被阻止，请允许弹窗'));
                return;
            }
            
            // 监听窗口加载完成，通过postMessage发送数据（备用方案）
            let messageHandler = null;
            let resolved = false;
            
            messageHandler = (event) => {
                // 安全检查：只接受来自分离窗口的消息
                if (event.source !== newWindow) {
                    return;
                }
                
                if (event.data && event.data.type === 'SEPARATED_VIEW_READY' && !resolved) {
                    resolved = true;
                    // 窗口已准备好，发送快照数据
                    try {
                        newWindow.postMessage({
                            type: 'SNAPSHOT_DATA',
                            snapshot: serializedSnapshot,
                            key: snapshotKey
                        }, window.location.origin);
                        
                        // 清理监听器
                        if (messageHandler) {
                            window.removeEventListener('message', messageHandler);
                        }
                        resolve(newWindow);
                    } catch (e) {
                        console.error('发送快照数据失败:', e);
                        // 清理临时数据
                        try {
                            sessionStorage.removeItem(snapshotKey);
                        } catch (e2) {}
                        if (messageHandler) {
                            window.removeEventListener('message', messageHandler);
                        }
                        reject(e);
                    }
                }
            };
            
            window.addEventListener('message', messageHandler);
            
            // 超时处理（5秒后如果还没收到ready消息，尝试直接使用sessionStorage）
            setTimeout(() => {
                if (!resolved) {
                    if (messageHandler) {
                        window.removeEventListener('message', messageHandler);
                    }
                    // 如果超时，仍然resolve，因为sessionStorage中已经有数据了
                    resolve(newWindow);
                }
            }, 5000);
            
        } catch (error) {
            // 清理临时数据
            try {
                sessionStorage.removeItem(snapshotKey);
            } catch (e) {}
            console.error('创建窗口失败:', error);
            reject(error);
        }
    });
}

