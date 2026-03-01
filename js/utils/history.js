/**
 * 历史记录管理模块
 * 负责管理编辑历史，支持撤销功能
 */

import { state } from '../core/state.js';
import { processContent } from './markdownConverter.js';
import { saveFile } from '../core/api.js';

/**
 * 初始化历史记录
 */
export function initializeHistories() {
    state.views.forEach(view => {
        if (!state.histories[view.id]) {
            state.histories[view.id] = [];
        }
        if (state.historyIndices[view.id] === undefined) {
            state.historyIndices[view.id] = -1;
        }
    });
}

/**
 * 添加到历史记录
 */
export function addToHistory(paneId, content) {
    if (!state.histories[paneId]) {
        state.histories[paneId] = [];
        state.historyIndices[paneId] = -1;
    }
    
    const history = state.histories[paneId];
    const index = state.historyIndices[paneId];
    
    // 限制历史记录数量为50条
    if (history.length > 50) {
        history.shift();
        if (state.historyIndices[paneId] > 0) {
            state.historyIndices[paneId]--;
        }
    }
    
    history.push(content);
    state.historyIndices[paneId] = history.length - 1;
}

/**
 * 获取上一个状态
 */
export function getPreviousState(paneId) {
    if (!state.histories[paneId]) return null;
    
    const index = state.historyIndices[paneId];
    if (index <= 0) return null;
    
    state.historyIndices[paneId]--;
    return state.histories[paneId][state.historyIndices[paneId]];
}

/**
 * 显示通知消息
 */
// 全局通知容器，用于管理通知显示
let notificationContainer = null;
let notificationTimer = null;

function showNotification(message, type = 'info') {
    // 如果已有通知，先移除
    if (notificationContainer) {
        notificationContainer.remove();
        if (notificationTimer) {
            clearTimeout(notificationTimer);
        }
    }
    
    notificationContainer = document.createElement('div');
    notificationContainer.textContent = message;
    
    if (type === 'success') {
        notificationContainer.style.backgroundColor = 'var(--accent-bg)';
        notificationContainer.style.color = 'var(--accent)';
        notificationContainer.style.border = '1px solid var(--accent)';
    } else {
        notificationContainer.style.backgroundColor = 'var(--bg-sidebar)';
        notificationContainer.style.border = '1px solid var(--border)';
    }
    
    notificationContainer.style.position = 'fixed';
    notificationContainer.style.top = '80px'; // 往下移动，避免遮挡导航栏
    notificationContainer.style.right = '20px';
    notificationContainer.style.padding = '10px 15px';
    notificationContainer.style.borderRadius = '5px';
    notificationContainer.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
    notificationContainer.style.zIndex = '1000';
    notificationContainer.style.fontSize = '14px';
    
    document.body.appendChild(notificationContainer);
    notificationTimer = setTimeout(() => {
        if (notificationContainer) {
            notificationContainer.remove();
            notificationContainer = null;
        }
        notificationTimer = null;
    }, 2000);
}

/**
 * 撤销操作
 * @param {string|null} viewId - 要撤销的视图ID，如果为null则撤销所有视图
 * 只撤销粘贴操作，不影响文件夹导航
 */
export async function undoAction(viewId = null) {
    if (!state.originalPath) {
        showNotification('没有可撤销的操作', 'info');
        return;
    }
    
    // 如果指定了视图ID（且不为空字符串），只撤销该视图
    if (viewId !== null && viewId !== undefined && viewId !== '') {
        const history = state.histories[viewId];
        const index = state.historyIndices[viewId];
        
        // 只有在有历史记录且索引有效时才撤销
        if (history && history.length > 0 && index > 0) {
            const prevContent = getPreviousState(viewId);
            if (prevContent !== null) {
                state.rawContents[viewId] = prevContent;
                
                // 重新渲染视图
                const viewEl = document.getElementById(`view-${viewId}`);
                if (viewEl) {
                    const html = processContent(marked.parse(prevContent));
                    viewEl.innerHTML = DOMPurify.sanitize(html);
                    
                    // 增强表格和跳转链接
                    if (window.enhanceTables) window.enhanceTables();
                    if (window.attachJumpLinkListeners) window.attachJumpLinkListeners(viewEl);
                }
                
                // 保存文件
                if (state.panePaths[viewId]) {
                    await saveFile(state.panePaths[viewId], prevContent);
                }
                
                showNotification('撤销完成', 'success');
                return;
            }
        }
        showNotification('没有可撤销的操作', 'info');
        return;
    }
    
    // 如果没有指定视图ID，撤销所有视图（向后兼容）
    let hasUndo = false;
    for (const view of state.views) {
        const paneId = view.id;
        const history = state.histories[paneId];
        const index = state.historyIndices[paneId];
        
        // 只有在有历史记录且索引有效时才撤销
        // 历史记录只在粘贴操作时添加，所以这里只撤销粘贴操作
        if (history && history.length > 0 && index > 0) {
            const prevContent = getPreviousState(paneId);
            if (prevContent !== null) {
                state.rawContents[paneId] = prevContent;
                
                // 重新渲染视图
                const viewEl = document.getElementById(`view-${paneId}`);
                if (viewEl) {
                    const html = processContent(marked.parse(prevContent));
                    viewEl.innerHTML = DOMPurify.sanitize(html);
                    
                    // 增强表格和跳转链接
                    if (window.enhanceTables) window.enhanceTables();
                    if (window.attachJumpLinkListeners) window.attachJumpLinkListeners(viewEl);
                }
                
                // 保存文件
                if (state.panePaths[paneId]) {
                    await saveFile(state.panePaths[paneId], prevContent);
                }
                
                hasUndo = true;
            }
        }
    }
    
    showNotification(
        hasUndo ? '撤销完成' : '没有可撤销的操作',
        hasUndo ? 'success' : 'info'
    );
}
