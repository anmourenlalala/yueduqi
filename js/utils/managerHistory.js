/**
 * 管理器历史记录模块
 * 负责管理各个管理器面板的编辑历史，支持撤销功能
 */

import { state } from '../core/state.js';

// 管理器历史记录：{managerType: [{data: object, timestamp: number}]}
if (!state.managerHistories) {
    state.managerHistories = {};
}

// 管理器历史索引：{managerType: number}
if (!state.managerHistoryIndices) {
    state.managerHistoryIndices = {};
}

/**
 * 添加到管理器历史记录
 * @param {string} managerType - 管理器类型 ('prompt', 'theme', 'layout', 'workflow', 'event')
 * @param {object} data - 要保存的数据
 */
export function addToManagerHistory(managerType, data) {
    if (!state.managerHistories[managerType]) {
        state.managerHistories[managerType] = [];
        state.managerHistoryIndices[managerType] = -1;
    }
    
    const history = state.managerHistories[managerType];
    const index = state.managerHistoryIndices[managerType];
    
    // 限制历史记录数量为20条
    if (history.length > 20) {
        history.shift();
        if (state.managerHistoryIndices[managerType] > 0) {
            state.managerHistoryIndices[managerType]--;
        }
    }
    
    // 添加新记录
    history.push({
        data: JSON.parse(JSON.stringify(data)), // 深拷贝
        timestamp: Date.now()
    });
    state.managerHistoryIndices[managerType] = history.length - 1;
}

/**
 * 获取上一个状态
 * @param {string} managerType - 管理器类型
 * @returns {object|null} 上一个状态的数据，如果没有则返回null
 */
export function getPreviousManagerState(managerType) {
    if (!state.managerHistories[managerType]) return null;
    
    const history = state.managerHistories[managerType];
    const index = state.managerHistoryIndices[managerType];
    
    if (index <= 0) return null;
    
    state.managerHistoryIndices[managerType]--;
    return history[state.managerHistoryIndices[managerType]].data;
}

/**
 * 显示通知消息
 */
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.textContent = message;
    
    if (type === 'success') {
        notification.style.backgroundColor = 'var(--accent-bg)';
        notification.style.color = 'var(--accent)';
        notification.style.border = '1px solid var(--accent)';
    } else {
        notification.style.backgroundColor = 'var(--bg-sidebar)';
        notification.style.border = '1px solid var(--border)';
    }
    
    notification.style.position = 'fixed';
    notification.style.top = '20px';
    notification.style.right = '20px';
    notification.style.padding = '10px 15px';
    notification.style.borderRadius = '5px';
    notification.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
    notification.style.zIndex = '10000';
    notification.style.fontSize = '14px';
    
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.remove();
    }, 2000);
}

/**
 * 撤销管理器操作
 * @param {string} managerType - 管理器类型
 * @returns {boolean} 是否成功撤销
 */
export function undoManagerAction(managerType) {
    const prevState = getPreviousManagerState(managerType);
    if (!prevState) {
        showNotification('没有可撤销的操作', 'info');
        return false;
    }
    
    // 根据管理器类型恢复状态
    switch (managerType) {
        case 'prompt':
            restorePromptState(prevState);
            break;
        case 'theme':
            restoreThemeState(prevState);
            break;
        case 'layout':
            restoreLayoutState(prevState);
            break;
        case 'workflow':
            restoreWorkflowState(prevState);
            break;
        case 'event':
            restoreEventState(prevState);
            break;
        default:
            return false;
    }
    
    showNotification('撤销完成', 'success');
    return true;
}

/**
 * 恢复提示词状态
 */
function restorePromptState(data) {
    const nameInput = document.getElementById('prompt-name');
    const contentInput = document.getElementById('prompt-content');
    
    if (nameInput) nameInput.value = data.name || '';
    if (contentInput) contentInput.value = data.content || '';
}

/**
 * 恢复主题状态
 */
function restoreThemeState(data) {
    const nameInput = document.getElementById('theme-name');
    const contentInput = document.getElementById('theme-content');
    
    if (nameInput) nameInput.value = data.name || '';
    if (contentInput) contentInput.value = data.css || '';
}

/**
 * 恢复布局状态
 */
function restoreLayoutState(data) {
    const nameInput = document.getElementById('layout-name');
    const columnsInput = document.getElementById('layout-columns');
    const fullscreenEnabledInput = document.getElementById('layout-fullscreen-enabled');
    const fullscreenCloseOnEscapeInput = document.getElementById('layout-fullscreen-close-on-escape');
    
    if (nameInput) nameInput.value = data.name || '';
    if (columnsInput) columnsInput.value = data.columns || 2;
    if (fullscreenEnabledInput) fullscreenEnabledInput.checked = data.fullscreenEnabled !== false;
    if (fullscreenCloseOnEscapeInput) fullscreenCloseOnEscapeInput.checked = data.fullscreenCloseOnEscape !== false;
    
    // 触发预览更新
    if (window.updateLayoutPreview) {
        setTimeout(() => window.updateLayoutPreview(), 100);
    }
}

/**
 * 恢复工作流状态
 */
function restoreWorkflowState(data) {
    const nameInput = document.getElementById('workflow-name');
    const contentInput = document.getElementById('workflow-content');
    
    if (nameInput) nameInput.value = data.name || '';
    if (contentInput) contentInput.value = data.content || '';
    
    // 更新可视化
    if (contentInput && contentInput.value && window.renderWorkflowFromContent) {
        window.renderWorkflowFromContent(contentInput.value);
    }
}

/**
 * 恢复事件状态
 */
function restoreEventState(data) {
    const nameInput = document.getElementById('event-name');
    const workflowSelect = document.getElementById('event-workflow-select');
    const viewSelect = document.getElementById('event-view-select');
    const projectPathInput = document.getElementById('event-project-path');
    
    if (nameInput) nameInput.value = data.name || '';
    if (workflowSelect) workflowSelect.value = data.workflowName || '';
    if (viewSelect) viewSelect.value = data.viewId || '';
    const projectPath = data.projectPath || '';
    if (projectPathInput) projectPathInput.value = projectPath;
}

/**
 * 检查当前打开的管理器面板
 * @returns {string|null} 当前打开的管理器类型，如果没有则返回null
 */
export function getCurrentManagerType() {
    const promptPanel = document.getElementById('prompt-panel');
    const themePanel = document.getElementById('theme-panel');
    const layoutPanel = document.getElementById('layout-panel');
    const workflowPanel = document.getElementById('workflow-panel');
    const eventPanel = document.getElementById('event-panel');
    
    if (promptPanel && promptPanel.style.display === 'flex') return 'prompt';
    if (themePanel && themePanel.style.display === 'flex') return 'theme';
    if (layoutPanel && layoutPanel.style.display === 'flex') return 'layout';
    if (workflowPanel && workflowPanel.style.display === 'flex') return 'workflow';
    if (eventPanel && eventPanel.style.display === 'flex') return 'event';
    
    return null;
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.undoManagerAction = undoManagerAction;
    window.getCurrentManagerType = getCurrentManagerType;
    window.addToManagerHistory = addToManagerHistory;
}

