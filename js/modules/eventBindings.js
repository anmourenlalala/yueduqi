/**
 * 事件绑定模块
 * 负责绑定所有UI事件处理器
 */

import { state, saveStateToStorage } from '../core/state.js';
import { loadDir, selectFile, selectFolder, enterDirectory, moveSelection } from './fileManager.js';
import { copyContent, handlePaste } from './editor.js';
import { renderViewerGrid, renderPasteTargets, renderSettings, addViewConfig, updateSettingsPromptSelectors, renderViewConfigFullscreen, saveViewConfigFullscreen, newViewInFullscreen, updateExternalAiToggleState } from './viewManager.js';
import { loadPrompts, renderPromptsList, selectPrompt, clearPrompt, newPrompt, cancelEdit, resetPromptForm, savePrompt as savePromptHandler, editPrompt, removePrompt } from './promptManager.js';
import { loadThemes, renderThemesList, selectTheme, clearTheme, newTheme, saveTheme as saveThemeHandler, resetThemeForm, toggleThemeMode, importTheme, exportTheme, previewTheme, formatThemeCSS, showThemeTemplate } from './themeManager.js';
import { showKeywordRecognitionManager, renderRulesList, newKeywordRecognitionRule, saveKeywordRecognitionRule, cancelKeywordRecognitionEdit, showKeywordRecognitionFunctionTemplate, saveKeywordRecognitionFunctionCode, clearKeywordRecognitionFunctionCode, loadSavedCodeToInput, copyKeywordRecognitionCodeBlock, exportKeywordRecognitionRule, importKeywordRecognitionRule } from './usage/keywordRecognitionManager.js';
import { loadLayouts, renderLayoutsList, selectLayout, clearLayout, newLayout, saveLayout as saveLayoutHandler, resetLayoutForm, editLayout, removeLayout, showLayoutHistory, importLayout, exportLayout, updateLayoutPreview } from './layoutManager.js';
import { loadWorkflows, renderWorkflowsList, parseWorkflowFormat, generateWorkflowFormat } from './workflowManager.js';
import { loadEvents, renderEventsList, executeEvent } from './eventManager.js';
import { loadEventsForBatch, renderEventsListForBatch, executeBatch, loadBatchDir } from './batchExecutor.js';
import { initEnhancedLogDisplay } from './workflowExecutionLogger.js';
import { initWorkflowVisualizer, renderWorkflowFromContent } from './workflowVisualizer.js';
import { createFile, createFolder, getTrash, restoreItem, getWorkflows, getWorkflow, saveWorkflow, deleteWorkflow, getEvents, getEvent, saveEvent, deleteEvent } from '../core/api.js';
import { pathUtils } from '../utils/path.js';
import { initKeyboardHandler } from './keyboardHandler.js';
import { organizeFiles } from './fileOrganizer.js';
import { getFileFolderPath, getFileInFolderPath } from '../utils/fileUtils.js';
import { addToManagerHistory } from '../utils/managerHistory.js';
import { broadcastFontSizeChange } from './dragSeparator/index.js';

/**
 * 初始化所有事件绑定
 */
export function initEventBindings() {
    bindHeaderEvents();
    bindFileManagerEvents();
    bindSettingsEvents();
    bindPromptManagerEvents();
    bindThemeManagerEvents();
    bindLayoutManagerEvents();
    bindWorkflowManagerEvents();
    bindEventManagerEvents();
    bindBatchExecutorEvents();
    bindModalEvents();
    bindTrashEvents();
    bindFloatingActionsEvents();
    
    // 初始化键盘事件处理
    initKeyboardHandler();
    
    // 初始化增强的日志展示（延迟执行，确保DOM已加载）
    setTimeout(() => {
        const logElement = document.getElementById('workflow-execution-status');
        if (logElement && logElement.dataset.enhanced !== 'true') {
            initEnhancedLogDisplay();
        }
    }, 100);
}

/**
 * 绑定顶部标题栏事件
 */
function bindHeaderEvents() {
    // 一键开关所有视图编辑模式按钮
    
    // 主题切换按钮
    const btnTheme = document.getElementById('btn-theme');
    if (btnTheme) {
        btnTheme.onclick = () => {
            const panel = document.getElementById('theme-panel');
            if (panel) {
                panel.style.display = 'flex';
                panel.focus();
                renderThemesList();
            }
        };
    }
    
    // 复制按钮
    const btnCopy = document.getElementById('btn-copy');
    if (btnCopy) {
        btnCopy.onclick = copyContent;
    }
    
    // 新建下拉菜单
    const dropdownBtn = document.getElementById('new-dropdown-btn');
    const dropdownMenu = document.querySelector('.dropdown-menu');
    
    if (dropdownBtn && dropdownMenu) {
        dropdownBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            const isVisible = dropdownMenu.style.display === 'block';
            dropdownMenu.style.display = isVisible ? 'none' : 'block';
        });
        
        // 点击外部关闭下拉菜单
        document.addEventListener('click', function(e) {
            if (!dropdownBtn.contains(e.target) && !dropdownMenu.contains(e.target)) {
                dropdownMenu.style.display = 'none';
            }
        });
    }
    
    // 新建文件按钮
    const newFileBtn = document.getElementById('new-file-btn');
    if (newFileBtn) {
        newFileBtn.addEventListener('click', async function(e) {
            e.preventDefault();
            const currentDir = document.getElementById('dir-path')?.value || state.currentDir;
            // 进入“新建文件编辑模式”：先写内容，保存时再询问文件名
            try {
                state.isCreatingNewFile = true;
                state.newFileDir = currentDir;
                state.originalPath = null;
                state.originalPanePaths = {};
                if (!state.panePaths) state.panePaths = {};
                if (!state.rawContents) state.rawContents = {};

                // 使用第一个视图作为新建文件的主视图
                const mainView = state.views && state.views[0];
                if (mainView) {
                    state.panePaths[mainView.id] = null;
                    state.rawContents[mainView.id] = '';

                    // 清空当前视图内容
                    const viewEl = document.getElementById(`view-${mainView.id}`);
                    if (viewEl) {
                        viewEl.innerHTML = '';
                    }

                    // 直接进入编辑模式，让用户先写内容
                    const { enterEditMode } = await import('./paragraphEditor.js');
                    await enterEditMode(mainView.id, null);
                }
            } catch (error) {
                alert('进入新建文件编辑模式失败: ' + error.message);
            }
            const dropdownMenu = document.querySelector('.dropdown-menu');
            if (dropdownMenu) dropdownMenu.style.display = 'none';
        });
    }
    
    // 自动整理按钮
    const organizeFilesBtn = document.getElementById('organize-files-btn');
    if (organizeFilesBtn) {
        organizeFilesBtn.addEventListener('click', async function(e) {
            e.preventDefault();
            const currentDir = document.getElementById('dir-path')?.value || state.currentDir;
            const dropdownMenu = document.querySelector('.dropdown-menu');
            
            if (!confirm('确定要整理当前目录的文件吗？\n\n这将把视图文件和AI文件移动到对应的文件名文件夹中，主文件保持在根目录。')) {
                if (dropdownMenu) dropdownMenu.style.display = 'none';
                return;
            }
            
            try {
                organizeFilesBtn.textContent = '整理中...';
                organizeFilesBtn.disabled = true;
                
                const result = await organizeFiles(currentDir);
                
                let message = `整理完成！\n\n成功整理: ${result.organizedCount} 个文件`;
                if (result.errorCount > 0) {
                    message += `\n失败: ${result.errorCount} 个文件`;
                }
                alert(message);
            } catch (error) {
                alert('整理失败: ' + error.message);
            } finally {
                organizeFilesBtn.textContent = '📦 自动整理';
                organizeFilesBtn.disabled = false;
                if (dropdownMenu) dropdownMenu.style.display = 'none';
            }
        });
    }
    
    // 新建文件夹按钮
    const newFolderBtn = document.getElementById('new-folder-btn');
    if (newFolderBtn) {
        newFolderBtn.addEventListener('click', async function(e) {
            e.preventDefault();
            const currentDir = document.getElementById('dir-path')?.value || state.currentDir;
            const folderName = prompt('请输入文件夹名:');
            if (folderName) {
                const folderPath = pathUtils.join(currentDir, folderName).replace(/\\/g, '/');
                try {
                    await createFolder(folderPath);
                    alert('文件夹创建成功');
                    await loadDir(currentDir);
                } catch (error) {
                    alert('创建失败: ' + error.message);
                }
            }
            const dropdownMenu = document.querySelector('.dropdown-menu');
            if (dropdownMenu) dropdownMenu.style.display = 'none';
        });
    }
    
    // 路径输入框回车加载目录
    const dirPathInput = document.getElementById('dir-path');
    if (dirPathInput) {
        dirPathInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                loadDir(this.value);
            }
        });
    }
    
    // UP按钮
    const btnUp = document.getElementById('btn-up');
    if (btnUp) {
        btnUp.onclick = () => {
            const parts = state.currentDir.replace(/\\/g, '/').split('/');
            if (parts.length > 1) {
                parts.pop();
                loadDir(parts.join('/') || '.');
            }
        };
    }
}

/**
 * 绑定 HTML 页面布局管理相关事件
 */
function bindHtmlLayoutManagerEvents() {
    const panel = document.getElementById('html-layout-panel');
    if (!panel) return;

    // 顶部关闭按钮
    const closeBtn = document.getElementById('close-html-layout-panel');
    if (closeBtn) {
        closeBtn.onclick = () => {
            panel.style.display = 'none';
        };
    }

    // 清空当前布局（回到默认）
    const clearBtn = document.getElementById('clear-html-layout-btn');
    if (clearBtn) {
        clearBtn.onclick = () => {
            clearHtmlLayoutSelection();
            // 同步左侧列表选中状态
            renderHtmlLayoutsList((document.getElementById('html-layout-search') || {}).value || '');
        };
    }

    // 新建按钮
    const newBtn = document.getElementById('new-html-layout-btn');
    if (newBtn) {
        newBtn.onclick = () => {
            newHtmlLayout();
        };
    }

    // 保存按钮
    const saveBtn = document.getElementById('save-html-layout');
    if (saveBtn) {
        saveBtn.onclick = async () => {
            const ok = await saveHtmlLayoutHandler();
            if (ok) {
                // 重新渲染列表，保持搜索关键字
                const searchInput = document.getElementById('html-layout-search');
                const term = searchInput ? searchInput.value : '';
                renderHtmlLayoutsList(term);
            }
        };
    }

    // 取消编辑
    const cancelBtn = document.getElementById('cancel-html-layout-edit');
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            resetHtmlLayoutForm();
        };
    }

    // 初始化搜索框与模板按钮等交互
    initHtmlLayoutPanelInteractions();
}

/**
 * 绑定文件管理事件
 */
function bindFileManagerEvents() {
    // 这些事件主要在fileManager模块中处理
    // 这里可以添加额外的文件管理相关事件
    
    // 移动端INDEX下拉菜单事件
    const mobileIndexToggle = document.getElementById('mobile-index-toggle');
    const mobileIndexDropdown = document.getElementById('mobile-index-dropdown');
    const closeMobileIndex = document.getElementById('close-mobile-index');
    const mobileIndexUpBtn = document.getElementById('mobile-index-up-btn');
    
    if (mobileIndexToggle && mobileIndexDropdown) {
        mobileIndexToggle.onclick = () => {
            mobileIndexDropdown.style.display = 'flex';
        };
    }
    
    if (closeMobileIndex && mobileIndexDropdown) {
        closeMobileIndex.onclick = () => {
            mobileIndexDropdown.style.display = 'none';
        };
    }
    
    // 移动端INDEX返回上一目录按钮
    if (mobileIndexUpBtn) {
        mobileIndexUpBtn.onclick = () => {
            const parts = state.currentDir.replace(/\\/g, '/').split('/');
            if (parts.length > 1) {
                parts.pop();
                loadDir(parts.join('/') || '.');
            }
        };
    }
    
    // 点击下拉菜单外部关闭
    if (mobileIndexDropdown) {
        mobileIndexDropdown.addEventListener('click', (e) => {
            if (e.target === mobileIndexDropdown) {
                mobileIndexDropdown.style.display = 'none';
            }
        });
    }
}

/**
 * 加载回收站内容
 */
async function loadTrashContent() {
    try {
        const data = await getTrash();
        const trashContent = document.getElementById('trash-content');
        if (!trashContent) return;

        if (data.items && data.items.length > 0) {
            trashContent.innerHTML = '';
            data.items.forEach(item => {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'trash-item';
                itemDiv.style.cssText = `
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px;
                    border: 1px solid var(--border);
                    border-radius: var(--border-radius);
                    margin-bottom: 5px;
                    background-color: var(--bg-tertiary);
                `;

                itemDiv.innerHTML = `
                    <div>
                        <span>${item.type === 'directory' ? '📁' : '📄'}</span>
                        <span style="margin-left: 5px;">${item.name}</span>
                        <span style="font-size: 12px; color: var(--text-muted); margin-left: 10px;">${new Date(item.deletedAt).toLocaleString()}</span>
                    </div>
                    <div>
                        <button class="btn restore-btn" style="font-size: 12px;">恢复</button>
                        <button class="btn permanent-delete-btn" style="font-size: 12px; margin-left: 8px; background: var(--error, #f87171); color: white;">永久删除</button>
                    </div>
                `;

                const restoreBtn = itemDiv.querySelector('.restore-btn');
                restoreBtn.dataset.path = item.path;
                restoreBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (window.handleTrashRestore) {
                        window.handleTrashRestore(item.path);
                    }
                });

                const permanentDeleteBtn = itemDiv.querySelector('.permanent-delete-btn');
                if (permanentDeleteBtn) {
                    permanentDeleteBtn.dataset.path = item.path;
                    permanentDeleteBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        // 再次检查是否为本地访问
                        if (!window.isLocalAccess) {
                            alert('此操作仅允许本地访问');
                            return;
                        }
                        if (confirm('确定要永久删除此项目吗？此操作无法撤销！')) {
                            if (window.handleTrashPermanentDelete) {
                                window.handleTrashPermanentDelete(item.path);
                            }
                        }
                    });
                    // 根据访问控制显示/隐藏
                    if (window.isLocalAccess) {
                        permanentDeleteBtn.style.display = '';
                    } else {
                        permanentDeleteBtn.style.display = 'none';
                    }
                }

                trashContent.appendChild(itemDiv);
            });
            
            // 显示一键恢复和一键删除按钮
            const restoreAllBtn = document.getElementById('restore-all-btn');
            const permanentDeleteAllBtn = document.getElementById('permanent-delete-all-btn');
            if (restoreAllBtn) restoreAllBtn.style.display = '';
            if (permanentDeleteAllBtn) permanentDeleteAllBtn.style.display = '';
        } else {
            trashContent.innerHTML = '<p style="color: var(--text-muted); font-style: italic;">回收站是空的</p>';
            
            // 隐藏一键恢复和一键删除按钮
            const restoreAllBtn = document.getElementById('restore-all-btn');
            const permanentDeleteAllBtn = document.getElementById('permanent-delete-all-btn');
            if (restoreAllBtn) restoreAllBtn.style.display = 'none';
            if (permanentDeleteAllBtn) permanentDeleteAllBtn.style.display = 'none';
        }
    } catch (error) {
        const trashContent = document.getElementById('trash-content');
        if (trashContent) {
            trashContent.innerHTML = '<p style="color: red;">加载回收站失败: ' + error.message + '</p>';
        }
    }
}

/**
 * 绑定设置面板事件
 */
function bindSettingsEvents() {
    // 打开设置
    const btnSettings = document.getElementById('btn-settings');
    if (btnSettings) {
        btnSettings.onclick = async () => {
            // 先关闭统计面板，避免遮挡
            const usagePanel = document.getElementById('usage-panel');
            if (usagePanel) {
                usagePanel.style.display = 'none';
            }

            const modal = document.getElementById('settings-modal');
            if (modal) {
                modal.style.display = 'flex';
                modal.focus();
                // 打开设置时加载提示词列表（用于视图配置中的提示词选择器）
                await loadPrompts();
                // 更新设置页面的提示词选择器
                updateSettingsPromptSelectors();
                // 关键修复：在加载提示词后渲染设置，确保首次显示时提示词选择器正确填充
                await renderSettings();
                // 打开设置时加载回收站内容
                setTimeout(loadTrashContent, 100);
                // 根据主机用户状态显示/隐藏外部AI设置
                const externalAiSection = document.getElementById('external-ai-settings-section');
                if (externalAiSection) {
                    if (window.isLocalAccess === true) {
                        externalAiSection.style.display = '';
                        // 更新外部AI开关状态
                        updateExternalAiToggleState();
                    } else {
                        externalAiSection.style.display = 'none';
                    }
                }
            }
        };
    }
    
    // 关闭设置
    const closeSettings = document.getElementById('close-settings');
    if (closeSettings) {
        closeSettings.onclick = () => {
            const modal = document.getElementById('settings-modal');
            if (modal) {
                modal.style.display = 'none';
                saveStateToStorage();
                // 保存快捷键配置
                const keyW = document.getElementById('key-w');
                const keyS = document.getElementById('key-s');
                const keyA = document.getElementById('key-a');
                const keyD = document.getElementById('key-d');
                
                if (keyW) state.keybinds.w = keyW.value.toLowerCase();
                if (keyS) state.keybinds.s = keyS.value.toLowerCase();
                if (keyA) state.keybinds.a = keyA.value.toLowerCase();
                if (keyD) state.keybinds.d = keyD.value.toLowerCase();
                
                localStorage.setItem('keybinds', JSON.stringify(state.keybinds));
                renderViewerGrid();
                renderPasteTargets();
            }
        };
    }

    // 外部AI同步开关
    const externalAiToggle = document.getElementById('external-ai-sync-toggle');
    if (externalAiToggle) {
        externalAiToggle.onclick = () => {
            // 切换状态
            state.externalAiSyncEnabled = !state.externalAiSyncEnabled;
            // 更新按钮显示
            updateExternalAiToggleState();
            // 立即保存到localStorage
            localStorage.setItem('externalAiSyncEnabled', JSON.stringify(state.externalAiSyncEnabled));
            // 保存到state
            saveStateToStorage();
        };
    }
    
    // 字体大小滑块
    const fontSizeRange = document.getElementById('font-size-range');
    if (fontSizeRange) {
        fontSizeRange.addEventListener('input', function() {
            const fontSize = this.value + "px";
            document.documentElement.style.setProperty('--font-size', fontSize);
            const currentFontSize = document.getElementById('current-font-size');
            if (currentFontSize) {
                currentFontSize.textContent = fontSize;
            }

            // 同步更新所有分离窗口的字体大小
            try {
                broadcastFontSizeChange(fontSize);
            } catch (e) {
                console.warn('[设置] 向分离窗口同步字体大小失败:', e);
            }
        });
    }
    
    // 添加视图按钮
    const addViewBtn = document.getElementById('add-view');
    if (addViewBtn) {
        addViewBtn.onclick = addViewConfig;
    }
    
    // 显示全部视图配置按钮
    const showAllViewsBtn = document.getElementById('show-all-views-btn');
    if (showAllViewsBtn) {
        showAllViewsBtn.onclick = async () => {
            await loadPrompts();
            renderViewConfigFullscreen();
            // 显示设置面板中的"添加视图"按钮
            const addViewBtn = document.getElementById('add-view');
            if (addViewBtn) {
                addViewBtn.style.display = '';
            }
        };
    }
    
    // 全屏视图配置面板事件
    const viewConfigFullscreenModal = document.getElementById('view-config-fullscreen-modal');
    if (viewConfigFullscreenModal) {
        // 关闭按钮
        const closeBtn = document.getElementById('close-view-config-fullscreen');
        if (closeBtn) {
            closeBtn.onclick = () => {
                viewConfigFullscreenModal.style.display = 'none';
                // 隐藏设置面板中的"添加视图"按钮
                const addViewBtn = document.getElementById('add-view');
                if (addViewBtn) {
                    addViewBtn.style.display = 'none';
                }
            };
        }
        
        // 点击外部关闭
        viewConfigFullscreenModal.addEventListener('click', function(e) {
            if (e.target.id === 'view-config-fullscreen-modal' || e.target.id === 'close-view-config-fullscreen') {
                viewConfigFullscreenModal.style.display = 'none';
                // 隐藏设置面板中的"添加视图"按钮
                const addViewBtn = document.getElementById('add-view');
                if (addViewBtn) {
                    addViewBtn.style.display = 'none';
                }
            }
        });
        
        // 新建视图按钮
        const newViewBtn = document.getElementById('new-view-in-fullscreen');
        if (newViewBtn) {
            newViewBtn.onclick = newViewInFullscreen;
        }
        
        // 保存配置按钮
        const saveViewConfigBtn = document.getElementById('save-view-config');
        if (saveViewConfigBtn) {
            saveViewConfigBtn.onclick = saveViewConfigFullscreen;
        }
    }
    
    // 设置模态点击外部关闭
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) {
        settingsModal.addEventListener('click', function(e) {
            if (e.target.id === 'settings-modal' || e.target.id === 'close-settings') {
                settingsModal.style.display = 'none';
            }
        });
    }

    // 反馈系统管理面板
    const feedbackPanel = document.getElementById('feedback-panel');
    const closeFeedbackBtn = document.getElementById('close-feedback-panel');
    if (feedbackPanel && closeFeedbackBtn) {
        closeFeedbackBtn.addEventListener('click', () => {
            feedbackPanel.style.display = 'none';
        });
    }

    // 顶部“反馈系统”按钮（如果以后加的话）和悬浮窗按钮，统一用全局函数打开
    if (typeof window !== 'undefined') {
        window.openFeedbackPanel = () => {
            if (!feedbackPanel) return;
            // 先关闭设置面板，避免遮挡
            const settings = document.getElementById('settings-modal');
            if (settings) {
                settings.style.display = 'none';
            }
            feedbackPanel.style.display = 'flex';
            feedbackPanel.focus();
            if (window.loadFeedbackConfig) {
                window.loadFeedbackConfig();
            }
            if (window.initFeedbackPanelControls) {
                window.initFeedbackPanelControls();
            }
            if (window.initPermanentFeedbackPanel) {
                window.initPermanentFeedbackPanel();
            }
        };
    }
    
    // 初始化永久反馈面板（只需要初始化一次）
    if (typeof window !== 'undefined' && window.initPermanentFeedbackPanel) {
        window.initPermanentFeedbackPanel();
    }
    
    // 初始化全屏反馈配置面板
    if (typeof window !== 'undefined' && window.initFeedbackConfigFullscreenPanel) {
        window.initFeedbackConfigFullscreenPanel();
    }
    
    // 关键字识别管理面板
    bindKeywordRecognitionManagerEvents();
}

/**
 * 绑定关键字识别管理面板事件
 */
function bindKeywordRecognitionManagerEvents() {
    // 测试按钮
    const testBtn = document.getElementById('test-keyword-recognition-btn');
    if (testBtn) {
        testBtn.addEventListener('click', async () => {
            const { showKeywordRecognitionTestPanel, initKeywordRecognitionTestPanel } = await import('./usage/keywordRecognitionManager.js');
            await initKeywordRecognitionTestPanel();
            await showKeywordRecognitionTestPanel();
        });
    }
    // 打开关键字识别管理面板按钮（在反馈统计面板中）
    const openBtn = document.getElementById('open-keyword-recognition-manager-btn');
    if (openBtn) {
        openBtn.addEventListener('click', () => {
            const panel = document.getElementById('keyword-recognition-panel');
            if (panel) {
                panel.style.display = 'flex';
                panel.focus();
                showKeywordRecognitionManager();
            }
        });
    }
    
    // 关闭面板按钮
    const closeBtn = document.getElementById('close-keyword-recognition-panel');
    const panel = document.getElementById('keyword-recognition-panel');
    if (closeBtn && panel) {
        closeBtn.addEventListener('click', () => {
            panel.style.display = 'none';
        });
    }
    
    // ESC键关闭
    if (panel) {
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && panel.style.display === 'flex') {
                panel.style.display = 'none';
            }
        });
    }
    
    // 搜索框
    const searchInput = document.getElementById('keyword-recognition-search');
    if (searchInput) {
        let searchDebounceTimer = null;
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.trim();
            if (searchDebounceTimer) {
                clearTimeout(searchDebounceTimer);
            }
            searchDebounceTimer = setTimeout(async () => {
                await renderRulesList(null, searchTerm);
            }, 300);
        });
    }
    
    // 新建规则按钮
    const newBtn = document.getElementById('new-keyword-recognition-rule-btn');
    if (newBtn) {
        newBtn.addEventListener('click', () => {
            newKeywordRecognitionRule();
        });
    }
    
    // 保存规则按钮
    const saveBtn = document.getElementById('save-keyword-recognition-rule');
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            await saveKeywordRecognitionRule();
        });
    }
    
    // 取消编辑按钮
    const cancelBtn = document.getElementById('cancel-keyword-recognition-edit');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            cancelKeywordRecognitionEdit();
        });
    }
    
    // 查看关键字统计按钮
    const viewStatsBtn = document.getElementById('view-keyword-stats-from-manager-btn');
    if (viewStatsBtn) {
        viewStatsBtn.addEventListener('click', async () => {
            const { showKeywordStatsModal } = await import('./usage/usageDisplay.js');
            await showKeywordStatsModal(null, null, null); // 显示全部关键字统计
        });
    }
    
    // 功能函数模板按钮（切换开关）
    const templateBtn = document.getElementById('keyword-recognition-function-template-btn');
    const templatePanel = document.getElementById('keyword-recognition-function-template-panel');
    if (templateBtn && templatePanel) {
        templateBtn.addEventListener('click', () => {
            const isVisible = templatePanel.style.display !== 'none' && templatePanel.style.display !== '';
            if (isVisible) {
                // 当前是开启状态，点击后关闭
                templatePanel.style.display = 'none';
                templateBtn.classList.remove('btn-active');
            } else {
                // 当前是关闭状态，点击后开启
                showKeywordRecognitionFunctionTemplate();
            }
        });
    }
    
    // 关闭模板面板按钮
    const closeTemplateBtn = document.getElementById('close-keyword-recognition-function-template');
    if (closeTemplateBtn && templatePanel && templateBtn) {
        closeTemplateBtn.addEventListener('click', () => {
            templatePanel.style.display = 'none';
            templateBtn.classList.remove('btn-active');
        });
    }
    
    // 代码编辑器按钮（切换开关）
    const codeEditorBtn = document.getElementById('keyword-recognition-function-code-editor-btn');
    const codeEditorPanel = document.getElementById('keyword-recognition-function-code-editor-panel');
    if (codeEditorBtn && codeEditorPanel) {
        codeEditorBtn.addEventListener('click', async () => {
            const isVisible = codeEditorPanel.style.display !== 'none' && codeEditorPanel.style.display !== '';
            if (isVisible) {
                // 当前是开启状态，点击后关闭
                codeEditorPanel.style.display = 'none';
                codeEditorBtn.classList.remove('btn-active');
            } else {
                // 当前是关闭状态，点击后开启
                codeEditorPanel.style.display = 'block';
                codeEditorBtn.classList.add('btn-active');
                // 如果代码编辑器打开时，加载已保存的代码
                await loadSavedCodeToInput();
            }
        });
    }
    
    // 关闭代码编辑器按钮
    const closeCodeEditorBtn = document.getElementById('close-keyword-recognition-function-code-editor');
    if (closeCodeEditorBtn && codeEditorPanel && codeEditorBtn) {
        closeCodeEditorBtn.addEventListener('click', () => {
            codeEditorPanel.style.display = 'none';
            codeEditorBtn.classList.remove('btn-active');
        });
    }
    
    // 复制模板按钮
    const copyTemplateBtn = document.getElementById('copy-keyword-recognition-function-template');
    if (copyTemplateBtn) {
        copyTemplateBtn.addEventListener('click', () => {
            const content = document.getElementById('keyword-recognition-function-template-content');
            if (content) {
                const text = content.textContent || content.innerText;
                navigator.clipboard.writeText(text).then(() => {
                    const originalText = copyTemplateBtn.textContent;
                    copyTemplateBtn.textContent = '✅ 已复制';
                    setTimeout(() => {
                        copyTemplateBtn.textContent = originalText;
                    }, 2000);
                }).catch(err => {
                    alert('复制失败: ' + err.message);
                });
            }
        });
    }
    
    // 保存代码按钮
    const saveCodeBtn = document.getElementById('save-keyword-recognition-function-code');
    if (saveCodeBtn) {
        saveCodeBtn.addEventListener('click', async () => {
            await saveKeywordRecognitionFunctionCode();
        });
    }
    
    // 清空代码按钮
    const clearCodeBtn = document.getElementById('clear-keyword-recognition-function-code');
    if (clearCodeBtn) {
        clearCodeBtn.addEventListener('click', () => {
            clearKeywordRecognitionFunctionCode();
        });
    }
    
    // 复制代码块按钮
    const copyCodeBlockBtn = document.getElementById('copy-keyword-recognition-code-block');
    if (copyCodeBlockBtn) {
        copyCodeBlockBtn.addEventListener('click', async () => {
            await copyKeywordRecognitionCodeBlock();
        });
    }
    
    // 刷新代码块按钮（从文件重新加载）
    const refreshCodeBlockBtn = document.getElementById('refresh-keyword-recognition-code-block');
    if (refreshCodeBlockBtn) {
        refreshCodeBlockBtn.addEventListener('click', async () => {
            await loadSavedCodeToInput();
            // 显示刷新成功的反馈
            const originalText = refreshCodeBlockBtn.textContent;
            refreshCodeBlockBtn.textContent = '✅ 已刷新';
            setTimeout(() => {
                refreshCodeBlockBtn.textContent = originalText;
            }, 1500);
        });
    }
    
    // 导出规则按钮
    const exportRuleBtn = document.getElementById('export-keyword-recognition-rule');
    if (exportRuleBtn) {
        exportRuleBtn.addEventListener('click', async () => {
            await exportKeywordRecognitionRule();
        });
    }
    
    // 导入规则按钮
    const importRuleBtn = document.getElementById('import-keyword-recognition-rule');
    if (importRuleBtn) {
        importRuleBtn.addEventListener('click', async () => {
            await importKeywordRecognitionRule();
        });
    }
}

/**
 * 绑定提示词管理事件
 */
function bindPromptManagerEvents() {
    // 打开提示词面板
    const btnPrompt = document.getElementById('btn-prompt');
    if (btnPrompt) {
        btnPrompt.onclick = async () => {
            const panel = document.getElementById('prompt-panel');
            if (panel) {
                panel.style.display = 'flex';
                panel.focus();
                await loadPrompts();
                renderPromptsList();
            }
        };
    }
    
    // 关闭提示词面板
    const closePromptPanel = document.getElementById('close-prompt-panel');
    if (closePromptPanel) {
        closePromptPanel.onclick = () => {
            const panel = document.getElementById('prompt-panel');
            if (panel) {
                panel.style.display = 'none';
                resetPromptForm();
            }
        };
    }
    
    // 保存提示词
    const savePromptBtn = document.getElementById('save-prompt');
    if (savePromptBtn) {
        savePromptBtn.onclick = async () => {
            await savePromptHandler();
        };
    }
    
    // 新建提示词
    const newPromptBtn = document.getElementById('new-prompt-btn');
    if (newPromptBtn) {
        newPromptBtn.onclick = newPrompt;
    }
    
    // 取消编辑
    const cancelEditBtn = document.getElementById('cancel-edit');
    if (cancelEditBtn) {
        cancelEditBtn.onclick = cancelEdit;
    }
    
    // 搜索提示词
    const promptSearch = document.getElementById('prompt-search');
    if (promptSearch) {
        promptSearch.addEventListener('input', function() {
            renderPromptsList(this.value);
        });
    }
    
    // 为提示词输入框添加历史记录（防抖）
    let promptHistoryTimeout = null;
    const promptNameInput = document.getElementById('prompt-name');
    const promptContentInput = document.getElementById('prompt-content');
    if (promptNameInput || promptContentInput) {
        const recordPromptHistory = () => {
            if (promptHistoryTimeout) clearTimeout(promptHistoryTimeout);
            promptHistoryTimeout = setTimeout(() => {
                if (promptNameInput && promptContentInput) {
                    addToManagerHistory('prompt', {
                        name: promptNameInput.value,
                        content: promptContentInput.value
                    });
                }
            }, 1000); // 1秒防抖
        };
        if (promptNameInput) promptNameInput.addEventListener('input', recordPromptHistory);
        if (promptContentInput) promptContentInput.addEventListener('input', recordPromptHistory);
    }
    
    // 清空提示词按钮
    const clearPromptBtn = document.getElementById('clear-prompt-btn');
    if (clearPromptBtn) {
        clearPromptBtn.onclick = clearPrompt;
    }
    
    // 清空提示词（全局函数）
    if (typeof window !== 'undefined') {
        window.clearPrompt = clearPrompt;
    }
}

/**
 * 绑定主题管理事件
 */
function bindThemeManagerEvents() {
    // 关闭主题面板
    const closeThemePanel = document.getElementById('close-theme-panel');
    if (closeThemePanel) {
        closeThemePanel.onclick = () => {
            const panel = document.getElementById('theme-panel');
            if (panel) {
                panel.style.display = 'none';
                resetThemeForm();
            }
        };
    }
    
    // 新建主题
    const newThemeBtn = document.getElementById('new-theme-btn');
    if (newThemeBtn) {
        newThemeBtn.onclick = newTheme;
    }
    
    // 保存主题
    const saveThemeBtn = document.getElementById('save-theme');
    if (saveThemeBtn) {
        saveThemeBtn.onclick = saveThemeHandler;
    }
    
    // 取消编辑
    const cancelThemeEdit = document.getElementById('cancel-theme-edit');
    if (cancelThemeEdit) {
        cancelThemeEdit.onclick = resetThemeForm;
    }
    
    // 搜索主题
    const themeSearch = document.getElementById('theme-search');
    if (themeSearch) {
        themeSearch.addEventListener('input', function() {
            renderThemesList(this.value);
        });
    }
    
    // 为主题输入框添加历史记录（防抖）
    let themeHistoryTimeout = null;
    const themeNameInput = document.getElementById('theme-name');
    const themeContentInput = document.getElementById('theme-content');
    if (themeNameInput || themeContentInput) {
        const recordThemeHistory = () => {
            if (themeHistoryTimeout) clearTimeout(themeHistoryTimeout);
            themeHistoryTimeout = setTimeout(() => {
                if (themeNameInput && themeContentInput) {
                    addToManagerHistory('theme', {
                        name: themeNameInput.value,
                        css: themeContentInput.value
                    });
                }
            }, 1000); // 1秒防抖
        };
        if (themeNameInput) themeNameInput.addEventListener('input', recordThemeHistory);
        if (themeContentInput) themeContentInput.addEventListener('input', recordThemeHistory);
    }
    
    // 主题相关按钮
    const toggleThemeModeBtn = document.getElementById('toggle-theme-mode-btn');
    if (toggleThemeModeBtn) {
        toggleThemeModeBtn.onclick = toggleThemeMode;
    }
    // 顶部导航栏中的日间/夜间主题切换按钮（提示词左侧）
    const headerThemeToggleBtn = document.getElementById('toggle-theme-mode-btn-header');
    if (headerThemeToggleBtn) {
        headerThemeToggleBtn.onclick = toggleThemeMode;
    }
    
    const themeImportBtn = document.getElementById('theme-import-btn');
    if (themeImportBtn) {
        themeImportBtn.onclick = importTheme;
    }
    
    const themeExportBtn = document.getElementById('theme-export-btn');
    if (themeExportBtn) {
        themeExportBtn.onclick = exportTheme;
    }
    
    const themePreviewBtn = document.getElementById('theme-preview-btn');
    if (themePreviewBtn) {
        themePreviewBtn.onclick = previewTheme;
    }
    
    const themeFormatBtn = document.getElementById('theme-format-btn');
    if (themeFormatBtn) {
        themeFormatBtn.onclick = formatThemeCSS;
    }
    
    const themeTemplateBtn = document.getElementById('theme-template-btn');
    if (themeTemplateBtn) {
        themeTemplateBtn.onclick = showThemeTemplate;
    }
    
    // 关闭主题模板面板
    const closeThemeTemplate = document.getElementById('close-theme-template');
    if (closeThemeTemplate) {
        closeThemeTemplate.onclick = () => {
            const panel = document.getElementById('theme-template-panel');
            if (panel) {
                panel.style.display = 'none';
            }
        };
    }
    
    // 复制主题模板
    const copyThemeTemplate = document.getElementById('copy-theme-template');
    if (copyThemeTemplate) {
        copyThemeTemplate.onclick = async () => {
            const content = document.getElementById('theme-template-content');
            if (content) {
                try {
                    await navigator.clipboard.writeText(content.textContent);
                    const btn = document.getElementById('copy-theme-template');
                    if (btn) {
                        const originalText = btn.textContent;
                        btn.textContent = '✅ 已复制';
                        setTimeout(() => {
                            btn.textContent = originalText;
                        }, 1500);
                    }
                } catch (err) {
                    alert('复制失败: ' + err.message);
                }
            }
        };
    }
    
    // 清空主题按钮
    const clearThemeBtn = document.getElementById('clear-theme-btn');
    if (clearThemeBtn) {
        clearThemeBtn.onclick = clearTheme;
    }
    
    // 清空主题（全局函数）
    if (typeof window !== 'undefined') {
        window.clearTheme = clearTheme;
    }
}

/**
 * 绑定布局管理事件
 */
function bindLayoutManagerEvents() {
    // 打开布局面板
    const btnLayout = document.getElementById('btn-layout');
    if (btnLayout) {
        btnLayout.onclick = async () => {
            const panel = document.getElementById('layout-panel');
            if (panel) {
                panel.style.display = 'flex';
                panel.focus();
                await loadLayouts();
                renderLayoutsList();
                setTimeout(() => {
                    updateLayoutPreview();
                }, 10);
            }
        };
    }
    
    // 关闭布局面板
    const closeLayoutPanel = document.getElementById('close-layout-panel');
    if (closeLayoutPanel) {
        closeLayoutPanel.onclick = () => {
            const panel = document.getElementById('layout-panel');
            if (panel) {
                panel.style.display = 'none';
                resetLayoutForm();
            }
        };
    }
    
    // 新建布局
    const newLayoutBtn = document.getElementById('new-layout-btn');
    if (newLayoutBtn) {
        newLayoutBtn.onclick = newLayout;
    }
    
    // 保存布局
    const saveLayoutBtn = document.getElementById('save-layout');
    if (saveLayoutBtn) {
        saveLayoutBtn.onclick = saveLayoutHandler;
    }
    
    // 取消编辑
    const cancelLayoutEdit = document.getElementById('cancel-layout-edit');
    if (cancelLayoutEdit) {
        cancelLayoutEdit.onclick = resetLayoutForm;
    }
    
    // 搜索布局
    const layoutSearch = document.getElementById('layout-search');
    if (layoutSearch) {
        layoutSearch.addEventListener('input', function() {
            renderLayoutsList(this.value);
        });
    }
    
    // 布局列数变化
    const layoutColumns = document.getElementById('layout-columns');
    if (layoutColumns) {
        layoutColumns.addEventListener('input', updateLayoutPreview);
        layoutColumns.addEventListener('change', updateLayoutPreview);
    }
    
    // 为布局输入框添加历史记录（防抖）
    let layoutHistoryTimeout = null;
    const layoutNameInput = document.getElementById('layout-name');
    const layoutColumnsInput = document.getElementById('layout-columns');
    const layoutFullscreenEnabledInput = document.getElementById('layout-fullscreen-enabled');
    const layoutFullscreenCloseOnEscapeInput = document.getElementById('layout-fullscreen-close-on-escape');
    if (layoutNameInput || layoutColumnsInput) {
        const recordLayoutHistory = () => {
            if (layoutHistoryTimeout) clearTimeout(layoutHistoryTimeout);
            layoutHistoryTimeout = setTimeout(() => {
                if (layoutNameInput && layoutColumnsInput) {
                    addToManagerHistory('layout', {
                        name: layoutNameInput.value,
                        columns: layoutColumnsInput.value,
                        fullscreenEnabled: layoutFullscreenEnabledInput ? layoutFullscreenEnabledInput.checked : true,
                        fullscreenCloseOnEscape: layoutFullscreenCloseOnEscapeInput ? layoutFullscreenCloseOnEscapeInput.checked : true
                    });
                }
            }, 1000); // 1秒防抖
        };
        if (layoutNameInput) layoutNameInput.addEventListener('input', recordLayoutHistory);
        if (layoutColumnsInput) layoutColumnsInput.addEventListener('input', recordLayoutHistory);
        if (layoutFullscreenEnabledInput) layoutFullscreenEnabledInput.addEventListener('change', recordLayoutHistory);
        if (layoutFullscreenCloseOnEscapeInput) layoutFullscreenCloseOnEscapeInput.addEventListener('change', recordLayoutHistory);
    }
    
    // 布局历史
    const layoutHistoryBtn = document.getElementById('layout-history-btn');
    if (layoutHistoryBtn) {
        layoutHistoryBtn.onclick = showLayoutHistory;
    }
    
    // 关闭布局历史面板
    const closeLayoutHistory = document.getElementById('close-layout-history');
    if (closeLayoutHistory) {
        closeLayoutHistory.onclick = () => {
            const panel = document.getElementById('layout-history-panel');
            if (panel) {
                panel.style.display = 'none';
            }
        };
    }
    
    // 导入/导出布局
    const layoutImportBtn = document.getElementById('layout-import-btn');
    if (layoutImportBtn) {
        layoutImportBtn.onclick = importLayout;
    }
    
    const layoutExportBtn = document.getElementById('layout-export-btn');
    if (layoutExportBtn) {
        layoutExportBtn.onclick = exportLayout;
    }
    
    // 清空布局按钮
    const clearLayoutBtn = document.getElementById('clear-layout-btn');
    if (clearLayoutBtn) {
        clearLayoutBtn.onclick = clearLayout;
    }
    
    // 清空布局（全局函数）
    if (typeof window !== 'undefined') {
        window.clearLayout = clearLayout;
    }
}

/**
 * 绑定模态框事件
 */
function bindModalEvents() {
    // 全屏模态点击外部关闭
    const fullscreenModal = document.getElementById('fullscreen-modal');
    if (fullscreenModal) {
        fullscreenModal.onclick = (e) => {
            if (e.target.id === 'fullscreen-modal' && window.closeFullscreen) {
                window.closeFullscreen();
            }
        };
    }
}

/**
 * 绑定回收站事件
 */
function bindTrashEvents() {
    // 回收站恢复功能
    if (typeof window !== 'undefined') {
        window.handleTrashRestore = async function(itemPath) {
            try {
                await restoreItem(itemPath);
                // 刷新回收站和目录
                loadTrashContent();
                await loadDir(state.currentDir);
            } catch (error) {
                console.error('恢复失败:', error);
                alert('恢复失败: ' + error.message);
            }
        };
        
        // 回收站永久删除功能
        window.handleTrashPermanentDelete = async function(itemPath) {
            try {
                const { permanentDelete } = await import('../core/api.js');
                await permanentDelete(itemPath);
                // 刷新回收站
                loadTrashContent();
            } catch (error) {
                console.error('永久删除失败:', error);
                alert('永久删除失败: ' + error.message);
            }
        };
        
        // 一键恢复所有回收站项目
        window.handleTrashRestoreAll = async function() {
            // 再次检查是否为本地访问
            if (!window.isLocalAccess) {
                alert('此操作仅允许本地访问');
                return;
            }
            
            const trashData = await getTrash();
            if (!trashData.items || trashData.items.length === 0) {
                alert('回收站已经是空的');
                return;
            }
            
            const count = trashData.items.length;
            if (!confirm(`确定要恢复回收站中的所有 ${count} 个项目吗？`)) {
                return;
            }
            
            try {
                const response = await fetch('/api/restore-all', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'same-origin'
                });
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || '恢复失败');
                }
                
                const result = await response.json();
                alert(`已恢复 ${result.count} 个项目`);
                // 刷新回收站和目录
                loadTrashContent();
                if (window.loadDir && state.currentDir) {
                    await window.loadDir(state.currentDir);
                }
            } catch (error) {
                console.error('一键恢复失败:', error);
                alert('一键恢复失败: ' + error.message);
            }
        };
        
        // 一键永久删除所有回收站项目
        window.handleTrashPermanentDeleteAll = async function() {
            // 再次检查是否为本地访问
            if (!window.isLocalAccess) {
                alert('此操作仅允许本地访问');
                return;
            }
            
            const trashData = await getTrash();
            if (!trashData.items || trashData.items.length === 0) {
                alert('回收站已经是空的');
                return;
            }
            
            const count = trashData.items.length;
            if (!confirm(`确定要永久删除回收站中的所有 ${count} 个项目吗？\n此操作无法撤销！`)) {
                return;
            }
            
            try {
                const response = await fetch('/api/permanent-delete-all', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'same-origin'
                });
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || '删除失败');
                }
                
                const result = await response.json();
                alert(`已永久删除 ${result.count} 个项目`);
                // 刷新回收站
                loadTrashContent();
            } catch (error) {
                console.error('一键永久删除失败:', error);
                alert('一键永久删除失败: ' + error.message);
            }
        };
        
        // 暴露回收站加载函数
        window.loadTrashContent = loadTrashContent;
    }
    
    // 绑定一键恢复按钮
    const restoreAllBtn = document.getElementById('restore-all-btn');
    if (restoreAllBtn) {
        restoreAllBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (window.handleTrashRestoreAll) {
                window.handleTrashRestoreAll();
            }
        });
    }
    
    // 绑定一键永久删除按钮
    const permanentDeleteAllBtn = document.getElementById('permanent-delete-all-btn');
    if (permanentDeleteAllBtn) {
        permanentDeleteAllBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (window.handleTrashPermanentDeleteAll) {
                window.handleTrashPermanentDeleteAll();
            }
        });
    }
}

/**
 * 绑定工作流管理事件
 */
function bindWorkflowManagerEvents() {
    // 打开工作流面板
    const btnWorkflow = document.getElementById('btn-workflow');
    if (btnWorkflow) {
        btnWorkflow.onclick = async () => {
            const panel = document.getElementById('workflow-panel');
            if (panel) {
                panel.style.display = 'flex';
                panel.focus();
                await loadWorkflows();
                renderWorkflowsList();
                setTimeout(() => {
                    if (window.initWorkflowVisualizer) {
                        window.initWorkflowVisualizer();
                    }
                }, 100);
            }
        };
    }
    
    // 关闭工作流面板
    const closeWorkflowPanel = document.getElementById('close-workflow-panel');
    if (closeWorkflowPanel) {
        closeWorkflowPanel.onclick = () => {
            const panel = document.getElementById('workflow-panel');
            if (panel) {
                panel.style.display = 'none';
            }
        };
    }
    
    // 搜索工作流
    const workflowSearch = document.getElementById('workflow-search');
    if (workflowSearch) {
        workflowSearch.addEventListener('input', function() {
            renderWorkflowsList(this.value);
        });
    }
    
    // 新建工作流
    const newWorkflowBtn = document.getElementById('new-workflow-btn');
    if (newWorkflowBtn) {
        newWorkflowBtn.onclick = () => {
            document.getElementById('workflow-name').value = '';
            document.getElementById('workflow-content').value = '';
            const descriptionInput = document.getElementById('workflow-description');
            if (descriptionInput) {
                descriptionInput.value = '';
            }
            // 重置图形，initWorkflowVisualizer会自动创建默认节点
            if (window.initWorkflowVisualizer) {
                window.initWorkflowVisualizer();
            }
        };
    }
    
    // 保存工作流
    const saveWorkflowBtn = document.getElementById('save-workflow');
    if (saveWorkflowBtn) {
        saveWorkflowBtn.onclick = async () => {
            const nameInput = document.getElementById('workflow-name');
            const contentInput = document.getElementById('workflow-content');
            const descriptionInput = document.getElementById('workflow-description');
            const name = nameInput ? nameInput.value.trim() : '';
            const content = contentInput ? contentInput.value.trim() : '';
            const description = descriptionInput ? descriptionInput.value.trim() : '';
            if (!name || !content) {
                alert('请填写工作流名称和内容');
                return;
            }
            
            // 保存前记录当前状态到历史
            addToManagerHistory('workflow', {
                name: nameInput ? nameInput.value : '',
                content: contentInput ? contentInput.value : '',
                description: descriptionInput ? descriptionInput.value : ''
            });
            
            try {
                await saveWorkflow(name, content, description);
                await loadWorkflows();
                renderWorkflowsList();
                alert('工作流保存成功');
            } catch (err) {
                alert('保存失败: ' + err.message);
            }
        };
    }
    
    // 工作流内容变化时更新可视化
    const workflowContent = document.getElementById('workflow-content');
    if (workflowContent) {
        workflowContent.addEventListener('input', function() {
            if (this.value && window.renderWorkflowFromContent) {
                window.renderWorkflowFromContent(this.value);
            }
        });
    }
    
    // 为工作流输入框添加历史记录（防抖）
    let workflowHistoryTimeout = null;
    const workflowNameInput = document.getElementById('workflow-name');
    const workflowContentInput = document.getElementById('workflow-content');
    if (workflowNameInput || workflowContentInput) {
        const recordWorkflowHistory = () => {
            if (workflowHistoryTimeout) clearTimeout(workflowHistoryTimeout);
            workflowHistoryTimeout = setTimeout(() => {
                if (workflowNameInput && workflowContentInput) {
                    addToManagerHistory('workflow', {
                        name: workflowNameInput.value,
                        content: workflowContentInput.value
                    });
                }
            }, 1000); // 1秒防抖
        };
        if (workflowNameInput) workflowNameInput.addEventListener('input', recordWorkflowHistory);
        if (workflowContentInput) workflowContentInput.addEventListener('input', recordWorkflowHistory);
    }
    
    // 全局函数
    if (typeof window !== 'undefined') {
        window.selectWorkflow = async (name) => {
            try {
                const workflow = await getWorkflow(name);
                document.getElementById('workflow-name').value = workflow.name;
                document.getElementById('workflow-content').value = workflow.content;
                const descriptionInput = document.getElementById('workflow-description');
                if (descriptionInput) {
                    descriptionInput.value = workflow.description || '';
                }
                if (window.renderWorkflowFromContent) {
                    window.renderWorkflowFromContent(workflow.content);
                }
            } catch (err) {
                alert('加载工作流失败: ' + err.message);
            }
        };
        
        window.previewWorkflow = async (name) => {
            try {
                const workflow = await getWorkflow(name);
                // 预览：只加载到可视化，不加载到编辑表单
                if (window.renderWorkflowFromContent) {
                    window.renderWorkflowFromContent(workflow.content);
                }
                // 打开工作流面板
                const panel = document.getElementById('workflow-panel');
                if (panel) {
                    panel.style.display = 'flex';
                    panel.focus();
                }
            } catch (err) {
                alert('预览工作流失败: ' + err.message);
            }
        };
        
        window.editWorkflow = async (name) => {
            await window.selectWorkflow(name);
        };
        
        window.removeWorkflow = async (name) => {
            if (!confirm(`确定要删除工作流 "${name}" 吗？`)) return;
            try {
                await deleteWorkflow(name);
                await loadWorkflows();
                renderWorkflowsList();
            } catch (err) {
                alert('删除失败: ' + err.message);
            }
        };
    }
}

/**
 * 更新事件提示词选择器（从state.prompts同步）
 * 当提示词管理面板中的提示词发生变化时调用此函数
 */
function updateEventPromptSelectors() {
    const promptSelect = document.getElementById('event-prompt-select');
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
        }
    }
}

/**
 * 绑定事件管理事件
 */
function bindEventManagerEvents() {
    // 打开事件面板
    const btnEvent = document.getElementById('btn-event');
    if (btnEvent) {
        btnEvent.onclick = async () => {
            const panel = document.getElementById('event-panel');
            if (panel) {
                panel.style.display = 'flex';
                panel.focus();
                await loadEvents();
                renderEventsList();
                await loadWorkflows();
                // 填充工作流选择器
                const workflowSelect = document.getElementById('event-workflow-select');
                if (workflowSelect) {
                    workflowSelect.innerHTML = '<option value="">请选择工作流</option>';
                    state.workflows.forEach(workflow => {
                        const option = document.createElement('option');
                        option.value = workflow.name;
                        option.textContent = workflow.name;
                        workflowSelect.appendChild(option);
                    });
                }
                // 填充视图选择器
                const viewSelect = document.getElementById('event-view-select');
                if (viewSelect) {
                    viewSelect.innerHTML = '<option value="">请选择视图</option>';
                    state.views.forEach(view => {
                        const option = document.createElement('option');
                        option.value = view.id;
                        option.textContent = view.id;
                        viewSelect.appendChild(option);
                    });
                }
                
                // 加载提示词并填充提示词选择器
                await loadPrompts();
                // 确保提示词选择器被正确初始化
                const promptSelect = document.getElementById('event-prompt-select');
                if (promptSelect) {
                    updateEventPromptSelectors();
                }
                
                // 初始化状态显示
                // 关键修复：只有在工作流执行状态存在时才触发状态更新
                if (window.updateWorkflowExecutionStatus && state.workflowExecutionState) {
                    window.updateWorkflowExecutionStatus();
                }
                
                // 启动定时器定期更新状态显示
                if (window.eventStatusUpdateInterval) {
                    clearInterval(window.eventStatusUpdateInterval);
                }
                window.eventStatusUpdateInterval = setInterval(() => {
                    // 关键修复：只有在工作流执行状态存在时才触发状态更新
                    if (window.updateWorkflowExecutionStatus && state.workflowExecutionState) {
                        window.updateWorkflowExecutionStatus();
                    }
                }, 500); // 每500ms更新一次
            }
        };
    }
    
    // 关闭事件面板
    const closeEventPanel = document.getElementById('close-event-panel');
    if (closeEventPanel) {
        closeEventPanel.onclick = () => {
            const panel = document.getElementById('event-panel');
            if (panel) {
                panel.style.display = 'none';
                // 清除定时器
                if (window.eventStatusUpdateInterval) {
                    clearInterval(window.eventStatusUpdateInterval);
                    window.eventStatusUpdateInterval = null;
                }
            }
        };
    }
    
    // 搜索事件
    const eventSearch = document.getElementById('event-search');
    if (eventSearch) {
        eventSearch.addEventListener('input', function() {
            renderEventsList(this.value);
        });
    }
    
    // 为事件输入框添加历史记录（防抖）
    let eventHistoryTimeout = null;
    const eventNameInput = document.getElementById('event-name');
    const eventWorkflowSelect = document.getElementById('event-workflow-select');
    const eventViewSelect = document.getElementById('event-view-select');
    const eventPromptSelect = document.getElementById('event-prompt-select');
    const eventProjectPathInput = document.getElementById('event-project-path');
    if (eventNameInput || eventWorkflowSelect || eventViewSelect || eventPromptSelect || eventProjectPathInput) {
        const recordEventHistory = () => {
            if (eventHistoryTimeout) clearTimeout(eventHistoryTimeout);
            eventHistoryTimeout = setTimeout(() => {
                addToManagerHistory('event', {
                    name: eventNameInput ? eventNameInput.value : '',
                    workflowName: eventWorkflowSelect ? eventWorkflowSelect.value : '',
                    viewId: eventViewSelect ? eventViewSelect.value : '',
                    promptId: eventPromptSelect ? eventPromptSelect.value : '',
                    projectPath: eventProjectPathInput ? eventProjectPathInput.value : ''
                });
            }, 1000); // 1秒防抖
        };
        if (eventNameInput) eventNameInput.addEventListener('input', recordEventHistory);
        if (eventWorkflowSelect) eventWorkflowSelect.addEventListener('change', recordEventHistory);
        if (eventViewSelect) eventViewSelect.addEventListener('change', recordEventHistory);
        if (eventPromptSelect) eventPromptSelect.addEventListener('change', recordEventHistory);
        if (eventProjectPathInput) eventProjectPathInput.addEventListener('input', recordEventHistory);
        
    }
    
    // 新建事件
    const newEventBtn = document.getElementById('new-event-btn');
    if (newEventBtn) {
        newEventBtn.onclick = () => {
            document.getElementById('event-name').value = '';
            document.getElementById('event-workflow-select').value = '';
            document.getElementById('event-view-select').value = '';
            document.getElementById('event-prompt-select').value = '';
            document.getElementById('event-project-path').value = '';
        };
    }
    
    // 保存事件
    const saveEventBtn = document.getElementById('save-event');
    if (saveEventBtn) {
        saveEventBtn.onclick = async () => {
            const nameInput = document.getElementById('event-name');
            const workflowSelect = document.getElementById('event-workflow-select');
            const viewSelect = document.getElementById('event-view-select');
            const promptSelect = document.getElementById('event-prompt-select');
            const projectPathInput = document.getElementById('event-project-path');
            const name = nameInput ? nameInput.value.trim() : '';
            const workflowName = workflowSelect ? workflowSelect.value : '';
            const viewId = viewSelect ? viewSelect.value : '';
            const promptId = promptSelect ? promptSelect.value : '';
            const projectPath = projectPathInput ? projectPathInput.value.trim() : '';
            
            if (!name || !workflowName) {
                alert('请填写事件名称并选择工作流');
                return;
            }
            
            // 保存前记录当前状态到历史
            addToManagerHistory('event', {
                name: nameInput ? nameInput.value : '',
                workflowName: workflowName,
                viewId: viewId,
                promptId: promptId || '',
                projectPath: projectPath
            });
            
            try {
                await saveEvent(name, workflowName, viewId || null, projectPath || null, promptId || null);
                await loadEvents();
                renderEventsList();
                
                // 保存成功后，重新加载当前事件以确保表单显示最新数据
                if (name) {
                    await window.selectEvent(name);
                }
                
                alert('事件保存成功');
            } catch (err) {
                alert('保存失败: ' + err.message);
            }
        };
    }
    
    // 执行事件
    const executeEventBtn = document.getElementById('execute-event-btn');
    if (executeEventBtn) {
        executeEventBtn.onclick = async () => {
            const name = document.getElementById('event-name').value.trim();
            if (!name) {
                alert('请先选择或创建事件');
                return;
            }
            
            // 询问执行模式
            const executionMode = confirm('是否使用并发执行模式？\n\n点击"确定"使用并发执行（更快，但可能消耗更多资源）\n点击"取消"使用顺序执行（较慢，但更稳定）');
            const concurrency = executionMode ? 3 : 1;
            const sequential = !executionMode;
            
            try {
                executeEventBtn.disabled = true;
                executeEventBtn.textContent = '执行中...';
                
                const result = await executeEvent(name, {
                    concurrency: concurrency,
                    sequential: sequential
                });

                if (result && result.summary) {
                    /**
                     * 深度统计工作流的步骤数，包括工作流节点内部的步骤
                     * @param {Array} steps - 工作流步骤数组
                     * @returns {Object} 统计结果 {totalSteps: 总步骤数, workflowNodeCount: 工作流节点数量, workflowNodes: 工作流节点数组}
                     */
                    const countStepsDeeply = (steps) => {
                        let totalSteps = 0;
                        let workflowNodeCount = 0;
                        const workflowNodes = [];
                        
                        if (!steps || !Array.isArray(steps)) {
                            return { totalSteps: 0, workflowNodeCount: 0, workflowNodes: [] };
                        }
                        
                        steps.forEach(step => {
                            // 检查是否是工作流节点
                            if (step.isWorkflowNode && step.workflowNodeInternalSteps) {
                                workflowNodeCount++;
                                const internalSteps = step.workflowNodeInternalSteps || [];
                                const workflowNodeName = step.workflowNodeName || step.step || step.viewId || '未知工作流节点';
                                
                                // 递归统计内部步骤（包括嵌套的工作流节点）
                                const internalStats = countStepsDeeply(internalSteps);
                                
                                workflowNodes.push({
                                    name: workflowNodeName,
                                    stepCount: internalStats.totalSteps // 工作流节点内部的总步骤数（包括嵌套）
                                });
                                
                                // 工作流节点本身算作1个步骤，加上其内部的所有步骤
                                totalSteps += 1 + internalStats.totalSteps;
                            } else {
                                // 普通步骤
                                totalSteps += 1;
                            }
                        });
                        
                        return { totalSteps, workflowNodeCount, workflowNodes };
                    };
                    
                    // 统计所有执行过的工作流
                    const workflowStats = new Map();
                    if (result.results && result.results.length > 0) {
                        result.results.forEach(fileResult => {
                            if (fileResult.workflowResult && fileResult.workflowResult.steps) {
                                const workflowName = fileResult.summary?.workflow || '未知工作流';
                                if (!workflowStats.has(workflowName)) {
                                    workflowStats.set(workflowName, {
                                        name: workflowName,
                                        directStepCount: 0, // 直接步骤数（不包括工作流节点内部）
                                        totalStepCount: 0,  // 总步骤数（包括工作流节点内部）
                                        workflowNodeCount: 0, // 工作流节点数量
                                        workflowNodes: [], // 工作流节点列表
                                        fileCount: 0
                                    });
                                }
                                const stats = workflowStats.get(workflowName);
                                
                                // 关键修复：使用fileResult.summary.steps，因为它包含isWorkflowNode属性（来自mappedSteps）
                                // fileResult.workflowResult.steps是executedSteps，也包含isWorkflowNode属性，但使用summary.steps更可靠
                                const stepsToCount = fileResult.summary?.steps || fileResult.workflowResult?.steps || [];
                                const deepStats = countStepsDeeply(stepsToCount);
                                
                                // 总步骤数（包括工作流节点内部的步骤，递归统计）
                                stats.totalStepCount += deepStats.totalSteps;
                                // 工作流节点数量
                                stats.workflowNodeCount += deepStats.workflowNodeCount;
                                // 工作流节点列表（合并）
                                stats.workflowNodes.push(...deepStats.workflowNodes);
                                stats.fileCount += 1;
                            }
                        });
                    }
                    
                    // 关键修复：弹窗只显示事件执行完毕
                    alert(`事件：${name}执行完毕`);
                } else {
                    // 检查是否有后续工作流
                    if (state.workflowExecutionState && state.workflowExecutionState._pendingContinueWorkflow) {
                        console.log('工作流执行完毕，准备执行下一个工作流');
                    } else {
                        alert('工作流执行结束');
                    }
                }
            } catch (err) {
                if (err.message !== '工作流执行已终止') {
                    alert('执行失败: ' + err.message);
                }
            } finally {
                executeEventBtn.disabled = false;
                executeEventBtn.textContent = '执行';
            }
        };
    }
    
    // 暂停工作流
    const pauseWorkflowBtn = document.getElementById('pause-workflow-btn');
    if (pauseWorkflowBtn) {
        pauseWorkflowBtn.onclick = () => {
            if (window.pauseWorkflow) {
                window.pauseWorkflow();
            }
        };
    }
    
    // 继续工作流
    const resumeWorkflowBtn = document.getElementById('resume-workflow-btn');
    if (resumeWorkflowBtn) {
        resumeWorkflowBtn.onclick = async () => {
            if (window.resumeWorkflow) {
                try {
                    resumeWorkflowBtn.disabled = true;
                    resumeWorkflowBtn.textContent = '继续中...';
                    await window.resumeWorkflow();
                } catch (err) {
                    alert('继续执行失败: ' + err.message);
                } finally {
                    resumeWorkflowBtn.disabled = false;
                    resumeWorkflowBtn.textContent = '继续';
                }
            }
        };
    }
    
    // 终止工作流
    const cancelWorkflowBtn = document.getElementById('cancel-workflow-btn');
    if (cancelWorkflowBtn) {
        cancelWorkflowBtn.onclick = () => {
            if (confirm('确定要终止当前工作流执行吗？')) {
                if (window.cancelWorkflow) {
                    window.cancelWorkflow();
                }
            }
        };
    }
    
    // 全屏显示工作流日志
    const fullscreenWorkflowLogBtn = document.getElementById('fullscreen-workflow-log-btn');
    if (fullscreenWorkflowLogBtn) {
        fullscreenWorkflowLogBtn.onclick = () => {
            const modal = document.getElementById('workflow-log-fullscreen-modal');
            const contentEl = document.getElementById('workflow-log-fullscreen-content');
            if (!modal || !contentEl) return;
            
            // 显示模态框
            modal.style.display = 'flex';
            
            // 调用 updateWorkflowExecutionStatus 来更新内容（它会自动检测全屏日志是否打开并更新）
            // 关键修复：只有在工作流执行状态存在时才触发状态更新
            if (window.updateWorkflowExecutionStatus && state.workflowExecutionState) {
                window.updateWorkflowExecutionStatus();
            } else {
                // 如果 updateWorkflowExecutionStatus 不可用，显示基本状态
                const execState = state.workflowExecutionState;
                if (!execState) {
                    contentEl.textContent = '无执行状态';
                    return;
                }
                contentEl.textContent = '正在加载...';
            }
        };
    }
    
    // 关闭工作流日志全屏模态
    const closeWorkflowLogFullscreenBtn = document.getElementById('close-workflow-log-fullscreen-btn');
    if (closeWorkflowLogFullscreenBtn) {
        closeWorkflowLogFullscreenBtn.onclick = () => {
            const modal = document.getElementById('workflow-log-fullscreen-modal');
            if (modal) {
                modal.style.display = 'none';
            }
        };
    }
    
    // 复制全屏日志
    const copyFullscreenLogBtn = document.getElementById('copy-fullscreen-log-btn');
    if (copyFullscreenLogBtn) {
        copyFullscreenLogBtn.onclick = async () => {
            const contentEl = document.getElementById('workflow-log-fullscreen-content');
            if (contentEl) {
                const logText = contentEl.textContent || contentEl.innerText;
                if (logText && logText.trim() !== '加载中...' && logText.trim() !== '无执行状态') {
                    try {
                        await navigator.clipboard.writeText(logText);
                        const originalText = copyFullscreenLogBtn.textContent;
                        copyFullscreenLogBtn.textContent = '已复制';
                        setTimeout(() => {
                            copyFullscreenLogBtn.textContent = originalText;
                        }, 1500);
                    } catch (err) {
                        alert('复制失败: ' + err.message);
                    }
                } else {
                    alert('当前没有可复制的日志内容');
                }
            }
        };
    }
    
    // 导出工作流日志
    const exportWorkflowLogBtn = document.getElementById('export-workflow-log-btn');
    if (exportWorkflowLogBtn) {
        exportWorkflowLogBtn.onclick = async () => {
            const { exportLog } = await import('./workflowExecutionLogger.js');
            const success = await exportLog();
            if (success) {
                exportWorkflowLogBtn.textContent = '已复制';
                setTimeout(() => {
                    exportWorkflowLogBtn.textContent = '导出';
                }, 1500);
            }
        };
    }
    
    // 清空工作流日志
    const clearWorkflowLogBtn = document.getElementById('clear-workflow-log-btn');
    if (clearWorkflowLogBtn) {
        clearWorkflowLogBtn.onclick = async () => {
            if (confirm('确定要清空所有日志吗？')) {
                const { clearLog, renderEnhancedLog } = await import('./workflowExecutionLogger.js');
                clearLog();
                renderEnhancedLog();
            }
        };
    }
    
    // 复制工作流日志
    const copyWorkflowLogBtn = document.getElementById('copy-workflow-log-btn');
    if (copyWorkflowLogBtn) {
        copyWorkflowLogBtn.onclick = async () => {
            const statusEl = document.getElementById('workflow-execution-status');
            if (statusEl) {
                // 关键修复：只复制日志内容，排除按钮文本
                // 如果是增强日志显示，从隐藏的文本区域读取；否则从内容容器读取
                let logText = '';
                if (statusEl.dataset.enhanced === 'true') {
                    const hiddenTextArea = statusEl.querySelector('#workflow-execution-status-text-hidden');
                    if (hiddenTextArea) {
                        logText = hiddenTextArea.value || '';
                    } else {
                        const contentContainer = statusEl.querySelector('#workflow-execution-status-content-enhanced');
                        if (contentContainer) {
                            // 只获取日志内容，排除按钮
                            logText = contentContainer.textContent || contentContainer.innerText || '';
                        }
                    }
                } else {
                    // 普通模式：只获取文本内容，排除按钮
                    const contentEl = statusEl.querySelector('#workflow-execution-status-content');
                    if (contentEl) {
                        logText = contentEl.textContent || contentEl.innerText || '';
                    } else {
                        // 如果没有内容容器，直接获取文本，但需要排除按钮文本
                        const clone = statusEl.cloneNode(true);
                        // 移除所有按钮
                        clone.querySelectorAll('button').forEach(btn => btn.remove());
                        logText = clone.textContent || clone.innerText || '';
                    }
                }
                
                if (logText && logText.trim() !== '无执行状态' && logText.trim() !== '') {
                    try {
                        await navigator.clipboard.writeText(logText);
                        const originalText = copyWorkflowLogBtn.textContent;
                        copyWorkflowLogBtn.textContent = '已复制';
                        setTimeout(() => {
                            copyWorkflowLogBtn.textContent = originalText;
                        }, 1500);
                    } catch (err) {
                        alert('复制失败: ' + err.message);
                    }
                } else {
                    alert('当前没有可复制的日志内容');
                }
            }
        };
    }
    
    // 查看事件历史记录
    const viewEventHistoryBtn = document.getElementById('view-event-history-btn');
    if (viewEventHistoryBtn) {
        viewEventHistoryBtn.onclick = async () => {
            const contentEl = document.getElementById('workflow-log-fullscreen-content');
            if (!contentEl) return;
            
            // 获取当前事件名称
            const eventNameInput = document.getElementById('event-name');
            const eventName = eventNameInput ? eventNameInput.value.trim() : '';
            
            if (!eventName) {
                alert('请先选择或创建事件');
                return;
            }
            
            if (!state.originalPath) {
                alert('请先选择文件');
                return;
            }
            
            try {
                contentEl.textContent = '正在加载事件历史记录...';
                
                // 获取文件名文件夹路径
                const { getFileFolderPath } = await import('../utils/fileUtils.js');
                const { getDirectory, getFile } = await import('../core/api.js');
                const fileFolderPath = getFileFolderPath(state.originalPath);
                
                // 获取文件名文件夹内容
                const folderData = await getDirectory(fileFolderPath);
                
                // 查找所有该事件的执行记录
                // 1. 查找合并文件（事件名:文件名格式）
                const mergedFiles = folderData.files.filter(file => {
                    return file.name.startsWith(`${eventName}:`);
                });
                
                // 2. 查找所有步骤文件（时间戳_文件名_视图名格式）
                // 解析原文件名
                const lastSeparatorIndex = Math.max(state.originalPath.lastIndexOf('\\'), state.originalPath.lastIndexOf('/'));
                const fileName = lastSeparatorIndex >= 0 ? state.originalPath.substring(lastSeparatorIndex + 1) : state.originalPath;
                const lastDotIndex = fileName.lastIndexOf('.');
                const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
                const ext = lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1) : '';
                
                // 查找所有匹配的步骤文件（时间戳_文件名_视图名.扩展名）
                const stepFiles = folderData.files.filter(file => {
                    // 匹配格式：时间戳_文件名_视图名.扩展名
                    const pattern = new RegExp(`^\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}_${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(.+)\\.${ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
                    return pattern.test(file.name);
                });
                
                // 构建历史记录显示
                let historyText = `事件历史记录: ${eventName}\n`;
                historyText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
                // 显示合并文件
                if (mergedFiles.length > 0) {
                    historyText += `合并文件 (${mergedFiles.length} 个):\n`;
                    for (const file of mergedFiles) {
                        historyText += `  - ${file.name}\n`;
                        try {
                            const content = await getFile(file.path);
                            const lines = content.split('\n');
                            const preview = lines.slice(0, 10).join('\n');
                            historyText += `    预览: ${preview.substring(0, 200)}${preview.length > 200 ? '...' : ''}\n\n`;
                        } catch (err) {
                            historyText += `    (无法读取文件内容)\n\n`;
                        }
                    }
                } else {
                    historyText += `合并文件: 无\n\n`;
                }
                
                // 按时间戳分组步骤文件
                const stepFilesByTimestamp = new Map();
                stepFiles.forEach(file => {
                    // 提取时间戳（文件名前19个字符：YYYY-MM-DD_HH-MM-SS）
                    const timestampMatch = file.name.match(/^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})_/);
                    if (timestampMatch) {
                        const timestamp = timestampMatch[1];
                        if (!stepFilesByTimestamp.has(timestamp)) {
                            stepFilesByTimestamp.set(timestamp, []);
                        }
                        stepFilesByTimestamp.get(timestamp).push(file);
                    }
                });
                
                // 显示步骤文件（按时间戳排序）
                if (stepFilesByTimestamp.size > 0) {
                    historyText += `步骤文件 (${stepFiles.length} 个，${stepFilesByTimestamp.size} 次执行):\n\n`;
                    const sortedTimestamps = Array.from(stepFilesByTimestamp.keys()).sort().reverse(); // 最新的在前
                    
                    for (let index = 0; index < sortedTimestamps.length; index++) {
                        const timestamp = sortedTimestamps[index];
                        const files = stepFilesByTimestamp.get(timestamp);
                        historyText += `执行 ${index + 1} - 时间戳: ${timestamp.replace(/_/g, ' ')}\n`;
                        historyText += `  步骤文件 (${files.length} 个):\n`;
                        
                        for (const file of files) {
                            // 提取视图名（文件名中时间戳和基础名之后的部分）
                            const viewIdMatch = file.name.match(new RegExp(`^${timestamp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(.+)\\.${ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
                            const viewId = viewIdMatch ? viewIdMatch[1] : '未知';
                            
                            historyText += `    - ${viewId}: ${file.name}\n`;
                            try {
                                const content = await getFile(file.path);
                                // 提取所有步骤内容（如果文件包含多个步骤）
                                const stepMatches = content.match(/={60}\n步骤 (\d+)/g);
                                const stepCount = stepMatches ? stepMatches.length : 1;
                                historyText += `      包含 ${stepCount} 个步骤，内容长度: ${content.length} 字符\n`;
                            } catch (err) {
                                historyText += `      (无法读取文件内容)\n`;
                            }
                        }
                        historyText += `\n`;
                    }
                } else {
                    historyText += `步骤文件: 无\n\n`;
                }
                
                contentEl.textContent = historyText;
            } catch (err) {
                console.error('加载事件历史记录失败:', err);
                contentEl.textContent = `加载事件历史记录失败: ${err.message}`;
            }
        };
    }
    
    // 点击全屏模态外部关闭
    const workflowLogFullscreenModal = document.getElementById('workflow-log-fullscreen-modal');
    if (workflowLogFullscreenModal) {
        workflowLogFullscreenModal.addEventListener('click', function(e) {
            if (e.target.id === 'workflow-log-fullscreen-modal') {
                workflowLogFullscreenModal.style.display = 'none';
            }
        });
    }
    
    // 测试工作流
    const testWorkflowBtn = document.getElementById('test-workflow-btn');
    if (testWorkflowBtn) {
        testWorkflowBtn.onclick = async () => {
            // 获取当前选择的工作流（从事件选择器获取，如果没有则从工作流选择器获取）
            const eventWorkflowSelect = document.getElementById('event-workflow-select');
            const workflowName = eventWorkflowSelect ? eventWorkflowSelect.value : '';
            
            if (!workflowName) {
                alert('请先选择一个工作流（在事件管理中选择事件或直接选择工作流）');
                return;
            }
            
            try {
                testWorkflowBtn.disabled = true;
                testWorkflowBtn.textContent = '测试中...';
                
                // 导入测试函数
                const { executeWorkflowTest } = await import('./workflowManager.js');
                
                // 执行测试
                await executeWorkflowTest(workflowName, {});
                
                alert('工作流测试完成！\n\n注意：这是测试模式，未实际调用AI，也未创建文件。');
            } catch (err) {
                if (err.message !== '工作流执行已终止') {
                    alert('测试失败: ' + err.message);
                    console.error('工作流测试失败:', err);
                }
            } finally {
                testWorkflowBtn.disabled = false;
                testWorkflowBtn.textContent = '测试';
            }
        };
    }
    
    // 选择项目文件
    const selectProjectFileBtn = document.getElementById('select-project-file-btn');
    if (selectProjectFileBtn) {
        selectProjectFileBtn.onclick = () => {
            // 这里应该打开文件选择器，使用项目内的文件选择器
            // 暂时使用简单的提示
            const path = prompt('请输入项目文件路径:');
            if (path) {
                document.getElementById('event-project-path').value = path;
            }
        };
    }
    
    // 全局函数
    if (typeof window !== 'undefined') {
        window.selectEvent = async (name) => {
            try {
                const event = await getEvent(name);
                document.getElementById('event-name').value = event.name;
                document.getElementById('event-workflow-select').value = event.workflowName || '';
                document.getElementById('event-view-select').value = event.viewId || '';
                const projectPath = event.projectPath || '';
                document.getElementById('event-project-path').value = projectPath;
                
                // 确保提示词已加载，然后更新选择器并设置值
                if (!state.prompts || state.prompts.length === 0) {
                    await loadPrompts();
                }
                
                // 先更新选择器（填充选项）
                const promptSelect = document.getElementById('event-prompt-select');
                if (promptSelect) {
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
                    
                    // 设置从服务器加载的值
                    const savedPromptId = event.promptId || '';
                    promptSelect.value = savedPromptId;
                }
                
                // 更新选中索引
                const eventIndex = state.eventItems.findIndex(item => item.name === name);
                if (eventIndex >= 0) {
                    // 移除所有选中状态
                    state.eventItems.forEach(item => {
                        item.el.classList.remove('selected');
                    });
                    // 添加选中状态
                    state.selectedEventIndex = eventIndex;
                    state.eventItems[eventIndex].el.classList.add('selected');
                    state.eventItems[eventIndex].el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            } catch (err) {
                alert('加载事件失败: ' + err.message);
            }
        };
        
        window.editEvent = async (name) => {
            await window.selectEvent(name);
        };
        
        window.removeEvent = async (name) => {
            if (!confirm(`确定要删除事件 "${name}" 吗？`)) return;
            try {
                await deleteEvent(name);
                await loadEvents();
                renderEventsList();
            } catch (err) {
                alert('删除失败: ' + err.message);
            }
        };
        
        // 暴露updateEventPromptSelectors到全局，供其他模块调用
        window.updateEventPromptSelectors = updateEventPromptSelectors;
    }
}

/**
 * 绑定批量执行管理事件
 */
function bindBatchExecutorEvents() {
    // 打开批量执行面板
    const btnBatch = document.getElementById('btn-batch');
    if (btnBatch) {
        btnBatch.onclick = async () => {
            const panel = document.getElementById('batch-panel');
            if (panel) {
                panel.style.display = 'flex';
                panel.focus();
                // 加载事件列表
                await loadEventsForBatch();
                
                // 总是使用主界面当前目录初始化批量执行面板
                const initialPath = state.currentDir || '.';
                // 加载目录到左侧目录栏（会同步到输入框）
                await loadBatchDir(initialPath);
            }
        };
    }

    // 关闭批量执行面板
    const closeBatchPanel = document.getElementById('close-batch-panel');
    if (closeBatchPanel) {
        closeBatchPanel.onclick = () => {
            const panel = document.getElementById('batch-panel');
            if (panel) {
                panel.style.display = 'none';
                // 清理面板状态
                import('./batchExecutor.js').then(module => {
                    if (module.clearBatchState) {
                        module.clearBatchState();
                    }
                });
            }
        };
    }

    // 反馈系统按钮
    const btnFeedback = document.getElementById('btn-feedback');
    if (btnFeedback) {
        btnFeedback.onclick = () => {
            if (window.openFeedbackPanel) {
                window.openFeedbackPanel();
            } else {
                alert('反馈系统管理面板未初始化，请刷新页面后重试');
            }
        };
    }
    
    // 执行批量处理
    const batchExecuteBtn = document.getElementById('batch-execute-btn');
    if (batchExecuteBtn) {
        batchExecuteBtn.onclick = executeBatch;
    }
    
    // 批量执行目录管理（双向联动）
    const batchDirectoryPathInput = document.getElementById('batch-directory-path');
    const batchBtnUp = document.getElementById('batch-btn-up');
    
    if (batchDirectoryPathInput && batchBtnUp) {
        // 返回上一级目录
        batchBtnUp.onclick = async () => {
            const currentPath = batchDirectoryPathInput.value.trim() || state.currentDir || '.';
            const pathParts = currentPath.replace(/\\/g, '/').split('/').filter(p => p);
            if (pathParts.length > 1) {
                pathParts.pop();
                const parentPath = pathParts.join('/') || '/';
                await loadBatchDir(parentPath);
            } else if (pathParts.length === 1) {
                // 如果只有一个路径段，返回根目录
                await loadBatchDir('/');
            }
        };
        
        // 输入框变化时，同步到目录栏
        let inputDebounceTimer = null;
        batchDirectoryPathInput.addEventListener('input', async (e) => {
            const dirPath = e.target.value.trim();
            
            // 清除之前的定时器
            if (inputDebounceTimer) {
                clearTimeout(inputDebounceTimer);
            }
            
            // 设置新的定时器，500ms后加载目录
            inputDebounceTimer = setTimeout(async () => {
                if (dirPath) {
                    try {
                        await loadBatchDir(dirPath);
                    } catch (error) {
                        console.error('加载目录失败:', error);
                    }
                }
            }, 500);
        });
        
        // 输入框失去焦点时立即加载（如果路径改变了）
        batchDirectoryPathInput.addEventListener('blur', async (e) => {
            if (inputDebounceTimer) {
                clearTimeout(inputDebounceTimer);
                inputDebounceTimer = null;
            }
            const dirPath = e.target.value.trim();
            if (dirPath) {
                try {
                    await loadBatchDir(dirPath);
                } catch (error) {
                    console.error('加载目录失败:', error);
                }
            }
        });
    }
    
    // 移除旧的浏览目录和清除按钮代码（这些元素已从HTML中移除）
    if (false) {
        selectBatchDirectoryBtn.onclick = () => {
            // 触发文件选择器（目录模式）
            batchDirectoryPicker.click();
        };
        
        batchDirectoryPicker.addEventListener('change', (e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
                // 获取第一个文件的路径，然后提取目录路径
                const firstFile = files[0];
                let directoryPath = '';
                
                // 尝试获取文件路径
                if (firstFile.path) {
                    // Electron环境或某些浏览器支持path属性，直接使用
                    const path = firstFile.path;
                    const lastSeparatorIndex = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
                    directoryPath = lastSeparatorIndex >= 0 ? path.substring(0, lastSeparatorIndex) : path;
                    
                    // 直接设置路径，不需要弹窗
                    if (directoryPath) {
                        batchDirectoryPathInput.value = directoryPath;
                        // 显示清除按钮
                        if (clearBatchDirectoryBtn) {
                            clearBatchDirectoryBtn.style.display = 'inline-block';
                        }
                    }
                } else {
                    // Web环境，webkitdirectory只能获取相对路径
                    // 使用自定义模态框让用户确认或修改路径
                    const relativePath = firstFile.webkitRelativePath || firstFile.name;
                    const pathParts = relativePath.split(/[/\\]/);
                    let relativeDir = '';
                    let infoText = '';
                    
                    if (pathParts.length > 1) {
                        pathParts.pop(); // 移除文件名
                        relativeDir = pathParts.join('/');
                        infoText = `已选择目录中的文件：${firstFile.name}\n相对路径：${relativeDir}`;
                    } else {
                        infoText = `已选择文件：${firstFile.name}`;
                    }
                    
                    // 显示自定义模态框
                    const modal = document.getElementById('batch-directory-modal');
                    const modalInfo = document.getElementById('batch-directory-modal-info');
                    const modalInput = document.getElementById('batch-directory-modal-input');
                    const modalConfirm = document.getElementById('batch-directory-modal-confirm');
                    const modalCancel = document.getElementById('batch-directory-modal-cancel');
                    const modalClose = document.getElementById('close-batch-directory-modal');
                    
                    if (modal && modalInfo && modalInput && modalConfirm && modalCancel && modalClose) {
                        // 设置信息文本
                        modalInfo.textContent = infoText;
                        // 设置默认路径为当前目录
                        modalInput.value = state.currentDir || '';
                        // 显示模态框
                        modal.style.display = 'block';
                        
                        // 获取文件数量显示元素
                        const modalFileCount = document.getElementById('batch-directory-modal-file-count');
                        
                        // 防抖函数，用于延迟检查文件数量
                        let debounceTimer = null;
                        const checkFileCount = async (dirPath) => {
                            if (!dirPath || dirPath.trim() === '') {
                                if (modalFileCount) {
                                    modalFileCount.style.display = 'none';
                                }
                                return;
                            }
                            
                            // 显示加载状态
                            if (modalFileCount) {
                                modalFileCount.style.display = 'block';
                                modalFileCount.textContent = '正在检查文件...';
                                modalFileCount.style.color = 'var(--text-secondary)';
                            }
                            
                            try {
                                // 导入 getAllFilesInDirectory 函数
                                const { getAllFilesInDirectory } = await import('../utils/fileUtils.js');
                                const files = await getAllFilesInDirectory(dirPath.trim());
                                
                                // 显示文件数量
                                if (modalFileCount) {
                                    modalFileCount.style.display = 'block';
                                    modalFileCount.textContent = `当前目录将会处理 ${files.length} 个 .md 文件`;
                                    modalFileCount.style.color = 'var(--accent-blue)';
                                }
                            } catch (error) {
                                console.error('检查文件数量失败:', error);
                                if (modalFileCount) {
                                    modalFileCount.style.display = 'block';
                                    modalFileCount.textContent = '无法检查文件数量：' + error.message;
                                    modalFileCount.style.color = 'var(--accent-red, #ff4444)';
                                }
                            }
                        };
                        
                        // 监听输入框变化，使用防抖
                        modalInput.oninput = (e) => {
                            const dirPath = e.target.value.trim();
                            
                            // 清除之前的定时器
                            if (debounceTimer) {
                                clearTimeout(debounceTimer);
                            }
                            
                            // 设置新的定时器，500ms后检查
                            debounceTimer = setTimeout(() => {
                                checkFileCount(dirPath);
                            }, 500);
                        };
                        
                        // 初始检查（如果默认路径不为空）
                        if (modalInput.value.trim()) {
                            checkFileCount(modalInput.value.trim());
                        }
                        
                        // 确认按钮事件
                        const handleConfirm = () => {
                            const fullPath = modalInput.value.trim();
                            if (fullPath) {
                                batchDirectoryPathInput.value = fullPath;
                                // 显示清除按钮
                                if (clearBatchDirectoryBtn) {
                                    clearBatchDirectoryBtn.style.display = 'inline-block';
                                }
                            }
                            modal.style.display = 'none';
                            // 清除防抖定时器
                            if (debounceTimer) {
                                clearTimeout(debounceTimer);
                            }
                        };
                        
                        // 取消/关闭按钮事件
                        const handleCancel = () => {
                            modal.style.display = 'none';
                            // 清除防抖定时器
                            if (debounceTimer) {
                                clearTimeout(debounceTimer);
                            }
                        };
                        
                        // 绑定事件（先移除旧的事件监听器，避免重复绑定）
                        modalConfirm.onclick = handleConfirm;
                        modalCancel.onclick = handleCancel;
                        modalClose.onclick = handleCancel;
                        
                        // 支持回车键确认
                        modalInput.onkeydown = (keyEvent) => {
                            if (keyEvent.key === 'Enter') {
                                handleConfirm();
                            } else if (keyEvent.key === 'Escape') {
                                handleCancel();
                            }
                        };
                        
                        // 聚焦到输入框
                        setTimeout(() => {
                            modalInput.focus();
                            modalInput.select();
                        }, 100);
                    }
                }
            }
            // 重置文件选择器，以便可以再次选择相同的目录
            e.target.value = '';
        });
    }
    
    // 清空批量执行日志
    const clearBatchLogBtn = document.getElementById('clear-batch-log-btn');
    if (clearBatchLogBtn) {
        clearBatchLogBtn.onclick = () => {
            if (window.clearBatchLog) {
                window.clearBatchLog();
            }
        };
    }
    
    // 查看批量执行详细日志
    const viewBatchDetailLogsBtn = document.getElementById('view-batch-detail-logs-btn');
    if (viewBatchDetailLogsBtn) {
        viewBatchDetailLogsBtn.onclick = () => {
            if (window.showBatchExecutionDetailLogs) {
                window.showBatchExecutionDetailLogs();
            }
        };
    }
    
    // 关闭批量执行详细日志模态框
    const closeBatchExecutionDetailModal = document.getElementById('close-batch-execution-detail-modal');
    if (closeBatchExecutionDetailModal) {
        closeBatchExecutionDetailModal.onclick = () => {
            const modal = document.getElementById('batch-execution-detail-modal');
            if (modal) {
                modal.style.display = 'none';
            }
        };
    }
}

// 暴露全局函数供其他模块使用
if (typeof window !== 'undefined') {
    window.loadDir = loadDir;
    window.selectFile = selectFile;
    window.selectFolder = selectFolder;
    window.enterDirectory = enterDirectory;
    window.moveSelection = moveSelection;
    window.initEventBindings = initEventBindings;
}

/**
 * 绑定悬浮操作按钮和面板事件
 */
function bindFloatingActionsEvents() {
    // 延迟执行，确保DOM完全加载
    setTimeout(() => {
        const fabBtn = document.getElementById('floating-action-btn');
        const floatingPanel = document.getElementById('floating-actions-panel');
        const closeBtn = document.getElementById('floating-panel-close');
        const dragHandle = document.getElementById('floating-panel-drag-handle');
        
        if (!fabBtn || !floatingPanel || !dragHandle) {
            console.error('悬浮窗元素未找到', { fabBtn, floatingPanel, dragHandle });
            return;
        }
        
        // 设置移动端默认位置：右上角（移动端始终固定在右上角，不允许拖拽）
        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
            // 移动端强制固定在右上角，清除保存的位置
            fabBtn.style.position = 'fixed';
            fabBtn.style.left = 'auto';
            fabBtn.style.top = '20px';
            fabBtn.style.right = '20px';
            fabBtn.style.bottom = 'auto';
            // 清除移动端保存的位置，确保始终使用默认位置
            localStorage.removeItem('floatingBtnPosition');
        } else {
            // 网页端恢复保存的位置
            try {
                const savedPosition = localStorage.getItem('floatingBtnPosition');
                if (savedPosition) {
                    const pos = JSON.parse(savedPosition);
                    if (pos.x !== undefined && pos.y !== undefined) {
                        fabBtn.style.position = 'fixed';
                        fabBtn.style.left = pos.x + 'px';
                        fabBtn.style.top = pos.y + 'px';
                        fabBtn.style.right = 'auto';
                        fabBtn.style.bottom = 'auto';
                    }
                }
            } catch (e) {
                console.warn('恢复按钮位置失败', e);
            }
        }
        
        // 点击悬浮按钮显示/隐藏面板（但不在拖动时）
        let clickStartPos = { x: 0, y: 0 };
        let hasMoved = false;
        
        fabBtn.addEventListener('mousedown', function(e) {
            clickStartPos.x = e.clientX;
            clickStartPos.y = e.clientY;
            hasMoved = false;
        });
        
        fabBtn.addEventListener('click', (e) => {
            // 如果移动距离超过5px，认为是拖动，不触发点击
            const moveDistance = Math.sqrt(
                Math.pow(e.clientX - clickStartPos.x, 2) + 
                Math.pow(e.clientY - clickStartPos.y, 2)
            );
            
            if (moveDistance > 5 || hasMoved) {
                e.stopPropagation();
                e.preventDefault();
                return; // 拖动时不触发点击
            }
            
            e.stopPropagation();
            e.preventDefault();
            const isVisible = floatingPanel.classList.contains('show');
            if (isVisible) {
                floatingPanel.classList.remove('show');
            } else {
                floatingPanel.classList.add('show');
                // 显示面板时，设置面板位置在按钮右下角
                // 先显示面板以获取实际尺寸
                setTimeout(() => {
                    const btnRect = fabBtn.getBoundingClientRect();
                    // 移动端默认位置：右上角
                    const isMobile = window.innerWidth <= 768;
                    const btnSize = isMobile ? 24 : 48;
                    const defaultX = isMobile ? (window.innerWidth - btnSize - 20) : (window.innerWidth - btnSize - 20);
                    const defaultY = isMobile ? 20 : (window.innerHeight - btnSize - 20);
                    const btnX = parseFloat(fabBtn.style.left) || btnRect.left || defaultX;
                    const btnY = parseFloat(fabBtn.style.top) || btnRect.top || defaultY;
                    const btnWidth = btnRect.width || btnSize;
                    const btnHeight = btnRect.height || btnSize;
                    
                    const panelRect = floatingPanel.getBoundingClientRect();
                    const panelWidth = panelRect.width || 200;
                    const panelHeight = panelRect.height || 400;
                    const panelOffsetX = 20; // 面板在按钮右侧，间距20px
                    const panelOffsetY = 0; // 面板顶部与按钮顶部对齐
                    
                    // 计算面板位置（右下角：右侧对齐，底部对齐）
                    let panelX = btnX + btnWidth + panelOffsetX;
                    
                    // 检测按钮是否在屏幕底部
                    const distanceToBottom = window.innerHeight - (btnY + btnHeight);
                    const isNearBottom = distanceToBottom < 100; // 距离底部小于100px认为在底部
                    
                    let panelY;
                    if (isNearBottom) {
                        // 按钮在屏幕底部，面板显示在按钮上方10px
                        panelY = btnY - panelHeight - 10;
                    } else {
                        // 按钮不在底部，面板显示在按钮右下角（底部对齐）
                        panelY = btnY + btnHeight - panelHeight;
                        
                        // 检测面板是否会与按钮重叠
                        if (panelY < btnY) {
                            // 面板显示在按钮下方，避免重叠
                            panelY = btnY + btnHeight + 10;
                        }
                    }
                    
                    // 检测面板是否会超出屏幕
                    const margin = 10;
                    
                    // 如果面板在按钮上方，检查是否会超出屏幕顶部
                    if (isNearBottom && panelY < margin) {
                        // 如果上方空间不足，调整到按钮下方
                        panelY = btnY + btnHeight + 10;
                    }
                    
                    // 如果面板超出右边界，调整到左侧
                    if (panelX + panelWidth > window.innerWidth - margin) {
                        panelX = btnX - panelWidth - panelOffsetX; // 显示在左侧
                    }
                    
                    // 如果面板超出上边界，调整位置
                    if (panelY < margin) {
                        panelY = margin;
                    }
                    
                    // 如果面板超出下边界，调整位置
                    if (panelY + panelHeight > window.innerHeight - margin) {
                        panelY = window.innerHeight - panelHeight - margin;
                    }
                    
                    // 如果面板超出左边界，调整位置
                    if (panelX < margin) {
                        panelX = margin;
                    }
                    
                    floatingPanel.style.position = 'fixed';
                    floatingPanel.style.left = panelX + 'px';
                    floatingPanel.style.top = panelY + 'px';
                    floatingPanel.style.right = 'auto';
                    floatingPanel.style.bottom = 'auto';
                }, 10);
            }
        });
        
        // 点击关闭按钮隐藏面板
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                floatingPanel.classList.remove('show');
            });
        }
        
        // 点击面板外部关闭面板
        document.addEventListener('click', (e) => {
            if (floatingPanel.classList.contains('show')) {
                if (!floatingPanel.contains(e.target) && !fabBtn.contains(e.target)) {
                    floatingPanel.classList.remove('show');
                }
            }
        });
        
        // ========== 拖动悬浮按钮功能 ==========
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let initialBtnX = 0;
        let initialBtnY = 0;
        const panelOffsetX = -20; // 面板在按钮左侧，间距20px（宽度自适应）
        const panelOffsetY = 0; // 面板与按钮顶部对齐
        
        // 悬浮按钮鼠标按下事件
        fabBtn.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return; // 只处理左键
            
            // 移动端禁用拖拽，始终固定在右上角
            const isMobile = window.innerWidth <= 768;
            if (isMobile) {
                // 移动端不启动拖拽，只允许点击
                return;
            }
            
            e.preventDefault();
            e.stopPropagation();
            
            isDragging = true;
            
            // 获取按钮当前位置
            const btnRect = fabBtn.getBoundingClientRect();
            const btnComputedStyle = window.getComputedStyle(fabBtn);
            
            // 计算按钮的初始位置（从 bottom/right 转换为 left/top）
            if (btnComputedStyle.right !== 'auto' && btnComputedStyle.left === 'auto') {
                initialBtnX = window.innerWidth - parseFloat(btnComputedStyle.right) - btnRect.width;
            } else {
                initialBtnX = btnRect.left;
            }
            
            if (btnComputedStyle.bottom !== 'auto' && btnComputedStyle.top === 'auto') {
                initialBtnY = window.innerHeight - parseFloat(btnComputedStyle.bottom) - btnRect.height;
            } else {
                initialBtnY = btnRect.top;
            }
            
            
            startX = e.clientX;
            startY = e.clientY;
            
            // 设置按钮初始位置（确保使用 fixed 定位）
            fabBtn.style.position = 'fixed';
            fabBtn.style.left = initialBtnX + 'px';
            fabBtn.style.top = initialBtnY + 'px';
            fabBtn.style.right = 'auto';
            fabBtn.style.bottom = 'auto';
            fabBtn.style.transition = 'none';
            fabBtn.style.cursor = 'grabbing';
            fabBtn.style.zIndex = '10001';
            
            // 如果面板显示，设置面板位置（在按钮右下角）
            if (floatingPanel.classList.contains('show')) {
                // 获取按钮和面板的实际尺寸
                const btnRect = fabBtn.getBoundingClientRect();
                const btnWidth = btnRect.width || 48;
                const btnHeight = btnRect.height || 48;
                const panelRect = floatingPanel.getBoundingClientRect();
                const panelWidth = panelRect.width || 200;
                const panelHeight = panelRect.height || 400;
                let panelX = initialBtnX + btnWidth + panelOffsetX;
                
                // 检测按钮是否在屏幕底部
                const distanceToBottom = window.innerHeight - (initialBtnY + btnHeight);
                const isNearBottom = distanceToBottom < 100; // 距离底部小于100px认为在底部
                
                let panelY;
                if (isNearBottom) {
                    // 按钮在屏幕底部，面板显示在按钮上方10px
                    panelY = initialBtnY - panelHeight - 10;
                } else {
                    // 按钮不在底部，面板显示在按钮右下角（底部对齐）
                    panelY = initialBtnY + btnHeight - panelHeight;
                    
                    // 检测面板是否会与按钮重叠
                    if (panelY < initialBtnY) {
                        // 面板显示在按钮下方，避免重叠
                        panelY = initialBtnY + btnHeight + 10;
                    }
                }
                
                // 检测面板是否会超出屏幕
                const margin = 10;
                
                // 如果面板超出右边界，调整到左侧
                if (panelX + panelWidth > window.innerWidth - margin) {
                    const leftPanelX = initialBtnX - panelWidth - panelOffsetX;
                    if (leftPanelX >= margin) {
                        panelX = leftPanelX;
                    } else {
                        panelX = window.innerWidth - panelWidth - margin;
                    }
                }
                
                // 如果面板超出上边界，调整位置
                if (panelY < margin) {
                    panelY = margin;
                }
                
                // 如果面板超出下边界，调整位置
                if (panelY + panelHeight > window.innerHeight - margin) {
                    panelY = window.innerHeight - panelHeight - margin;
                }
                
                floatingPanel.style.position = 'fixed';
                floatingPanel.style.left = panelX + 'px';
                floatingPanel.style.top = panelY + 'px';
                floatingPanel.style.right = 'auto';
                floatingPanel.style.bottom = 'auto';
                floatingPanel.style.transition = 'none';
            }
            
            document.body.style.userSelect = 'none';
            
            console.log('开始拖动悬浮按钮', { initialBtnX, initialBtnY, startX, startY });
        });
        
        // 鼠标移动事件
        function onMouseMove(e) {
            if (!isDragging) return;
            
            e.preventDefault();
            e.stopPropagation();
            
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            
            // 计算按钮新位置
            let newBtnX = initialBtnX + deltaX;
            let newBtnY = initialBtnY + deltaY;
            
            // 限制按钮在视口内（留出一些边距）
            const isMobile = window.innerWidth <= 768;
            const btnWidth = isMobile ? 24 : 48; // 按钮宽度（移动端缩小一半）
            const btnHeight = isMobile ? 24 : 48; // 按钮高度（移动端缩小一半）
            const margin = 10; // 边距
            
            const maxBtnX = window.innerWidth - btnWidth - margin;
            const maxBtnY = window.innerHeight - btnHeight - margin;
            
            newBtnX = Math.max(margin, Math.min(newBtnX, maxBtnX));
            newBtnY = Math.max(margin, Math.min(newBtnY, maxBtnY));
            
            // 确保按钮始终可见
            fabBtn.style.position = 'fixed';
            fabBtn.style.right = 'auto';
            fabBtn.style.bottom = 'auto';
            fabBtn.style.zIndex = '10001';
            
            // 更新按钮位置
            fabBtn.style.left = newBtnX + 'px';
            fabBtn.style.top = newBtnY + 'px';
            
            // 如果面板显示，面板始终在按钮右下角
            if (floatingPanel.classList.contains('show')) {
                
                // 使用 requestAnimationFrame 确保按钮位置已更新后再计算面板位置
                requestAnimationFrame(() => {
                    // 获取按钮和面板的实际尺寸和位置
                    const btnRect = fabBtn.getBoundingClientRect();
                    const btnWidth = btnRect.width || 48;
                    const btnHeight = btnRect.height || 48;
                    const btnX = btnRect.left;
                    const btnY = btnRect.top;
                    
                    const panelRect = floatingPanel.getBoundingClientRect();
                    const panelWidth = panelRect.width || 200;
                    const panelHeight = panelRect.height || 400;
                    
                    // 计算面板位置（右下角对齐，确保不重叠）
                    let newPanelX = btnX + btnWidth + panelOffsetX;
                    
                    // 检测按钮是否在屏幕底部
                    const margin = 10;
                    const distanceToBottom = window.innerHeight - (btnY + btnHeight);
                    const isNearBottom = distanceToBottom < 100; // 距离底部小于100px认为在底部
                    
                    let newPanelY;
                    if (isNearBottom) {
                        // 按钮在屏幕底部，面板显示在按钮上方10px
                        newPanelY = btnY - panelHeight - 10;
                    } else {
                        // 按钮不在底部，面板显示在按钮右下角（底部对齐）
                        newPanelY = btnY + btnHeight - panelHeight;
                        
                        // 检测面板是否会与按钮重叠
                        if (newPanelY < btnY) {
                            // 面板显示在按钮下方，避免重叠
                            newPanelY = btnY + btnHeight + 10;
                        }
                    }
                    
                    // 检测面板是否会超出屏幕
                    
                    // 如果面板超出右边界，调整到左侧
                    if (newPanelX + panelWidth > window.innerWidth - margin) {
                        const leftPanelX = btnX - panelWidth - panelOffsetX;
                        if (leftPanelX >= margin) {
                            newPanelX = leftPanelX;
                        } else {
                            newPanelX = window.innerWidth - panelWidth - margin;
                        }
                    }
                    
                    // 如果面板超出左边界，调整位置
                    if (newPanelX < margin) {
                        newPanelX = margin;
                    }
                    
                    // 如果面板超出上边界，调整位置
                    if (newPanelY < margin) {
                        newPanelY = margin;
                    }
                    
                    // 如果面板超出下边界，调整位置
                    if (newPanelY + panelHeight > window.innerHeight - margin) {
                        newPanelY = window.innerHeight - panelHeight - margin;
                    }
                    
                    floatingPanel.style.position = 'fixed';
                    floatingPanel.style.left = newPanelX + 'px';
                    floatingPanel.style.top = newPanelY + 'px';
                    floatingPanel.style.right = 'auto';
                    floatingPanel.style.bottom = 'auto';
                });
            } else {
                // 如果面板不显示，直接更新按钮位置
                fabBtn.style.left = newBtnX + 'px';
                fabBtn.style.top = newBtnY + 'px';
            }
        }
        
        // 鼠标释放事件
        function onMouseUp(e) {
            if (!isDragging) return;
            
            e.preventDefault();
            e.stopPropagation();
            
            isDragging = false;
            fabBtn.style.cursor = 'pointer';
            fabBtn.style.transition = '';
            
            // 更新面板位置（如果显示）
            if (floatingPanel.classList.contains('show')) {
                const btnX = parseFloat(fabBtn.style.left);
                const btnY = parseFloat(fabBtn.style.top);
                const btnRect = fabBtn.getBoundingClientRect();
                const btnWidth = btnRect.width || 48;
                const btnHeight = btnRect.height || 48;
                const panelRect = floatingPanel.getBoundingClientRect();
                const panelWidth = panelRect.width || 200;
                const panelHeight = panelRect.height || 400;
                let panelX = btnX + btnWidth + panelOffsetX;
                
                // 检测按钮是否在屏幕底部
                const distanceToBottom = window.innerHeight - (btnY + btnHeight);
                const isNearBottom = distanceToBottom < 100; // 距离底部小于100px认为在底部
                
                let panelY;
                if (isNearBottom) {
                    // 按钮在屏幕底部，面板显示在按钮上方10px
                        panelY = btnY - panelHeight - 10;
                } else {
                    // 按钮不在底部，面板显示在按钮右下角（底部对齐）
                    panelY = btnY + btnHeight - panelHeight;
                    
                    // 检测面板是否会与按钮重叠
                    if (panelY < btnY) {
                        // 面板显示在按钮下方，避免重叠
                        panelY = btnY + btnHeight + 10;
                    }
                }
                
                // 检测面板是否会超出屏幕
                const margin = 10;
                
                // 如果面板在按钮上方，检查是否会超出屏幕顶部
                if (isNearBottom && panelY < margin) {
                    // 如果上方空间不足，调整到按钮下方
                    panelY = btnY + btnHeight + 10;
                }
                
                // 如果面板超出右边界，调整到左侧
                if (panelX + panelWidth > window.innerWidth - margin) {
                    const leftPanelX = btnX - panelWidth - panelOffsetX;
                    if (leftPanelX >= margin) {
                        panelX = leftPanelX;
                    } else {
                        panelX = window.innerWidth - panelWidth - margin;
                    }
                }
                
                // 边界检查
                if (panelX < margin) panelX = margin;
                if (panelY < margin) panelY = margin;
                if (panelY + panelHeight > window.innerHeight - margin) {
                    panelY = window.innerHeight - panelHeight - margin;
                }
                
                floatingPanel.style.transition = '';
                floatingPanel.style.position = 'fixed';
                floatingPanel.style.left = panelX + 'px';
                floatingPanel.style.top = panelY + 'px';
                floatingPanel.style.right = 'auto';
                floatingPanel.style.bottom = 'auto';
            }
            
            document.body.style.userSelect = '';
            
            // 保存位置到 localStorage（移动端不保存，始终使用默认位置）
            const isMobile = window.innerWidth <= 768;
            if (!isMobile) {
                const finalBtnX = parseFloat(fabBtn.style.left);
                const finalBtnY = parseFloat(fabBtn.style.top);
                if (!isNaN(finalBtnX) && !isNaN(finalBtnY)) {
                    localStorage.setItem('floatingBtnPosition', JSON.stringify({ x: finalBtnX, y: finalBtnY }));
                    console.log('拖动结束', { x: finalBtnX, y: finalBtnY });
                }
            }
        }
        
        // 绑定全局事件
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        
        console.log('悬浮按钮拖动功能已初始化');
    
        // 绑定悬浮窗中的按钮事件（代理到原始按钮）
        const buttonMappings = [
            { floating: 'floating-btn-prompt', original: 'btn-prompt' },
            { floating: 'floating-btn-settings', original: 'btn-settings' },
            { floating: 'floating-btn-theme', original: 'btn-theme' },
            { floating: 'floating-btn-layout', original: 'btn-layout' },
            { floating: 'floating-btn-workflow', original: 'btn-workflow' },
            { floating: 'floating-btn-event', original: 'btn-event' },
            // 悬浮窗中的“反馈系统”按钮：直接打开反馈系统管理面板
            { floating: 'floating-btn-feedback', original: null },
            { floating: 'floating-btn-copy', original: 'btn-copy' }
        ];
        
        buttonMappings.forEach(({ floating, original }) => {
            const floatingBtn = document.getElementById(floating);
            const originalBtn = original ? document.getElementById(original) : null;
            
            if (floatingBtn) {
                floatingBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (originalBtn) {
                        // 触发原始按钮的点击事件
                        originalBtn.click();
                    } else if (floating === 'floating-btn-feedback' && window.openFeedbackPanel) {
                        // 直接打开反馈系统管理面板
                        window.openFeedbackPanel();
                    }
                    // 点击后关闭面板
                    if (floatingPanel) {
                        floatingPanel.classList.remove('show');
                    }
                });
            } else {
                console.warn(`按钮映射失败: ${floating} -> ${original}`, { floatingBtn, originalBtn });
            }
        });
        
        // 监听窗口大小改变，确保移动端始终固定在右上角
        window.addEventListener('resize', () => {
            const isMobile = window.innerWidth <= 768;
            if (isMobile) {
                // 移动端强制固定在右上角
                fabBtn.style.position = 'fixed';
                fabBtn.style.left = 'auto';
                fabBtn.style.top = '20px';
                fabBtn.style.right = '20px';
                fabBtn.style.bottom = 'auto';
                // 清除保存的位置
                localStorage.removeItem('floatingBtnPosition');
            }
        });
    }, 100); // 延迟100ms确保DOM加载完成
}

