/**
 * 布局管理模块
 * 负责布局的配置、应用和管理
 */

import { state, saveStateToStorage } from '../core/state.js';
import { getLayouts, getLayout, saveLayout as saveLayoutAPI, deleteLayout } from '../core/api.js';
import { addToManagerHistory } from '../utils/managerHistory.js';

let currentEditingLayout = null;
let draggedElement = null;

/**
 * 加载布局列表
 */
export async function loadLayouts() {
    try {
        const data = await getLayouts();
        state.layouts = data.layouts || [];
        renderLayoutsList();
    } catch (err) {
        console.error('Failed to load layouts:', err);
        state.layouts = [];
    }
}

/**
 * 渲染布局列表
 */
export async function renderLayoutsList(searchTerm = '') {
    const list = document.getElementById('layouts-list');
    if (!list) return;
    
    list.innerHTML = '';
    
    const filteredLayouts = state.layouts.filter(layout =>
        !searchTerm || layout.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    if (filteredLayouts.length === 0) {
        list.innerHTML = '<div style="color: var(--text-muted); font-style: italic; padding: 10px;">没有找到匹配的布局</div>';
        return;
    }
    
    for (const layout of filteredLayouts) {
        const item = document.createElement('div');
        item.className = 'prompt-item';
        item.innerHTML = `
            <div class="file-item type-file" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; margin-bottom: 6px; cursor: pointer; position: relative;" onclick="window.selectLayout('${layout.name}')">
                <div style="flex: 1; min-width: 0; text-align: left;">
                    <div class="layout-name-display" style="font-weight: bold; color: var(--accent-blue); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 60px;">${layout.name}</div>
                    <div style="font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-left: 2em;">&nbsp;&nbsp;${new Date(layout.updatedAt).toLocaleString()}</div>
                </div>
                <div style="display: flex; gap: 5px; position: absolute; right: 14px; transition: opacity 0.3s; opacity: 0;" class="layout-actions">
                    <button class="btn" onclick="event.stopPropagation(); window.editLayout('${layout.name}')" style="font-size: 12px; padding: 4px 8px;">编辑</button>
                    <button class="btn" onclick="event.stopPropagation(); window.removeLayout('${layout.name}')" style="font-size: 12px; padding: 4px 8px;">删除</button>
                </div>
            </div>
        `;
        list.appendChild(item);
        
        const layoutItem = item.querySelector('.file-item');
        const actions = item.querySelector('.layout-actions');
        layoutItem.addEventListener('mouseenter', () => actions.style.opacity = '1');
        layoutItem.addEventListener('mouseleave', () => actions.style.opacity = '0');
    }
}

/**
 * 选择布局
 */
export async function selectLayout(name) {
    try {
        const layout = await getLayout(name);
        state.selectedLayout = layout;
        applyLayout(layout);
        updateLayoutDisplay();
        saveStateToStorage();
        
        const panel = document.getElementById('layout-panel');
        if (panel) panel.style.display = 'none';
    } catch (err) {
        console.error('Failed to select layout:', err);
        alert('加载布局失败: ' + err.message);
    }
}

/**
 * 应用布局
 */
export function applyLayout(layout) {
    const grid = document.getElementById('viewer-grid');
    if (!grid) return;
    
    const columns = layout.columns || 2;
    // 使用 minmax(0, 1fr) 确保每一列的最大宽度受网格约束，
    // 避免列被内部内容撑得超过整体布局设置的宽度。
    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    
    localStorage.setItem('selectedLayout', JSON.stringify(layout));
}

/**
 * 更新布局显示
 */
export function updateLayoutDisplay() {
    const layoutNameDisplay = document.getElementById('current-layout-name');
    if (layoutNameDisplay) {
        if (state.selectedLayout && state.selectedLayout.name) {
            layoutNameDisplay.textContent = state.selectedLayout.name;
        } else {
            layoutNameDisplay.textContent = '默认布局';
        }
    }
}

/**
 * 清空布局
 */
export function clearLayout() {
    state.selectedLayout = null;
    localStorage.removeItem('selectedLayout');
    const grid = document.getElementById('viewer-grid');
    if (grid) {
        grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
    }
    updateLayoutDisplay();
    saveStateToStorage();
}

/**
 * 新建布局
 */
export function newLayout() {
    const nameInput = document.getElementById('layout-name');
    const columnsInput = document.getElementById('layout-columns');
    const fullscreenEnabledInput = document.getElementById('layout-fullscreen-enabled');
    const fullscreenCloseOnEscapeInput = document.getElementById('layout-fullscreen-close-on-escape');
    const cancelBtn = document.getElementById('cancel-layout-edit');
    
    if (nameInput) nameInput.value = '';
    if (columnsInput) columnsInput.value = '2';
    if (fullscreenEnabledInput) fullscreenEnabledInput.checked = true;
    if (fullscreenCloseOnEscapeInput) fullscreenCloseOnEscapeInput.checked = true;
    if (cancelBtn) cancelBtn.style.display = 'none';
    
    currentEditingLayout = null;
    
    setTimeout(() => {
        updateLayoutPreview();
    }, 10);
    
    if (nameInput) nameInput.focus();
}

/**
 * 保存布局
 */
export async function saveLayout() {
    const nameInput = document.getElementById('layout-name');
    const columnsInput = document.getElementById('layout-columns');
    const fullscreenEnabledInput = document.getElementById('layout-fullscreen-enabled');
    const fullscreenCloseOnEscapeInput = document.getElementById('layout-fullscreen-close-on-escape');
    
    if (!nameInput || !columnsInput) return false;
    
    const name = nameInput.value.trim();
    const columnsValue = columnsInput.value.trim();
    const columns = parseInt(columnsValue);
    const fullscreenEnabled = fullscreenEnabledInput ? fullscreenEnabledInput.checked : true;
    const fullscreenCloseOnEscape = fullscreenCloseOnEscapeInput ? fullscreenCloseOnEscapeInput.checked : true;
    
    if (!name) {
        alert('请填写布局名称');
        return false;
    }
    
    if (!columnsValue || isNaN(columns) || columns < 1) {
        alert('请填写有效的列数（至少为1）');
        return false;
    }
    
    // 保存前记录当前状态到历史
    addToManagerHistory('layout', {
        name: nameInput.value,
        columns: columnsInput.value,
        fullscreenEnabled: fullscreenEnabled,
        fullscreenCloseOnEscape: fullscreenCloseOnEscape
    });
    
    try {
        const data = await saveLayoutAPI(name, columns, fullscreenEnabled, fullscreenCloseOnEscape);
        await loadLayouts();
        resetLayoutForm();
        
        // 立即应用布局
        applyLayout(data.layout);
        
        const saveBtn = document.getElementById('save-layout');
        if (saveBtn) {
            const originalText = saveBtn.textContent;
            saveBtn.textContent = currentEditingLayout ? '✅ 已更新并应用' : '✅ 已保存并应用';
            setTimeout(() => {
                saveBtn.textContent = originalText;
            }, 1500);
        }
        
        return true;
    } catch (err) {
        alert('保存失败: ' + err.message);
        return false;
    }
}

/**
 * 重置布局表单
 */
export function resetLayoutForm() {
    const nameInput = document.getElementById('layout-name');
    const columnsInput = document.getElementById('layout-columns');
    const cancelBtn = document.getElementById('cancel-layout-edit');
    
    if (nameInput) nameInput.value = '';
    if (columnsInput) columnsInput.value = '2';
    if (cancelBtn) cancelBtn.style.display = 'none';
    
    currentEditingLayout = null;
}

/**
 * 编辑布局
 */
export async function editLayout(name) {
    try {
        const layout = await getLayout(name);
        
        const nameInput = document.getElementById('layout-name');
        const columnsInput = document.getElementById('layout-columns');
        const fullscreenEnabledInput = document.getElementById('layout-fullscreen-enabled');
        const fullscreenCloseOnEscapeInput = document.getElementById('layout-fullscreen-close-on-escape');
        const cancelBtn = document.getElementById('cancel-layout-edit');
        
        if (nameInput) nameInput.value = layout.name;
        if (columnsInput) columnsInput.value = layout.columns || 2;
        if (fullscreenEnabledInput) fullscreenEnabledInput.checked = layout.fullscreenEnabled !== false;
        if (fullscreenCloseOnEscapeInput) fullscreenCloseOnEscapeInput.checked = layout.fullscreenCloseOnEscape !== false;
        if (cancelBtn) cancelBtn.style.display = 'inline-block';
        
        currentEditingLayout = layout.name;
        
        setTimeout(() => {
            updateLayoutPreview();
        }, 10);
        
        if (nameInput) {
            nameInput.scrollIntoView({ behavior: 'smooth' });
        }
    } catch (err) {
        alert('加载布局失败: ' + err.message);
    }
}

/**
 * 删除布局
 */
export async function removeLayout(name) {
    if (!confirm(`确定要删除布局 "${name}" 吗？`)) return;
    
    try {
        await deleteLayout(name);
        
        if (state.selectedLayout && state.selectedLayout.name === name) {
            state.selectedLayout = null;
            const grid = document.getElementById('viewer-grid');
            if (grid) {
                grid.style.gridTemplateColumns = '1fr 1fr';
            }
            updateLayoutDisplay();
        }
        
        await loadLayouts();
    } catch (err) {
        alert('删除失败: ' + err.message);
    }
}

/**
 * 更新布局预览
 */
export function updateLayoutPreview() {
    const preview = document.getElementById('layout-preview');
    const columnsInput = document.getElementById('layout-columns');
    
    if (!preview || !columnsInput) return;
    
    preview.innerHTML = '';
    
    const columnsValue = columnsInput.value.trim();
    const columns = parseInt(columnsValue);
    
    if (!columnsValue || isNaN(columns) || columns < 1) {
        preview.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">请输入有效的列数</div>';
        return;
    }
    
    preview.style.display = 'grid';
    preview.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
    preview.style.gap = '10px';
    
    for (let i = 0; i < columns; i++) {
        const pane = document.createElement('div');
        pane.className = 'layout-preview-pane';
        pane.draggable = true;
        pane.dataset.index = i;
        pane.style.cssText = `
            min-height: 150px;
            background: var(--bg-secondary);
            border: 2px dashed var(--border);
            border-radius: var(--border-radius);
            padding: 15px;
            cursor: move;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-muted);
            position: relative;
        `;
        pane.textContent = `视图 ${i + 1}`;
        pane.addEventListener('dragstart', handleDragStart);
        pane.addEventListener('dragover', handleDragOver);
        pane.addEventListener('drop', handleDrop);
        pane.addEventListener('dragend', handleDragEnd);
        preview.appendChild(pane);
    }
}

/**
 * 拖拽处理函数
 */
function handleDragStart(e) {
    draggedElement = this;
    this.style.opacity = '0.5';
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }
    
    if (draggedElement !== this) {
        const preview = document.getElementById('layout-preview');
        if (!preview) return;
        
        const allPanes = Array.from(preview.querySelectorAll('.layout-preview-pane'));
        const draggedIndex = parseInt(draggedElement.dataset.index);
        const targetIndex = parseInt(this.dataset.index);
        
        if (draggedIndex < targetIndex) {
            preview.insertBefore(draggedElement, this.nextSibling);
        } else {
            preview.insertBefore(draggedElement, this);
        }
        
        // 更新索引
        allPanes.forEach((pane, index) => {
            pane.dataset.index = index;
            pane.textContent = `视图 ${index + 1}`;
        });
    }
    
    return false;
}

function handleDragEnd(e) {
    this.style.opacity = '1';
}

/**
 * 导入布局
 */
export function importLayout() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (!data.name || data.columns === undefined) {
                alert('无效的布局文件格式');
                return;
            }
            
            const nameInput = document.getElementById('layout-name');
            const columnsInput = document.getElementById('layout-columns');
            const fullscreenEnabledInput = document.getElementById('layout-fullscreen-enabled');
            const fullscreenCloseOnEscapeInput = document.getElementById('layout-fullscreen-close-on-escape');
            
            if (nameInput) nameInput.value = data.name;
            if (columnsInput) columnsInput.value = data.columns || 2;
            if (fullscreenEnabledInput) fullscreenEnabledInput.checked = data.fullscreenEnabled !== false;
            if (fullscreenCloseOnEscapeInput) fullscreenCloseOnEscapeInput.checked = data.fullscreenCloseOnEscape !== false;
            
            currentEditingLayout = null;
            
            setTimeout(() => {
                updateLayoutPreview();
            }, 10);
        } catch (err) {
            alert('导入失败: ' + err.message);
        }
    };
    input.click();
}

/**
 * 导出布局
 */
export async function exportLayout() {
    const nameInput = document.getElementById('layout-name');
    if (!nameInput) return;
    
    const name = nameInput.value.trim();
    if (!name) {
        alert('请先输入布局名称');
        return;
    }
    
    try {
        const layout = await getLayout(name);
        
        const dataStr = JSON.stringify(layout, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name}.json`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        alert('导出失败: ' + err.message);
    }
}

/**
 * 显示布局历史
 */
export async function showLayoutHistory() {
    const nameInput = document.getElementById('layout-name');
    if (!nameInput) return;
    
    const name = nameInput.value.trim();
    if (!name) {
        alert('请先输入布局名称');
        return;
    }
    
    try {
        const layout = await getLayout(name);
        displayLayoutHistory(layout);
    } catch (err) {
        alert('加载布局失败: ' + err.message);
    }
}

/**
 * 显示布局历史记录
 */
export function displayLayoutHistory(layout) {
    const panel = document.getElementById('layout-history-panel');
    const list = document.getElementById('layout-history-list');
    
    if (!panel || !list) return;
    
    panel.style.display = 'block';
    list.innerHTML = '';
    
    if (!layout.history || layout.history.length === 0) {
        list.innerHTML = '<div style="color: var(--text-muted); font-style: italic; padding: 20px; text-align: center;">没有历史记录</div>';
        return;
    }
    
    layout.history.forEach((historyItem, index) => {
        const item = document.createElement('div');
        item.style.cssText = `
            padding: 15px;
            margin-bottom: 10px;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: var(--border-radius);
        `;
        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <div>
                    <strong style="color: var(--accent-blue);">版本 ${layout.history.length - index}</strong>
                    <div style="font-size: 12px; color: var(--text-muted); margin-top: 5px;">
                        ${new Date(historyItem.timestamp).toLocaleString()}
                    </div>
                </div>
                <button class="btn" onclick="window.restoreLayoutVersion('${layout.name}', ${index})" style="font-size: 12px; padding: 4px 8px;">恢复</button>
            </div>
            <div style="font-size: 12px; color: var(--text-secondary);">
                列数: ${historyItem.columns || 'N/A'}
            </div>
        `;
        list.appendChild(item);
    });
}

/**
 * 恢复布局版本
 */
export async function restoreLayoutVersion(layoutName, historyIndex) {
    try {
        const layout = await getLayout(layoutName);
        if (!layout.history || !layout.history[historyIndex]) {
            alert('历史记录不存在');
            return;
        }
        
        const historyItem = layout.history[historyIndex];
        const restoredLayout = {
            name: layout.name,
            columns: historyItem.columns,
            fullscreenEnabled: historyItem.fullscreenEnabled,
            fullscreenCloseOnEscape: historyItem.fullscreenCloseOnEscape
        };
        
        await saveLayoutAPI(restoredLayout.name, restoredLayout.columns, restoredLayout.fullscreenEnabled, restoredLayout.fullscreenCloseOnEscape);
        await loadLayouts();
        
        const panel = document.getElementById('layout-history-panel');
        if (panel) panel.style.display = 'none';
        
        alert('布局已恢复');
    } catch (err) {
        alert('恢复失败: ' + err.message);
    }
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.loadLayouts = loadLayouts;
    window.renderLayoutsList = renderLayoutsList;
    window.selectLayout = selectLayout;
    window.applyLayout = applyLayout;
    window.updateLayoutDisplay = updateLayoutDisplay;
    window.clearLayout = clearLayout;
    window.newLayout = newLayout;
    window.saveLayout = saveLayout;
    window.resetLayoutForm = resetLayoutForm;
    window.editLayout = editLayout;
    window.removeLayout = removeLayout;
    window.updateLayoutPreview = updateLayoutPreview;
    window.importLayout = importLayout;
    window.exportLayout = exportLayout;
    window.showLayoutHistory = showLayoutHistory;
    window.displayLayoutHistory = displayLayoutHistory;
    window.restoreLayoutVersion = restoreLayoutVersion;
}
