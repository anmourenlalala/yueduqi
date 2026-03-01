/**
 * 视图管理模块
 * 负责多视图的渲染、配置和管理
 */

import { state, saveStateToStorage, getViewById, updateViewsMap } from '../core/state.js';
import { initializeHistories } from '../utils/history.js';
import { getFile, saveFile } from '../core/api.js';
import { isSupportedFileType } from '../utils/fileUtils.js';
import { processContent } from '../utils/markdownConverter.js';
import { renderHtmlWithVDOM } from '../utils/simpleVirtualDom.js';
import { wrapViewInContainer } from '../utils/viewContainerWrapper.js';

// 存储每个按钮的 timeout ID，用于管理成功反馈
const buttonTimeouts = new Map();

/**
 * 显示按钮成功反馈效果（每个按钮独立管理自己的 timeout）
 * @param {HTMLElement|string} button - 按钮元素或选择器
 * @param {number} duration - 显示时长（毫秒），默认1500
 */
export function showButtonSuccessFeedback(button, duration = 1500) {
    const btn = typeof button === 'string' ? document.querySelector(button) : button;
    if (!btn) return;
    
    // 获取视图ID
    const viewId = btn.dataset.viewId || '';
    
    // 从className中提取特定的按钮类名（如 view-switch-ai-btn, view-swap-file-btn 等）
    const buttonType = btn.className.split(' ').find(cls => 
        cls === 'view-switch-ai-btn' || 
        cls === 'view-swap-file-btn' || 
        cls === 'view-paste-btn' || 
        cls === 'view-copy-btn' ||
        cls === 'view-download-excel-btn' ||
        cls === 'view-send-deepseek-btn' ||
        cls === 'ai-view-paste-btn' ||
        cls === 'ai-view-copy-btn'
    ) || '';
    
    // 使用视图ID和按钮类型组合生成唯一标识
    const buttonKey = `${viewId}_${buttonType}`;
    
    // 如果之前有正在运行的 timeout，先清除它
    if (buttonTimeouts.has(buttonKey)) {
        clearTimeout(buttonTimeouts.get(buttonKey));
    }
    
    // 保存原始内容
    const oldText = btn.innerHTML;
    
    // 显示成功图标
    btn.innerHTML = "✅";
    
    // 设置新的 timeout
    const timeoutId = setTimeout(() => {
        // 再次获取按钮元素（可能已被重新渲染）
        const currentBtn = typeof button === 'string' ? document.querySelector(button) : button;
        if (currentBtn) {
            currentBtn.innerHTML = oldText;
        }
        buttonTimeouts.delete(buttonKey);
    }, duration);
    
    // 存储 timeout ID
    buttonTimeouts.set(buttonKey, timeoutId);
}

/**
 * 检查文件是否存在
 * @param {string} filePath - 文件路径
 * @returns {Promise<boolean>} 文件是否存在
 */
async function checkFileExists(filePath) {
    try {
        const content = await getFile(filePath);
        // 如果返回的是错误JSON，说明文件不存在
        if (content.trim().startsWith('{') && content.includes('"error"')) {
            return false;
        }
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * 切换单个视图到_ai版本文件或回退
 * @param {string} viewId - 视图ID
 */
export async function switchToAiFile(viewId) {
    if (!state.originalPath) {
        alert('请先选择文件');
        return;
    }
    
    // 获取原始文件路径（如果还没有保存，则使用当前路径）
    if (!state.originalPanePaths[viewId]) {
        state.originalPanePaths[viewId] = state.panePaths[viewId];
    }
    
    const originalPath = state.originalPanePaths[viewId];
    if (!originalPath) {
        alert('无法确定原始文件路径');
        return;
    }
    
    // 检查当前状态
    const isShowingAi = state.viewAiStates[viewId] || false;
    
    if (isShowingAi) {
        // 当前显示_ai文件，切换回原始文件
        state.viewAiStates[viewId] = false;
        state.panePaths[viewId] = originalPath;
    } else {
        // 当前显示原始文件，切换到_AI文件
        // 从 state.originalPath 获取基础文件名（而不是从 originalPath，因为 originalPath 可能已包含 suffix）
        const lastSeparatorIndex = Math.max(state.originalPath.lastIndexOf('\\'), state.originalPath.lastIndexOf('/'));
        const fileName = lastSeparatorIndex >= 0 ? state.originalPath.substring(lastSeparatorIndex + 1) : state.originalPath;
        const lastDotIndex = fileName.lastIndexOf('.');
        const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
        const ext = lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1) : '';
        
        // 构建新文件路径：文件名 + "_" + 视图ID + "_AI" + 扩展名
        // AI文件保存在文件名文件夹内
        const aiFileName = `${baseName}_${viewId}_AI${ext ? '.' + ext : ''}`;
        const { getFileInFolderPath } = await import('../utils/fileUtils.js');
        const aiFilePath = getFileInFolderPath(state.originalPath, aiFileName);
        
        // 直接切换，不检查文件是否存在（如果不存在会显示"文件未找到"）
        state.viewAiStates[viewId] = true;
        state.panePaths[viewId] = aiFilePath;
    }
    
    // 重新加载当前视图
    await loadSingleView(viewId);
    
    // 显示成功反馈效果（在加载完成后显示）
    showButtonSuccessFeedback(`.view-switch-ai-btn[data-view-id="${viewId}"]`);
}

/**
 * 加载单个视图
 * @param {string} viewId - 视图ID
 * @param {boolean} skipEditModeRestore - 是否跳过编辑模式状态恢复（默认false）
 */
export async function loadSingleView(viewId, skipEditModeRestore = false) {
    const targetPath = state.panePaths[viewId];
    if (!targetPath) return;
    
    // 使用Map索引直接查找，O(1)复杂度，而不是O(n)的find遍历
    const view = getViewById(viewId);
    if (!view) return;
    
    // 解析文件名用于显示标题
    const lastSeparatorIndex = Math.max(state.originalPath.lastIndexOf('\\'), state.originalPath.lastIndexOf('/'));
    const fileName = lastSeparatorIndex >= 0 ? state.originalPath.substring(lastSeparatorIndex + 1) : state.originalPath;
    const lastDotIndex = fileName.lastIndexOf('.');
    const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
    const ext = lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1) : '';
    
    // 获取视图的suffix（从视图配置中动态获取）
    const viewSuffix = (view.suffix !== undefined && view.suffix !== null && String(view.suffix).trim() !== '') 
        ? view.suffix 
        : '';
    
    // 拼接文件名用于显示（baseName + suffix，不包含扩展名）
    const displayFileName = baseName + viewSuffix;
    
    // 更新标题
    const titleEl = document.getElementById(`title-${viewId}`);
    if (titleEl) {
        titleEl.textContent = view.titleTemplate.replace('{filename}', displayFileName);
    }
    
    // 更新视图状态显示（主视图还是AI视图）
    const statusEl = document.getElementById(`view-status-${viewId}`);
    if (statusEl) {
        const isShowingAi = state.viewAiStates[viewId] || false;
        statusEl.textContent = `当前是：${isShowingAi ? 'AI视图' : '主视图'}`;
    }
    
    // 更新编辑模式状态显示
    updateEditModeStatus(viewId);
    
    const viewEl = document.getElementById(`view-${viewId}`);
    if (!viewEl) return;
    
    // 安全兜底：普通视图容器默认禁止编辑
    // 只有段落编辑器内部的专用元素才会被设置为 contentEditable = true
    // 这样可以避免某些情况下容器被错误地置为可编辑，导致“编辑模式：关”时仍然可以修改内容。
    viewEl.contentEditable = 'false';
    
    // 保存当前滚动位置
    if (!state.scrollPositions) state.scrollPositions = {};
    const savedScrollTop = state.scrollPositions[viewId] || 0;
    
        if (!isSupportedFileType(targetPath)) {
            renderHtmlWithVDOM(
                viewEl,
                `<div style="color:var(--text-muted); padding:20px; font-style:italic; font-size:13px;">不支持的文件类型（仅支持 .txt 和 .md）</div>`
            );
        state.rawContents[viewId] = "**不支持的文件类型**";
    } else {
        try {
            const content = await getFile(targetPath);
            if (content.trim().startsWith('{') && content.includes('"error"')) {
                state.rawContents[viewId] = '';
                renderHtmlWithVDOM(
                    viewEl,
                    `<div style="color:var(--text-muted); padding:20px; font-style:italic; font-size:13px;">文件未找到 (Ctrl+V创建)</div>`
                );
            } else {
                state.rawContents[viewId] = content;
                const html = processContent(marked.parse(content));
                const safeHtml = DOMPurify.sanitize(html);
                renderHtmlWithVDOM(viewEl, safeHtml);
                
                // 恢复滚动位置
                setTimeout(() => {
                    viewEl.scrollTop = savedScrollTop;
                }, 50);
            }
        } catch (error) {
            state.rawContents[viewId] = '';
            renderHtmlWithVDOM(
                viewEl,
                `<div style="color:var(--text-muted); padding:20px; font-style:italic; font-size:13px;">文件未找到 (Ctrl+V创建)</div>`
            );
        }
        
        // 增强表格和跳转链接
        if (window.enhanceTables) window.enhanceTables();
        if (window.attachJumpLinkListeners) window.attachJumpLinkListeners(viewEl);
        
        // 设置编辑模式开关事件
        setupEditModeToggle(viewId);
        
        // 恢复编辑模式状态（根据用户之前保存的选择）
        // 如果skipEditModeRestore为true，则跳过状态恢复（用于导航栏按钮操作后）
        if (!skipEditModeRestore) {
            // 使用Map索引直接查找，O(1)复杂度
            const view = getViewById(viewId);
            if (view && view.id === viewId) {
                // 只有视图ID与设置中的视图ID匹配时才恢复状态
                const savedState = loadEditModeState(viewId);
                if (savedState === true) {
                    // 如果之前保存为开启，则进入编辑模式
                    setTimeout(async () => {
                        const { enterEditMode } = await import('./paragraphEditor.js');
                        await enterEditMode(viewId, null);
                        await updateEditModeStatus(viewId);
                    }, 100);
                } else if (savedState === false) {
                    // 如果之前保存为关闭，确保不在编辑模式（页面刷新后editingViews是空的，所以只需要更新显示状态）
                    await updateEditModeStatus(viewId);
                } else {
                    // 如果没有保存过状态，默认关闭编辑模式（不强制进入）
                    // 这样可以确保用户明确选择开启时才会开启
                    await updateEditModeStatus(viewId);
                }
            } else {
                // 如果视图ID不匹配，只更新显示状态（不恢复编辑模式）
                await updateEditModeStatus(viewId);
            }
        } else {
            // 跳过状态恢复，只更新显示状态
            await updateEditModeStatus(viewId);
        }
    }
    
    // 自动同步上下文到服务器（供外部项目使用）
    if (window.getAllViewsContextWithSync) {
        setTimeout(async () => {
            try {
                await window.getAllViewsContextWithSync();
            } catch (err) {
                console.warn('自动同步上下文失败:', err);
            }
        }, 300); // 延迟300ms，避免频繁同步
    }
}

/**
 * 保存所有视图的编辑模式状态到localStorage
 */
function saveAllEditModeStates() {
    try {
        const allStates = {};
        // 注意：这里不能直接使用同步的require，需要使用异步方式
        // 这个函数主要用于批量保存，实际使用saveEditModeState
    } catch (err) {
        console.warn('保存编辑模式状态失败:', err);
    }
}

/**
 * 获取编辑模式状态的存储key
 * 主窗口和分离窗口使用不同的key，避免互相干扰
 * @returns {string} localStorage的key
 */
function getEditModeStorageKey() {
    // 如果存在 window.opener，说明是分离窗口
    // 或者检查当前页面文件名
    const isSeparatedWindow = window.opener && !window.opener.closed || 
                              window.location.pathname.includes('separated-view.html');
    return isSeparatedWindow ? 'editModeStatesSeparated' : 'editModeStates';
}

/**
 * 保存单个视图的编辑模式状态到localStorage
 * 使用设置中的视图ID（view.id）作为键，确保即使视图顺序改变也能正确恢复
 * 主窗口和分离窗口使用不同的存储key，避免互相干扰
 * @param {string} viewId - 视图ID（来自设置中的view.id）
 * @param {boolean} isEditing - 是否在编辑模式
 */
function saveEditModeState(viewId, isEditing) {
    try {
        // 使用Map索引直接查找，O(1)复杂度
        const view = getViewById(viewId);
        if (!view) {
            // 如果视图ID不在设置中，不保存状态
            console.warn(`视图ID ${viewId} 不在设置中，跳过保存`);
            return;
        }
        
        // 确保viewId与设置中的视图ID完全匹配
        if (view.id !== viewId) {
            console.warn(`视图ID不匹配: ${viewId} !== ${view.id}，跳过保存`);
            return;
        }
        
        // 根据窗口类型获取存储key
        const storageKey = getEditModeStorageKey();
        
        // 加载所有状态
        let allStates = {};
        try {
            const saved = localStorage.getItem(storageKey);
            if (saved) {
                allStates = JSON.parse(saved);
            }
        } catch (e) {
            // 忽略解析错误，重新开始
            allStates = {};
        }
        
        // 使用设置中的视图ID（view.id）作为键
        // 确保viewId是字符串，并且只更新当前视图的状态
        const viewIdStr = String(viewId);
        allStates[viewIdStr] = isEditing;
        
        // 保存所有状态到localStorage
        localStorage.setItem(storageKey, JSON.stringify(allStates));
    } catch (err) {
        console.error('保存编辑模式状态失败:', err);
    }
}

/**
 * 从localStorage加载编辑模式状态
 * 使用设置中的视图ID（view.id）作为键来查找保存的状态
 * 主窗口和分离窗口使用不同的存储key，避免互相干扰
 * @param {string} viewId - 视图ID（来自设置中的view.id）
 * @returns {boolean|undefined} 是否应该在编辑模式，如果没有保存过则返回undefined
 */
function loadEditModeState(viewId) {
    try {
        // 使用Map索引直接查找，O(1)复杂度
        const view = getViewById(viewId);
        if (!view) {
            // 如果视图ID不在设置中，返回undefined
            return undefined;
        }
        
        // 确保viewId与设置中的视图ID完全匹配
        if (view.id !== viewId) {
            return undefined;
        }
        
        // 根据窗口类型获取存储key
        const storageKey = getEditModeStorageKey();
        
        const saved = localStorage.getItem(storageKey);
        if (saved) {
            const allStates = JSON.parse(saved);
            // 使用设置中的视图ID（view.id）作为键来查找
            // 确保viewId是字符串，并且精确匹配
            const viewIdStr = String(viewId);
            // 如果存在保存的状态，返回保存的值（可能是true或false）
            if (viewIdStr in allStates) {
                return allStates[viewIdStr] === true ? true : false;
            }
        }
    } catch (err) {
        console.warn('加载编辑模式状态失败:', err);
    }
    // 如果没有保存过状态，返回undefined，表示没有默认值
    return undefined;
}

/**
 * 更新所有视图的编辑模式状态显示
 * 只更新与设置中视图ID匹配的视图，确保一个对一个
 */
export async function updateAllEditModeStatus() {
    for (const view of state.views) {
        // 确保只更新设置中存在的视图ID
        if (view && view.id) {
            await updateEditModeStatus(view.id);
        }
    }
    
}

/**
 * 一键开关所有视图的编辑模式
 * 根据当前状态切换：如果所有视图都是开启状态，则全部关闭；否则全部开启
 */
export async function toggleAllViewsEditMode() {
    const { isInEditMode, enterEditMode, exitEditMode } = await import('./paragraphEditor.js');
    
    // 统计所有视图中在编辑模式的数量
    let editingCount = 0;
    let totalValidViews = 0;
    
    for (const view of state.views) {
        if (view && view.id) {
            // 直接使用Map索引检查，O(1)复杂度（在循环中已经遍历views，这个检查只是为了确认）
            const viewInState = getViewById(view.id);
            if (viewInState && viewInState.id === view.id) {
                totalValidViews++;
                if (isInEditMode(view.id)) {
                    editingCount++;
                }
            }
        }
    }
    
    // 判断：如果所有视图都在编辑模式，则全部关闭；否则全部开启
    const shouldCloseAll = editingCount === totalValidViews && totalValidViews > 0;
    
    // 执行切换操作
    for (const view of state.views) {
        if (view && view.id) {
            // 直接使用Map索引检查，O(1)复杂度
            const viewInState = getViewById(view.id);
            if (viewInState && viewInState.id === view.id) {
                if (shouldCloseAll) {
                    // 关闭所有视图的编辑模式
                    if (isInEditMode(view.id)) {
                        // 先保存状态，再退出编辑模式（确保状态持久化）
                        saveEditModeState(view.id, false);
                        await exitEditMode(view.id);
                    }
                } else {
                    // 开启所有视图的编辑模式
                    if (!isInEditMode(view.id)) {
                        // 先保存状态，再进入编辑模式（确保状态持久化）
                        saveEditModeState(view.id, true);
                        await enterEditMode(view.id, null);
                    }
                }
            }
        }
    }
    
    // 更新所有视图的状态显示
    await updateAllEditModeStatus();
}

/**
 * 更新导航栏一键开关按钮的状态显示
 */
export async function updateToggleAllEditModeButton() {
    const btn = document.getElementById('btn-toggle-all-edit-mode');
    if (!btn) return;
    
    try {
        // 统计所有视图中在编辑模式的数量
        const { isInEditMode } = await import('./paragraphEditor.js');
        let editingCount = 0;
        let totalValidViews = 0;
        
        for (const view of state.views) {
            if (view && view.id) {
                // 直接使用Map索引检查，O(1)复杂度
                const viewInState = getViewById(view.id);
                if (viewInState && viewInState.id === view.id) {
                    totalValidViews++;
                    if (isInEditMode(view.id)) {
                        editingCount++;
                    }
                }
            }
        }
        
        // 更新按钮显示
        // 如果所有视图都在编辑模式，显示为"开"状态；否则显示为"关"状态
        const iconSpan = btn.querySelector('span:first-child');
        const allEditing = editingCount === totalValidViews && totalValidViews > 0;
        
        if (allEditing) {
            btn.style.background = 'var(--accent-blue)';
            btn.style.color = 'white';
            if (iconSpan) iconSpan.textContent = '✓';
        } else {
            btn.style.background = '';
            btn.style.color = '';
            if (iconSpan) iconSpan.textContent = '✏️';
        }
    } catch (err) {
        console.warn('更新导航栏按钮状态失败:', err);
    }
}


/**
 * 更新编辑模式状态显示
 * 只更新与设置中视图ID匹配的视图，确保一个对一个
 * @param {string} viewId - 视图ID（来自设置中的view.id）
 */
export async function updateEditModeStatus(viewId) {
    // 使用Map索引直接查找，O(1)复杂度
    const view = getViewById(viewId);
    if (!view) {
        // 如果视图ID不在设置中，不更新状态
        return;
    }
    
    // 确保viewId与设置中的视图ID完全匹配
    if (view.id !== viewId) {
        return;
    }
    
    const editStatusEl = document.getElementById(`view-edit-status-${viewId}`);
    const toggleBtn = document.getElementById(`view-edit-toggle-${viewId}`);
    
    if (editStatusEl || toggleBtn) {
        const { isInEditMode } = await import('./paragraphEditor.js');
        // 检查指定视图是否在编辑模式
        const isEditing = isInEditMode(viewId);
        
        if (editStatusEl) {
            editStatusEl.textContent = `| 编辑模式：`;
            editStatusEl.style.color = isEditing ? 'var(--accent-blue)' : 'var(--text-muted)';
        }
        
        if (toggleBtn) {
            if (isEditing) {
                toggleBtn.classList.add('active');
                toggleBtn.textContent = '开';
            } else {
                toggleBtn.classList.remove('active');
                toggleBtn.textContent = '关';
            }
        }
    }
}

/**
 * 设置编辑模式开关事件
 * @param {string} viewId - 视图ID
 */
export function setupEditModeToggle(viewId) {
    const toggleBtn = document.getElementById(`view-edit-toggle-${viewId}`);
    if (!toggleBtn) return;
    
    // 移除旧的事件监听器
    if (toggleBtn._toggleHandler) {
        toggleBtn.removeEventListener('click', toggleBtn._toggleHandler);
    }
    
    // 添加点击事件
    const toggleHandler = async (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        // 防止重复点击
        if (toggleBtn._isToggling) {
            return;
        }
        toggleBtn._isToggling = true;
        
        try {
            const { isInEditMode, enterEditMode, exitEditMode } = await import('./paragraphEditor.js');
            const isEditing = isInEditMode(viewId);
            
            if (isEditing) {
                // 退出编辑模式
                await exitEditMode(viewId);
                // 立即保存状态：关闭编辑模式
                saveEditModeState(viewId, false);
            } else {
                // 进入编辑模式
                await enterEditMode(viewId, null);
                // 立即保存状态：开启编辑模式
                saveEditModeState(viewId, true);
            }
            
            // 等待一小段时间确保状态更新完成
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // 只更新当前视图的状态显示
            await updateEditModeStatus(viewId);
            
            // 再次确认保存状态（确保持久化）
            const { isInEditMode: checkIsInEditMode } = await import('./paragraphEditor.js');
            const finalState = checkIsInEditMode(viewId);
            saveEditModeState(viewId, finalState);
        } finally {
            // 重置标志，允许下次点击
            toggleBtn._isToggling = false;
        }
    };
    
    toggleBtn._toggleHandler = toggleHandler;
    toggleBtn.addEventListener('click', toggleHandler);
}

/**
 * 设置视图点击事件（用于进入编辑模式）- 已废弃
 * @param {string} viewId - 视图ID
 */
function setupViewClickEvents(viewId) {
    const viewEl = document.getElementById(`view-${viewId}`);
    if (!viewEl) return;
    
    // 移除旧的事件监听器（如果存在）
    const oldClickHandler = viewEl._paragraphEditClickHandler;
    const oldDblClickHandler = viewEl._paragraphEditDblClickHandler;
    if (oldClickHandler) {
        viewEl.removeEventListener('click', oldClickHandler);
    }
    if (oldDblClickHandler) {
        viewEl.removeEventListener('dblclick', oldDblClickHandler);
    }
    
    // 用于防止双击时触发两次单击
    let clickTimer = null;
    const CLICK_DELAY = 300; // 300ms内的双击不触发单击
    
    // 单击事件处理
    const clickHandler = async (e) => {
        // 如果点击的是按钮、链接、输入框、表格、跳转链接或其他交互元素，不处理
        if (e.target.closest('button') || 
            e.target.closest('a') || 
            e.target.closest('input') || 
            e.target.closest('table') ||
            e.target.closest('.jump-link') ||
            e.target.closest('.cell-expand-btn') ||
            e.target.closest('.row-expand-btn')) {
            return;
        }
        
        // 如果点击的是编辑器容器，不处理（已经在编辑模式）
        if (e.target.closest('.rich-text-editor-container')) {
            return;
        }
        
        // 检查是否已经在编辑模式
        if (viewEl.querySelector('.rich-text-editor-container')) {
            return;
        }
        
        // 清除之前的定时器
        if (clickTimer) {
            clearTimeout(clickTimer);
            clickTimer = null;
            return; // 如果是双击，不执行单击逻辑
        }
        
        // 设置定时器，延迟执行单击逻辑
        clickTimer = setTimeout(async () => {
            clickTimer = null;
            // 再次检查是否已经在编辑模式（防止双击后进入编辑模式）
            if (viewEl.querySelector('.rich-text-editor-container')) {
                return;
            }
            
            // 单击：进入编辑模式，传递点击事件以定位光标
            const { enterEditMode } = await import('./paragraphEditor.js');
            await enterEditMode(viewId, e);
        }, CLICK_DELAY);
    };
    
    // 双击事件处理
    const dblClickHandler = async (e) => {
        // 清除单击定时器
        if (clickTimer) {
            clearTimeout(clickTimer);
            clickTimer = null;
        }
        
        // 如果点击的是按钮、链接、输入框、表格、跳转链接或其他交互元素，不处理
        if (e.target.closest('button') || 
            e.target.closest('a') || 
            e.target.closest('input') || 
            e.target.closest('table') ||
            e.target.closest('.jump-link') ||
            e.target.closest('.cell-expand-btn') ||
            e.target.closest('.row-expand-btn')) {
            return;
        }
        
        // 如果点击的是编辑器容器，不处理（已经在编辑模式）
        if (e.target.closest('.rich-text-editor-container')) {
            return;
        }
        
        // 检查是否已经在编辑模式
        if (viewEl.querySelector('.rich-text-editor-container')) {
            return;
        }
        
        // 双击：进入编辑模式，传递点击事件以定位光标
        const { enterEditMode } = await import('./paragraphEditor.js');
        await enterEditMode(viewId, e);
    };
    
    // 保存引用以便后续移除
    viewEl._paragraphEditClickHandler = clickHandler;
    viewEl._paragraphEditDblClickHandler = dblClickHandler;
    
    // 绑定事件
    viewEl.addEventListener('click', clickHandler);
    viewEl.addEventListener('dblclick', dblClickHandler);
}

/**
 * 在指定范围选择一句话
 * @param {Range} range - 当前选择范围
 */
function selectSentenceAtRange(range) {
    const selection = window.getSelection();
    const container = range.startContainer;
    const offset = range.startOffset;
    
    // 获取文本内容
    let text = '';
    let textNode = null;
    
    if (container.nodeType === Node.TEXT_NODE) {
        text = container.textContent || container.nodeValue || '';
        textNode = container;
    } else {
        // 查找文本节点
        const walker = document.createTreeWalker(
            container,
            NodeFilter.SHOW_TEXT,
            null
        );
        textNode = walker.nextNode();
        if (textNode) {
            text = textNode.textContent || textNode.nodeValue || '';
        } else {
            return;
        }
    }
    
    if (!text) return;
    
    // 找到句子边界（中文句号、英文句号、问号、感叹号等）
    const sentenceEndings = /[。！？.!?]/;
    let start = 0;
    let end = text.length;
    
    // 向前查找句子开始
    for (let i = offset - 1; i >= 0; i--) {
        if (sentenceEndings.test(text[i]) || text[i] === '\n') {
            start = i + 1;
            break;
        }
    }
    
    // 向后查找句子结束
    for (let i = offset; i < text.length; i++) {
        if (sentenceEndings.test(text[i]) || text[i] === '\n') {
            end = i + 1;
            break;
        }
    }
    
    // 创建新的范围
    const newRange = document.createRange();
    if (textNode) {
        newRange.setStart(textNode, start);
        newRange.setEnd(textNode, end);
    }
    
    selection.removeAllRanges();
    selection.addRange(newRange);
}

/**
 * 在指定元素查找句子范围
 * @param {Element} element - 元素
 * @returns {Range|null}
 */
function findSentenceAtElement(element) {
    // 查找包含文本的节点
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null
    );
    
    let textNode = walker.nextNode();
    if (!textNode) {
        // 如果没有文本节点，尝试获取元素的文本内容
        const text = element.textContent || '';
        if (!text) return null;
        
        // 创建一个临时文本节点
        const tempDiv = document.createElement('div');
        tempDiv.textContent = text;
        textNode = tempDiv.firstChild;
    }
    
    if (!textNode) return null;
    
    const text = textNode.textContent || textNode.nodeValue || '';
    if (!text) return null;
    
    // 使用文本中间位置作为起点
    const offset = Math.floor(text.length / 2);
    
    const sentenceEndings = /[。！？.!?]/;
    let start = 0;
    let end = text.length;
    
    // 向前查找句子开始
    for (let i = offset - 1; i >= 0; i--) {
        if (sentenceEndings.test(text[i]) || text[i] === '\n') {
            start = i + 1;
            break;
        }
    }
    
    // 向后查找句子结束
    for (let i = offset; i < text.length; i++) {
        if (sentenceEndings.test(text[i]) || text[i] === '\n') {
            end = i + 1;
            break;
        }
    }
    
    const range = document.createRange();
    if (textNode.nodeType === Node.TEXT_NODE) {
        range.setStart(textNode, start);
        range.setEnd(textNode, end);
    } else {
        return null;
    }
    
    return range;
}

/**
 * 下载当前视图的表格为Excel文件
 * @param {string} viewId - 视图ID
 */
export async function downloadViewTableAsExcel(viewId) {
    // 检查xlsx库是否可用
    if (typeof XLSX === 'undefined') {
        alert('Excel导出功能需要加载xlsx库，请刷新页面重试');
        return;
    }

    // 获取当前视图的DOM元素
    const viewEl = document.getElementById(`view-${viewId}`);
    if (!viewEl) {
        alert('无法找到视图元素');
        return;
    }

    // 获取视图中的所有表格
    const tables = viewEl.querySelectorAll('table');
    if (tables.length === 0) {
        alert('当前视图没有表格');
        return;
    }

    // 获取当前文件路径和文件名
    const currentPath = state.panePaths[viewId] || '';
    let fileName = '未命名文件';
    if (currentPath) {
        const lastSeparatorIndex = Math.max(currentPath.lastIndexOf('\\'), currentPath.lastIndexOf('/'));
        const fullFileName = lastSeparatorIndex >= 0 ? currentPath.substring(lastSeparatorIndex + 1) : currentPath;
        const lastDotIndex = fullFileName.lastIndexOf('.');
        fileName = lastDotIndex > 0 ? fullFileName.substring(0, lastDotIndex) : fullFileName;
    }

    // 生成时间戳（某某年，某某月，某某日，几小时，几分）
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const timestamp = `${year}年${month}月${day}日${hour}时${minute}分`;

    // 生成Excel文件名：视图ID + 文件名 + 时间戳
    const excelFileName = `${viewId}_${fileName}_${timestamp}.xlsx`;

    // 创建工作簿
    const wb = XLSX.utils.book_new();

    // 处理每个表格
    tables.forEach((table, tableIndex) => {
        // 解析表格数据
        const rows = Array.from(table.rows);
        if (rows.length === 0) return;

        const tableData = [];
        
        rows.forEach((row) => {
            const cells = Array.from(row.cells);
            const rowData = cells.map(cell => {
                // 获取单元格的纯文本内容
                let text = cell.textContent.trim();
                // 清理字符串末尾的">"符号（一个或多个），包括可能存在的空格和换行符
                // 使用全局匹配，确保清理所有末尾的">"符号
                text = text.replace(/>+\s*$/gm, '').trim();
                // 如果清理后末尾还有">"，再次清理（防止某些特殊情况）
                while (text.endsWith('>')) {
                    text = text.slice(0, -1).trim();
                }
                return text;
            });
            tableData.push(rowData);
        });

        // 创建工作表
        const ws = XLSX.utils.aoa_to_sheet(tableData);

        // 设置列宽（自动调整）
        const colWidths = [];
        if (tableData.length > 0) {
            const maxCols = Math.max(...tableData.map(row => row.length));
            for (let i = 0; i < maxCols; i++) {
                let maxWidth = 10;
                tableData.forEach(row => {
                    if (row[i] && row[i].length > maxWidth) {
                        maxWidth = Math.min(row[i].length, 50); // 最大宽度限制为50
                    }
                });
                colWidths.push({ wch: maxWidth });
            }
            ws['!cols'] = colWidths;
        }

        // 工作表名称：如果有多个表格，使用索引区分
        const sheetName = tables.length > 1 ? `表格${tableIndex + 1}` : '表格';
        
        // 添加工作表到工作簿
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    // 如果没有有效的工作表，提示用户
    if (wb.SheetNames.length === 0) {
        alert('没有找到有效的表格数据');
        return;
    }

    // 生成Excel文件并下载
    try {
        XLSX.writeFile(wb, excelFileName);
        
        // 显示成功反馈
        showButtonSuccessFeedback(`.view-download-excel-btn[data-view-id="${viewId}"]`);
    } catch (error) {
        alert('下载Excel文件失败: ' + error.message);
        console.error('下载Excel文件错误:', error);
    }
}

/**
 * 交换单个视图的原始文件和AI文件的内容
 * @param {string} viewId - 视图ID
 */
export async function swapViewFileContent(viewId) {
    if (!state.originalPath) {
        alert('请先选择文件');
        return;
    }
    
    // 获取原始文件路径（如果还没有保存，则使用当前路径）
    if (!state.originalPanePaths[viewId]) {
        state.originalPanePaths[viewId] = state.panePaths[viewId];
    }
    
    const originalPath = state.originalPanePaths[viewId];
    if (!originalPath) {
        alert('无法确定原始文件路径');
        return;
    }
    
    // 使用 switchToAiFile 的逻辑来定位AI文件路径
    const lastSeparatorIndex = Math.max(state.originalPath.lastIndexOf('\\'), state.originalPath.lastIndexOf('/'));
    const fileName = lastSeparatorIndex >= 0 ? state.originalPath.substring(lastSeparatorIndex + 1) : state.originalPath;
    const lastDotIndex = fileName.lastIndexOf('.');
    const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
    const ext = lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1) : '';
    
    // 构建AI文件路径：文件名 + "_" + 视图ID + "_AI" + 扩展名
    const aiFileName = `${baseName}_${viewId}_AI${ext ? '.' + ext : ''}`;
    const { getFileInFolderPath } = await import('../utils/fileUtils.js');
    const aiFilePath = getFileInFolderPath(state.originalPath, aiFileName);
    
    // 读取两个文件的内容
    let originalContent = '';
    let aiContent = '';
    
    try {
        const originalContentResult = await getFile(originalPath);
        if (originalContentResult.trim().startsWith('{') && originalContentResult.includes('"error"')) {
            originalContent = ''; // 文件不存在，使用空内容
        } else {
            originalContent = originalContentResult;
        }
    } catch (error) {
        originalContent = ''; // 文件不存在，使用空内容
    }
    
    try {
        const aiContentResult = await getFile(aiFilePath);
        if (aiContentResult.trim().startsWith('{') && aiContentResult.includes('"error"')) {
            aiContent = ''; // 文件不存在，使用空内容
        } else {
            aiContent = aiContentResult;
        }
    } catch (error) {
        aiContent = ''; // 文件不存在，使用空内容
    }
    
    // 交换内容：将原始文件内容写入AI文件，将AI文件内容写入原始文件
    try {
        await saveFile(aiFilePath, originalContent);
        await saveFile(originalPath, aiContent);
    } catch (error) {
        alert('交换文件内容失败: ' + error.message);
        return;
    }
    
    // 重新加载当前视图（不改变显示状态，只是刷新内容）
    await loadSingleView(viewId);
    
    // 显示成功反馈效果（在加载完成后显示）
    showButtonSuccessFeedback(`.view-swap-file-btn[data-view-id="${viewId}"]`);
}

/**
 * 交换所有视图的原始文件和AI文件的内容
 */
export async function swapAllViewsFileContent() {
    if (!state.originalPath) {
        alert('请先选择文件');
        return;
    }
    
    // 对所有视图执行交换操作
    for (const view of state.views) {
        await swapViewFileContent(view.id);
    }
    
    // 更新所有视图的编辑模式状态显示
    await updateAllEditModeStatus();
}

/**
 * 切换所有视图到_ai版本文件或回退
 */
export async function switchAllViewsToAi() {
    if (!state.originalPath) {
        return;
    }
    
    // 检查是否所有视图都显示_ai文件
    const allShowingAi = state.views.every(view => state.viewAiStates[view.id] === true);
    
    // 切换所有视图
    for (const view of state.views) {
        // 保存原始路径
        if (!state.originalPanePaths[view.id]) {
            state.originalPanePaths[view.id] = state.panePaths[view.id];
        }
        
        if (allShowingAi) {
            // 所有都显示_ai，切换回原始文件
            state.viewAiStates[view.id] = false;
            state.panePaths[view.id] = state.originalPanePaths[view.id];
        } else {
            // 切换到_AI文件
            // 从 state.originalPath 获取基础文件名（而不是从 originalPath，因为 originalPath 可能已包含 suffix）
            const lastSeparatorIndex = Math.max(state.originalPath.lastIndexOf('\\'), state.originalPath.lastIndexOf('/'));
            const fileName = lastSeparatorIndex >= 0 ? state.originalPath.substring(lastSeparatorIndex + 1) : state.originalPath;
            const lastDotIndex = fileName.lastIndexOf('.');
            const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
            const ext = lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1) : '';
            
            // 构建新文件路径：文件名 + "_" + 视图ID + "_AI" + 扩展名
            // AI文件保存在文件名文件夹内
            const aiFileName = `${baseName}_${view.id}_AI${ext ? '.' + ext : ''}`;
            const { getFileInFolderPath } = await import('../utils/fileUtils.js');
            const aiFilePath = getFileInFolderPath(state.originalPath, aiFileName);
            
            // 直接切换，不检查文件是否存在（如果不存在会显示"文件未找到"）
            state.viewAiStates[view.id] = true;
            state.panePaths[view.id] = aiFilePath;
        }
    }
    
    // 重新加载所有视图（恢复用户之前选择的编辑模式状态）
    for (const view of state.views) {
        await loadSingleView(view.id, false); // 传递skipEditModeRestore=false，恢复用户之前保存的编辑模式状态
    }
    
    // 更新所有视图的编辑模式状态显示
    await updateAllEditModeStatus();
    
    // 为所有视图的切换AI按钮显示成功反馈
    for (const view of state.views) {
        showButtonSuccessFeedback(`.view-switch-ai-btn[data-view-id="${view.id}"]`);
    }
}

/**
 * 渲染视图网格
 */
export function renderViewerGrid() {
    const grid = document.getElementById('viewer-grid');
    if (!grid) return;
    
    grid.innerHTML = '';

    state.views.forEach((view, index) => {
        const pane = document.createElement('div');
        pane.className = 'pane';
        pane.innerHTML = `
            <div class="pane-bar">
                <div style="display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0;">
                    <span id="title-${view.id}" style="word-wrap: break-word; word-break: break-all; line-height: 1.4;">${(() => {
                        // 获取视图的suffix（从视图配置中动态获取）
                        const viewSuffix = (view.suffix !== undefined && view.suffix !== null && String(view.suffix).trim() !== '') 
                            ? view.suffix 
                            : '';
                        // 如果还没有加载文件，显示空文件名，否则会在loadSingleView中更新
                        return view.titleTemplate.replace('{filename}', '');
                    })()}</span>
                    <span id="view-status-${view.id}" style="font-size: 14px; color: var(--accent-blue); font-weight: bold; flex-shrink: 0;">当前是：主视图</span>
                    <div style="display: flex; align-items: center; gap: 4px; margin-left: 8px; flex-shrink: 0;">
                        <span id="view-edit-status-${view.id}" style="font-size: 14px; color: var(--text-muted); font-weight: normal;">| 编辑模式：</span>
                        <button id="view-edit-toggle-${view.id}" class="view-edit-toggle-btn ${(() => { const viewInState = getViewById(view.id); if (viewInState && viewInState.id === view.id) { const savedState = loadEditModeState(view.id); return savedState === true ? 'active' : ''; } return ''; })()}" data-view-id="${view.id}" title="切换编辑模式">${(() => { const viewInState = getViewById(view.id); if (viewInState && viewInState.id === view.id) { const savedState = loadEditModeState(view.id); if (savedState === true) return '开'; if (savedState === false) return '关'; return '关'; } return '关'; })()}</button>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 4px;">
                    <button class="view-download-excel-btn" data-view-id="${view.id}" style="background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-muted); cursor: pointer; font-size: 12px; width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" title="下载表格为Excel">📊</button>
                    <button class="view-swap-file-btn" data-view-id="${view.id}" style="background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-muted); cursor: pointer; font-size: 12px; width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" title="交换文件内容">⇄</button>
                    <button class="view-switch-ai-btn" data-view-id="${view.id}" style="background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-muted); cursor: pointer; font-size: 12px; width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" title="切换到_AI文件">🔄</button>
                    <button class="view-paste-btn" data-view-id="${view.id}" style="background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-muted); cursor: pointer; font-size: 12px; width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" title="粘贴到此视图">📄</button>
                    <button class="view-copy-btn" data-view-id="${view.id}" style="background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-muted); cursor: pointer; font-size: 12px; width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" title="复制此视图内容">📋</button>
                    <button class="view-send-deepseek-btn" data-view-id="${view.id}" style="background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-muted); cursor: pointer; font-size: 12px; width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" title="发送此视图到 DeepSeek (快捷键: n)">🚀</button>
                    <span class="view-paste-ok" data-view-id="${view.id}" style="font-size: 11px; font-weight: bold; color: var(--accent); opacity: 0; transition: opacity 0.2s;">OK</span>
                </div>
                <!-- 拖拽手柄：放在当前视图右侧，右对齐显示 -->
                <div class="view-drag-handle" style="
                    cursor: move;
                    padding: 4px 8px;
                    margin-left: 8px;
                    color: var(--text-muted);
                    user-select: none;
                    font-size: 16px;
                    line-height: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                " title="拖拽分离窗口" data-view-id="${view.id}">⋮⋮</div>
            </div>
            <div class="pane-content md-render" id="view-${view.id}"></div>
        `;
        
        // 使用容器包装工具包装pane
        const container = wrapViewInContainer(pane, view.id);
        
        // 错误处理：如果包装失败，回退到原始方式
        if (!container) {
            console.warn(`视图 ${view.id} 包装失败，使用原始方式`);
            grid.appendChild(pane);
        } else {
            // 包装成功，添加容器到grid
            grid.appendChild(container);
        }

        // 为每个视图添加滚动事件监听，保存滚动位置
        const paneContent = document.getElementById(`view-${view.id}`);
        if (paneContent) {
            paneContent.addEventListener('scroll', function() {
                if (!state.scrollPositions) state.scrollPositions = {};
                state.scrollPositions[view.id] = this.scrollTop;
            });
            
            // 设置编辑模式开关事件
            setupEditModeToggle(view.id);
            
            // 恢复编辑模式状态（根据用户之前保存的选择）
            // 直接使用Map索引检查，O(1)复杂度
            const viewInState = getViewById(view.id);
            if (viewInState && viewInState.id === view.id) {
                // 只有视图ID与设置中的视图ID匹配时才恢复状态
                const savedState = loadEditModeState(view.id);
                if (savedState === true) {
                    // 如果之前保存为开启，则进入编辑模式
                    setTimeout(async () => {
                        const { enterEditMode } = await import('./paragraphEditor.js');
                        await enterEditMode(view.id, null);
                        await updateEditModeStatus(view.id);
                    }, 200);
                } else if (savedState === false) {
                    // 如果之前保存为关闭，确保不在编辑模式（页面刷新后editingViews是空的，所以只需要更新显示状态）
                    setTimeout(async () => {
                        await updateEditModeStatus(view.id);
                    }, 50);
                } else {
                    // 如果没有保存过状态，默认关闭编辑模式（不强制进入）
                    // 这样可以确保用户明确选择开启时才会开启
                    setTimeout(async () => {
                        await updateEditModeStatus(view.id);
                    }, 50);
                }
            } else {
                // 如果视图ID不匹配，只更新显示状态（不恢复编辑模式）
                setTimeout(async () => {
                    await updateEditModeStatus(view.id);
                    await updateToggleAllEditModeButton();
                }, 50);
            }
        }
        
        // 为下载Excel按钮添加事件监听器
        const downloadExcelBtn = pane.querySelector('.view-download-excel-btn');
        if (downloadExcelBtn) {
            downloadExcelBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await downloadViewTableAsExcel(view.id);
            });

            // 添加悬停效果
            downloadExcelBtn.addEventListener('mouseenter', function() {
                this.style.background = 'var(--accent-bg)';
                this.style.borderColor = 'var(--accent-blue)';
                this.style.color = 'var(--accent-blue)';
            });

            downloadExcelBtn.addEventListener('mouseleave', function() {
                this.style.background = 'var(--bg-tertiary)';
                this.style.borderColor = 'var(--border)';
                this.style.color = 'var(--text-muted)';
            });
        }

        // 为交换文件内容按钮添加事件监听器
        const swapFileBtn = pane.querySelector('.view-swap-file-btn');
        if (swapFileBtn) {
            swapFileBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await swapViewFileContent(view.id);
            });

            // 添加悬停效果
            swapFileBtn.addEventListener('mouseenter', function() {
                this.style.background = 'var(--accent-bg)';
                this.style.borderColor = 'var(--accent-blue)';
                this.style.color = 'var(--accent-blue)';
            });

            swapFileBtn.addEventListener('mouseleave', function() {
                this.style.background = 'var(--bg-tertiary)';
                this.style.borderColor = 'var(--border)';
                this.style.color = 'var(--text-muted)';
            });
        }

        // 为切换AI文件按钮添加事件监听器
        const switchAiBtn = pane.querySelector('.view-switch-ai-btn');
        if (switchAiBtn) {
            switchAiBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await switchToAiFile(view.id);
            });

            // 添加悬停效果
            switchAiBtn.addEventListener('mouseenter', function() {
                this.style.background = 'var(--accent-bg)';
                this.style.borderColor = 'var(--accent-blue)';
                this.style.color = 'var(--accent-blue)';
            });

            switchAiBtn.addEventListener('mouseleave', function() {
                this.style.background = 'var(--bg-tertiary)';
                this.style.borderColor = 'var(--border)';
                this.style.color = 'var(--text-muted)';
            });
        }

        // 为粘贴按钮添加事件监听器
        const pasteBtn = pane.querySelector('.view-paste-btn');
        if (pasteBtn) {
            pasteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const radio = document.querySelector(`input[name="paste-target"][value="${view.id}"]`);
                if (radio) {
                    radio.checked = true;
                }
                if (window.handlePaste) {
                    await window.handlePaste();
                }
            });

            // 添加悬停效果
            pasteBtn.addEventListener('mouseenter', function() {
                this.style.background = 'var(--accent-bg)';
                this.style.borderColor = 'var(--accent-blue)';
                this.style.color = 'var(--accent-blue)';
            });

            pasteBtn.addEventListener('mouseleave', function() {
                this.style.background = 'var(--bg-tertiary)';
                this.style.borderColor = 'var(--border)';
                this.style.color = 'var(--text-muted)';
            });
        }

        // 为复制按钮添加事件监听器
        const copyBtn = pane.querySelector('.view-copy-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.copyViewContent) {
                    window.copyViewContent(view.id);
                }
            });

            // 添加悬停效果
            copyBtn.addEventListener('mouseenter', function() {
                this.style.background = 'var(--accent-bg)';
                this.style.borderColor = 'var(--accent-blue)';
                this.style.color = 'var(--accent-blue)';
            });

            copyBtn.addEventListener('mouseleave', function() {
                this.style.background = 'var(--bg-tertiary)';
                this.style.borderColor = 'var(--border)';
                this.style.color = 'var(--text-muted)';
            });
        }

        // 为发送到 DeepSeek 按钮添加事件监听器
        const sendDeepSeekBtn = pane.querySelector('.view-send-deepseek-btn');
        if (sendDeepSeekBtn) {
            sendDeepSeekBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const { sendSingleViewToDeepSeek } = await import('./deepseekSender.js');
                await sendSingleViewToDeepSeek(view.id);
            });

            // 添加悬停效果
            sendDeepSeekBtn.addEventListener('mouseenter', function() {
                this.style.background = 'var(--accent-bg)';
                this.style.borderColor = 'var(--accent-blue)';
                this.style.color = 'var(--accent-blue)';
            });

            sendDeepSeekBtn.addEventListener('mouseleave', function() {
                this.style.background = 'var(--bg-tertiary)';
                this.style.borderColor = 'var(--border)';
                this.style.color = 'var(--text-muted)';
            });
        }
    });
}

/**
 * 渲染粘贴目标选择器
 */
// 窗口大小变化时重新调整布局
let resizeTimer = null;
if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            adjustPasteTargetsLayout();
        }, 150);
    });
}

export function renderPasteTargets() {
    const container = document.getElementById('paste-targets-container');
    if (!container) return;
    
    // 保存主题切换按钮（如果存在）
    const themeToggleBtn = container.querySelector('#toggle-theme-mode-btn-header');
    
    // 清空容器，但保留主题切换按钮
    container.innerHTML = '<span class="paste-label" style="font-size: 11px; font-weight: bold; color: var(--text-muted);">Ctrl+V:</span>';
    
    // 渲染所有视图的粘贴目标
    state.views.forEach((view, index) => {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.gap = '5px';
        div.innerHTML = `
            <label class="toggle-switch">
                <input type="radio" name="paste-target" value="${view.id}" ${index === 0 ? 'checked' : ''}>
                <span class="toggle-slider"></span>
            </label>
            <span style="font-size: 11px; font-weight: bold; color: var(--accent);">${view.id}</span>
        `;
        container.appendChild(div);
    });
    
    // 重新添加主题切换按钮（如果之前存在）
    if (themeToggleBtn) {
        container.appendChild(themeToggleBtn);
    } else {
        // 如果不存在，创建一个新的
        const newThemeBtn = document.createElement('button');
        newThemeBtn.className = 'btn btn-icon-only';
        newThemeBtn.id = 'toggle-theme-mode-btn-header';
        newThemeBtn.title = '切换日间/夜间主题';
        newThemeBtn.textContent = '🌓';
        // 绑定事件（使用动态导入，避免循环依赖）
        import('./themeManager.js').then(({ toggleThemeMode }) => {
            newThemeBtn.onclick = toggleThemeMode;
        }).catch(() => {
            // 如果导入失败，尝试从全局获取
            if (window.toggleThemeMode) {
                newThemeBtn.onclick = window.toggleThemeMode;
            }
        });
        container.appendChild(newThemeBtn);
    }
    
    // 渲染完成后，调整按钮布局以实现更均匀的换行
    setTimeout(() => {
        adjustPasteTargetsLayout();
    }, 150);
}

/**
 * 调整粘贴目标按钮布局，使换行时上下行按钮数量更均匀
 */
function adjustPasteTargetsLayout() {
    const container = document.getElementById('paste-targets-container');
    if (!container) return;
    
    // 移除之前添加的占位符
    const existingPlaceholders = container.querySelectorAll('.paste-target-placeholder');
    existingPlaceholders.forEach(placeholder => placeholder.remove());
    
    const buttons = Array.from(container.querySelectorAll('div'));
    if (buttons.length === 0) return;
    
    // 先重置所有按钮的样式
    buttons.forEach(button => {
        button.style.flex = '';
        button.style.width = '';
        button.style.maxWidth = '';
        button.style.minWidth = '';
    });
    
    // 等待布局稳定后计算
    setTimeout(() => {
        // 计算占位宽度：只使用"Ctrl+V:"标签的宽度
        let placeholderWidth = 0;
        const ctrlVLabel = container.querySelector('span.paste-label');
        const containerStyle = window.getComputedStyle(container);
        const gap = parseFloat(containerStyle.gap) || 8;
        
        if (ctrlVLabel) {
            const labelRect = ctrlVLabel.getBoundingClientRect();
            // 只使用"Ctrl+V:"标签的宽度，加上gap
            placeholderWidth = labelRect.width + gap;
        }
        
        if (placeholderWidth <= 0) {
            // 调试日志已关闭：布局调整占位宽度计算失败
            return;
        }
        
        // 检测哪些按钮在同一行，使用更精确的方法
        const rows = [];
        let currentRow = [];
        let currentTop = null;
        const tolerance = 2; // 允许2px的误差
        
        buttons.forEach((button, index) => {
            const rect = button.getBoundingClientRect();
            const top = Math.round(rect.top);
            
            if (currentTop === null) {
                // 第一个按钮
                currentTop = top;
                currentRow.push({ button, index, top });
            } else if (Math.abs(top - currentTop) <= tolerance) {
                // 同一行（允许小误差）
                currentRow.push({ button, index, top });
            } else {
                // 换行了
                if (currentRow.length > 0) {
                    rows.push(currentRow);
                }
                currentRow = [{ button, index, top }];
                currentTop = top;
            }
        });
        
        // 添加最后一行
        if (currentRow.length > 0) {
            rows.push(currentRow);
        }
        
        // 调试日志已关闭：布局调整行数统计
        
        // 在每行的第一个按钮之前添加占位符（除了第一行）
        rows.forEach((row, rowIndex) => {
            if (rowIndex > 0 && row.length > 0 && placeholderWidth > 0) {
                const firstButton = row[0].button;
                
                // 检查是否已经有占位符
                const prevSibling = firstButton.previousElementSibling;
                if (prevSibling && prevSibling.classList.contains('paste-target-placeholder')) {
                    return; // 已经有占位符了
                }
                
                const placeholder = document.createElement('span');
                placeholder.className = 'paste-target-placeholder';
                placeholder.style.width = `${placeholderWidth}px`;
                placeholder.style.flexShrink = '0';
                placeholder.style.display = 'inline-block';
                placeholder.style.visibility = 'hidden'; // 隐藏但占位
                placeholder.style.height = '1px'; // 确保有高度
                placeholder.style.pointerEvents = 'none'; // 不响应鼠标事件
                placeholder.style.boxSizing = 'border-box';
                
                // 插入到第一个按钮之前
                firstButton.parentNode.insertBefore(placeholder, firstButton);
                console.log(`[布局调整] 在第 ${rowIndex + 1} 行添加占位符，宽度: ${placeholderWidth}px`);
            }
        });
    }, 200);
}

/**
 * 渲染设置界面
 */
export async function renderSettings() {
    const viewSelector = document.getElementById('view-selector');
    const currentViewConfig = document.getElementById('current-view-config');
    if (!viewSelector || !currentViewConfig) return;
    
    // 关键修复：确保提示词列表已加载，这样首次显示视图配置时就能正确填充提示词选择器
    if (!state.prompts || state.prompts.length === 0) {
        try {
            const { loadPrompts } = await import('./promptManager.js');
            await loadPrompts();
        } catch (err) {
            console.warn('[renderSettings] 加载提示词失败:', err);
        }
    }
    
    // 填充视图选择器
    viewSelector.innerHTML = '<option value="">请选择视图</option>';
    state.views.forEach(view => {
        const option = document.createElement('option');
        option.value = view.id;
        option.textContent = view.id;
        viewSelector.appendChild(option);
    });
    
    // 如果有视图，默认选择第一个
    if (state.views.length > 0 && !viewSelector.value) {
        viewSelector.value = state.views[0].id;
    }
    
    // 视图选择器变化时更新显示的配置
    viewSelector.onchange = () => {
        renderCurrentViewConfig(viewSelector.value);
    };
    
    // 初始渲染当前视图配置
    renderCurrentViewConfig(viewSelector.value);
    
    // 渲染全局快捷键设置
    const keyW = document.getElementById('key-w');
    const keyS = document.getElementById('key-s');
    const keyA = document.getElementById('key-a');
    const keyD = document.getElementById('key-d');
    
    if (keyW) keyW.value = state.keybinds.w;
    if (keyS) keyS.value = state.keybinds.s;
    if (keyA) keyA.value = state.keybinds.a;
    if (keyD) keyD.value = state.keybinds.d;
    
    // 初始化外部AI设置（仅主机用户可见）
    const externalAiSection = document.getElementById('external-ai-settings-section');
    const externalAiToggle = document.getElementById('external-ai-sync-toggle');
    const externalAiStatus = document.getElementById('external-ai-sync-status');
    
    if (externalAiSection && externalAiToggle && externalAiStatus) {
        // 根据主机用户状态显示/隐藏
        if (window.isLocalAccess === true) {
            externalAiSection.style.display = '';
            // 根据 state 设置按钮状态
            updateExternalAiToggleState();
        } else {
            externalAiSection.style.display = 'none';
        }
    }
    
    // 初始化F12日志控制设置（直接复制永久删除按钮的显示逻辑）
    const f12LogSections = document.querySelectorAll('#f12-log-settings-section');
    f12LogSections.forEach(section => {
        const isLocalAccess = window.isLocalAccess !== undefined ? window.isLocalAccess : true;
        if (isLocalAccess) {
            section.style.display = '';
        } else {
            section.style.display = 'none';
        }
    });
    
    // 如果设置页面已渲染且是本地访问，更新开关状态并绑定事件
    const f12LogToggle = document.getElementById('f12-log-toggle');
    const f12LogStatus = document.getElementById('f12-log-status');
    if (f12LogToggle && f12LogStatus) {
        const isLocalAccess = window.isLocalAccess !== undefined ? window.isLocalAccess : true;
        if (isLocalAccess) {
            // 关键修复：先更新按钮状态，确保初始状态正确
            // 直接调用函数，不使用typeof检查（因为函数已经导入）
            updateF12LogToggleState();
            
            // 关键修复：使用事件委托或者直接绑定，避免cloneNode导致的问题
            // 先移除旧的事件监听器（如果存在）
            const oldHandler = f12LogToggle._f12LogToggleHandler;
            if (oldHandler) {
                f12LogToggle.removeEventListener('click', oldHandler);
            }
            
            // 创建新的事件处理函数
            const newHandler = () => {
                // 关键修复：正确读取当前状态
                // localStorage中存储的是字符串'true'或'false'，或者null（默认开启）
                const currentValue = localStorage.getItem('f12LogEnabled');
                // 如果当前值是'true'或null（默认开启），则切换为关闭（'false'）
                // 如果当前值是'false'，则切换为开启（'true'）
                const isCurrentlyEnabled = currentValue !== 'false'; // null或'true'都视为开启
                const newValue = isCurrentlyEnabled ? 'false' : 'true';
                
                localStorage.setItem('f12LogEnabled', newValue);
                
                // 立即更新按钮状态
                updateF12LogToggleState();
            };
            
            // 保存处理函数引用，以便后续移除
            f12LogToggle._f12LogToggleHandler = newHandler;
            
            // 绑定切换事件
            f12LogToggle.addEventListener('click', newHandler);
        }
    }
}

/**
 * 更新F12日志控制开关状态
 */
export function updateF12LogToggleState() {
    const f12LogToggle = document.getElementById('f12-log-toggle');
    const f12LogStatus = document.getElementById('f12-log-status');
    
    if (f12LogToggle && f12LogStatus) {
        // 关键修复：正确读取localStorage的值
        // localStorage.getItem返回字符串'true'、'false'或null
        // 默认开启：如果值为null或'true'，则开启；如果值为'false'，则关闭
        const storedValue = localStorage.getItem('f12LogEnabled');
        const isEnabled = storedValue !== 'false'; // null或'true'都视为开启，只有'false'是关闭
        
        if (isEnabled) {
            f12LogStatus.textContent = '开启';
            f12LogToggle.classList.remove('btn-secondary');
            f12LogToggle.classList.add('btn-primary');
            // 确保按钮文本颜色正确
            f12LogToggle.style.color = '';
        } else {
            f12LogStatus.textContent = '关闭';
            f12LogToggle.classList.remove('btn-primary');
            f12LogToggle.classList.add('btn-secondary');
            // 确保按钮文本颜色正确
            f12LogToggle.style.color = '';
        }
        
        // 调试日志（仅在开发时使用）
        if (window.DEBUG) {
            console.log('[F12日志控制] 状态更新:', {
                storedValue: storedValue,
                isEnabled: isEnabled,
                buttonText: f12LogStatus.textContent,
                buttonClasses: f12LogToggle.className
            });
        }
    }
}

/**
 * 更新外部AI开关按钮的状态显示
 */
export function updateExternalAiToggleState() {
    const externalAiToggle = document.getElementById('external-ai-sync-toggle');
    const externalAiStatus = document.getElementById('external-ai-sync-status');
    
    if (externalAiToggle && externalAiStatus) {
        if (state.externalAiSyncEnabled) {
            externalAiStatus.textContent = '开启';
            externalAiToggle.classList.remove('btn-secondary');
            externalAiToggle.classList.add('btn-primary');
        } else {
            externalAiStatus.textContent = '关闭';
            externalAiToggle.classList.remove('btn-primary');
            externalAiToggle.classList.add('btn-secondary');
        }
    }
}

/**
 * 渲染当前选中的视图配置
 */
function renderCurrentViewConfig(viewId) {
    const currentViewConfig = document.getElementById('current-view-config');
    if (!currentViewConfig) return;
    
    if (!viewId) {
        currentViewConfig.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 40px;">请选择一个视图</p>';
        return;
    }
    
    // 使用Map索引直接查找，O(1)复杂度
    const view = getViewById(viewId);
    if (!view) {
        currentViewConfig.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 40px;">视图不存在</p>';
        return;
    }
    
    // 如果视图没有快捷键设置，则分配一个新的字母
    if (!view.keybind) {
        const usedKeys = state.views.filter(v => v.keybind).map(v => v.keybind.toLowerCase());
        let keyCandidate = 'a'.charCodeAt(0);
        while (usedKeys.includes(String.fromCharCode(keyCandidate))) {
            keyCandidate++;
        }
        view.keybind = String.fromCharCode(keyCandidate);
    }

    // 确保视图有promptId、suffix和OpenAI配置属性
    if (!view.promptId) view.promptId = null;
    if (view.suffix === undefined || view.suffix === null) {
        view.suffix = '';
    }
    if (!view.openaiConfig) view.openaiConfig = {
        apiKey: '',
        apiUrl: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-3.5-turbo'
    };
    
    const configDiv = document.createElement('div');
    configDiv.className = 'view-config';
    configDiv.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 16px;">
            <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--text-primary);">视图ID:</label>
                <input type="text" value="${view.id}" data-field="id" data-view-id="${view.id}" style="width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: var(--border-radius); background: var(--bg-tertiary); color: var(--text-primary);">
            </div>
            <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--text-primary);">标题模板 (使用 {filename}):</label>
                <input type="text" value="${view.titleTemplate}" data-field="titleTemplate" data-view-id="${view.id}" style="width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: var(--border-radius); background: var(--bg-tertiary); color: var(--text-primary);">
            </div>
            <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--text-primary);">文件后缀 (e.g. '_analysis'，留空表示主文件):</label>
                <input type="text" value="${view.suffix || ''}" data-field="suffix" data-view-id="${view.id}" placeholder="留空表示主文件（保存在根目录）" style="width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: var(--border-radius); background: var(--bg-tertiary); color: var(--text-primary);">
            </div>
            <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--text-primary);">当前视图提示词设置:</label>
                <select id="view-prompt-select-${view.id}" data-view-id="${view.id}" style="width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: var(--border-radius); background: var(--bg-tertiary); color: var(--text-primary);">
                    <option value="">无</option>
                </select>
            </div>
            <div style="margin-top: 10px; padding-top: 16px; border-top: 1px solid var(--border);">
                <label style="display: block; margin-bottom: 12px; font-weight: bold; color: var(--accent-blue);">OpenAI配置:</label>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    <div>
                        <label style="display: block; margin-bottom: 6px; font-size: 13px; color: var(--text-secondary);">API Key:</label>
                        <input type="password" id="view-openai-key-${view.id}" data-view-id="${view.id}" value="${view.openaiConfig?.apiKey || ''}" placeholder="sk-..." style="width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: var(--border-radius); background: var(--bg-tertiary); color: var(--text-primary);">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 6px; font-size: 13px; color: var(--text-secondary);">API URL:</label>
                        <input type="text" id="view-openai-url-${view.id}" data-view-id="${view.id}" value="${view.openaiConfig?.apiUrl || 'https://api.openai.com/v1/chat/completions'}" placeholder="https://api.openai.com/v1/chat/completions" style="width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: var(--border-radius); background: var(--bg-tertiary); color: var(--text-primary);">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 6px; font-size: 13px; color: var(--text-secondary);">模型名:</label>
                        <input type="text" id="view-openai-model-${view.id}" data-view-id="${view.id}" value="${view.openaiConfig?.model || 'gpt-3.5-turbo'}" placeholder="gpt-3.5-turbo" style="width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: var(--border-radius); background: var(--bg-tertiary); color: var(--text-primary);">
                    </div>
                </div>
            </div>
            <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--text-primary);">快捷键 (打开表格全屏):</label>
                <input type="text" value="${view.keybind}" data-field="keybind" data-view-id="${view.id}" maxlength="1" style="width: 80px; padding: 10px; border: 1px solid var(--border); border-radius: var(--border-radius); background: var(--bg-tertiary); color: var(--text-primary); text-align: center;">
            </div>
            <div>
                <button class="btn" onclick="window.removeView('${view.id}')" style="width: 100%;">移除视图</button>
            </div>
        </div>
    `;
    
    // 绑定OpenAI配置输入框事件
    const apiKeyInput = configDiv.querySelector(`#view-openai-key-${view.id}`);
    const apiUrlInput = configDiv.querySelector(`#view-openai-url-${view.id}`);
    const modelInput = configDiv.querySelector(`#view-openai-model-${view.id}`);
    
    [apiKeyInput, apiUrlInput, modelInput].forEach(input => {
        if (input) {
            input.addEventListener('change', (e) => {
                const viewId = e.target.dataset.viewId;
                updateViewOpenAIConfig(viewId);
            });
            input.addEventListener('blur', (e) => {
                const viewId = e.target.dataset.viewId;
                updateViewOpenAIConfig(viewId);
            });
        }
    });
    
    // 填充提示词选择器
    const promptSelect = configDiv.querySelector(`#view-prompt-select-${view.id}`);
    if (promptSelect) {
        // 关键修复：确保提示词列表已加载后再填充
        const fillPromptSelect = async () => {
            // 清空现有选项（保留"无"选项）
            promptSelect.innerHTML = '<option value="">无</option>';
            
            // 如果prompts未加载，先加载
            if (!state.prompts || state.prompts.length === 0) {
                try {
                    const { loadPrompts } = await import('./promptManager.js');
                    await loadPrompts();
                } catch (err) {
                    console.warn('[renderCurrentViewConfig] 加载提示词失败:', err);
                }
            }
            
            // 填充提示词列表
            if (state.prompts && state.prompts.length > 0) {
                state.prompts.forEach(prompt => {
                    const option = document.createElement('option');
                    option.value = prompt.name;
                    option.textContent = prompt.name;
                    if (view.promptId === prompt.name) {
                        option.selected = true;
                    }
                    promptSelect.appendChild(option);
                });
            }
        };
        
        // 立即尝试填充（异步）
        fillPromptSelect();
        
        promptSelect.onchange = (e) => {
            const viewId = e.target.dataset.viewId;
            const promptName = e.target.value;
            updateViewPrompt(viewId, promptName);
        };
    }
    configDiv.querySelectorAll('input').forEach(input => {
        input.onchange = (e) => updateView(e.target.dataset.viewId, e.target.dataset.field, e.target.value);
    });
    
    currentViewConfig.innerHTML = '';
    currentViewConfig.appendChild(configDiv);
}

// 全屏面板相关功能
let currentEditingViewId = null;
let isNewView = false;
let viewHistories = {}; // {viewId: [{config: object, timestamp: number}]}
let deletedViews = []; // [{view: object, timestamp: number}] 已删除的视图列表

/**
 * 初始化视图历史记录
 */
function initViewHistories() {
    const saved = localStorage.getItem('viewHistories');
    if (saved) {
        try {
            viewHistories = JSON.parse(saved);
        } catch (e) {
            viewHistories = {};
        }
    }
    
    // 初始化已删除视图列表
    const savedDeletedViews = localStorage.getItem('deletedViews');
    if (savedDeletedViews) {
        try {
            deletedViews = JSON.parse(savedDeletedViews);
        } catch (e) {
            deletedViews = [];
        }
    }
}

/**
 * 保存视图历史记录
 */
function saveViewHistories() {
    localStorage.setItem('viewHistories', JSON.stringify(viewHistories));
}

/**
 * 保存已删除视图列表
 */
function saveDeletedViews() {
    localStorage.setItem('deletedViews', JSON.stringify(deletedViews));
}

/**
 * 记录视图配置到历史
 */
function recordViewHistory(viewId, config) {
    if (!viewHistories[viewId]) {
        viewHistories[viewId] = [];
    }
    viewHistories[viewId].push({
        config: JSON.parse(JSON.stringify(config)),
        timestamp: Date.now()
    });
    // 只保留最近20条历史
    if (viewHistories[viewId].length > 20) {
        viewHistories[viewId] = viewHistories[viewId].slice(-20);
    }
    saveViewHistories();
}

/**
 * 渲染全屏视图配置面板
 */
export function renderViewConfigFullscreen() {
    const modal = document.getElementById('view-config-fullscreen-modal');
    if (!modal) return;
    
    modal.style.display = 'flex';
    modal.focus();
    
    initViewHistories();
    renderViewConfigList();
    renderViewConfigHistory();
    renderViewConfigEditor(null);
}

/**
 * 渲染视图列表
 */
function renderViewConfigList() {
    const list = document.getElementById('view-config-list');
    if (!list) return;
    
    list.innerHTML = '';
    state.views.forEach(view => {
        const item = document.createElement('div');
        item.className = 'view-config-list-item';
        item.style.cssText = 'padding: 12px; border: 1px solid var(--border); border-radius: var(--border-radius); cursor: pointer; margin-bottom: 8px; background: var(--surface-1); transition: all 0.2s; position: relative; display: flex; align-items: center; justify-content: space-between;';
        item.dataset.viewId = view.id;
        
        // 视图名称
        const nameSpan = document.createElement('span');
        nameSpan.textContent = view.id;
        item.appendChild(nameSpan);
        
        // 删除按钮（默认隐藏，悬浮时显示）
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '×';
        deleteBtn.style.cssText = 'background: transparent; border: none; color: var(--text-muted); font-size: 20px; font-weight: bold; cursor: pointer; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 4px; opacity: 0; pointer-events: none; transition: all 0.2s; padding: 0; line-height: 1;';
        deleteBtn.title = '删除视图';
        
        // 鼠标悬浮时显示删除按钮
        item.addEventListener('mouseenter', () => {
            deleteBtn.style.opacity = '1';
            deleteBtn.style.pointerEvents = 'auto';
            deleteBtn.style.color = 'var(--text-danger, #ff4444)';
        });
        item.addEventListener('mouseleave', () => {
            deleteBtn.style.opacity = '0';
            deleteBtn.style.pointerEvents = 'none';
            deleteBtn.style.color = 'var(--text-muted)';
        });
        
        // 点击删除按钮
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止触发item的click事件
            deleteViewFromList(view.id);
        });
        
        item.appendChild(deleteBtn);
        
        item.addEventListener('click', () => {
            currentEditingViewId = view.id;
            isNewView = false;
            renderViewConfigEditor(view);
            renderViewConfigHistory(); // 更新历史记录显示
            // 高亮选中的项
            list.querySelectorAll('.view-config-list-item').forEach(el => {
                el.style.background = 'var(--surface-1)';
                el.style.borderColor = 'var(--border)';
            });
            item.style.background = 'var(--accent-bg)';
            item.style.borderColor = 'var(--accent-blue)';
        });
        
        list.appendChild(item);
    });
}

/**
 * 渲染视图历史记录（显示已删除的视图）
 */
function renderViewConfigHistory() {
    const historyEl = document.getElementById('view-config-history');
    if (!historyEl) return;
    
    historyEl.innerHTML = '';
    
    // 添加清空历史记录按钮
    const clearBtn = document.createElement('button');
    clearBtn.textContent = '清空历史记录';
    clearBtn.style.cssText = 'width: 100%; padding: 8px; margin-bottom: 12px; background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: var(--border-radius); color: var(--text-primary); cursor: pointer; font-size: 13px; transition: all 0.2s;';
    clearBtn.addEventListener('mouseenter', () => {
        clearBtn.style.background = 'var(--accent-bg)';
        clearBtn.style.borderColor = 'var(--accent-blue)';
    });
    clearBtn.addEventListener('mouseleave', () => {
        clearBtn.style.background = 'var(--bg-tertiary)';
        clearBtn.style.borderColor = 'var(--border)';
    });
    clearBtn.addEventListener('click', () => {
        clearViewHistory();
    });
    historyEl.appendChild(clearBtn);
    
    // 显示已删除的视图列表
    if (!deletedViews || deletedViews.length === 0) {
        const emptyMsg = document.createElement('p');
        emptyMsg.textContent = '暂无历史记录';
        emptyMsg.style.cssText = 'color: var(--text-muted); text-align: center; padding: 20px; font-size: 13px;';
        historyEl.appendChild(emptyMsg);
        return;
    }
    
    // 按时间倒序显示（最新的在前）
    const sortedDeletedViews = [...deletedViews].reverse();
    
    sortedDeletedViews.forEach((deletedItem, index) => {
        const item = document.createElement('div');
        item.style.cssText = 'padding: 10px; border: 1px solid var(--border); border-radius: var(--border-radius); margin-bottom: 8px; background: var(--surface-1); cursor: pointer; transition: all 0.2s;';
        
        const date = new Date(deletedItem.timestamp);
        const view = deletedItem.view;
        const viewInfo = view.titleTemplate || view.id || '未命名视图';
        
        item.innerHTML = `
            <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">${date.toLocaleString('zh-CN')}</div>
            <div style="font-size: 13px; color: var(--text-primary); font-weight: 500; margin-bottom: 4px;">视图ID: ${view.id}</div>
            <div style="font-size: 12px; color: var(--text-muted);">${viewInfo}</div>
        `;
        
        item.addEventListener('click', async () => {
            // 恢复被删除的视图到视图列表
            // 使用Map索引检查，O(1)复杂度
            if (!getViewById(view.id)) {
                state.views.push(JSON.parse(JSON.stringify(view))); // 深拷贝
                updateViewsMap(); // 更新Map索引
                saveStateToStorage();
                
                // 从已删除列表中移除
                deletedViews = deletedViews.filter(item => item.view.id !== view.id);
                saveDeletedViews();
                
                // 重新渲染
                renderViewConfigList();
                renderViewConfigHistory();
                await renderSettings();
                renderViewerGrid();
                renderPasteTargets();
                initializeHistories();
            }
        });
        
        item.addEventListener('mouseenter', () => {
            item.style.background = 'var(--accent-bg)';
            item.style.borderColor = 'var(--accent-blue)';
        });
        item.addEventListener('mouseleave', () => {
            item.style.background = 'var(--surface-1)';
            item.style.borderColor = 'var(--border)';
        });
        
        historyEl.appendChild(item);
    });
}

/**
 * 渲染视图配置编辑器
 */
function renderViewConfigEditor(view) {
    const editor = document.getElementById('view-config-editor');
    if (!editor) return;
    
    if (!view) {
        editor.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 40px;">请从左侧选择视图进行编辑，或点击"新建视图"创建新视图</p>';
        return;
    }
    
    // 确保视图有必要的属性
    if (!view.promptId) view.promptId = null;
    if (view.suffix === undefined || view.suffix === null) {
        view.suffix = '';
    }
    if (!view.openaiConfig) view.openaiConfig = {
        apiKey: '',
        apiUrl: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-3.5-turbo'
    };
    if (!view.keybind) {
        const usedKeys = state.views.filter(v => v.keybind).map(v => v.keybind.toLowerCase());
        let keyCandidate = 'a'.charCodeAt(0);
        while (usedKeys.includes(String.fromCharCode(keyCandidate))) {
            keyCandidate++;
        }
        view.keybind = String.fromCharCode(keyCandidate);
    }
    
    editor.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 20px;">
            <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--text-primary);">视图ID:</label>
                <input type="text" id="fullscreen-view-id" value="${view.id}" style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: var(--border-radius); background: var(--bg-tertiary); color: var(--text-primary);">
            </div>
            <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--text-primary);">标题模板 (使用 {filename}):</label>
                <input type="text" id="fullscreen-view-titleTemplate" value="${view.titleTemplate}" style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: var(--border-radius); background: var(--bg-tertiary); color: var(--text-primary);">
            </div>
            <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--text-primary);">文件后缀 (e.g. '_analysis'，留空表示主文件):</label>
                <input type="text" id="fullscreen-view-suffix" value="${view.suffix || ''}" placeholder="留空表示主文件（保存在根目录）" style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: var(--border-radius); background: var(--bg-tertiary); color: var(--text-primary);">
            </div>
            <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--text-primary);">当前视图提示词设置:</label>
                <select id="fullscreen-view-prompt" style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: var(--border-radius); background: var(--bg-tertiary); color: var(--text-primary);">
                    <option value="">无</option>
                </select>
            </div>
            <div style="margin-top: 10px; padding-top: 20px; border-top: 1px solid var(--border);">
                <label style="display: block; margin-bottom: 12px; font-weight: bold; color: var(--accent-blue);">OpenAI配置:</label>
                <div style="display: flex; flex-direction: column; gap: 16px;">
                    <div>
                        <label style="display: block; margin-bottom: 6px; font-size: 13px; color: var(--text-secondary);">API Key:</label>
                        <input type="password" id="fullscreen-view-openai-key" value="${view.openaiConfig?.apiKey || ''}" placeholder="sk-..." style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: var(--border-radius); background: var(--bg-tertiary); color: var(--text-primary);">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 6px; font-size: 13px; color: var(--text-secondary);">API URL:</label>
                        <input type="text" id="fullscreen-view-openai-url" value="${view.openaiConfig?.apiUrl || 'https://api.openai.com/v1/chat/completions'}" placeholder="https://api.openai.com/v1/chat/completions" style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: var(--border-radius); background: var(--bg-tertiary); color: var(--text-primary);">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 6px; font-size: 13px; color: var(--text-secondary);">模型名:</label>
                        <input type="text" id="fullscreen-view-openai-model" value="${view.openaiConfig?.model || 'gpt-3.5-turbo'}" placeholder="gpt-3.5-turbo" style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: var(--border-radius); background: var(--bg-tertiary); color: var(--text-primary);">
                    </div>
                </div>
            </div>
            <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--text-primary);">快捷键 (打开表格全屏):</label>
                <input type="text" id="fullscreen-view-keybind" value="${view.keybind}" maxlength="1" style="width: 100px; padding: 12px; border: 1px solid var(--border); border-radius: var(--border-radius); background: var(--bg-tertiary); color: var(--text-primary); text-align: center;">
            </div>
        </div>
    `;
    
    // 填充提示词选择器
    const promptSelect = editor.querySelector('#fullscreen-view-prompt');
    if (promptSelect) {
        promptSelect.innerHTML = '<option value="">无</option>';
        if (state.prompts && state.prompts.length > 0) {
            state.prompts.forEach(prompt => {
                const option = document.createElement('option');
                option.value = prompt.name;
                option.textContent = prompt.name;
                if (view.promptId === prompt.name) {
                    option.selected = true;
                }
                promptSelect.appendChild(option);
            });
        }
    }
}

/**
 * 保存视图配置（全屏面板）
 */
export async function saveViewConfigFullscreen() {
    if (!currentEditingViewId && !isNewView) {
        alert('请先选择或创建视图');
        return;
    }
    
    const viewIdInput = document.getElementById('fullscreen-view-id');
    const titleTemplateInput = document.getElementById('fullscreen-view-titleTemplate');
    const suffixInput = document.getElementById('fullscreen-view-suffix');
    const promptSelect = document.getElementById('fullscreen-view-prompt');
    const keybindInput = document.getElementById('fullscreen-view-keybind');
    const apiKeyInput = document.getElementById('fullscreen-view-openai-key');
    const apiUrlInput = document.getElementById('fullscreen-view-openai-url');
    const modelInput = document.getElementById('fullscreen-view-openai-model');
    
    if (!viewIdInput || !titleTemplateInput) {
        alert('配置表单不完整');
        return;
    }
    
    const newViewId = viewIdInput.value.trim();
    const titleTemplate = titleTemplateInput.value.trim();
    const suffix = suffixInput ? suffixInput.value.trim() : '';
    const promptId = promptSelect ? promptSelect.value || null : null;
    const keybind = keybindInput ? keybindInput.value.trim().toLowerCase() : '';
    const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
    const apiUrl = apiUrlInput ? apiUrlInput.value.trim() || 'https://api.openai.com/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const model = modelInput ? modelInput.value.trim() || 'gpt-3.5-turbo' : 'gpt-3.5-turbo';
    
    if (!newViewId) {
        alert('视图ID不能为空');
        return;
    }
    
    // 检查快捷键冲突
    if (keybind) {
        const existingView = Array.from(state.views).find(v => v.id !== currentEditingViewId && v.keybind && v.keybind.toLowerCase() === keybind);
        if (existingView) {
            alert(`快捷键 '${keybind}' 已被视图 '${existingView.id}' 使用，请选择其他快捷键`);
            return;
        }
    }
    
    if (isNewView) {
        // 新建视图，使用Map索引检查，O(1)复杂度
        if (getViewById(newViewId)) {
            alert('视图ID已存在');
            return;
        }
        
        const newView = {
            id: newViewId,
            titleTemplate: titleTemplate,
            suffix: suffix,
            keybind: keybind,
            promptId: promptId,
            openaiConfig: {
                apiKey: apiKey,
                apiUrl: apiUrl,
                model: model
            }
        };
        
        state.views.push(newView);
        updateViewsMap(); // 更新Map索引
        recordViewHistory(newViewId, newView);
        currentEditingViewId = newViewId;
        isNewView = false;
    } else {
        // 编辑视图，使用Map索引查找，O(1)复杂度
        const view = getViewById(currentEditingViewId);
        if (!view) {
            alert('视图不存在');
            return;
        }
        
        // 如果视图ID改变了，就是重命名
        if (newViewId !== currentEditingViewId) {
            // 使用Map索引检查，O(1)复杂度
            if (getViewById(newViewId)) {
                alert('新视图ID已存在');
                return;
            }
            // 重命名
            view.id = newViewId;
            updateViewsMap(); // 更新Map索引
            // 更新历史记录中的key
            if (viewHistories[currentEditingViewId]) {
                viewHistories[newViewId] = viewHistories[currentEditingViewId];
                delete viewHistories[currentEditingViewId];
            }
            currentEditingViewId = newViewId;
        }
        
        // 更新配置
        view.titleTemplate = titleTemplate;
        view.suffix = suffix;
        view.keybind = keybind;
        view.promptId = promptId;
        if (!view.openaiConfig) view.openaiConfig = {};
        view.openaiConfig.apiKey = apiKey;
        view.openaiConfig.apiUrl = apiUrl;
        view.openaiConfig.model = model;
        
        // 记录历史
        recordViewHistory(newViewId, view);
    }
    
    saveStateToStorage();
    saveViewHistories();
    renderViewConfigList();
    renderViewConfigHistory();
    // 使用Map索引查找，O(1)复杂度
    renderViewConfigEditor(getViewById(currentEditingViewId));
    await renderSettings();
    renderViewerGrid();
    renderPasteTargets();
    initializeHistories();
    
    alert('保存成功！');
}

/**
 * 新建视图（全屏面板）
 */
export function newViewInFullscreen() {
    currentEditingViewId = null;
    isNewView = true;
    
    const usedKeys = state.views.filter(v => v.keybind).map(v => v.keybind.toLowerCase());
    let keyCandidate = 'a'.charCodeAt(0);
    while (usedKeys.includes(String.fromCharCode(keyCandidate))) {
        keyCandidate++;
    }
    const newKeybind = String.fromCharCode(keyCandidate);
    
    const newView = {
        id: `view${state.views.length + 1}`,
        titleTemplate: '自定义：{filename}',
        suffix: '',
        keybind: newKeybind,
        promptId: null,
        openaiConfig: {
            apiKey: '',
            apiUrl: 'https://api.openai.com/v1/chat/completions',
            model: 'gpt-3.5-turbo'
        }
    };
    
    renderViewConfigEditor(newView);
    renderViewConfigHistory(); // 清空历史显示
}

/**
 * 添加视图配置
 */
export async function addViewConfig() {
    const newId = `view${state.views.length + 1}`;
    const usedKeys = state.views.filter(v => v.keybind).map(v => v.keybind.toLowerCase());
    let keyCandidate = 'a'.charCodeAt(0);
    while (usedKeys.includes(String.fromCharCode(keyCandidate))) {
        keyCandidate++;
    }
    const newKeybind = String.fromCharCode(keyCandidate);
    state.views.push({
        id: newId, 
        titleTemplate: '自定义：{filename}', 
        suffix: '', 
        keybind: newKeybind,
        openaiConfig: {
            apiKey: '',
            apiUrl: 'https://api.openai.com/v1/chat/completions',
            model: 'gpt-3.5-turbo'
        }
    });
    updateViewsMap(); // 更新Map索引
    await renderSettings();
    renderViewerGrid();
    renderPasteTargets();
    initializeHistories();
}

/**
 * 更新视图配置
 */
export function updateView(id, field, value) {
    // 使用Map索引直接查找，O(1)复杂度
    const view = getViewById(id);
    if (view) {
        if (field === 'id') {
            // 如果更新的是ID，需要迁移持久化的编辑模式状态
            const oldId = String(id);
            const newId = String(value);
            
            // 迁移编辑模式状态（主窗口和分离窗口都需要迁移）
            try {
                const storageKeys = ['editModeStates', 'editModeStatesSeparated'];
                for (const storageKey of storageKeys) {
                    const saved = localStorage.getItem(storageKey);
                    if (saved) {
                        const allStates = JSON.parse(saved);
                        if (oldId in allStates) {
                            allStates[newId] = allStates[oldId];
                            delete allStates[oldId];
                            localStorage.setItem(storageKey, JSON.stringify(allStates));
                        }
                    }
                }
            } catch (e) {
                console.warn('迁移编辑模式状态失败:', e);
            }
            
            // 更新视图ID（需要更新Map索引）
            view.id = value;
            updateViewsMap(); // 更新Map索引
        } else if (field === 'keybind') {
            // 检查快捷键冲突：遍历所有视图，但不使用find（对于检查冲突，仍然需要遍历）
            const existingView = Array.from(state.views).find(v => v.id !== id && v.keybind && v.keybind.toLowerCase() === value.toLowerCase());
            if (existingView) {
                alert(`快捷键 '${value}' 已被视图 '${existingView.id}' 使用，请选择其他快捷键`);
                const input = document.querySelector(`input[data-view-id="${id}"][data-field="keybind"]`);
                if (input) input.value = view.keybind;
                return;
            }
            view[field] = value.toLowerCase();
        } else {
            view[field] = value;
        }
        saveStateToStorage();
    }
}

/**
 * 更新视图提示词
 */
export function updateViewPrompt(viewId, promptName) {
    // 使用Map索引查找，O(1)复杂度
    const view = getViewById(viewId);
    if (view) {
        view.promptId = promptName || null;
        saveStateToStorage();
    }
}

/**
 * 更新所有视图的提示词选择器（从state.prompts同步）
 * 当提示词管理面板中的提示词发生变化时调用此函数
 */
export function updateSettingsPromptSelectors() {
    // 遍历所有视图的提示词选择器
    state.views.forEach(view => {
        const promptSelect = document.getElementById(`view-prompt-select-${view.id}`);
        if (!promptSelect) return;
        
        // 保存当前选中的值
        const currentValue = promptSelect.value;
        
        // 清空现有选项（保留"无"选项）
        promptSelect.innerHTML = '<option value="">无</option>';
        
        // 从state.prompts填充选项
        if (state.prompts && state.prompts.length > 0) {
            state.prompts.forEach(prompt => {
                const option = document.createElement('option');
                option.value = prompt.name;
                option.textContent = prompt.name;
                promptSelect.appendChild(option);
            });
        }
        
        // 恢复之前选中的值（如果还存在）
        if (currentValue) {
            const optionExists = Array.from(promptSelect.options).some(opt => opt.value === currentValue);
            if (optionExists) {
                promptSelect.value = currentValue;
            } else {
                // 如果之前选中的提示词已被删除，更新视图的promptId
                view.promptId = null;
                saveStateToStorage();
            }
        }
    });
}

/**
 * 更新视图OpenAI配置
 */
export function updateViewOpenAIConfig(viewId) {
    // 使用Map索引查找，O(1)复杂度
    const view = getViewById(viewId);
    if (view) {
        if (!view.openaiConfig) view.openaiConfig = {};
        
        const apiKeyInput = document.getElementById(`view-openai-key-${viewId}`);
        const apiUrlInput = document.getElementById(`view-openai-url-${viewId}`);
        const modelInput = document.getElementById(`view-openai-model-${viewId}`);
        
        if (apiKeyInput) view.openaiConfig.apiKey = apiKeyInput.value.trim();
        if (apiUrlInput) view.openaiConfig.apiUrl = apiUrlInput.value.trim() || 'https://api.openai.com/v1/chat/completions';
        if (modelInput) view.openaiConfig.model = modelInput.value.trim() || 'gpt-3.5-turbo';
        
        saveStateToStorage();
    }
}

/**
 * 删除视图（从列表中删除，并保存到历史记录）
 */
function deleteViewFromList(viewId) {
    // 使用Map索引查找，O(1)复杂度
    const view = getViewById(viewId);
    if (!view) return;
    
    // 将视图保存到已删除视图列表
    deletedViews.push({
        view: JSON.parse(JSON.stringify(view)), // 深拷贝
        timestamp: Date.now()
    });
    // 只保留最近50条删除记录
    if (deletedViews.length > 50) {
        deletedViews = deletedViews.slice(-50);
    }
    saveDeletedViews();
    
    // 从视图列表中移除
    state.views = state.views.filter(v => v.id !== viewId);
    updateViewsMap(); // 更新Map索引
    
    // 如果当前正在编辑这个视图，清空编辑器
    if (currentEditingViewId === viewId) {
        currentEditingViewId = null;
        renderViewConfigEditor(null);
    }
    
    // 保存状态
    saveStateToStorage();
    
    // 重新渲染
    renderViewConfigList();
    renderViewConfigHistory();
    renderSettings();
    renderViewerGrid();
    renderPasteTargets();
    initializeHistories();
}

/**
 * 清空历史记录（清空已删除视图列表）
 */
function clearViewHistory() {
    if (!deletedViews || deletedViews.length === 0) {
        alert('历史记录为空，无需清空');
        return;
    }
    
    if (!confirm(`确定要清空所有历史记录吗？这将清除 ${deletedViews.length} 条已删除的视图记录。`)) {
        return;
    }
    
    deletedViews = [];
    saveDeletedViews();
    renderViewConfigHistory();
}

/**
 * 移除视图
 */
export function removeView(id) {
    state.views = state.views.filter(v => v.id !== id);
    updateViewsMap(); // 更新Map索引
    renderSettings();
    renderViewerGrid();
    renderPasteTargets();
    initializeHistories();
}

// 暴露到全局，供HTML中的onclick使用
if (typeof window !== 'undefined') {
    window.removeView = removeView;
}
