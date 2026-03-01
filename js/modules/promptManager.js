/**
 * 提示词管理模块
 * 负责提示词的加载、选择、编辑和保存
 */

import { state, saveStateToStorage } from '../core/state.js';
import { getPrompts, getPrompt, savePrompt as savePromptAPI, deletePrompt } from '../core/api.js';
import { addToManagerHistory } from '../utils/managerHistory.js';
import { updateSettingsPromptSelectors } from './viewManager.js';

let currentEditingPrompt = null;

/**
 * 加载提示词列表
 */
export async function loadPrompts() {
    try {
        const data = await getPrompts();
        state.prompts = data.prompts || [];
        renderPromptsList();
    } catch (err) {
        console.error('Failed to load prompts:', err);
        state.prompts = [];
    }
}

/**
 * 渲染提示词列表
 */
export function renderPromptsList(searchTerm = '') {
    const list = document.getElementById('prompts-list');
    if (!list) return;

    list.innerHTML = '';

    const filteredPrompts = state.prompts.filter(prompt =>
        !searchTerm ||
        prompt.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (filteredPrompts.length === 0) {
        list.innerHTML = '<div style="color: var(--text-muted); font-style: italic; padding: 10px;">没有找到匹配的提示词</div>';
        return;
    }

    filteredPrompts.forEach(prompt => {
        const item = document.createElement('div');
        item.className = 'prompt-item';
        item.innerHTML = `
            <div class="file-item type-file" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; margin-bottom: 6px; cursor: pointer; position: relative;" onclick="window.selectPrompt('${prompt.name}')">
                <div style="flex: 1; min-width: 0; text-align: left;">
                    <div class="prompt-name-display" style="font-weight: bold; color: var(--accent-blue); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 60px;">${prompt.name}</div>
                    <div style="font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-left: 2em;">&nbsp;&nbsp;${new Date(prompt.updatedAt).toLocaleString()}</div>
                </div>
                <div style="display: flex; gap: 5px; position: absolute; right: 14px; transition: opacity 0.3s; opacity: 0;" class="prompt-actions">
                    <button class="btn" onclick="event.stopPropagation(); window.editPrompt('${prompt.name}')" style="font-size: 12px; padding: 4px 8px;">编辑</button>
                    <button class="btn" onclick="event.stopPropagation(); window.removePrompt('${prompt.name}')" style="font-size: 12px; padding: 4px 8px;">删除</button>
                </div>
            </div>
        `;
        list.appendChild(item);
        
        const promptItem = item.querySelector('.file-item');
        const actions = item.querySelector('.prompt-actions');
        promptItem.addEventListener('mouseenter', () => actions.style.opacity = '1');
        promptItem.addEventListener('mouseleave', () => actions.style.opacity = '0');
    });
}

/**
 * 选择提示词
 */
export async function selectPrompt(name) {
    try {
        const prompt = await getPrompt(name);
        state.selectedPrompt = { name: prompt.name, content: prompt.content };
        localStorage.setItem('selectedPrompt', JSON.stringify(state.selectedPrompt));
        updatePromptDisplay();
        saveStateToStorage();
        
        const panel = document.getElementById('prompt-panel');
        if (panel) panel.style.display = 'none';
    } catch (err) {
        console.error('Failed to select prompt:', err);
        alert('加载提示词失败: ' + err.message);
    }
}

/**
 * 更新提示词显示
 */
export function updatePromptDisplay() {
    // 更新面板中的显示
    const promptNameDisplay = document.getElementById('current-prompt-name');
    if (promptNameDisplay) {
        if (state.selectedPrompt && state.selectedPrompt.name) {
            promptNameDisplay.textContent = state.selectedPrompt.name;
        } else {
            promptNameDisplay.textContent = '无';
        }
    }
    
    // 更新主界面的显示
    const currentPromptDisplay = document.getElementById('current-prompt-display');
    if (currentPromptDisplay) {
        if (state.selectedPrompt && state.selectedPrompt.name) {
            currentPromptDisplay.textContent = `提示词: ${state.selectedPrompt.name}`;
            currentPromptDisplay.title = state.selectedPrompt.name;
            // 有内容时显示
            currentPromptDisplay.style.display = '';
        } else {
            currentPromptDisplay.textContent = '';
            currentPromptDisplay.title = '';
            // 没有内容时隐藏
            currentPromptDisplay.style.display = 'none';
        }
    }
}

/**
 * 清空提示词
 */
export function clearPrompt() {
    state.selectedPrompt = null;
    localStorage.removeItem('selectedPrompt');
    updatePromptDisplay();
    saveStateToStorage();
}

/**
 * 新建提示词
 */
export function newPrompt() {
    const nameInput = document.getElementById('prompt-name');
    const contentInput = document.getElementById('prompt-content');
    const enableWorkflowControlCheckbox = document.getElementById('prompt-enable-workflow-control');
    const cancelBtn = document.getElementById('cancel-edit');
    
    if (nameInput) {
        nameInput.value = '';
        // 新建模式下名称输入框可编辑
        nameInput.readOnly = false;
        nameInput.style.background = 'var(--bg-tertiary)';
        nameInput.style.cursor = 'text';
    }
    if (contentInput) contentInput.value = '';
    if (enableWorkflowControlCheckbox) enableWorkflowControlCheckbox.checked = false; // 默认关闭
    if (cancelBtn) cancelBtn.style.display = 'none';
    
    currentEditingPrompt = null;
    if (nameInput) nameInput.focus();
}

/**
 * 保存提示词
 */
export async function savePrompt() {
    const nameInput = document.getElementById('prompt-name');
    const contentInput = document.getElementById('prompt-content');
    const enableWorkflowControlCheckbox = document.getElementById('prompt-enable-workflow-control');
    
    if (!nameInput || !contentInput) return false;
    
    const newName = nameInput.value.trim();
    const content = contentInput.value.trim();
    const enableWorkflowControl = enableWorkflowControlCheckbox ? enableWorkflowControlCheckbox.checked : false;
    
    if (!newName || !content) {
        if (!newName) nameInput.style.border = '2px solid var(--accent-purple)';
        if (!content) contentInput.style.border = '2px solid var(--accent-purple)';
        setTimeout(() => {
            if (!newName) nameInput.style.border = '1px solid var(--border)';
            if (!content) contentInput.style.border = '1px solid var(--border)';
        }, 2000);
        return false;
    }
    
    // 保存前记录当前状态到历史
    addToManagerHistory('prompt', {
        name: newName,
        content: contentInput.value,
        enableWorkflowControl: enableWorkflowControl
    });
    
    try {
        const isEditing = currentEditingPrompt !== null;
        const isRenamed = isEditing && currentEditingPrompt !== newName;
        
        if (isRenamed) {
            // 编辑模式且名称改变了：创建新名称的文件，然后软删除旧文件
            // 先保存新名称的文件
            await savePromptAPI(newName, content, enableWorkflowControl);
            
            // 然后软删除旧文件
            try {
                const { softDeletePrompt } = await import('../core/api.js');
                await softDeletePrompt(currentEditingPrompt);
            } catch (softDeleteErr) {
                console.error('软删除旧提示词失败:', softDeleteErr);
                // 如果软删除失败，至少新文件已经保存了，继续执行
            }
        } else {
            // 新建模式或编辑模式但名称没改变：直接保存
            await savePromptAPI(newName, content, enableWorkflowControl);
        }
        
        await loadPrompts();
        resetPromptForm();
        renderPromptsList();
        
        // 同步更新设置页面的提示词选择器
        updateSettingsPromptSelectors();
        
        // 同步更新事件的提示词选择器
        if (typeof window !== 'undefined' && window.updateEventPromptSelectors) {
            window.updateEventPromptSelectors();
        }
        
        // 如果当前选中的提示词是被编辑的提示词（旧名称），更新为新的名称
        if (state.selectedPrompt) {
            if (isRenamed && state.selectedPrompt.name === currentEditingPrompt) {
                // 如果重命名了且当前选中的是旧名称，更新为新名称
                state.selectedPrompt = { name: newName, content, enableWorkflowControl };
                localStorage.setItem('selectedPrompt', JSON.stringify(state.selectedPrompt));
                updatePromptDisplay();
            } else if (!isRenamed && state.selectedPrompt.name === newName) {
                // 如果没重命名，直接更新内容
                state.selectedPrompt = { name: newName, content, enableWorkflowControl };
                localStorage.setItem('selectedPrompt', JSON.stringify(state.selectedPrompt));
                updatePromptDisplay();
            }
        }
        
        const saveBtn = document.getElementById('save-prompt');
        if (saveBtn) {
            const originalText = saveBtn.textContent;
            saveBtn.textContent = isEditing ? (isRenamed ? '✅ 已重命名并保存' : '✅ 已更新') : '✅ 已保存';
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
 * 取消编辑（重置表单）
 */
export function cancelEdit() {
    resetPromptForm();
}

/**
 * 重置提示词表单
 */
export function resetPromptForm() {
    const nameInput = document.getElementById('prompt-name');
    const contentInput = document.getElementById('prompt-content');
    const enableWorkflowControlCheckbox = document.getElementById('prompt-enable-workflow-control');
    const cancelBtn = document.getElementById('cancel-edit');
    
    if (nameInput) {
        nameInput.value = '';
        // 重置为可编辑状态
        nameInput.readOnly = false;
        nameInput.style.background = 'var(--bg-tertiary)';
        nameInput.style.cursor = 'text';
    }
    if (contentInput) contentInput.value = '';
    if (enableWorkflowControlCheckbox) enableWorkflowControlCheckbox.checked = false; // 默认关闭
    if (cancelBtn) cancelBtn.style.display = 'none';
    
    currentEditingPrompt = null;
}

/**
 * 编辑提示词
 */
export async function editPrompt(name) {
    try {
        const prompt = await getPrompt(name);
        
        const nameInput = document.getElementById('prompt-name');
        const contentInput = document.getElementById('prompt-content');
        const enableWorkflowControlCheckbox = document.getElementById('prompt-enable-workflow-control');
        const cancelBtn = document.getElementById('cancel-edit');
        
        if (nameInput) {
            nameInput.value = prompt.name;
            // 编辑模式下名称输入框可编辑，允许重命名
            nameInput.readOnly = false;
            nameInput.style.background = 'var(--bg-tertiary)';
            nameInput.style.cursor = 'text';
        }
        if (contentInput) contentInput.value = prompt.content;
        if (enableWorkflowControlCheckbox) {
            // 读取提示词的实际状态，如果字段不存在，默认为false（默认关闭）
            enableWorkflowControlCheckbox.checked = prompt.enableWorkflowControl !== undefined ? prompt.enableWorkflowControl : false;
        }
        if (cancelBtn) cancelBtn.style.display = 'inline-block';
        
        // 记录原始提示词名称，用于检测是否重命名
        currentEditingPrompt = prompt.name;
        
        if (nameInput) {
            nameInput.focus();
        }
    } catch (err) {
        alert('加载提示词失败: ' + err.message);
    }
}

/**
 * 删除提示词
 */
export async function removePrompt(name) {
    if (!confirm(`确定要删除提示词 "${name}" 吗？`)) return;
    
    try {
        await deletePrompt(name);
        
        if (state.selectedPrompt && state.selectedPrompt.name === name) {
            state.selectedPrompt = null;
            localStorage.removeItem('selectedPrompt');
            updatePromptDisplay();
        }
        
        await loadPrompts();
        renderPromptsList();
        
        // 同步更新设置页面的提示词选择器
        updateSettingsPromptSelectors();
        
        // 同步更新事件的提示词选择器
        if (typeof window !== 'undefined' && window.updateEventPromptSelectors) {
            window.updateEventPromptSelectors();
        }
    } catch (err) {
        alert('删除失败: ' + err.message);
    }
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.loadPrompts = loadPrompts;
    window.renderPromptsList = renderPromptsList;
    window.selectPrompt = selectPrompt;
    window.updatePromptDisplay = updatePromptDisplay;
    window.clearPrompt = clearPrompt;
    window.newPrompt = newPrompt;
    window.savePrompt = savePrompt;
    window.cancelEdit = cancelEdit;
    window.resetPromptForm = resetPromptForm;
    window.editPrompt = editPrompt;
    window.removePrompt = removePrompt;
}
