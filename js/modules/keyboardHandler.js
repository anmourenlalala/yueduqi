/**
 * 键盘快捷键处理模块
 * 负责全局快捷键的处理和分发
 */

import { state } from '../core/state.js';
import { moveSelection, goToPreviousFile, enterDirectory } from './fileManager.js';
import { copyContent, handlePaste, selectFileByPath } from './editor.js';
import { undoAction } from '../utils/history.js';

// 简单的通知函数（如果 history.js 中的 showNotification 不可用）
// 使用全局通知管理器，避免重复显示
let keyboardNotificationContainer = null;
let keyboardNotificationTimer = null;

function showNotification(message, type = 'info') {
    // 如果已有通知，先移除
    if (keyboardNotificationContainer) {
        keyboardNotificationContainer.remove();
        if (keyboardNotificationTimer) {
            clearTimeout(keyboardNotificationTimer);
        }
    }
    
    keyboardNotificationContainer = document.createElement('div');
    keyboardNotificationContainer.style.cssText = `
        position: fixed;
        top: 80px; /* 往下移动，避免遮挡导航栏 */
        right: 20px;
        background: ${type === 'success' ? '#4caf50' : '#2196f3'};
        color: white;
        padding: 12px 20px;
        border-radius: 6px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 10000;
        font-size: 14px;
        max-width: 300px;
    `;
    keyboardNotificationContainer.textContent = message;
    document.body.appendChild(keyboardNotificationContainer);
    
    keyboardNotificationTimer = setTimeout(() => {
        if (keyboardNotificationContainer) {
            keyboardNotificationContainer.remove();
            keyboardNotificationContainer = null;
        }
        keyboardNotificationTimer = null;
    }, 2000);
}
import { getFirstTable, showFullscreen, closeFullscreen } from './tableEditor.js';
import { showDiagramFullscreen } from './mermaidRenderer.js';
import { selectPrompt } from './promptManager.js';
import { switchAllViewsToAi, swapAllViewsFileContent } from './viewManager.js';
import { sendAllViewsToDeepSeek, sendSingleViewToDeepSeek } from './deepseekSender.js';

/**
 * 初始化键盘事件处理
 */
export function initKeyboardHandler() {
    document.addEventListener('keydown', handleKeyDown);
}

/**
 * 处理键盘事件
 */
function handleKeyDown(e) {
    // 检查是否有管理器面板打开
    const promptPanel = document.getElementById('prompt-panel');
    const themePanel = document.getElementById('theme-panel');
    const layoutPanel = document.getElementById('layout-panel');
    const htmlLayoutPanel = document.getElementById('html-layout-panel');
    const workflowPanel = document.getElementById('workflow-panel');
    const eventPanel = document.getElementById('event-panel');
    const feedbackPanel = document.getElementById('feedback-panel');
    const batchPanel = document.getElementById('batch-panel');
    const settingsModal = document.getElementById('settings-modal');
    const viewConfigFullscreenModal = document.getElementById('view-config-fullscreen-modal');
    const keywordRecognitionPanel = document.getElementById('keyword-recognition-panel');
    const keywordRecognitionTestPanel = document.getElementById('keyword-recognition-test-panel');
    
    // 检查面板是否打开（display不是'none'）
    const isPanelOpen = (panel) => {
        if (!panel) return false;
        const display = panel.style.display;
        return display && display !== 'none';
    };
    
    const isManagerPanelOpen = isPanelOpen(promptPanel) ||
                              isPanelOpen(themePanel) ||
                              isPanelOpen(layoutPanel) ||
                              isPanelOpen(htmlLayoutPanel) ||
                              isPanelOpen(workflowPanel) ||
                              isPanelOpen(eventPanel) ||
                              isPanelOpen(feedbackPanel) ||
                              isPanelOpen(batchPanel) ||
                              isPanelOpen(settingsModal) ||
                              isPanelOpen(viewConfigFullscreenModal) ||
                              isPanelOpen(keywordRecognitionPanel) ||
                              isPanelOpen(keywordRecognitionTestPanel);
    
    // 如果管理器面板打开，且用户按Ctrl+V，允许系统默认行为
    if (isManagerPanelOpen && e.ctrlKey && e.key === 'v') {
        return;
    }
    
    // z 键优先级最高
    if (e.key && state.keybinds && state.keybinds.z) {
        const isZKey = !e.ctrlKey && e.key.toLowerCase() === state.keybinds.z;
        if (isZKey) {
            e.preventDefault();
            e.stopPropagation();
            goToPreviousFile();
            return;
        }
    }
    
    const modal = document.getElementById('fullscreen-modal');
    if (modal && modal.style.display === 'flex') {
        // 全屏模式下的键盘事件由tableEditor处理
        // 如果是 ctrl+v，允许浏览器默认行为（粘贴到当前编辑的单元格），不调用主界面的 handlePaste
        if (e.ctrlKey && e.key === 'v') {
            // 检查是否在可编辑元素中
            const activeElement = document.activeElement;
            const isEditing = activeElement && (activeElement.isContentEditable || activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA');
            if (isEditing) {
                // 在可编辑元素中，允许浏览器默认粘贴行为
                return;
            }
            // 如果不在可编辑元素中，阻止默认行为，但不调用 handlePaste
            e.preventDefault();
            return;
        }
        // 其他按键（除了 escape）由 tableEditor 处理
        if (e.key !== state.keybinds.escape) {
            return;
        }
    }

    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        // 在输入框中，只处理特定快捷键
        if (e.ctrlKey && e.key === 'v' && !isManagerPanelOpen) {
            e.preventDefault();
            handlePaste();
        }
        // 在输入框中，w、s、enter 键不处理，让输入框正常使用
        if (e.key && state.keybinds) {
            if ((state.keybinds.w && e.key.toLowerCase() === state.keybinds.w) || 
                (state.keybinds.s && e.key.toLowerCase() === state.keybinds.s) || 
                (state.keybinds.enter && e.key === state.keybinds.enter)) {
                return;
            }
        }
    }
    
    // 全局快捷键
    // 检查是否在全屏模式下
    const isFullscreen = modal && modal.style.display === 'flex';
    
    // Ctrl+V 粘贴：全局处理（不在输入框中的情况）
    if (e.ctrlKey && e.key === 'v') {
        // 检查是否在可编辑元素中
        const activeElement = document.activeElement;
        const isEditing = activeElement && (
            activeElement.isContentEditable || 
            activeElement.tagName === 'INPUT' || 
            activeElement.tagName === 'TEXTAREA'
        );
        
        // 如果不在可编辑元素中，且不在管理面板中，调用 handlePaste
        if (!isEditing && !isManagerPanelOpen) {
            e.preventDefault();
            e.stopPropagation();
            handlePaste();
            return;
        }
        // 如果在可编辑元素中或管理面板中，允许浏览器默认行为
    }
    
    if (e.ctrlKey && e.key === 'c') {
        // 如果管理面板或设置界面打开，允许浏览器默认的复制行为
        if (isManagerPanelOpen) {
            // 不阻止事件，让浏览器处理复制
            return;
        }
        e.preventDefault();
        copyContent();
    }
    
    // 快捷键 m：发送所有视图内容到 DeepSeek
    if (e.key === 'm' || e.key === 'M') {
        // 检查是否在输入框中
        const activeElement = document.activeElement;
        const isInInput = activeElement && (
            activeElement.tagName === 'INPUT' || 
            activeElement.tagName === 'TEXTAREA' || 
            activeElement.isContentEditable
        );
        
        // 如果不在输入框中，且不在管理面板中，执行发送
        if (!isInInput && !isManagerPanelOpen) {
            e.preventDefault();
            sendAllViewsToDeepSeek();
        }
    }
    
    // 快捷键 n：发送单个视图内容到 DeepSeek
    if (e.key === 'n' || e.key === 'N') {
        // 检查是否在输入框中
        const activeElement = document.activeElement;
        const isInInput = activeElement && (
            activeElement.tagName === 'INPUT' || 
            activeElement.tagName === 'TEXTAREA' || 
            activeElement.isContentEditable
        );
        
        // 如果不在输入框中，且不在管理面板中，执行发送
        if (!isInInput && !isManagerPanelOpen) {
            e.preventDefault();
            sendSingleViewToDeepSeek();
        }
    }
    
    if (e.ctrlKey && e.key === 'z') {
        // 检查是否在输入框或文本框中（包括 contentEditable 元素）
        const activeElement = document.activeElement;
        const isInInput = activeElement && (
            activeElement.tagName === 'INPUT' || 
            activeElement.tagName === 'TEXTAREA' || 
            activeElement.isContentEditable
        );
        
        // 如果管理器面板或设置面板打开，且焦点在输入框中，允许浏览器默认撤销行为
        if (isManagerPanelOpen && isInInput) {
            // 不阻止事件，让浏览器处理输入框的撤销
            return;
        }
        
        // 如果不在输入框中，且不在管理面板中，撤销 Ctrl+V 选中的视图
        if (!isInInput && !isManagerPanelOpen) {
            e.preventDefault();
            e.stopPropagation();
            
            // 获取 Ctrl+V 选中的视图ID
            const selectedRadio = document.querySelector('input[name="paste-target"]:checked');
            if (selectedRadio && selectedRadio.value) {
                const selectedViewId = selectedRadio.value.trim();
                if (selectedViewId) {
                    // 确保只撤销选中的视图（传入明确的视图ID，不会执行全局撤销）
                    undoAction(selectedViewId);
                } else {
                    // 如果视图ID为空，提示用户
                    showNotification('请先在导航栏的 Ctrl+V 区域选择要撤销的视图', 'info');
                }
            } else {
                // 如果没有选中的视图，提示用户
                showNotification('请先在导航栏的 Ctrl+V 区域选择要撤销的视图', 'info');
            }
            return;
        }
        
        // 如果在输入框中但不在管理面板中，允许浏览器默认行为（输入框的撤销）
        if (isInInput && !isManagerPanelOpen) {
            // 不阻止事件，让浏览器处理输入框的撤销
            return;
        }
        
        // 如果在输入框中但不在管理面板中，允许浏览器默认行为（输入框的撤销）
    }
    
    // 检查事件面板和批量执行面板是否打开
    const isEventPanelOpen = isPanelOpen(eventPanel);
    const isBatchPanelOpen = isPanelOpen(batchPanel);
    
    // 如果管理器面板打开，屏蔽导航快捷键（但事件面板和批量执行面板中的w、s、enter、e、q键不屏蔽）
    if (isManagerPanelOpen && e.key && state.keybinds) {
        // 在事件面板中，w、s、enter、e、g键允许使用
        const isEventPanelKey = (state.keybinds.w && e.key.toLowerCase() === state.keybinds.w) || 
                                (state.keybinds.s && e.key.toLowerCase() === state.keybinds.s) || 
                                (state.keybinds.enter && e.key === state.keybinds.enter) ||
                                e.key === 'e' || e.key === 'E' ||
                                e.key === 'g' || e.key === 'G';
        
        // 在批量执行面板中，w、s、enter、e、q键允许使用
        const isBatchPanelKey = (state.keybinds.w && e.key.toLowerCase() === state.keybinds.w) || 
                                (state.keybinds.s && e.key.toLowerCase() === state.keybinds.s) || 
                                (state.keybinds.enter && e.key === state.keybinds.enter) ||
                                e.key === 'e' || e.key === 'E' ||
                                e.key === 'q' || e.key === 'Q';
        
        // 如果是在事件面板中按w、s、enter、e、g键，不屏蔽
        if (isEventPanelOpen && isEventPanelKey) {
            // 允许事件面板中的w、s、enter、e、g键，继续执行后续处理
        } else if (isBatchPanelOpen && isBatchPanelKey) {
            // 允许批量执行面板中的w、s、enter、e、q键，继续执行后续处理
        } else {
            // 在其他管理器面板中，屏蔽导航快捷键（但不屏蔽j和k键）
            if ((state.keybinds.w && e.key.toLowerCase() === state.keybinds.w) || 
                (state.keybinds.s && e.key.toLowerCase() === state.keybinds.s) || 
                (state.keybinds.a && e.key.toLowerCase() === state.keybinds.a) || 
                (state.keybinds.d && e.key.toLowerCase() === state.keybinds.d) ||
                e.key === 'f' || e.key === 'F' ||
                e.key === 'g' || e.key === 'G' ||
                e.key === 'e' || e.key === 'E' ||
                e.key === 'q' || e.key === 'Q' ||
                e.key === 'r' || e.key === 'R' ||
                e.key === 't' || e.key === 'T' ||
                (state.keybinds.enter && e.key === state.keybinds.enter)) {
                return;
            }
            // j和k键不屏蔽，允许使用
        }
    }
    
    // w、s 键：在事件面板中移动事件选择，或在文件列表视图下移动选择
    // 检查工作流是否正在执行（锁定文件切换）
    const isWorkflowExecuting = state.isWorkflowExecuting || 
        (state.workflowExecutionState && 
         !state.workflowExecutionState.isCompleted && 
         !state.workflowExecutionState.isCancelled &&
         (state.workflowExecutionState.executingSteps.size > 0 || 
          state.workflowExecutionState.executedSteps.length > 0));
    
    if (e.key && state.keybinds && state.keybinds.w && e.key.toLowerCase() === state.keybinds.w) {
        e.preventDefault();
        if (isEventPanelOpen) {
            // 在事件面板中，移动事件选择（会自动执行enter功能）
            if (window.moveEventSelection) {
                window.moveEventSelection(-1);
            }
        } else if (isBatchPanelOpen) {
            // 在批量执行面板中，移动目录选择
            import('./batchExecutor.js').then(module => {
                if (module.moveBatchSelection) {
                    module.moveBatchSelection(-1);
                }
            });
        } else {
            // 如果工作流正在执行，不允许切换文件
            if (isWorkflowExecuting) {
                return;
            }
            // 在文件列表视图下移动选择，如果选中的是文件则自动打开
            moveSelection(-1);
            // 等待选择完成后，如果选中的是文件，自动打开
            setTimeout(() => {
                if (state.selectedIndex >= 0 && state.currentFileItem && !state.currentFileItem.isDir) {
                    // 只有选中的是文件时才自动打开
                    if (window.selectFile) {
                        window.selectFile(state.currentFileItem.el, state.currentFileItem.path);
                    }
                }
            }, 50);
        }
    }
    if (e.key && state.keybinds && state.keybinds.s && e.key.toLowerCase() === state.keybinds.s) {
        e.preventDefault();
        if (isEventPanelOpen) {
            // 在事件面板中，移动事件选择（会自动执行enter功能）
            if (window.moveEventSelection) {
                window.moveEventSelection(1);
            }
        } else if (isBatchPanelOpen) {
            // 在批量执行面板中，移动目录选择
            import('./batchExecutor.js').then(module => {
                if (module.moveBatchSelection) {
                    module.moveBatchSelection(1);
                }
            });
        } else {
            // 如果工作流正在执行，不允许切换文件
            if (isWorkflowExecuting) {
                return;
            }
            // 在文件列表视图下移动选择，如果选中的是文件则自动打开
            moveSelection(1);
            // 等待选择完成后，如果选中的是文件，自动打开
            setTimeout(() => {
                if (state.selectedIndex >= 0 && state.currentFileItem && !state.currentFileItem.isDir) {
                    // 只有选中的是文件时才自动打开
                    if (window.selectFile) {
                        window.selectFile(state.currentFileItem.el, state.currentFileItem.path);
                    }
                }
            }, 50);
        }
    }
    if (e.key === state.keybinds.escape) {
        e.preventDefault();
        closeFullscreen();
    }

    // ESC键关闭模态面板
    if (e.key === 'Escape') {
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal && settingsModal.style.display === 'flex') {
            settingsModal.style.display = 'none';
        }

        if (promptPanel && promptPanel.style.display === 'flex') {
            promptPanel.style.display = 'none';
            if (window.resetPromptForm) window.resetPromptForm();
        }
        
        if (themePanel && themePanel.style.display === 'flex') {
            themePanel.style.display = 'none';
            if (window.resetThemeForm) window.resetThemeForm();
        }
        
        if (layoutPanel && layoutPanel.style.display === 'flex') {
            layoutPanel.style.display = 'none';
            if (window.resetLayoutForm) window.resetLayoutForm();
        }
        
        if (workflowPanel && workflowPanel.style.display === 'flex') {
            workflowPanel.style.display = 'none';
        }
        
        if (eventPanel && eventPanel.style.display === 'flex') {
            eventPanel.style.display = 'none';
        }

        // ESC 关闭反馈系统管理面板
        if (feedbackPanel && feedbackPanel.style.display === 'flex') {
            feedbackPanel.style.display = 'none';
        }
        
        // ESC键关闭批量执行面板
        if (batchPanel && batchPanel.style.display === 'flex') {
            batchPanel.style.display = 'none';
            // 清理面板状态
            import('./batchExecutor.js').then(module => {
                if (module.clearBatchState) {
                    module.clearBatchState();
                }
            });
        }
        
        // ESC键关闭视图管理面板
        if (viewConfigFullscreenModal && viewConfigFullscreenModal.style.display === 'flex') {
            viewConfigFullscreenModal.style.display = 'none';
        }
    }

    // Enter键确认选择（在文件列表视图下或事件面板中或批量执行面板中）
    // 处理enter键的逻辑函数
    function handleEnterKey() {
        if (isEventPanelOpen) {
            // 在事件面板中，选择当前事件
            if (window.selectCurrentEvent) {
                window.selectCurrentEvent();
            }
        } else if (isBatchPanelOpen) {
            // 在批量执行面板中，进入选中的目录
            import('./batchExecutor.js').then(module => {
                if (module.enterBatchDirectory) {
                    module.enterBatchDirectory();
                }
            });
        } else {
            // 在文件列表视图下，执行选择操作
            if (state.selectedIndex >= 0 && state.currentFileItem) {
                if (state.currentFileItem.isDir) {
                    // 如果是目录，进入目录
                    if (window.enterDirectory) {
                        window.enterDirectory();
                    }
                } else {
                    // 如果是文件，选择文件
                    if (window.selectFile) {
                        window.selectFile(state.currentFileItem.el, state.currentFileItem.path);
                    }
                }
            }
        }
    }

    if (e.key === state.keybinds.enter) {
        // 如果当前焦点在可编辑区域（包括 contentEditable 的编辑模式），
        // 不拦截，让浏览器/编辑器自己处理换行。
        const activeElement = document.activeElement;
        const isEditing = activeElement && (
            activeElement.isContentEditable ||
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA'
        );
        if (!isEditing) {
            e.preventDefault();
            handleEnterKey();
        }
    }

    // 视图特定的快捷键（打开对应视图的表格全屏）
    const matchingView = e.key && state.views ? state.views.find(view => view.keybind && view.keybind.toLowerCase() === e.key.toLowerCase()) : null;
    // 特殊约定：字母 E 保留给“等价 Enter”的快捷键使用，不占用视图快捷键
    if (matchingView && state.originalPath && e.key.toLowerCase() !== 'e') {
        e.preventDefault();
        const table = getFirstTable(matchingView.id);
        if (table && table.rows.length > 2) {
            showFullscreen(2, 0, table, false);
        }
        return;
    }

    // A: 进入第一个视图的表格全屏
    if (e.key && state.keybinds && state.keybinds.a && e.key.toLowerCase() === state.keybinds.a && state.originalPath) {
        e.preventDefault();
        if (state.views.length > 0) {
            const firstViewId = state.views[0].id;
            const table = getFirstTable(firstViewId);
            if (table && table.rows.length > 2) {
                showFullscreen(2, 0, table, false);
            }
        }
    }

    // D: 进入第二个视图的表格全屏
    if (e.key && state.keybinds && state.keybinds.d && e.key.toLowerCase() === state.keybinds.d && state.originalPath) {
        e.preventDefault();
        if (state.views.length > 1) {
            const secondViewId = state.views[1].id;
            const table = getFirstTable(secondViewId);
            if (table && table.rows.length > 2) {
                showFullscreen(2, 0, table, false);
            }
        }
    }

    // F: 显示第一个视图的第一个图表
    if ((e.key === 'f' || e.key === 'F') && state.originalPath) {
        e.preventDefault();
        if (state.views.length > 0) {
            const firstViewId = state.views[0].id;
            const diagram = document.querySelector(`#view-${firstViewId} .md-diagram`);
            if (diagram) {
                showDiagramFullscreen(diagram);
            }
        }
    }

    // Delete: 软删除当前选中的文件或文件夹
    if (e.key === 'Delete') {
        // 在输入框或编辑区域中按 Delete，保持原生删除行为
        const activeElement = document.activeElement;
        const isEditing = activeElement && (
            activeElement.isContentEditable ||
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA'
        );
        if (isEditing) {
            return;
        }
        
        // 只有在文件管理列表有选中项时才处理
        if (state.selectedIndex >= 0 && state.currentFileItem && state.currentFileItem.path) {
            e.preventDefault();
            e.stopPropagation();
            
            const targetPath = state.currentFileItem.path;
            const isDir = !!state.currentFileItem.isDir;
            
            // 文件夹需要用户确认
            if (isDir) {
                const ok = confirm('确定要软删除当前文件夹及其内容吗？\n\n此操作会将文件夹移动到回收站，可在回收站中恢复。');
                if (!ok) return;
            }
            
            import('../core/api.js').then(async ({ softDelete }) => {
                try {
                    await softDelete(targetPath);
                    if (window.loadDir) {
                        await window.loadDir(state.currentDir);
                    }
                } catch (err) {
                    alert('删除失败: ' + (err.message || err));
                }
            });
        }
    }

    // G: 显示第二个视图的第一个图表
    if ((e.key === 'g' || e.key === 'G') && state.originalPath) {
        e.preventDefault();
        if (state.views.length > 1) {
            const secondViewId = state.views[1].id;
            const diagram = document.querySelector(`#view-${secondViewId} .md-diagram`);
            if (diagram) {
                showDiagramFullscreen(diagram);
            }
        }
    }

    // E: 调用enter的功能（直接使用enter的逻辑）
    if (e.key === 'e' || e.key === 'E') {
        // 在可编辑区域中，按 e 应该输入字母 e，而不是触发快捷键
        const activeElement = document.activeElement;
        const isEditing = activeElement && (
            activeElement.isContentEditable ||
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA'
        );
        if (!isEditing) {
            e.preventDefault();
            handleEnterKey();
        }
    }

    // Q: 返回上一个文件或目录
    if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        if (isBatchPanelOpen) {
            // 在批量执行面板中，返回上一级目录
            import('./batchExecutor.js').then(module => {
                if (module.goBackBatchDirectory) {
                    module.goBackBatchDirectory();
                }
            });
        } else if (state.currentContext === 'file' && state.fileJumpStack && state.fileJumpStack.length > 0) {
            const previousFile = state.fileJumpStack.pop();
            selectFileByPath(previousFile);
        } else if (state.dirStack && state.dirStack.length > 0) {
            state.currentContext = 'dir';
            const previousDir = state.dirStack.pop();
            const previousFolder = state.folderStack ? state.folderStack.pop() : null;
            
            if (window.loadDir) {
                window.loadDir(previousDir).then(() => {
                    setTimeout(() => {
                        if (previousFolder) {
                            const folderItem = Array.from(document.querySelectorAll('.file-item.type-dir')).find(item =>
                                item.dataset.path === previousFolder
                            );
                            if (folderItem && window.selectFolder) {
                                window.selectFolder(folderItem, previousFolder);
                                folderItem.scrollIntoView({ block: 'nearest' });
                            }
                        }
                    }, 100);
                });
            }
        } else {
            const parts = state.currentDir.replace(/\\/g, '/').split('/');
            if (parts.length > 1) {
                parts.pop();
                if (window.loadDir) {
                    window.loadDir(parts.join('/') || '.');
                }
            }
        }
    }

    // R: 循环切换粘贴目标
    if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        const radioButtons = document.querySelectorAll('input[name="paste-target"]');
        if (radioButtons.length > 0) {
            let currentIndex = -1;
            for (let i = 0; i < radioButtons.length; i++) {
                if (radioButtons[i].checked) {
                    currentIndex = i;
                    break;
                }
            }
            const nextIndex = (currentIndex + 1) % radioButtons.length;
            radioButtons[nextIndex].checked = true;
        }
    }

    // T: 循环切换提示词
    if (e.key === 't' || e.key === 'T') {
        const modal = document.getElementById('fullscreen-modal');
        const isFullscreen = modal && modal.style.display === 'flex';
        
        if (!isFullscreen) {
            e.preventDefault();
            if (state.prompts.length === 0) return;
            
            let currentIndex = -1;
            if (state.selectedPrompt && state.selectedPrompt.name) {
                currentIndex = state.prompts.findIndex(p => p.name === state.selectedPrompt.name);
            }
            
            const nextIndex = (currentIndex + 1) % state.prompts.length;
            const nextPrompt = state.prompts[nextIndex];
            selectPrompt(nextPrompt.name);
        }
    }

    // J: 切换所有视图到_ai文件或回退
    if ((e.key === 'j' || e.key === 'J') && state.originalPath) {
        e.preventDefault();
        switchAllViewsToAi();
    }

    // K: 一键交换所有视图的原始文件和AI文件的内容
    if ((e.key === 'k' || e.key === 'K') && state.originalPath && !isManagerPanelOpen) {
        e.preventDefault();
        swapAllViewsFileContent();
    }

    // F: 切换事件列表
    if ((e.key === 'f' || e.key === 'F') && !isFullscreen) {
        e.preventDefault();
        const eventPanel = document.getElementById('event-panel');
        if (eventPanel) {
            if (isPanelOpen(eventPanel)) {
                eventPanel.style.display = 'none';
                // 清除定时器
                if (window.eventStatusUpdateInterval) {
                    clearInterval(window.eventStatusUpdateInterval);
                    window.eventStatusUpdateInterval = null;
                }
            } else {
                eventPanel.style.display = 'flex';
                eventPanel.focus();
                // 触发事件面板的打开事件（会加载事件列表和初始化状态显示）
                const btnEvent = document.getElementById('btn-event');
                if (btnEvent && btnEvent.onclick) {
                    btnEvent.onclick();
                }
            }
        }
    }

    // G: 执行当前事件
    if ((e.key === 'g' || e.key === 'G') && !isFullscreen) {
        e.preventDefault();
        const eventNameInput = document.getElementById('event-name');
        if (eventNameInput && eventNameInput.value.trim()) {
            const executeEventBtn = document.getElementById('execute-event-btn');
            if (executeEventBtn && !executeEventBtn.disabled) {
                executeEventBtn.click();
            }
        }
    }
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.initKeyboardHandler = initKeyboardHandler;
}
