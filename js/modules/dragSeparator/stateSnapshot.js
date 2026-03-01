/**
 * 视图状态快照管理器
 * 负责创建、序列化和反序列化视图状态快照
 */

import { state } from '../../core/state.js';
import { getViewById } from '../../core/state.js';

/**
 * 创建视图状态快照
 * @param {string} viewId - 视图ID
 * @returns {Promise<Object>} 状态快照对象
 */
export async function createViewSnapshot(viewId) {
    const view = getViewById(viewId);
    if (!view) {
        throw new Error(`视图 ${viewId} 不存在`);
    }
    
    // 获取视图DOM元素
    const viewEl = document.getElementById(`view-${viewId}`);
    const container = document.getElementById(`view-container-${viewId}`);
    
    // 构建快照对象
    const snapshot = {
        // 元数据
        viewId: viewId,
        timestamp: Date.now(),
        version: '1.0',
        
        // 视图配置
        viewConfig: {
            id: view.id,
            titleTemplate: view.titleTemplate,
            suffix: view.suffix || '',
            keybind: view.keybind || ''
        },
        
        // 文件相关状态
        fileState: {
            filePath: state.panePaths[viewId] || null,
            originalPath: state.originalPanePaths[viewId] || null,
            rawContent: state.rawContents[viewId] || '',
            isAiFile: state.viewAiStates[viewId] || false
        },
        
        // UI状态
        uiState: {
            scrollPosition: state.scrollPositions[viewId] || 0,
            editMode: false, // 需要从localStorage读取
            // 窗口尺寸（用于分离窗口）
            containerSize: container ? {
                width: container.offsetWidth,
                height: container.offsetHeight
            } : null
        },
        
        // 主题和布局（全局状态，分离窗口需要）
        globalState: {
            theme: state.selectedTheme ? state.selectedTheme.name : null,
            themeCSS: state.selectedTheme ? state.selectedTheme.css : null,
            themeMode: document.documentElement.getAttribute('data-theme') || 'dark', // 日间/夜间模式
            layout: state.selectedLayout ? state.selectedLayout.name : null,
            originalPath: state.originalPath || null,
            currentDir: state.currentDir || '.',
            // 保存所有视图配置，确保分离窗口能正确加载文件
            allViews: state.views ? JSON.parse(JSON.stringify(state.views)) : []
        }
    };
    
    // 读取编辑模式状态
    try {
        const editModeKey = `editMode_${viewId}`;
        const savedEditMode = localStorage.getItem(editModeKey);
        if (savedEditMode !== null) {
            snapshot.uiState.editMode = JSON.parse(savedEditMode) === true;
        }
    } catch (e) {
        console.warn('读取编辑模式状态失败:', e);
    }
    
    return snapshot;
}

/**
 * 序列化快照（转换为JSON字符串）
 * @param {Object} snapshot - 快照对象
 * @returns {string} JSON字符串
 */
export function serializeSnapshot(snapshot) {
    try {
        return JSON.stringify(snapshot);
    } catch (e) {
        console.error('序列化快照失败:', e);
        throw new Error('快照序列化失败');
    }
}

/**
 * 反序列化快照（从JSON字符串恢复）
 * @param {string} serialized - JSON字符串
 * @returns {Object} 快照对象
 */
export function deserializeSnapshot(serialized) {
    try {
        return JSON.parse(serialized);
    } catch (e) {
        console.error('反序列化快照失败:', e);
        throw new Error('快照反序列化失败');
    }
}

/**
 * 验证快照完整性
 * @param {Object} snapshot - 快照对象
 * @returns {boolean} 是否完整
 */
export function validateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
        return false;
    }
    
    const required = ['viewId', 'timestamp', 'viewConfig', 'fileState', 'uiState'];
    for (const key of required) {
        if (!(key in snapshot)) {
            console.warn(`快照缺少必需字段: ${key}`);
            return false;
        }
    }
    
    return true;
}

/**
 * 从快照恢复视图状态（不修改DOM，只恢复state）
 * @param {Object} snapshot - 快照对象
 */
export function restoreViewStateFromSnapshot(snapshot) {
    if (!validateSnapshot(snapshot)) {
        throw new Error('快照验证失败');
    }
    
    const { viewId, viewConfig, fileState, uiState } = snapshot;
    
    // 恢复文件状态
    if (!state.panePaths) state.panePaths = {};
    if (!state.originalPanePaths) state.originalPanePaths = {};
    if (!state.rawContents) state.rawContents = {};
    if (!state.viewAiStates) state.viewAiStates = {};
    
    if (fileState.filePath) {
        state.panePaths[viewId] = fileState.filePath;
    }
    if (fileState.originalPath) {
        state.originalPanePaths[viewId] = fileState.originalPath;
    }
    // 即使 rawContent 是空字符串，也要恢复（可能是文件不存在的情况）
    if (fileState.rawContent !== undefined) {
        state.rawContents[viewId] = fileState.rawContent;
        console.log(`[快照恢复] 恢复视图 ${viewId} 的内容，长度: ${fileState.rawContent.length}`);
    } else {
        console.warn(`[快照恢复] 视图 ${viewId} 的快照中没有 rawContent`);
    }
    if (fileState.isAiFile !== undefined) {
        state.viewAiStates[viewId] = fileState.isAiFile;
    }
    
    // 恢复UI状态
    if (uiState.scrollPosition !== undefined) {
        if (!state.scrollPositions) state.scrollPositions = {};
        state.scrollPositions[viewId] = uiState.scrollPosition;
    }
    
    // 恢复编辑模式状态
    if (uiState.editMode !== undefined) {
        try {
            const editModeKey = `editMode_${viewId}`;
            localStorage.setItem(editModeKey, JSON.stringify(uiState.editMode));
        } catch (e) {
            console.warn('保存编辑模式状态失败:', e);
        }
    }
}

