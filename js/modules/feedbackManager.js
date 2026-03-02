/**
 * 反馈系统管理模块
 * 负责反馈配置、反馈生成和反馈查看
 */

import { state } from '../core/state.js';
import { getPrompts, getPrompt, getEvents } from '../core/api.js';
import { getFile, saveFile, getDirectory } from '../core/api.js';
import { callOpenAI } from './aiService.js';
import { readCurrentView } from './editor.js';
import { getFileInFolderPath } from '../utils/fileUtils.js';
import { formatPromptContent } from '../utils/promptFormatter.js';
import { processContent, htmlToMarkdown } from '../utils/markdownConverter.js';
import { renderHtmlWithVDOM } from '../utils/simpleVirtualDom.js';

/**
 * 反馈生成状态管理
 */
let feedbackGeneratingCount = 0; // 正在生成的反馈文件数量
let feedbackCompletedCount = 0; // 已完成的反馈文件数量
let beforeunloadHandler = null; // beforeunload事件处理器

/**
 * 反馈生成队列系统（用于并发处理多个节点的反馈生成）
 */
const feedbackGenerationQueues = new Map(); // viewId -> { queue: [], isProcessing: false }
let feedbackBatchProcessorScheduled = false; // 批量处理器调度标志

// 反馈文件全屏编辑器状态
const feedbackEditorState = {
    files: [],
    currentIndex: 0,
    keydownHandler: null,
    rawContent: '' // 保存原始 markdown 内容，用于保存
};

/**
 * 清理并隐藏“反馈文件生成中”提示状态
 * 不会触发任何反馈生成逻辑，只是重置计数和 UI
 */
function clearFeedbackGeneratingState() {
    feedbackGeneratingCount = 0;
    feedbackCompletedCount = 0;

    const noticesRow = document.getElementById('feedback-notices-row');
    const feedbackNotice = document.getElementById('feedback-generating-notice');
    if (noticesRow) {
        noticesRow.style.display = 'none';
    }
    if (feedbackNotice) {
        feedbackNotice.style.display = 'none';
    }

    if (beforeunloadHandler) {
        window.removeEventListener('beforeunload', beforeunloadHandler);
        beforeunloadHandler = null;
    }
}

/**
 * 判断当前是否启用反馈生成（优先读界面上的开关，其次读配置）
 * @returns {boolean} true 表示启用反馈生成，false 表示完全关闭
 */
function isFeedbackEnabled() {
    try {
        // 1. 优先读取界面上的复选框（用户可见的真实状态）
        const uiCheckbox =
            document.getElementById('feedback-enabled-checkbox') ||
            document.getElementById('feedback-enabled-checkbox-fullscreen');
        if (uiCheckbox) {
            return !!uiCheckbox.checked;
        }
    } catch (err) {
        console.warn('[反馈系统] 读取界面开关状态失败:', err);
    }

    try {
        // 2. 其次读取本地配置（localStorage），避免内存状态不同步
        const saved = localStorage.getItem('feedbackConfig');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.enabled === false) {
                clearFeedbackGeneratingState();
                return false;
            }
            if (parsed.enabled === true) return true;
        }
    } catch (err) {
        console.warn('[反馈系统] 读取反馈配置失败:', err);
    }

    // 3. 最后退回到内存中的配置（默认开启）
    const enabled = feedbackConfig.enabled !== false;
    if (!enabled) {
        clearFeedbackGeneratingState();
    }
    return enabled;
}

/**
 * 打开反馈文件全屏编辑器
 * @param {Array} files - 当前列表中的所有反馈文件
 * @param {number} startIndex - 要打开的文件索引
 */
async function openFeedbackEditor(files, startIndex) {
    const modal = document.getElementById('feedback-editor-modal');
    const titleEl = document.getElementById('feedback-editor-title');
    const pathEl = document.getElementById('feedback-editor-path');
    const contentEl = document.getElementById('feedback-editor-content');
    const indexEl = document.getElementById('feedback-editor-index');
    const saveBtn = document.getElementById('feedback-editor-save-btn');
    const closeBtn = document.getElementById('feedback-editor-close-btn');
    
    if (!modal || !titleEl || !pathEl || !contentEl || !indexEl || !saveBtn || !closeBtn) {
        console.warn('[反馈编辑器] 必要的DOM元素缺失，无法打开编辑器');
        return;
    }
    
    if (!files || files.length === 0 || startIndex < 0 || startIndex >= files.length) {
        console.warn('[反馈编辑器] 文件列表为空或索引无效');
        return;
    }
    
    feedbackEditorState.files = files;
    feedbackEditorState.currentIndex = startIndex;
    
    // 显示模态框
    modal.style.display = 'flex';
    modal.focus();
    
    async function loadCurrentFile() {
        const file = feedbackEditorState.files[feedbackEditorState.currentIndex];
        if (!file) return;
        
        // 更新头部信息
        const formattedName = formatFileNameTimestamp(file.name);
        titleEl.textContent = formattedName;
        pathEl.textContent = file.path;
        indexEl.textContent = `${feedbackEditorState.currentIndex + 1} / ${feedbackEditorState.files.length}`;
        
        // 加载内容
        try {
            contentEl.innerHTML = '<div style="padding: 20px; color: var(--text-muted);">正在加载内容...</div>';
            const content = await getFile(file.path);
            feedbackEditorState.rawContent = content;
            
            // 将 markdown 转换为富文本 HTML，并设置为可编辑
            if (typeof marked !== 'undefined') {
                const html = processContent(marked.parse(content));
                // 反馈编辑器内容本身就是受控区域，这里直接使用虚拟DOM渲染
                renderHtmlWithVDOM(contentEl, html);
                contentEl.contentEditable = 'true'; // 启用富文本编辑
                contentEl.style.outline = 'none'; // 移除焦点时的边框
                
                // 增强表格和跳转链接
                if (window.enhanceTables) window.enhanceTables();
                if (window.attachJumpLinkListeners) window.attachJumpLinkListeners(contentEl);
            } else {
                // 如果没有 marked，使用可编辑的 pre 元素
                contentEl.innerHTML = `<pre style="white-space: pre-wrap; font-family: inherit; margin: 0;">${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
                contentEl.contentEditable = 'true';
                contentEl.style.outline = 'none';
            }
            
            // 滚动到顶部
            contentEl.scrollTop = 0;
        } catch (err) {
            console.error('[反馈编辑器] 加载文件失败:', err);
            contentEl.innerHTML = `<div style="padding: 20px; color: var(--accent-red);">加载文件失败: ${err.message || err}</div>`;
            contentEl.contentEditable = 'false';
        }
    }
    
    async function saveCurrentFile() {
        const file = feedbackEditorState.files[feedbackEditorState.currentIndex];
        if (!file) return;
        
        try {
            saveBtn.disabled = true;
            const originalText = saveBtn.textContent;
            saveBtn.textContent = '保存中...';
            
            // 将编辑后的 HTML 内容转换回 markdown
            let contentToSave = feedbackEditorState.rawContent;
            
            // 如果内容是可编辑的，将 HTML 转换为 markdown
            if (contentEl.contentEditable === 'true') {
                try {
                    // 使用 htmlToMarkdown 将 HTML 转换为 markdown
                    const editedHtml = contentEl.innerHTML;
                    contentToSave = htmlToMarkdown(editedHtml);
                } catch (err) {
                    console.error('[反馈编辑器] HTML转Markdown失败:', err);
                    // 如果转换失败，尝试使用原始内容
                    alert('转换内容失败，将使用原始内容保存');
                }
            }
            
            await saveFile(file.path, contentToSave);
            // 更新原始内容，以便下次保存时使用
            feedbackEditorState.rawContent = contentToSave;
            saveBtn.textContent = '✅ 已保存';
            setTimeout(() => {
                saveBtn.textContent = originalText;
                saveBtn.disabled = false;
            }, 1200);
        } catch (err) {
            console.error('[反馈编辑器] 保存文件失败:', err);
            alert('保存失败: ' + (err.message || err));
            saveBtn.disabled = false;
        }
    }
    
    function closeEditor() {
        modal.style.display = 'none';
        // 移除键盘事件
        if (feedbackEditorState.keydownHandler) {
            window.removeEventListener('keydown', feedbackEditorState.keydownHandler, true);
            feedbackEditorState.keydownHandler = null;
        }
    }
    
    // 绑定保存和关闭按钮（只绑定一次）
    if (!saveBtn._feedbackEditorBound) {
        saveBtn._feedbackEditorBound = true;
        saveBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await saveCurrentFile();
        });
    }
    
    if (!closeBtn._feedbackEditorBound) {
        closeBtn._feedbackEditorBound = true;
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeEditor();
        });
    }
    
    // 键盘导航：W / S 切换文件，Esc 关闭
    if (!feedbackEditorState.keydownHandler) {
        feedbackEditorState.keydownHandler = (e) => {
            const modalVisible = modal.style.display === 'flex';
            if (!modalVisible) return;
            
            const key = e.key ? e.key.toLowerCase() : '';
            const keybinds = state.keybinds || {};
            const wKey = keybinds.w ? keybinds.w.toLowerCase() : 'w';
            const sKey = keybinds.s ? keybinds.s.toLowerCase() : 's';
            const escKey = keybinds.escape || 'Escape';
            
            if (key === wKey || key === sKey || e.key === escKey || e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
            }
            
            if (key === wKey) {
                // 上一个文件
                if (feedbackEditorState.files.length > 0) {
                    feedbackEditorState.currentIndex = (feedbackEditorState.currentIndex - 1 + feedbackEditorState.files.length) % feedbackEditorState.files.length;
                    loadCurrentFile();
                }
            } else if (key === sKey) {
                // 下一个文件
                if (feedbackEditorState.files.length > 0) {
                    feedbackEditorState.currentIndex = (feedbackEditorState.currentIndex + 1) % feedbackEditorState.files.length;
                    loadCurrentFile();
                }
            } else if (e.key === escKey || e.key === 'Escape') {
                closeEditor();
            }
        };
        
        // 使用捕获阶段，优先于全局 keyboardHandler，避免主视图收到 w/s/esc
        window.addEventListener('keydown', feedbackEditorState.keydownHandler, true);
    }
    
    // 首次打开时加载当前文件
    await loadCurrentFile();
}

/**
 * 全局批量处理所有视图的反馈生成队列（真正并行处理所有视图）
 * 每个视图的反馈生成都是完全独立的，可以真正并发执行
 */
function processAllFeedbackQueues() {
    feedbackBatchProcessorScheduled = false;
    
    // 收集所有有任务且未在处理中的视图
    const viewsToProcess = [];
    feedbackGenerationQueues.forEach((queueData, viewId) => {
        if (queueData.queue.length > 0 && !queueData.isProcessing) {
            viewsToProcess.push(viewId);
        }
    });
    
    if (viewsToProcess.length === 0) {
        return;
    }
    
    // 关键修复：使用Promise.all并行处理所有视图，而不是forEach顺序处理
    // 每个视图的反馈生成完全独立，可以真正并发执行
    const processingPromises = viewsToProcess.map(viewId => {
        return Promise.resolve().then(async () => {
            const queueData = feedbackGenerationQueues.get(viewId);
            if (!queueData || queueData.queue.length === 0) return;
            
            // 标记为处理中（防止重复处理）
            queueData.isProcessing = true;
            
            // 处理该视图队列中的所有任务（并发处理）
            const tasks = [];
            while (queueData.queue.length > 0) {
                const task = queueData.queue.shift();
                tasks.push(task);
            }
            
            // 并发执行所有反馈生成任务
            const taskPromises = tasks.map(async (task) => {
                try {
                    const { generateNodeFeedback } = await import('./feedbackManager.js');
                    const result = await generateNodeFeedback(
                        task.eventName,
                        task.eventTimestamp,
                        task.filePath,
                        task.viewId,
                        task.stepContent,
                        task.sentContent
                    );
                    if (result) {
                        console.log(`[反馈队列] 节点 ${task.viewId} 反馈已生成: ${result}`);
                    }
                    return result;
                } catch (err) {
                    console.error(`[反馈队列] 生成节点反馈失败 (${task.viewId}):`, err);
                    return null;
                }
            });
            
            // 等待所有任务完成
            await Promise.all(taskPromises);
            
            // 处理完成，重置标志
            queueData.isProcessing = false;
        });
    });
    
    // 等待所有视图处理完成
    Promise.all(processingPromises).then(() => {
        // 检查是否还有任务需要处理，如果有则继续调度
        let hasMoreTasks = false;
        feedbackGenerationQueues.forEach((queueData) => {
            if (queueData.queue.length > 0) {
                hasMoreTasks = true;
            }
        });
        
        if (hasMoreTasks) {
            scheduleFeedbackBatchProcessor();
        }
    }).catch(err => {
        console.error('[反馈队列] 批量处理反馈生成队列时出错:', err);
    });
}

/**
 * 调度反馈生成批量处理器
 */
function scheduleFeedbackBatchProcessor() {
    if (feedbackBatchProcessorScheduled) {
        return; // 已经调度过了，不需要重复调度
    }
    
    feedbackBatchProcessorScheduled = true;
    
    // 使用 setTimeout(0) 立即调度，确保批量处理可以快速响应
    setTimeout(() => {
        processAllFeedbackQueues();
    }, 0);
}

/**
 * 添加反馈生成任务到队列（非阻塞，立即启动处理）
 * @param {string} eventName - 事件名称
 * @param {string} eventTimestamp - 事件时间戳
 * @param {string} filePath - 文件路径
 * @param {string} viewId - 视图ID
 * @param {string} stepContent - 步骤内容（AI的回复）
 * @param {string} sentContent - 节点发送给AI的完整内容（可选）
 */
export function enqueueFeedbackGeneration(eventName, eventTimestamp, filePath, viewId, stepContent, sentContent = '') {
    // 全局开关：关闭时直接跳过队列入栈，彻底禁用节点反馈生成
    if (!isFeedbackEnabled()) {
        console.log('[反馈系统] 全局反馈已关闭，enqueueFeedbackGeneration 跳过入队');
        return;
    }

    if (!feedbackGenerationQueues.has(viewId)) {
        feedbackGenerationQueues.set(viewId, {
            queue: [],
            isProcessing: false
        });
    }
    
    const queueData = feedbackGenerationQueues.get(viewId);
    
    // 添加任务到队列
    queueData.queue.push({
        eventName,
        eventTimestamp,
        filePath,
        viewId,
        stepContent,
        sentContent
    });
    
    // 立即调度批量处理器（如果还没有调度的话）
    scheduleFeedbackBatchProcessor();
}

/**
 * 更新反馈生成提示文本
 */
function updateFeedbackNoticeText() {
    const noticeText = document.getElementById('feedback-notice-text');
    if (noticeText) {
        const total = feedbackGeneratingCount + feedbackCompletedCount;
        const completed = feedbackCompletedCount;
        const generating = feedbackGeneratingCount;
        
        if (generating > 0) {
            noticeText.textContent = `反馈文件已生成${completed}，未生成${generating} 请不要关闭当前页面`;
        } else if (completed > 0) {
            noticeText.textContent = `反馈文件已生成${completed}，未生成0 请不要关闭当前页面`;
        } else {
            noticeText.textContent = '反馈文件生成中，请不要关闭';
        }
    }
}

/**
 * 显示反馈生成提示并屏蔽关闭功能
 */
function showFeedbackGeneratingNotice() {
    feedbackGeneratingCount++;
    
    // 显示提示容器
    const noticesRow = document.getElementById('feedback-notices-row');
    const feedbackNotice = document.getElementById('feedback-generating-notice');
    
    if (noticesRow) {
        noticesRow.style.display = 'flex';
    }
    
    if (feedbackNotice) {
        feedbackNotice.style.display = 'flex';
    }
    
    // 更新提示文本
    updateFeedbackNoticeText();
    
    // 如果还没有添加beforeunload处理器，则添加
    if (feedbackGeneratingCount === 1 && !beforeunloadHandler) {
        beforeunloadHandler = (e) => {
            e.preventDefault();
            e.returnValue = '反馈文件正在生成中，请不要关闭页面！';
            return e.returnValue;
        };
        window.addEventListener('beforeunload', beforeunloadHandler);
    }
}

/**
 * 隐藏反馈生成提示并恢复关闭功能
 */
function hideFeedbackGeneratingNotice() {
    feedbackGeneratingCount = Math.max(0, feedbackGeneratingCount - 1);
    feedbackCompletedCount++;
    
    // 更新提示文本
    updateFeedbackNoticeText();
    
    // 如果所有反馈都生成完成，隐藏提示并移除beforeunload处理器
    if (feedbackGeneratingCount === 0) {
        // 延迟隐藏，让用户看到完成状态
        setTimeout(() => {
            const noticesRow = document.getElementById('feedback-notices-row');
            const feedbackNotice = document.getElementById('feedback-generating-notice');
            
            // 隐藏反馈生成提示
            if (feedbackNotice) {
                feedbackNotice.style.display = 'none';
            }
            
            // 检查是否还有执行中指示器显示
            const executionIndicator = document.getElementById('workflow-execution-indicator');
            if (noticesRow) {
                // 如果执行中指示器还在显示，保持row显示；否则隐藏row
                if (executionIndicator && executionIndicator.style.display !== 'none') {
                    // 执行中指示器还在，保持row显示
                } else {
                    noticesRow.style.display = 'none';
                }
            }
            
            // 重置计数
            feedbackCompletedCount = 0;
            
            if (beforeunloadHandler) {
                window.removeEventListener('beforeunload', beforeunloadHandler);
                beforeunloadHandler = null;
            }
        }, 2000); // 2秒后隐藏
    }
}

/**
 * 获取项目根目录
 * 直接使用相对路径，就像log文件夹一样
 * 后端API会自动处理项目根目录（使用__dirname）
 */
function getProjectRoot(filePath) {
    // 直接返回空字符串，表示使用相对路径（项目根目录）
    // 这样fankui_log会和log文件夹在同一个目录（项目根目录）
    return '';
}

// 反馈配置存储
let feedbackConfig = {
    // 全局开关：控制是否启用反馈AI生成（关闭后不会自动生成任何新的反馈文件）
    enabled: true,
    workflowFeedbackPrompts: {}, // {workflowName: promptName} 每个工作流的反馈提示词
    nodeFeedbackPrompts: {}, // {viewId: promptName}
    feedbackCount: 3, // 默认读取的反馈文件数量（节点反馈和工作流反馈都使用这个值）
    workflowFeedbackCount: 0, // 读取工作流反馈数量（0表示不读取）
    maxLimit: 10, // 最大限制（用于限制反馈数量输入的最大值）
    permanentFeedbacks: {} // 永久反馈配置 {viewId: [filePath1, filePath2, ...]}
};

/**
 * 加载反馈配置
 */
export async function loadFeedbackConfig() {
    try {
        const saved = localStorage.getItem('feedbackConfig');
        if (saved) {
            const parsed = JSON.parse(saved);
            feedbackConfig = {
                enabled: parsed.enabled !== undefined ? !!parsed.enabled : true,
                // 兼容旧配置：如果有 workflowFeedbackPrompt，迁移到 workflowFeedbackPrompts
                workflowFeedbackPrompts: parsed.workflowFeedbackPrompts || (parsed.workflowFeedbackPrompt ? { '默认': parsed.workflowFeedbackPrompt } : {}),
                nodeFeedbackPrompts: parsed.nodeFeedbackPrompts || {},
                feedbackCount: parsed.feedbackCount !== undefined ? parsed.feedbackCount : 3, // 默认3个，允许0
                workflowFeedbackCount: parsed.workflowFeedbackCount !== undefined ? parsed.workflowFeedbackCount : (parsed.feedbackCount !== undefined ? parsed.feedbackCount : 3), // 如果未配置，使用feedbackCount作为默认值
                maxLimit: parsed.maxLimit !== undefined ? parsed.maxLimit : 10, // 最大限制，默认10，使用 !== undefined 确保0值也能正确保存
                permanentFeedbacks: parsed.permanentFeedbacks || {} // 永久反馈配置
            };
        }
        // 渲染管理面板中的配置UI
        renderFeedbackConfig();
    } catch (err) {
        console.error('加载反馈配置失败:', err);
    }
}

/**
 * 保存反馈配置
 */
export async function saveFeedbackConfig() {
    try {
        // 在保存前，从输入框读取最新值，确保配置是最新的
        const enabledCheckbox = document.getElementById('feedback-enabled-checkbox');
        const enabledCheckboxFullscreen = document.getElementById('feedback-enabled-checkbox-fullscreen');
        // 全局开关：优先读取普通面板，其次全屏面板
        if (enabledCheckbox) {
            feedbackConfig.enabled = !!enabledCheckbox.checked;
        } else if (enabledCheckboxFullscreen) {
            feedbackConfig.enabled = !!enabledCheckboxFullscreen.checked;
        }

        const feedbackCountInput = document.getElementById('feedback-count-input');
        const feedbackCountInputFullscreen = document.getElementById('feedback-count-input-fullscreen');
        const workflowFeedbackCountInput = document.getElementById('workflow-feedback-count-input');
        const workflowFeedbackCountInputFullscreen = document.getElementById('workflow-feedback-count-input-fullscreen');
        // 读取反馈数量（优先使用普通模式，如果不存在则使用全屏模式）
        const feedbackCountValue = feedbackCountInput ? parseInt(feedbackCountInput.value) : (feedbackCountInputFullscreen ? parseInt(feedbackCountInputFullscreen.value) : undefined);
        if (feedbackCountValue !== undefined && !isNaN(feedbackCountValue)) {
            feedbackConfig.feedbackCount = feedbackCountValue;
        }
        
        // 读取工作流反馈数量
        const workflowFeedbackCountValue = workflowFeedbackCountInput ? parseInt(workflowFeedbackCountInput.value) : (workflowFeedbackCountInputFullscreen ? parseInt(workflowFeedbackCountInputFullscreen.value) : undefined);
        if (workflowFeedbackCountValue !== undefined && !isNaN(workflowFeedbackCountValue)) {
            feedbackConfig.workflowFeedbackCount = workflowFeedbackCountValue;
        }
        
        localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
        alert('反馈配置已保存');
        return true;
    } catch (err) {
        console.error('保存反馈配置失败:', err);
        alert('保存失败: ' + err.message);
        return false;
    }
}

/**
 * 保存永久反馈配置（独立保存函数，避免与反馈配置保存冲突）
 */
export async function savePermanentFeedbackConfig() {
    try {
        // 确保配置已加载最新数据
        const saved = localStorage.getItem('feedbackConfig');
        if (saved) {
            const parsed = JSON.parse(saved);
            // 只更新永久反馈配置部分
            parsed.permanentFeedbacks = feedbackConfig.permanentFeedbacks || {};
            localStorage.setItem('feedbackConfig', JSON.stringify(parsed));
            // 同步更新内存中的配置
            feedbackConfig.permanentFeedbacks = parsed.permanentFeedbacks;
        } else {
            // 如果没有现有配置，直接保存
            localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
        }
        alert('永久反馈配置已保存');
        return true;
    } catch (err) {
        console.error('保存永久反馈配置失败:', err);
        alert('保存失败: ' + err.message);
        return false;
    }
}

/**
 * 渲染反馈配置界面（管理面板右侧）
 */
export async function renderFeedbackConfig() {
    // 加载提示词列表（与提示词管理面板共享同一套历史列表）
    await loadPrompts();
    
    // 加载工作流列表（用于工作流反馈提示词配置）
    try {
        const { loadWorkflows } = await import('./workflowManager.js');
        await loadWorkflows();
    } catch (err) {
        console.warn('加载工作流列表失败:', err);
    }
    
    // 渲染反馈数量配置
    const feedbackCountInput = document.getElementById('feedback-count-input');
    const feedbackEnabledCheckbox = document.getElementById('feedback-enabled-checkbox');
    if (feedbackEnabledCheckbox) {
        feedbackEnabledCheckbox.checked = feedbackConfig.enabled !== false;
        feedbackEnabledCheckbox.addEventListener('change', (e) => {
            feedbackConfig.enabled = !!e.target.checked;
            try {
                localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
            } catch (err) {
                console.warn('实时保存反馈配置失败:', err);
            }
        });
    }

    if (feedbackCountInput) {
        feedbackCountInput.value = feedbackConfig.feedbackCount !== undefined ? feedbackConfig.feedbackCount : 0;
        feedbackCountInput.addEventListener('change', (e) => {
            const count = parseInt(e.target.value);
            if (isNaN(count) || count < 0) {
                e.target.value = 0;
                feedbackConfig.feedbackCount = 0;
            } else {
                feedbackConfig.feedbackCount = count;
            }
            try {
                localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
            } catch (err) {
                console.warn('实时保存反馈配置失败:', err);
            }
        });
    }
    
    // 全屏模式的反馈数量配置
    const feedbackCountInputFullscreen = document.getElementById('feedback-count-input-fullscreen');
    const feedbackEnabledCheckboxFullscreen = document.getElementById('feedback-enabled-checkbox-fullscreen');
    if (feedbackEnabledCheckboxFullscreen) {
        feedbackEnabledCheckboxFullscreen.checked = feedbackConfig.enabled !== false;
        feedbackEnabledCheckboxFullscreen.addEventListener('change', (e) => {
            feedbackConfig.enabled = !!e.target.checked;
            try {
                localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
            } catch (err) {
                console.warn('实时保存反馈配置失败:', err);
            }
        });
    }

    if (feedbackCountInputFullscreen) {
        feedbackCountInputFullscreen.value = feedbackConfig.feedbackCount !== undefined ? feedbackConfig.feedbackCount : 0;
        feedbackCountInputFullscreen.addEventListener('change', (e) => {
            const count = parseInt(e.target.value);
            if (isNaN(count) || count < 0) {
                e.target.value = 0;
                feedbackConfig.feedbackCount = 0;
            } else {
                feedbackConfig.feedbackCount = count;
            }
            try {
                localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
            } catch (err) {
                console.warn('实时保存反馈配置失败:', err);
            }
        });
    }
    
    // 渲染工作流反馈提示词配置列表
    renderWorkflowFeedbackConfigList();
    
    // 渲染工作流反馈数量配置
    const workflowFeedbackCountInput = document.getElementById('workflow-feedback-count-input');
    if (workflowFeedbackCountInput) {
        // 如果workflowFeedbackCount未配置，显示feedbackCount的值（作为默认值提示）
        const displayValue = feedbackConfig.workflowFeedbackCount !== undefined 
            ? feedbackConfig.workflowFeedbackCount 
            : (feedbackConfig.feedbackCount !== undefined ? feedbackConfig.feedbackCount : 0);
        workflowFeedbackCountInput.value = displayValue;
        workflowFeedbackCountInput.addEventListener('change', (e) => {
            const count = parseInt(e.target.value);
            if (isNaN(count) || count < 0) {
                e.target.value = 0;
                feedbackConfig.workflowFeedbackCount = 0;
            } else {
                feedbackConfig.workflowFeedbackCount = count;
            }
            try {
                localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
            } catch (err) {
                console.warn('实时保存反馈配置失败:', err);
            }
        });
    }
    
    // 全屏模式的工作流反馈数量配置
    const workflowFeedbackCountInputFullscreen = document.getElementById('workflow-feedback-count-input-fullscreen');
    if (workflowFeedbackCountInputFullscreen) {
        const displayValue = feedbackConfig.workflowFeedbackCount !== undefined 
            ? feedbackConfig.workflowFeedbackCount 
            : (feedbackConfig.feedbackCount !== undefined ? feedbackConfig.feedbackCount : 0);
        workflowFeedbackCountInputFullscreen.value = displayValue;
        workflowFeedbackCountInputFullscreen.addEventListener('change', (e) => {
            const count = parseInt(e.target.value);
            if (isNaN(count) || count < 0) {
                e.target.value = 0;
                feedbackConfig.workflowFeedbackCount = 0;
            } else {
                feedbackConfig.workflowFeedbackCount = count;
            }
            try {
                localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
            } catch (err) {
                console.warn('实时保存反馈配置失败:', err);
            }
        });
    }
    
    // 渲染节点反馈配置列表
    renderNodeFeedbackConfigList();
    
    // 移除添加工作流反馈配置按钮的绑定（按钮已移除）

    // 保存配置按钮绑定（反馈配置面板的保存按钮）
    const saveBtn = document.getElementById('save-feedback-config-btn');
    if (saveBtn && !saveBtn._feedbackBound) {
        saveBtn._feedbackBound = true;
        saveBtn.addEventListener('click', async (e) => {
            e.stopPropagation(); // 阻止事件冒泡
            await saveFeedbackConfig();
        });
    }
}

/**
 * 初始化反馈系统管理面板左侧（事件下拉 + 列表刷新）
 */
export async function initFeedbackPanelControls() {
    const eventSelect = document.getElementById('feedback-event-select');
    const viewIdSelect = document.getElementById('feedback-viewid-select');
    const workflowSelect = document.getElementById('feedback-workflow-select');
    const daysInput = document.getElementById('feedback-days-input');
    const hoursInput = document.getElementById('feedback-hours-input');
    const refreshBtn = document.getElementById('refresh-feedback-list-btn');
    const listEl = document.getElementById('feedback-list');
    if (!eventSelect || !viewIdSelect || !daysInput || !hoursInput || !refreshBtn || !listEl) {
        return;
    }
    
    // 填充事件下拉（优先使用 state.events，没有则调用 getEvents）
    try {
        let events = state.events && state.events.length > 0 ? state.events : null;
        if (!events) {
            const data = await getEvents();
            events = data.events || [];
            state.events = events;
        }
        
        eventSelect.innerHTML = '<option value="">全部事件</option>';
        events.forEach(ev => {
            const opt = document.createElement('option');
            opt.value = ev.name;
            opt.textContent = ev.name;
            eventSelect.appendChild(opt);
        });
    } catch (err) {
        console.error('加载事件列表失败（反馈系统）:', err);
    }
    
    // 填充视图ID下拉（使用 state.views）
    try {
        viewIdSelect.innerHTML = '<option value="">全部视图</option>';
        if (state.views && state.views.length > 0) {
            state.views.forEach(view => {
                const opt = document.createElement('option');
                opt.value = view.id;
                opt.textContent = view.id;
                viewIdSelect.appendChild(opt);
            });
        }
    } catch (err) {
        console.error('加载视图ID列表失败（反馈系统）:', err);
    }
    
    // 填充工作流名称下拉（使用 state.workflows）
    if (workflowSelect) {
        try {
            // 确保工作流列表已加载
            if (!state.workflows || state.workflows.length === 0) {
                try {
                    const { loadWorkflows } = await import('./workflowManager.js');
                    await loadWorkflows();
                } catch (err) {
                    console.warn('加载工作流列表失败（反馈系统）:', err);
                }
            }
            
            workflowSelect.innerHTML = '<option value="">全部工作流</option>';
            if (state.workflows && state.workflows.length > 0) {
                state.workflows.forEach(workflow => {
                    const opt = document.createElement('option');
                    opt.value = workflow.name;
                    opt.textContent = workflow.name;
                    workflowSelect.appendChild(opt);
                });
            }
        } catch (err) {
            console.error('加载工作流列表失败（反馈系统）:', err);
        }
    }
    
    // 绑定刷新按钮（避免重复绑定）
    if (!refreshBtn._feedbackBound) {
        refreshBtn._feedbackBound = true;
        refreshBtn.addEventListener('click', async () => {
            const eventName = eventSelect.value || '';
            const viewId = viewIdSelect.value || '';
            const workflowName = workflowSelect ? (workflowSelect.value || '') : '';
            const days = parseInt(daysInput.value || '0', 10) || 0;
            const hours = parseInt(hoursInput.value || '0', 10) || 0;
            await viewFeedbackFiles(eventName, viewId, workflowName, days, hours);
        });
    }
    
    // 事件或时间变化时可选自动刷新（简单做法：用户点按钮）
    // 打开面板时先加载一次列表（全部事件、全部视图、全部工作流、全部时间）
    await viewFeedbackFiles('', '', '', 0, 0);
}

// 注意：反馈文件列表的实际渲染逻辑使用上面的 viewFeedbackFiles，
// 管理面板左侧通过 initFeedbackPanelControls 调用它，以保持与原有系统完全一致。

/**
 * 渲染工作流反馈提示词配置列表
 */
function renderWorkflowFeedbackConfigList() {
    const configList = document.getElementById('workflow-feedback-config-list');
    if (!configList) return;
    
    configList.innerHTML = '';
    
    // 获取所有工作流
    const workflows = state.workflows || [];
    const allWorkflowNames = new Set(workflows.map(w => w.name));
    
    // 添加已配置但可能不存在的工作流（保留配置）
    Object.keys(feedbackConfig.workflowFeedbackPrompts || {}).forEach(workflowName => {
        allWorkflowNames.add(workflowName);
    });
    
    const sortedWorkflowNames = Array.from(allWorkflowNames).sort();
    
    // 如果没有配置，显示提示
    if (sortedWorkflowNames.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.style.padding = '20px';
        emptyMessage.style.textAlign = 'center';
        emptyMessage.style.color = 'var(--text-muted)';
        emptyMessage.textContent = '暂无工作流反馈配置';
        configList.appendChild(emptyMessage);
        return;
    }
    
    // 为每个工作流创建配置项
    sortedWorkflowNames.forEach(workflowName => {
        const configItem = document.createElement('div');
        configItem.className = 'form-section';
        configItem.style.border = '1px solid var(--border)';
        configItem.style.padding = '12px';
        configItem.style.borderRadius = 'var(--border-radius)';
        configItem.style.marginBottom = '8px';
        configItem.style.position = 'relative';
        
        const promptSelectId = `workflow-feedback-prompt-${workflowName.replace(/[^a-zA-Z0-9]/g, '_')}`;
        configItem.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <label class="form-label" style="margin: 0; font-weight: 600;">工作流: ${workflowName}</label>
            </div>
            <select id="${promptSelectId}" class="form-select">
                <option value="">请选择提示词</option>
            </select>
        `;
        
        configList.appendChild(configItem);
        
        // 填充提示词选项
        const promptSelect = document.getElementById(promptSelectId);
        if (promptSelect) {
            state.prompts.forEach(prompt => {
                const option = document.createElement('option');
                option.value = prompt.name;
                option.textContent = prompt.name;
                if (feedbackConfig.workflowFeedbackPrompts[workflowName] === prompt.name) {
                    option.selected = true;
                }
                promptSelect.appendChild(option);
            });
            
            // 监听变化（实时更新配置）
            promptSelect.addEventListener('change', (e) => {
                const selectedValue = e.target.value || null;
                if (selectedValue) {
                    if (!feedbackConfig.workflowFeedbackPrompts) {
                        feedbackConfig.workflowFeedbackPrompts = {};
                    }
                    feedbackConfig.workflowFeedbackPrompts[workflowName] = selectedValue;
                    // 立即保存到localStorage（实时保存）
                    try {
                        localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
                    } catch (err) {
                        console.warn('实时保存反馈配置失败:', err);
                    }
                } else {
                    if (feedbackConfig.workflowFeedbackPrompts) {
                        delete feedbackConfig.workflowFeedbackPrompts[workflowName];
                    }
                    // 立即保存到localStorage（实时保存）
                    try {
                        localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
                    } catch (err) {
                        console.warn('实时保存反馈配置失败:', err);
                    }
                }
            });
        }
    });
    
    // CSS已经处理好了滚动条样式，不需要动态设置
}

/**
 * 添加工作流反馈配置
 */
export function addWorkflowFeedbackConfig() {
    const workflows = state.workflows || [];
    if (workflows.length === 0) {
        alert('暂无工作流，请先创建工作流');
        return;
    }
    
    // 获取已配置的工作流名称
    const configuredWorkflows = new Set(Object.keys(feedbackConfig.workflowFeedbackPrompts || {}));
    
    // 过滤出未配置的工作流
    const availableWorkflows = workflows.filter(w => !configuredWorkflows.has(w.name));
    
    if (availableWorkflows.length === 0) {
        alert('所有工作流都已配置，无需重复添加');
        return;
    }
    
    // 创建选择对话框（使用更友好的方式）
    if (availableWorkflows.length === 1) {
        // 只有一个可用工作流，直接添加
        const workflowName = availableWorkflows[0].name;
        if (!feedbackConfig.workflowFeedbackPrompts) {
            feedbackConfig.workflowFeedbackPrompts = {};
        }
        feedbackConfig.workflowFeedbackPrompts[workflowName] = '';
        renderWorkflowFeedbackConfigList();
        
        // 立即保存到localStorage
        try {
            localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
        } catch (err) {
            console.warn('实时保存反馈配置失败:', err);
        }
        return;
    }
    
    // 多个工作流，创建选择列表
    const workflowNames = availableWorkflows.map(w => w.name);
    const workflowList = workflowNames.map((name, index) => `${index + 1}. ${name}`).join('\n');
    const selectedIndex = prompt(`请选择要配置的工作流（输入序号）:\n\n${workflowList}\n\n输入序号:`);
    
    if (!selectedIndex || !selectedIndex.trim()) return;
    
    const index = parseInt(selectedIndex.trim()) - 1;
    if (index < 0 || index >= workflowNames.length) {
        alert('无效的序号');
        return;
    }
    
    const workflowName = workflowNames[index];
    if (!feedbackConfig.workflowFeedbackPrompts) {
        feedbackConfig.workflowFeedbackPrompts = {};
    }
    feedbackConfig.workflowFeedbackPrompts[workflowName] = '';
    renderWorkflowFeedbackConfigList();
    
    // 立即保存到localStorage
    try {
        localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
    } catch (err) {
        console.warn('实时保存反馈配置失败:', err);
    }
}

/**
 * 删除工作流反馈配置
 */
export function removeWorkflowFeedbackConfig(workflowName) {
    if (confirm(`确定要删除工作流 "${workflowName}" 的反馈配置吗？`)) {
        if (feedbackConfig.workflowFeedbackPrompts) {
            delete feedbackConfig.workflowFeedbackPrompts[workflowName];
        }
        renderWorkflowFeedbackConfigList();
        // 立即保存到localStorage
        try {
            localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
        } catch (err) {
            console.warn('实时保存反馈配置失败:', err);
        }
    }
}

/**
 * 渲染节点反馈配置列表
 */
function renderNodeFeedbackConfigList() {
    const configList = document.getElementById('node-feedback-config-list');
    if (!configList) return;
    
    configList.innerHTML = '';
    
    // 获取所有视图ID（包括已配置但可能不在views中的）
    const configuredViewIds = new Set(Object.keys(feedbackConfig.nodeFeedbackPrompts || {}));
    const allViewIds = new Set(state.views.map(v => v.id));
    configuredViewIds.forEach(id => allViewIds.add(id));
    
    const viewIds = Array.from(allViewIds).sort();
    
    // 为每个视图ID创建配置项
    viewIds.forEach(viewId => {
        const configItem = document.createElement('div');
        configItem.className = 'form-section';
        configItem.style.border = '1px solid var(--border)';
        configItem.style.padding = '12px';
        configItem.style.borderRadius = 'var(--border-radius)';
        configItem.style.marginBottom = '8px';
        
        const promptSelectId = `node-feedback-prompt-${viewId}`;
        configItem.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <label class="form-label" style="margin: 0;">视图ID: ${viewId}</label>
            </div>
            <select id="${promptSelectId}" class="form-select">
                <option value="">请选择提示词</option>
            </select>
        `;
        
        configList.appendChild(configItem);
        
        // 填充提示词选项
        const promptSelect = document.getElementById(promptSelectId);
        if (promptSelect) {
            state.prompts.forEach(prompt => {
                const option = document.createElement('option');
                option.value = prompt.name;
                option.textContent = prompt.name;
                if (feedbackConfig.nodeFeedbackPrompts[viewId] === prompt.name) {
                    option.selected = true;
                }
                promptSelect.appendChild(option);
            });
            
            // 监听变化（实时更新配置）
            promptSelect.addEventListener('change', (e) => {
                const selectedValue = e.target.value || null;
                if (selectedValue) {
                    feedbackConfig.nodeFeedbackPrompts[viewId] = selectedValue;
                    // 立即保存到localStorage（实时保存）
                    try {
                        localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
                    } catch (err) {
                        console.warn('实时保存反馈配置失败:', err);
                    }
                } else {
                    delete feedbackConfig.nodeFeedbackPrompts[viewId];
                    // 立即保存到localStorage（实时保存）
                    try {
                        localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
                    } catch (err) {
                        console.warn('实时保存反馈配置失败:', err);
                    }
                }
            });
        }
    });
    
    // CSS已经处理好了滚动条样式，不需要动态设置
}

/**
 * 添加节点反馈配置
 */
export function addNodeFeedbackConfig() {
    const viewIdInput = prompt('请输入视图ID:');
    if (!viewIdInput || !viewIdInput.trim()) return;
    
    const viewId = viewIdInput.trim();
    if (!feedbackConfig.nodeFeedbackPrompts[viewId]) {
        feedbackConfig.nodeFeedbackPrompts[viewId] = '';
        renderNodeFeedbackConfigList();
    }
}

/**
 * 删除节点反馈配置
 */
export function removeNodeFeedbackConfig(viewId) {
    if (confirm(`确定要删除视图 "${viewId}" 的反馈配置吗？`)) {
        delete feedbackConfig.nodeFeedbackPrompts[viewId];
        renderNodeFeedbackConfigList();
    }
}

/**
 * 生成工作流反馈
 * @param {string} eventName - 事件名称
 * @param {string} eventTimestamp - 事件时间戳
 * @param {string} filePath - 文件路径
 * @param {string} workflowName - 工作流名称
 * @param {Array} executedSteps - 已执行的步骤列表
 * @param {object} stepResults - 步骤结果
 * @returns {Promise<string>} 反馈文件路径
 */
export async function generateWorkflowFeedback(eventName, eventTimestamp, filePath, workflowName, executedSteps, stepResults) {
    // 确保配置已加载（从localStorage重新加载，确保获取最新配置）
    try {
        const saved = localStorage.getItem('feedbackConfig');
        if (saved) {
            const parsed = JSON.parse(saved);
            feedbackConfig.workflowFeedbackPrompts = parsed.workflowFeedbackPrompts || {};
            if (parsed.enabled !== undefined) {
                feedbackConfig.enabled = !!parsed.enabled;
            }
        }
    } catch (err) {
        console.warn('[反馈系统] 加载配置失败，使用内存中的配置:', err);
    }

    // 全局开关：如果反馈系统被关闭，直接跳过生成
    if (!isFeedbackEnabled()) {
        console.log('[反馈系统] 全局反馈已关闭，跳过工作流反馈生成');
        return null;
    }
    
    // 获取该工作流的反馈提示词
    const promptName = feedbackConfig.workflowFeedbackPrompts[workflowName];
    const hasPrompt = !!promptName;
    
    if (!hasPrompt) {
        console.log(`[工作流反馈生成] 工作流 "${workflowName}" 未配置反馈提示词，将生成基本反馈文件（不调用AI）`);
    }
    
    // 显示反馈生成提示并屏蔽关闭功能
    showFeedbackGeneratingNotice();
    
    try {
        console.log(`[工作流反馈生成] ========== 开始生成工作流反馈 ==========`);
        console.log(`[工作流反馈生成] 工作流名称: ${workflowName}`);
        console.log(`[工作流反馈生成] 事件名称: ${eventName}`);
        console.log(`[工作流反馈生成] 文件路径: ${filePath}`);
        console.log(`[工作流反馈生成] 事件时间戳: ${eventTimestamp}`);
        console.log(`[工作流反馈生成] 执行步骤数: ${executedSteps.length}`);
        console.log(`[工作流反馈生成] 是否配置了反馈提示词: ${hasPrompt}`);
        
        // 构建消息内容：包含所有节点的完整内容
        const fileName = filePath.split(/[/\\]/).pop();
        
        // 按执行顺序构建所有节点的完整内容
        const allNodeContents = executedSteps.map((step, index) => {
            const stepContent = stepResults[step.step] || '';
            const stepViewId = step.step || step.viewId || '未知';
            return `## 节点 ${index + 1}: ${stepViewId}\n\n${stepContent}`;
        }).join('\n\n---\n\n');
        
        console.log(`[工作流反馈生成] 拼接的文件内容（所有节点的输出）:`);
        console.log(`[工作流反馈生成] 节点数量: ${executedSteps.length}`);
        executedSteps.forEach((step, index) => {
            const stepContent = stepResults[step.step] || '';
            const stepViewId = step.step || step.viewId || '未知';
            console.log(`[工作流反馈生成] --- 节点 ${index + 1}: ${stepViewId} ---`);
            console.log(`[工作流反馈生成] 节点内容长度: ${stepContent.length} 字符`);
        });
        
        let feedbackContent = '';
        
        if (hasPrompt) {
            // 如果配置了提示词，调用AI生成反馈
            const prompt = await getPrompt(promptName);
            console.log(`[工作流反馈生成] 工作流反馈提示词名称: ${promptName}`);
            console.log(`[工作流反馈生成] 工作流反馈提示词内容长度: ${prompt.content.length} 字符`);
            
            const userContent = `工作流执行总结反馈

事件名称: ${eventName}
工作流名称: ${workflowName}
文件名称: ${fileName}
执行时间: ${new Date(eventTimestamp).toLocaleString()}
执行步骤数: ${executedSteps.length}

工作流所有节点生成的内容:
${allNodeContents}

${formatPromptContent(prompt.content, '工作流反馈提示词')}`;
            
            console.log(`[工作流反馈生成] 发送给AI的完整内容长度: ${userContent.length} 字符`);
            
            // 获取第一个视图ID用于调用AI（使用工作流反馈的视图，如果没有配置则使用第一个视图）
            const viewId = state.views.length > 0 ? state.views[0].id : 'original';
            console.log(`[工作流反馈生成] 使用的视图ID: ${viewId}`);
            
            // 调用AI生成反馈
            console.log(`[工作流反馈生成] 正在调用AI生成反馈...`);
            feedbackContent = await callOpenAI(viewId, [{
                role: 'user',
                content: userContent
            }], {
                temperature: 0.7,
                max_tokens: 2000
            });
            
            console.log(`[工作流反馈生成] AI返回的反馈内容长度: ${feedbackContent.length} 字符`);
        } else {
            // 如果没有配置提示词，生成基本反馈内容（包含工作流执行信息）
            console.log(`[工作流反馈生成] 未配置提示词，生成基本反馈内容`);
            feedbackContent = `# 工作流执行反馈

**事件名称**: ${eventName}
**工作流名称**: ${workflowName}
**文件名称**: ${fileName}
**执行时间**: ${new Date(eventTimestamp).toLocaleString()}
**执行步骤数**: ${executedSteps.length}

## 执行步骤

${executedSteps.map((step, index) => {
    const stepViewId = step.step || step.viewId || '未知';
    return `${index + 1}. **${stepViewId}** (步骤索引: ${step.stepIndex || index + 1})`;
}).join('\n')}

## 节点输出内容

${allNodeContents}

---

*注意：此工作流未配置反馈提示词，因此生成了基本反馈文件。如需AI生成的详细反馈，请在反馈配置中为该工作流配置反馈提示词。*`;
            
            console.log(`[工作流反馈生成] 基本反馈内容长度: ${feedbackContent.length} 字符`);
        }
        
        // 生成文件路径：时间戳_工作流名_事件名_工作流反馈.md
        const timestampStr = eventTimestamp.replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
        const feedbackFileName = `${timestampStr}_${workflowName}_${eventName}_工作流反馈.md`;
        
        // 构建保存路径：fankui_log/年月/日/工作流名/文件名（项目根目录下，使用相对路径）
        const date = new Date(eventTimestamp);
        const yearMonth = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
        const day = String(date.getDate()).padStart(2, '0');
        // 使用相对路径，就像log文件夹一样
        const feedbackDir = `fankui_log/${yearMonth}/${day}/${workflowName}`;
        const feedbackFilePath = `${feedbackDir}/${feedbackFileName}`;
        
        console.log(`[工作流反馈生成] 反馈文件保存路径: ${feedbackFilePath}`);
        
        // 确保目录存在
        await ensureDirectoryExists(feedbackDir);
        
        // 保存反馈文件
        await saveFile(feedbackFilePath, feedbackContent);
        
        console.log(`[工作流反馈生成] 反馈文件已保存`);
        
        // 自动提取关键字（异步，不阻塞）
        processFeedbackFileForKeywords(feedbackFilePath).catch(err => {
            console.warn(`[反馈系统] 提取关键字失败: ${feedbackFilePath}`, err);
        });
        
        console.log(`[工作流反馈生成] ========== 工作流反馈生成完成 ==========`);
        console.log(`[反馈系统] 工作流反馈已生成: ${feedbackFilePath}`);
        
        // 隐藏反馈生成提示并恢复关闭功能
        hideFeedbackGeneratingNotice();
        
        return feedbackFilePath;
    } catch (err) {
        console.error('[反馈系统] 生成工作流反馈失败:', err);
        
        // 即使失败也要隐藏提示
        hideFeedbackGeneratingNotice();
        
        return null;
    }
}

/**
 * 生成节点反馈
 * @param {string} eventName - 事件名称
 * @param {string} eventTimestamp - 事件时间戳
 * @param {string} filePath - 文件路径
 * @param {string} viewId - 视图ID
 * @param {string} stepContent - 步骤内容（AI的回复）
 * @param {string} sentContent - 节点发送给AI的完整内容（可选）
 * @returns {Promise<string>} 反馈文件路径
 */
export async function generateNodeFeedback(eventName, eventTimestamp, filePath, viewId, stepContent, sentContent = '') {
    // 确保配置已加载（从localStorage重新加载，确保获取最新配置）
    try {
        const saved = localStorage.getItem('feedbackConfig');
        if (saved) {
            const parsed = JSON.parse(saved);
            // 只更新相关字段，避免覆盖其他配置
            feedbackConfig.workflowFeedbackPrompts = parsed.workflowFeedbackPrompts || feedbackConfig.workflowFeedbackPrompts || {};
            feedbackConfig.nodeFeedbackPrompts = parsed.nodeFeedbackPrompts || feedbackConfig.nodeFeedbackPrompts || {};
            if (parsed.enabled !== undefined) {
                feedbackConfig.enabled = !!parsed.enabled;
            }
            console.log(`[反馈系统] 重新加载配置，视图 "${viewId}" 的配置:`, feedbackConfig.nodeFeedbackPrompts[viewId] || '未配置');
        }
    } catch (err) {
        console.warn('[反馈系统] 加载配置失败，使用内存中的配置:', err);
    }

    // 全局开关：如果反馈系统被关闭，直接跳过生成
    if (!isFeedbackEnabled()) {
        console.log('[反馈系统] 全局反馈已关闭，跳过节点反馈生成');
        return null;
    }
    
    // 检查是否配置了该视图的反馈提示词
    const promptName = feedbackConfig.nodeFeedbackPrompts[viewId];
    if (!promptName) {
        console.warn(`[反馈系统] 视图 "${viewId}" 未配置节点反馈提示词，跳过生成`);
        console.warn(`[反馈系统] 当前已配置的视图ID:`, Object.keys(feedbackConfig.nodeFeedbackPrompts));
        console.warn(`[反馈系统] 完整配置:`, JSON.stringify(feedbackConfig, null, 2));
        return null;
    }
    
    // 显示反馈生成提示并屏蔽关闭功能
    showFeedbackGeneratingNotice();
    
    try {
        console.log(`[节点反馈生成] ========== 开始生成节点反馈 ==========`);
        console.log(`[节点反馈生成] 视图ID: ${viewId}`);
        console.log(`[节点反馈生成] 事件名称: ${eventName}`);
        console.log(`[节点反馈生成] 文件路径: ${filePath}`);
        console.log(`[节点反馈生成] 事件时间戳: ${eventTimestamp}`);
        
        // 获取提示词内容（使用已检查的promptName）
        const prompt = await getPrompt(promptName);
        console.log(`[节点反馈生成] 节点反馈提示词名称: ${promptName}`);
        console.log(`[节点反馈生成] 节点反馈提示词内容长度: ${prompt.content.length} 字符`);
        console.log(`[节点反馈生成] 节点反馈提示词内容:`);
        console.log(prompt.content);
        
        // 构建消息内容
        const fileName = filePath.split(/[/\\]/).pop();
        let userContent = `节点执行反馈

事件名称: ${eventName}
视图ID: ${viewId}
文件名称: ${fileName}
执行时间: ${new Date(eventTimestamp).toLocaleString()}

`;
        
        // 如果提供了节点发送给AI的完整内容，包含它
        if (sentContent && sentContent.trim()) {
            console.log(`[节点反馈生成] 节点发送给AI的完整内容长度: ${sentContent.length} 字符`);
            console.log(`[节点反馈生成] 节点发送给AI的完整内容:`);
            console.log(sentContent);
            
            userContent += `节点发送给AI的完整内容:
${sentContent}

`;
        } else {
            console.log(`[节点反馈生成] 节点发送给AI的完整内容: 未提供（sentContent为空）`);
        }
        
        console.log(`[节点反馈生成] 节点AI回复内容长度: ${stepContent.length} 字符`);
        console.log(`[节点反馈生成] 节点AI回复内容:`);
        console.log(stepContent);
        
        userContent += `节点AI回复内容:
${stepContent}

${formatPromptContent(prompt.content, '节点反馈提示词')}`;
        
        console.log(`[节点反馈生成] 发送给AI的完整内容长度: ${userContent.length} 字符`);
        console.log(`[节点反馈生成] 发送给AI的完整内容:`);
        console.log(userContent);
        
        // 调用AI生成反馈（使用当前视图ID的模型）
        console.log(`[节点反馈生成] 正在调用AI生成反馈（使用视图ID: ${viewId}）...`);
        const feedbackContent = await callOpenAI(viewId, [{
            role: 'user',
            content: userContent
        }], {
            temperature: 0.7,
            max_tokens: 2000
        });
        
        console.log(`[节点反馈生成] AI返回的反馈内容长度: ${feedbackContent.length} 字符`);
        console.log(`[节点反馈生成] AI返回的反馈内容:`);
        console.log(feedbackContent);
        
        // 生成文件路径（包含viewId以区分不同节点的反馈）
        const timestampStr = eventTimestamp.replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
        const lastDotIndex = fileName.lastIndexOf('.');
        const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
        const ext = lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1) : '';
        // 文件名格式：事件名_时间戳_文件名_视图ID_反馈.md
        const feedbackFileName = `${eventName}_${timestampStr}_${baseName}_${viewId}_反馈.${ext || 'md'}`;
        
        // 构建保存路径：fankui_log/年月/日/事件名/文件名（项目根目录下，使用相对路径）
        const date = new Date(eventTimestamp);
        const yearMonth = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
        const day = String(date.getDate()).padStart(2, '0');
        // 使用相对路径，就像log文件夹一样
        const feedbackDir = `fankui_log/${yearMonth}/${day}/${eventName}`;
        const feedbackFilePath = `${feedbackDir}/${feedbackFileName}`;
        
        console.log(`[节点反馈生成] 反馈文件保存路径: ${feedbackFilePath}`);
        
        // 确保目录存在
        await ensureDirectoryExists(feedbackDir);
        
        // 保存反馈文件
        await saveFile(feedbackFilePath, feedbackContent);
        
        console.log(`[节点反馈生成] 反馈文件已保存`);
        
        // 自动提取关键字（异步，不阻塞）
        processFeedbackFileForKeywords(feedbackFilePath).catch(err => {
            console.warn(`[反馈系统] 提取关键字失败: ${feedbackFilePath}`, err);
        });
        
        console.log(`[节点反馈生成] ========== 节点反馈生成完成 ==========`);
        console.log(`[反馈系统] 节点反馈已生成: ${feedbackFilePath}`);
        
        // 隐藏反馈生成提示并恢复关闭功能
        hideFeedbackGeneratingNotice();
        
        return feedbackFilePath;
    } catch (err) {
        console.error(`[反馈系统] 生成节点反馈失败 (${viewId}):`, err);
        
        // 即使失败也要隐藏提示
        hideFeedbackGeneratingNotice();
        
        return null;
    }
}

/**
 * 加载提示词列表（用于下拉选择器）
 */
async function loadPrompts() {
    try {
        const data = await getPrompts();
        state.prompts = data.prompts || [];
    } catch (err) {
        console.error('加载提示词列表失败:', err);
        state.prompts = [];
    }
}

/**
 * 查看反馈文件列表
 * @param {string} eventName - 事件名称（可选）
 * @param {string} viewId - 视图ID（可选）
 * @param {string} workflowName - 工作流名称（可选）
 * @param {number} days - 天数（可选）
 * @param {number} hours - 小时数（可选）
 */
export async function viewFeedbackFiles(eventName = '', viewId = '', workflowName = '', days = 0, hours = 0) {
    const feedbackList = document.getElementById('feedback-list');
    if (!feedbackList) return;
    
    // 确保反馈列表应用CSS样式，使用max-height: 110vh限制
    // 移除动态高度计算，让CSS控制
    if (feedbackList) {
        // 确保应用CSS样式，移除任何可能的内联样式覆盖
        feedbackList.style.maxHeight = '110vh';
        feedbackList.style.display = 'flex';
        feedbackList.style.flexDirection = 'column';
        // 移除可能被动态设置的其他高度限制
        feedbackList.style.height = 'auto';
    }
    
    feedbackList.innerHTML = '<div style="padding: 12px; color: var(--text-muted);">正在加载反馈文件...</div>';
    
    try {
        // 计算时间范围
        // 如果天数和小时数都没有指定，显示全部（startTime为null）
        let startTime = null;
        if (days > 0 || hours > 0) {
            const now = new Date(); // 使用当前用户电脑上的时间
            startTime = new Date(now);
            if (days > 0) {
                startTime.setDate(startTime.getDate() - days);
            }
            if (hours > 0) {
                startTime.setHours(startTime.getHours() - hours);
            }
        }
        
        // 扫描反馈文件（传递viewId和workflowName用于筛选）
        const feedbackFiles = await scanFeedbackFiles(eventName, viewId, workflowName, startTime, days, hours);
        
        // 统计文件数量
        const workflowCount = feedbackFiles.filter(f => f.type === 'workflow').length;
        const nodeCount = feedbackFiles.filter(f => f.type === 'node').length;
        const totalCount = feedbackFiles.length;
        
        if (feedbackFiles.length === 0) {
            feedbackList.innerHTML = '<div style="padding: 12px; color: var(--text-muted);">暂无反馈文件</div>';
            return;
        }
        
        // 渲染统计信息
        const statsHtml = `
            <div style="padding: 12px; background: var(--bg-secondary); border-radius: var(--border-radius); margin-bottom: 12px; border: 1px solid var(--border);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div style="font-weight: bold; color: var(--accent-blue);">📊 反馈统计</div>
                    <button id="open-keyword-recognition-manager-btn" style="background: var(--accent-blue); color: white; border: none; border-radius: var(--border-radius); padding: 4px 12px; cursor: pointer; font-size: 12px; font-weight: 500;" onmouseenter="this.style.opacity='0.8';" onmouseleave="this.style.opacity='1';">
                        🔑 关键字识别管理
                    </button>
                </div>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-size: 13px;">
                    <div>
                        <div style="color: var(--text-muted);">总计</div>
                        <div style="font-weight: bold; color: var(--text-primary);">${totalCount}</div>
                    </div>
                    <div>
                        <div style="color: var(--text-muted);">工作流反馈</div>
                        <div style="font-weight: bold; color: var(--accent-blue);">${workflowCount}</div>
                    </div>
                    <div>
                        <div style="color: var(--text-muted);">节点反馈</div>
                        <div style="font-weight: bold; color: var(--accent-green);">${nodeCount}</div>
                    </div>
                </div>
            </div>
        `;
        
        // 渲染反馈文件列表（统一与"选择反馈文件"弹窗的展示风格）
        feedbackList.innerHTML = statsHtml;
        
        // 绑定关键字识别管理按钮事件（按钮是动态创建的，需要在这里绑定）
        const keywordRecognitionBtn = document.getElementById('open-keyword-recognition-manager-btn');
        if (keywordRecognitionBtn) {
            keywordRecognitionBtn.addEventListener('click', async () => {
                const { showKeywordRecognitionManager } = await import('./usage/keywordRecognitionManager.js');
                await showKeywordRecognitionManager();
            });
        }
        feedbackFiles.forEach((file, index) => {
            const item = document.createElement('div');
            item.className = 'file-item type-file';
            item.style.cssText = `
                padding: 10px 14px;
                cursor: pointer;
                border-radius: var(--border-radius);
                margin-bottom: 6px;
                border: 1px solid var(--border);
                background: var(--bg-primary);
                display: flex;
                align-items: flex-start;
                gap: 10px;
                transition: background-color 0.2s, border-color 0.2s, box-shadow 0.2s;
            `;
            
            item.onmouseenter = () => {
                item.style.background = 'var(--bg-secondary)';
                item.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.06)';
                item.style.borderColor = 'var(--accent-blue)';
            };
            item.onmouseleave = () => {
                item.style.background = 'var(--bg-primary)';
                item.style.boxShadow = 'none';
                item.style.borderColor = 'var(--border)';
            };

            const content = document.createElement('div');
            content.style.flex = '1';
            content.style.minWidth = '0';

            // 标签：工作流反馈 / 节点反馈，使用统一的反馈标签样式
            const typeLabel = file.type === 'workflow' ? '工作流反馈' : '节点反馈';
            const typeTag = document.createElement('span');
            typeTag.textContent = typeLabel;
            typeTag.className = 'feedback-type-tag';
            if (file.type === 'workflow') {
                typeTag.classList.add('feedback-type-tag-workflow');
            } else {
                typeTag.classList.add('feedback-type-tag-node');
            }

            // 文件名使用统一的“年月日 时:分”时间戳格式
            const formattedFileName = formatFileNameTimestamp(file.name);

            const firstLine = document.createElement('div');
            firstLine.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 4px;';
            firstLine.appendChild(typeTag);

            const fileNameDiv = document.createElement('div');
            fileNameDiv.style.cssText = 'font-weight: 500; color: var(--text-primary); flex: 1; word-break: break-all;';
            fileNameDiv.textContent = formattedFileName;
            firstLine.appendChild(fileNameDiv);

            // 路径行
            const pathLine = document.createElement('div');
            pathLine.style.cssText = 'font-size: 11px; color: var(--text-muted); word-break: break-all; margin-top: 2px;';
            pathLine.textContent = file.path;

            // 组装内容
            content.appendChild(firstLine);
            content.appendChild(pathLine);

            item.appendChild(content);

            // 添加删除按钮
            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = '🗑️';
            deleteBtn.className = 'btn btn-small';
            deleteBtn.style.cssText = `
                flex-shrink: 0;
                padding: 4px 8px;
                font-size: 14px;
                background: var(--bg-secondary);
                border: 1px solid var(--border);
                color: var(--text-primary);
                cursor: pointer;
                border-radius: var(--border-radius);
                transition: background-color 0.2s, border-color 0.2s;
            `;
            deleteBtn.title = '删除到回收站';
            deleteBtn.onmouseenter = () => {
                deleteBtn.style.background = 'var(--accent-red, #f87171)';
                deleteBtn.style.borderColor = 'var(--accent-red, #f87171)';
                deleteBtn.style.color = 'white';
            };
            deleteBtn.onmouseleave = () => {
                deleteBtn.style.background = 'var(--bg-secondary)';
                deleteBtn.style.borderColor = 'var(--border)';
                deleteBtn.style.color = 'var(--text-primary)';
            };
            deleteBtn.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                    const { softDelete } = await import('../core/api.js');
                    await softDelete(file.path);
                    // 刷新反馈列表
                    await viewFeedbackFiles(eventName, viewId, workflowName, days, hours);
                } catch (err) {
                    console.error('删除失败:', err);
                    alert('删除失败: ' + (err.message || err));
                }
            };
            item.appendChild(deleteBtn);

            // 点击：在全屏富文本编辑器中打开该反馈文件
            item.onclick = async () => {
                await openFeedbackEditor(feedbackFiles, index);
            };
            feedbackList.appendChild(item);
        });
        
        // 内容加载后，确保高度设置正确以便显示滚动条
        setTimeout(() => {
            const parentSection = feedbackList.closest('.form-section');
            if (parentSection) {
                const sidebarBody = feedbackList.closest('.panel-sidebar-body');
                if (sidebarBody) {
                    const sidebarHeader = sidebarBody.previousElementSibling;
                    const headerHeight = sidebarHeader ? sidebarHeader.offsetHeight : 0;
                    const otherSectionsHeight = Array.from(sidebarBody.children)
                        .filter(child => child !== parentSection)
                        .reduce((sum, child) => sum + child.offsetHeight, 0);
                    const padding = 32;
                    const gap = 12;
                    const availableHeight = window.innerHeight - headerHeight - otherSectionsHeight - padding - gap;
                    parentSection.style.maxHeight = `${availableHeight}px`;
                    feedbackList.style.maxHeight = `${availableHeight - 40}px`;
                }
            }
        }, 100);
    } catch (err) {
        console.error('加载反馈文件列表失败:', err);
        feedbackList.innerHTML = '<div style="padding: 12px; color: var(--accent-red);">加载失败: ' + err.message + '</div>';
    }
}

/**
 * 统计工作流反馈文件数量
 * @param {string} eventName - 事件名称（可选，用于筛选特定事件的反馈）
 * @param {string} workflowName - 工作流名称（可选，用于筛选特定工作流的反馈）
 * @returns {Promise<number>} 工作流反馈文件数量
 */
export async function countWorkflowFeedbackFiles(eventName = '', workflowName = '') {
    const workflowFiles = [];
    
    try {
        // 扫描所有工作流反馈文件（不限制时间范围，统计全部）
        await scanFeedbackDirectory('fankui_log', 'workflow', eventName, null, null, workflowFiles, 0, 0);
        
        // 如果指定了工作流名称，进一步筛选
        if (workflowName) {
            // 工作流反馈文件路径格式：fankui_log/年月/日/工作流名/文件名_工作流反馈.md
            return workflowFiles.filter(file => file.path.includes(`/${workflowName}/`)).length;
        }
        
        return workflowFiles.length;
    } catch (err) {
        console.error('统计工作流反馈文件数量失败:', err);
        return 0;
    }
}

/**
 * 更新工作流反馈文件数量显示
 * @param {string} eventName - 事件名称（可选，用于筛选特定事件的反馈）
 * @param {string} workflowName - 工作流名称（可选，用于筛选特定工作流的反馈）
 */
export async function updateWorkflowFeedbackCountDisplay(eventName = '', workflowName = '') {
    const displayEl = document.getElementById('workflow-feedback-count-display');
    if (!displayEl) return;
    
    try {
        displayEl.innerHTML = '<span style="color: var(--text-muted);">正在统计...</span>';
        
        const count = await countWorkflowFeedbackFiles(eventName, workflowName);
        
        // 构建显示文本
        let displayText = '个工作流反馈文件';
        if (eventName || workflowName) {
            displayText = '个匹配的工作流反馈文件';
            const filters = [];
            if (eventName) filters.push(`事件: ${eventName}`);
            if (workflowName) filters.push(`工作流: ${workflowName}`);
            if (filters.length > 0) {
                displayText += ` (${filters.join(', ')})`;
            }
        }
        
        displayEl.innerHTML = `
            <span style="font-weight: 600; color: var(--accent-blue); font-size: 18px;">${count}</span>
            <span style="color: var(--text-primary); font-size: 14px;">${displayText}</span>
        `;
    } catch (err) {
        console.error('更新工作流反馈文件数量显示失败:', err);
        displayEl.innerHTML = '<span style="color: var(--accent-red);">统计失败</span>';
    }
}

/**
 * 扫描反馈文件
 * @param {string} eventName - 事件名称（可选）
 * @param {string} viewId - 视图ID（可选）
 * @param {string} workflowName - 工作流名称（可选）
 * @param {Date} startTime - 开始时间（可选）
 * @param {number} days - 天数（可选）
 * @param {number} hours - 小时数（可选）
 */
export async function scanFeedbackFiles(eventName, viewId, workflowName, startTime, days = 0, hours = 0) {
    const feedbackFiles = [];
    
    try {
        // 使用相对路径，就像log文件夹一样
        // 扫描工作流反馈文件：log/年月/日/工作流名/（注意：工作流反馈实际保存在fankui_log中）
        // 扫描节点反馈文件：fankui_log/年月/日/事件名/
        
        // 如果指定了工作流名称，只扫描工作流反馈，不扫描节点反馈
        // 其他情况（包括只选择视图ID或都没有选择），都扫描所有反馈（节点反馈和工作流反馈）
        
        if (workflowName) {
            // 只扫描工作流反馈
            await scanFeedbackDirectory('fankui_log', 'workflow', eventName, null, workflowName, startTime, feedbackFiles, days, hours);
        } else {
            // 扫描所有反馈（节点反馈和工作流反馈）
            await scanFeedbackDirectory('fankui_log', 'node', eventName, viewId, null, startTime, feedbackFiles, days, hours);
            await scanFeedbackDirectory('fankui_log', 'workflow', eventName, null, workflowName, startTime, feedbackFiles, days, hours);
        }
        
    } catch (err) {
        console.error('扫描反馈文件失败:', err);
    }
    
    // 按时间倒序排序
    feedbackFiles.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    return feedbackFiles;
}

/**
 * 扫描反馈目录
 * @param {string} baseDir - 基础目录
 * @param {string} type - 类型（'node' 或 'workflow'）
 * @param {string} eventName - 事件名称（可选）
 * @param {string} viewId - 视图ID（可选，仅用于节点反馈）
 * @param {string} workflowName - 工作流名称（可选，仅用于工作流反馈）
 * @param {Date} startTime - 开始时间（可选）
 * @param {Array} resultArray - 结果数组
 * @param {number} days - 天数（可选）
 * @param {number} hours - 小时数（可选）
 */
async function scanFeedbackDirectory(baseDir, type, eventName, viewId, workflowName, startTime, resultArray, days = 0, hours = 0) {
    try {
        const { getDirectory } = await import('../core/api.js');
        
        // 尝试读取基础目录
        try {
            const baseData = await getDirectory(baseDir);
            
            // 遍历年月文件夹
            for (const yearMonthDir of baseData.directories) {
                if (!yearMonthDir.name.match(/^\d{6}$/)) continue; // 格式：YYYYMM
                
                try {
                    const yearMonthData = await getDirectory(yearMonthDir.path);
                    
                    // 遍历日文件夹
                    for (const dayDir of yearMonthData.directories) {
                        if (!dayDir.name.match(/^\d{2}$/)) continue; // 格式：DD
                        
                        try {
                            const dayData = await getDirectory(dayDir.path);
                            
                            if (type === 'workflow') {
                                // 工作流反馈：文件夹是工作流名，文件名格式：时间戳_工作流名_事件名_工作流反馈.md
                                // 遍历所有文件夹（工作流名），查找包含_工作流反馈的文件
                                for (const workflowDir of dayData.directories) {
                                    // 如果指定了工作流名称，只扫描该工作流名的文件夹
                                    if (workflowName && workflowDir.name !== workflowName) continue;
                                    
                                    try {
                                        const workflowData = await getDirectory(workflowDir.path);
                                        for (const file of workflowData.files) {
                                            // 排除 .deleted 文件
                                            if (file.name.endsWith('.deleted')) continue;
                                            
                                            if (file.name.includes('_工作流反馈.')) {
                                                // 如果指定了事件名，检查文件名中是否包含该事件名
                                                // 文件名格式：时间戳_工作流名_事件名_工作流反馈.md
                                                // 事件名在文件名中间部分，需要检查是否包含 _事件名_工作流反馈. 的模式
                                                if (eventName) {
                                                    // 检查文件名中是否包含事件名（在_工作流反馈之前）
                                                    // 使用正则匹配：事件名后面应该跟着_工作流反馈
                                                    const eventNamePattern = new RegExp(`_${eventName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_工作流反馈\\.`);
                                                    if (!eventNamePattern.test(file.name)) {
                                                        continue;
                                                    }
                                                }
                                                
                                                // 从文件名提取时间戳
                                                const fileTimestamp = extractTimestampFromFileName(file.name);
                                                if (!fileTimestamp) continue; // 无法提取时间戳，跳过
                                                
                                                // 使用文件名中的时间戳进行时间范围筛选
                                                // 如果指定了时间范围，检查文件时间是否在范围内
                                                if (startTime !== null) {
                                                    const fileDate = new Date(fileTimestamp);
                                                    const now = new Date(); // 当前用户电脑上的时间
                                                    // 计算时间差：当前时间 - 文件时间
                                                    const timeDiff = now - fileDate;
                                                    // 计算时间范围（毫秒）
                                                    const timeRange = (days * 24 * 60 * 60 * 1000) + (hours * 60 * 60 * 1000);
                                                    // 如果时间差大于时间范围，说明文件太旧，跳过
                                                    if (timeDiff > timeRange) continue;
                                                }
                                                
                                                resultArray.push({
                                                    name: file.name,
                                                    path: file.path,
                                                    type: 'workflow',
                                                    timestamp: fileTimestamp
                                                });
                                            }
                                        }
                                    } catch (err) {
                                        // 忽略无法访问的目录
                                    }
                                }
                            } else {
                                // 节点反馈：文件夹是事件名，文件名格式：事件名_时间戳_文件名_视图ID_反馈.md
                                // 遍历所有文件夹
                                for (const eventDir of dayData.directories) {
                                    // 如果指定了事件名，只扫描该事件名的文件夹
                                    // 如果没有指定事件名（全部事件），扫描所有文件夹
                                    if (eventName && eventDir.name !== eventName) continue;
                                    
                                    try {
                                        const eventData = await getDirectory(eventDir.path);
                                        for (const file of eventData.files) {
                                            // 排除 .deleted 文件
                                            if (file.name.endsWith('.deleted')) continue;
                                            
                                            // 节点反馈文件名包含_视图ID_反馈，但不包含_工作流反馈
                                            // 文件名格式：事件名_时间戳_文件名_视图ID_反馈.md
                                            if (file.name.includes('_反馈.') && !file.name.includes('_工作流反馈.')) {
                                                // 如果指定了事件名，检查文件名是否以事件名开头
                                                if (eventName && !file.name.startsWith(eventName + '_')) continue;
                                                
                                                // 如果指定了视图ID，检查文件名是否包含该视图ID
                                                if (viewId && !file.name.includes(`_${viewId}_反馈.`)) continue;
                                                
                                                // 从文件名提取时间戳
                                                const fileTimestamp = extractTimestampFromFileName(file.name);
                                                if (!fileTimestamp) continue; // 无法提取时间戳，跳过
                                                
                                                // 使用文件名中的时间戳进行时间范围筛选
                                                // 如果指定了时间范围，检查文件时间是否在范围内
                                                if (startTime !== null) {
                                                    const fileDate = new Date(fileTimestamp);
                                                    const now = new Date(); // 当前用户电脑上的时间
                                                    // 计算时间差：当前时间 - 文件时间
                                                    const timeDiff = now - fileDate;
                                                    // 计算时间范围（毫秒）
                                                    const timeRange = (days * 24 * 60 * 60 * 1000) + (hours * 60 * 60 * 1000);
                                                    // 如果时间差大于时间范围，说明文件太旧，跳过
                                                    if (timeDiff > timeRange) continue;
                                                }
                                                
                                                resultArray.push({
                                                    name: file.name,
                                                    path: file.path,
                                                    type: 'node',
                                                    timestamp: fileTimestamp
                                                });
                                            }
                                        }
                                    } catch (err) {
                                        // 忽略无法访问的目录
                                    }
                                }
                            }
                        } catch (err) {
                            // 忽略无法访问的目录
                        }
                    }
                } catch (err) {
                    // 忽略无法访问的目录
                }
            }
        } catch (err) {
            // 基础目录不存在，跳过
        }
    } catch (err) {
        console.error(`扫描${baseDir}目录失败:`, err);
    }
}

/**
 * 确保目录存在（递归创建所有必要的父目录）
 * @param {string} dirPath - 目录路径
 */
async function ensureDirectoryExists(dirPath) {
    const { createFolder, getDirectory } = await import('../core/api.js');
    const pathParts = dirPath.replace(/\\/g, '/').split('/').filter(p => p);
    
    // 从根目录开始，逐级创建目录
    let currentPath = '';
    for (const part of pathParts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        
        try {
            // 尝试读取目录，如果存在则跳过
            await getDirectory(currentPath);
            console.log(`[ensureDirectoryExists] 目录已存在: ${currentPath}`);
        } catch (err) {
            // 目录不存在，创建它
            try {
                await createFolder(currentPath);
                console.log(`[ensureDirectoryExists] 目录创建成功: ${currentPath}`);
            } catch (createErr) {
                // 如果创建失败，可能是父目录不存在，继续尝试（会在下一级处理）
                // 或者目录已存在（并发创建），忽略错误
                console.warn(`[ensureDirectoryExists] 创建目录失败（可能已存在）: ${currentPath}`, createErr);
                // 再次尝试读取，确认是否真的创建失败
                try {
                    await getDirectory(currentPath);
                    console.log(`[ensureDirectoryExists] 目录实际已存在（并发创建）: ${currentPath}`);
                } catch (readErr) {
                    // 确实创建失败，记录错误但继续尝试下一级
                    console.error(`[ensureDirectoryExists] 目录创建失败且不存在: ${currentPath}`, createErr);
                }
            }
        }
    }
    
    // 最后验证整个路径是否存在
    try {
        await getDirectory(dirPath);
        console.log(`[ensureDirectoryExists] 最终验证：目录存在: ${dirPath}`);
        return true;
    } catch (err) {
        console.error(`[ensureDirectoryExists] 最终验证失败：目录不存在: ${dirPath}`, err);
        return false;
    }
}

/**
 * 从文件名提取时间戳
 * 支持两种文件名格式：
 * 1. 节点反馈：事件名_时间戳_文件名_视图ID_反馈.md（时间戳在中间）
 * 2. 工作流反馈：时间戳_工作流名_事件名_工作流反馈.md（时间戳在开头）
 * 时间戳格式：YYYY-MM-DD_HH-MM-SS-mmmZ 或 YYYY-MM-DD_HH-MM-SS
 * 例如：2025-12-21_08-47-34-631Z
 */
/**
 * 格式化文件名中的时间戳为易读格式（年月日小时分）
 * @param {string} fileName - 文件名
 * @returns {string} 格式化后的文件名（时间戳部分被替换为易读格式）
 */
function formatFileNameTimestamp(fileName) {
    // 提取时间戳
    const timestamp = extractTimestampFromFileName(fileName);
    if (!timestamp) return fileName; // 如果没有时间戳，返回原文件名
    
    // 将ISO格式转换为Date对象
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return fileName; // 如果日期无效，返回原文件名
    
    // 格式化为：年月日小时分（例如：2025年12月30日 14:16）
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const formattedTime = `${year}年${month}月${day}日 ${hour}:${minute}`;
    
    // 替换文件名中的时间戳部分
    // 先尝试匹配开头的时间戳（工作流反馈格式）
    let formattedName = fileName.replace(/^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d+Z)?)_/, `${formattedTime} `);
    
    // 如果开头没有匹配到，尝试匹配中间的时间戳（节点反馈格式）
    if (formattedName === fileName) {
        formattedName = fileName.replace(/_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d+Z)?)_/, `_${formattedTime}_`);
    }
    
    return formattedName;
}

/**
 * 从文件名提取时间戳
 */
function extractTimestampFromFileName(fileName) {
    let match = null;
    let timestampStr = null;
    
    // 先尝试匹配文件名开头的时间戳（工作流反馈格式：时间戳_工作流名_事件名_工作流反馈.md）
    match = fileName.match(/^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d+Z)?)_/);
    if (match) {
        timestampStr = match[1];
    } else {
        // 如果开头没有匹配到，尝试匹配中间的时间戳（节点反馈格式：事件名_时间戳_文件名_视图ID_反馈.md）
        // 匹配时间戳格式：YYYY-MM-DD_HH-MM-SS-mmmZ 或 YYYY-MM-DD_HH-MM-SS
        // 例如：2025-12-21_08-47-34-631Z 或 2025-12-21_08-47-34
        match = fileName.match(/_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d+Z)?)_/);
        if (match) {
            timestampStr = match[1];
        }
    }
    
    // 如果没有匹配到时间戳，返回null
    if (!timestampStr) {
        return null;
    }
    
    // 如果有Z结尾，去掉Z
    const hasZ = timestampStr.endsWith('Z');
    if (hasZ) {
        timestampStr = timestampStr.slice(0, -1);
    }
    
    // 分割日期和时间部分（使用下划线分割）
    const dateTimeParts = timestampStr.split('_');
    if (dateTimeParts.length !== 2) return null;
    
    const datePart = dateTimeParts[0]; // YYYY-MM-DD
    const timePart = dateTimeParts[1];  // HH-MM-SS 或 HH-MM-SS-mmm
    
    // 处理时间部分
    const timeComponents = timePart.split('-');
    if (timeComponents.length < 3) return null;
    
    const hour = timeComponents[0];
    const minute = timeComponents[1];
    const second = timeComponents[2];
    const millisecond = timeComponents[3] || '000'; // 如果有毫秒则使用，否则为000
    
    // 构建ISO格式时间戳：YYYY-MM-DDTHH:MM:SS.mmmZ
    const isoString = `${datePart}T${hour}:${minute}:${second}.${millisecond}${hasZ ? 'Z' : ''}`;
    return isoString;
}

/**
 * 读取永久反馈文件（不占用时间戳反馈的数量限制）
 * @param {string} viewId - 视图ID
 * @returns {Promise<Array>} 反馈内容数组 [{content: string, timestamp: string, filePath: string}]
 */
async function readPermanentNodeFeedbacks(viewId) {
    const feedbacks = [];
    
    try {
        // 确保配置已加载（从localStorage读取最新配置）
        const saved = localStorage.getItem('feedbackConfig');
        let config = {
            workflowFeedbackPrompt: null,
            nodeFeedbackPrompts: {},
            feedbackCount: 3,
            permanentFeedbacks: {}
        };
        
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                config = {
                    workflowFeedbackPrompt: parsed.workflowFeedbackPrompt || null,
                    nodeFeedbackPrompts: parsed.nodeFeedbackPrompts || {},
                    feedbackCount: parsed.feedbackCount || 3,
                    permanentFeedbacks: parsed.permanentFeedbacks || {}
                };
            } catch (parseErr) {
                console.warn('[readPermanentNodeFeedbacks] 解析配置失败，使用默认配置:', parseErr);
            }
        }
        
        // 同步更新内存中的配置
        feedbackConfig.permanentFeedbacks = config.permanentFeedbacks;
        
        // 获取该视图的永久反馈文件列表（只使用配置中选定的文件）
        const permanentFilePaths = config.permanentFeedbacks[viewId] || [];
        if (permanentFilePaths.length === 0) {
            return feedbacks;
        }
        
        const { getFile } = await import('../core/api.js');
        
        // 用于存储有效的文件路径（文件存在）
        const validFilePaths = [];
        
        // 读取所有永久反馈文件，并验证文件是否存在
        for (const filePath of permanentFilePaths) {
            // 排除 .deleted 文件
            if (filePath.endsWith('.deleted')) {
                console.warn(`[readPermanentNodeFeedbacks] 跳过 .deleted 文件: ${filePath}`);
                continue;
            }
            
            try {
                // 尝试读取文件，如果文件不存在会抛出错误
                const content = await getFile(filePath);
                
                // 文件存在，添加到有效列表
                validFilePaths.push(filePath);
                
                // 提取实际内容（去掉时间戳和视图ID头部，如果有的话）
                const contentLines = content.split('\n');
                let actualContent = content;
                
                // 跳过头部信息（时间戳和视图ID）
                const headerEndIndex = contentLines.findIndex(line => line.trim() === '');
                if (headerEndIndex >= 0 && headerEndIndex < 3) {
                    actualContent = contentLines.slice(headerEndIndex + 1).join('\n');
                }
                
                // 从文件路径提取时间戳（如果可能）
                let timestamp = new Date().toISOString(); // 默认使用当前时间
                const fileName = filePath.split(/[/\\]/).pop();
                const extractedTimestamp = extractTimestampFromFileName(fileName);
                if (extractedTimestamp) {
                    timestamp = extractedTimestamp;
                }
                
                feedbacks.push({
                    content: actualContent,
                    timestamp: timestamp,
                    filePath: filePath,
                    isPermanent: true // 标记为永久反馈
                });
            } catch (err) {
                // 文件不存在或读取失败，不添加到有效列表
                console.warn(`[readPermanentNodeFeedbacks] 永久反馈文件不存在或读取失败: ${filePath}`, err);
                // 不在这里处理，统一在最后清理
            }
        }
        
        // 内存和实际比对：如果配置中的文件不存在，从配置中移除
        if (validFilePaths.length !== permanentFilePaths.length) {
            // 有文件不存在，更新配置
            config.permanentFeedbacks[viewId] = validFilePaths;
            
            // 同步更新内存中的配置
            feedbackConfig.permanentFeedbacks = config.permanentFeedbacks;
            
            // 保存到localStorage
            try {
                const savedConfig = localStorage.getItem('feedbackConfig');
                if (savedConfig) {
                    const parsed = JSON.parse(savedConfig);
                    parsed.permanentFeedbacks = config.permanentFeedbacks;
                    localStorage.setItem('feedbackConfig', JSON.stringify(parsed));
                } else {
                    localStorage.setItem('feedbackConfig', JSON.stringify(config));
                }
                console.log(`[readPermanentNodeFeedbacks] 已清理 ${permanentFilePaths.length - validFilePaths.length} 个不存在的永久反馈文件`);
            } catch (saveErr) {
                console.warn('[readPermanentNodeFeedbacks] 更新配置失败:', saveErr);
            }
        }
    } catch (err) {
        console.error(`[readPermanentNodeFeedbacks] 读取永久反馈失败:`, err);
    }
    
    return feedbacks;
}

/**
 * 读取最近的节点反馈文件
 * @param {string} eventName - 事件名称
 * @param {string} filePath - 文件路径
 * @param {string} viewId - 视图ID
 * @param {number} count - 读取数量（默认3个）
 * @returns {Promise<Array>} 反馈内容数组 [{content: string, timestamp: string, filePath: string}]
 */
export async function readRecentNodeFeedbacks(eventName, filePath, viewId, count = 3) {
    const feedbacks = [];
    
    // 先读取永久反馈（不占用count限制）
    const permanentFeedbacks = await readPermanentNodeFeedbacks(viewId);
    feedbacks.push(...permanentFeedbacks);
    
    // 获取永久反馈的文件路径集合，用于排除
    const permanentFilePaths = new Set(permanentFeedbacks.map(f => f.filePath));
    
    try {
        const { getFile, getDirectory } = await import('../core/api.js');
        // 不再需要baseName，因为不再用文件名来限制检索
        // 只使用事件名（工作流名）和视图ID来匹配，实现数据互通
        
        // 使用相对路径，就像log文件夹一样
        const baseFeedbackDir = 'fankui_log';
        
        // 扫描所有可能的反馈文件
        const allFeedbackFiles = [];
        
        try {
            // 尝试读取fankui_log目录，如果不存在则创建
            let baseData;
            try {
                baseData = await getDirectory(baseFeedbackDir);
            } catch (dirError) {
                // 目录不存在，尝试创建
                console.log(`[readRecentNodeFeedbacks] fankui_log目录不存在，尝试创建: ${baseFeedbackDir}`);
                try {
                    const { createFolder } = await import('../core/api.js');
                    // 确保目录路径存在（递归创建）
                    await ensureDirectoryExists(baseFeedbackDir);
                    // 再次尝试读取
                    baseData = await getDirectory(baseFeedbackDir);
                    console.log(`[readRecentNodeFeedbacks] fankui_log目录创建成功: ${baseFeedbackDir}`);
                } catch (createError) {
                    // 创建失败，返回空数组
                    console.warn(`[readRecentNodeFeedbacks] 创建fankui_log目录失败: ${baseFeedbackDir}`, createError);
                    return [];
                }
            }
            
            // 遍历年月文件夹（从最新到最旧）
            const yearMonthDirs = baseData.directories
                .filter(d => d.name.match(/^\d{6}$/))
                .sort((a, b) => b.name.localeCompare(a.name)); // 降序，最新的在前
            
            for (const yearMonthDir of yearMonthDirs) {
                try {
                    const yearMonthData = await getDirectory(yearMonthDir.path);
                    
                    // 遍历日文件夹（从最新到最旧）
                    const dayDirs = yearMonthData.directories
                        .filter(d => d.name.match(/^\d{2}$/))
                        .sort((a, b) => b.name.localeCompare(a.name)); // 降序
                    
                    for (const dayDir of dayDirs) {
                        try {
                            const dayData = await getDirectory(dayDir.path);
                            
                            // 查找事件名文件夹
                            const eventDir = dayData.directories.find(d => d.name === eventName);
                            if (!eventDir) continue;
                            
                            try {
                                const eventData = await getDirectory(eventDir.path);
                                
                                // 查找匹配的反馈文件（只匹配事件名和视图ID，不限制文件名）
                                // 这样可以实现不同文件名的反馈数据互通
                                for (const file of eventData.files) {
                                    // 排除 .deleted 文件
                                    if (file.name.endsWith('.deleted')) continue;
                                    
                                    // 文件名格式：事件名_时间戳_文件名_视图ID_反馈.md
                                    // 需要匹配：包含viewId，且是反馈文件（不是工作流反馈）
                                    // 不再要求包含baseName，允许不同文件名的反馈被检索到
                                    if (file.name.includes('_反馈.') && 
                                        !file.name.includes('_工作流反馈.') &&
                                        file.name.includes(`_${viewId}_反馈.`)) {
                                        
                                        // 提取时间戳
                                        const timestamp = extractTimestampFromFileName(file.name);
                                        if (timestamp) {
                                            allFeedbackFiles.push({
                                                path: file.path,
                                                name: file.name,
                                                timestamp: timestamp
                                            });
                                        }
                                    }
                                }
                            } catch (err) {
                                // 忽略无法访问的目录
                            }
                        } catch (err) {
                            // 忽略无法访问的目录
                        }
                    }
                } catch (err) {
                    // 忽略无法访问的目录
                }
            }
        } catch (err) {
            // fankui_log目录不存在，返回空数组
            console.warn(`[readRecentNodeFeedbacks] fankui_log目录不存在: ${baseFeedbackDir}`);
            return [];
        }
        
        // 按时间戳降序排序，排除永久反馈文件，取前count个
        allFeedbackFiles.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        // 过滤掉已经在永久反馈中的文件
        const filteredFiles = allFeedbackFiles.filter(file => !permanentFilePaths.has(file.path));
        const recentFiles = filteredFiles.slice(0, count);
        
        // 读取文件内容
        for (const file of recentFiles) {
            try {
                const content = await getFile(file.path);
                // 提取实际内容（去掉时间戳和视图ID头部，如果有的话）
                const contentLines = content.split('\n');
                let actualContent = content;
                
                // 跳过头部信息（时间戳和视图ID）
                const headerEndIndex = contentLines.findIndex(line => line.trim() === '');
                if (headerEndIndex >= 0 && headerEndIndex < 3) {
                    actualContent = contentLines.slice(headerEndIndex + 1).join('\n');
                }
                
                feedbacks.push({
                    content: actualContent,
                    timestamp: file.timestamp,
                    filePath: file.path,
                    isPermanent: false // 标记为时间戳反馈
                });
            } catch (err) {
                console.warn(`[readRecentNodeFeedbacks] 读取反馈文件失败: ${file.path}`, err);
            }
        }
        
    } catch (err) {
        console.error(`[readRecentNodeFeedbacks] 读取反馈文件失败:`, err);
    }
    
    // 最终排序：时间戳反馈在前，永久反馈在后（各自内部按时间倒序）
    const permanent = feedbacks.filter(f => f.isPermanent).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const temporal = feedbacks.filter(f => !f.isPermanent).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    const result = [...temporal, ...permanent];
    
    // 输出拼接日志到控制台（cmd后台日志）
    console.log(`[反馈文件拼接] 视图ID: ${viewId}, 事件: ${eventName || '全部'}, 文件: ${filePath}`);
    console.log(`[反馈文件拼接] 时间戳反馈: ${temporal.length}个, 永久反馈: ${permanent.length}个`);
    if (temporal.length > 0) {
        console.log(`[反馈文件拼接] 时间戳反馈文件列表:`);
        temporal.forEach((f, i) => {
            console.log(`[反馈文件拼接]   ${i + 1}. ${f.filePath} (${new Date(f.timestamp).toLocaleString()})`);
        });
    }
    if (permanent.length > 0) {
        console.log(`[反馈文件拼接] 永久反馈文件列表:`);
        permanent.forEach((f, i) => {
            console.log(`[反馈文件拼接]   ${i + 1}. ${f.filePath} (${new Date(f.timestamp).toLocaleString()})`);
        });
    }
    console.log(`[反馈文件拼接] 最终拼接顺序: 时间戳反馈(${temporal.length}个) -> 永久反馈(${permanent.length}个)`);
    
    // 输出所有反馈文件的具体内容
    console.log(`[反馈文件拼接] ========== 开始输出反馈文件具体内容 ==========`);
    result.forEach((feedback, index) => {
        const label = feedback.isPermanent ? '永久反馈' : '时间戳反馈';
        console.log(`[反馈文件拼接] --- ${label} ${index + 1} / ${result.length} ---`);
        console.log(`[反馈文件拼接] 文件路径: ${feedback.filePath}`);
        console.log(`[反馈文件拼接] 时间戳: ${new Date(feedback.timestamp).toLocaleString()}`);
        console.log(`[反馈文件拼接] 内容长度: ${feedback.content.length} 字符`);
        // 关键修复：只打印文件路径，不打印完整内容，避免占用过多浏览器内存
        // console.log(`[反馈文件拼接] 内容预览（前500字符）:`);
        // const preview = feedback.content.length > 500 
        //     ? feedback.content.substring(0, 500) + '...' 
        //     : feedback.content;
        // console.log(preview);
        // console.log(`[反馈文件拼接] 完整内容:`);
        // console.log(feedback.content);
        console.log(`[反馈文件拼接] --- ${label} ${index + 1} 结束 ---`);
    });
    console.log(`[反馈文件拼接] ========== 反馈文件内容输出完成 ==========`);
    
    return result;
}

/**
 * 读取最近的工作流反馈文件
 * @param {string} eventName - 事件名称
 * @param {string} filePath - 文件路径
 * @param {string} workflowName - 工作流名称
 * @param {number} count - 读取数量，默认3个
 * @returns {Promise<Array>} 反馈内容数组，每个元素包含 {content, timestamp, filePath}
 */
export async function readRecentWorkflowFeedbacks(eventName, filePath, workflowName, count = 3) {
    const feedbacks = [];
    
    console.log(`[readRecentWorkflowFeedbacks] 开始读取工作流反馈: eventName=${eventName}, workflowName=${workflowName}, count=${count}`);
    
    // 检查工作流名称是否有效
    if (!workflowName || workflowName.trim() === '') {
        console.warn(`[readRecentWorkflowFeedbacks] 工作流名称为空，无法读取工作流反馈`);
        return [];
    }
    
    try {
        const { getFile, getDirectory } = await import('../core/api.js');
        const baseFeedbackDir = 'fankui_log';
        const allFeedbackFiles = [];
        
        try {
            // 尝试读取fankui_log目录，如果不存在则创建
            let baseData;
            try {
                baseData = await getDirectory(baseFeedbackDir);
            } catch (dirError) {
                console.log(`[readRecentWorkflowFeedbacks] fankui_log目录不存在，尝试创建: ${baseFeedbackDir}`);
                try {
                    await ensureDirectoryExists(baseFeedbackDir);
                    baseData = await getDirectory(baseFeedbackDir);
                    console.log(`[readRecentWorkflowFeedbacks] fankui_log目录创建成功: ${baseFeedbackDir}`);
                } catch (createError) {
                    console.warn(`[readRecentWorkflowFeedbacks] 创建fankui_log目录失败: ${baseFeedbackDir}`, createError);
                    return [];
                }
            }
            
            // 简化逻辑：直接扫描所有年月/日/工作流名文件夹，找到所有工作流反馈文件
            const yearMonthDirs = baseData.directories
                .filter(d => d.name.match(/^\d{6}$/))
                .sort((a, b) => b.name.localeCompare(a.name)); // 降序，最新的在前
            
            console.log(`[readRecentWorkflowFeedbacks] 找到 ${yearMonthDirs.length} 个年月文件夹，开始扫描工作流文件夹: "${workflowName}"`);
            
            for (const yearMonthDir of yearMonthDirs) {
                try {
                    const yearMonthData = await getDirectory(yearMonthDir.path);
                    const dayDirs = yearMonthData.directories
                        .filter(d => d.name.match(/^\d{2}$/))
                        .sort((a, b) => b.name.localeCompare(a.name)); // 降序
                    
                    for (const dayDir of dayDirs) {
                        try {
                            const dayData = await getDirectory(dayDir.path);
                            
                            // 直接查找工作流名文件夹（精确匹配）
                            const workflowDir = dayData.directories.find(d => d.name === workflowName);
                            
                            if (!workflowDir) {
                                continue; // 没找到就跳过
                            }
                            
                            try {
                                const workflowData = await getDirectory(workflowDir.path);
                                
                                // 直接读取该文件夹下所有包含"_工作流反馈."的文件
                                for (const file of workflowData.files) {
                                    // 排除 .deleted 文件
                                    if (file.name.endsWith('.deleted')) continue;
                                    
                                    if (file.name.includes('_工作流反馈.')) {
                                        // 提取时间戳
                                        const timestamp = extractTimestampFromFileName(file.name);
                                        if (timestamp) {
                                            allFeedbackFiles.push({
                                                path: file.path,
                                                name: file.name,
                                                timestamp: timestamp
                                            });
                                        }
                                    }
                                }
                            } catch (err) {
                                // 忽略无法访问的目录
                            }
                        } catch (err) {
                            // 忽略无法访问的目录
                        }
                    }
                } catch (err) {
                    // 忽略无法访问的目录
                }
            }
        } catch (err) {
            console.warn(`[readRecentWorkflowFeedbacks] fankui_log目录读取失败: ${baseFeedbackDir}`, err);
            return [];
        }
        
        // 按时间戳降序排序，取前count个
        allFeedbackFiles.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const recentFiles = allFeedbackFiles.slice(0, count);
        
        console.log(`[readRecentWorkflowFeedbacks] 找到 ${allFeedbackFiles.length} 个工作流反馈文件，取前 ${count} 个`);
        
        // 读取文件内容
        for (const file of recentFiles) {
            try {
                const content = await getFile(file.path);
                // 提取实际内容（去掉时间戳和头部信息，如果有的话）
                const contentLines = content.split('\n');
                let actualContent = content;
                
                // 跳过头部信息（时间戳和事件信息）
                const headerEndIndex = contentLines.findIndex(line => line.trim() === '');
                if (headerEndIndex >= 0 && headerEndIndex < 5) {
                    actualContent = contentLines.slice(headerEndIndex + 1).join('\n');
                }
                
                feedbacks.push({
                    content: actualContent,
                    timestamp: file.timestamp,
                    filePath: file.path
                });
            } catch (err) {
                console.warn(`[readRecentWorkflowFeedbacks] 读取反馈文件失败: ${file.path}`, err);
            }
        }
        
        // 输出拼接日志到控制台（与节点反馈保持一致的格式）
        console.log(`[反馈文件拼接] 工作流名称: ${workflowName}, 事件: ${eventName || '全部'}, 文件: ${filePath}`);
        console.log(`[反馈文件拼接] 工作流反馈: ${feedbacks.length}个`);
        if (feedbacks.length > 0) {
            console.log(`[反馈文件拼接] 工作流反馈文件列表:`);
            feedbacks.forEach((f, i) => {
                console.log(`[反馈文件拼接]   ${i + 1}. ${f.filePath} (${new Date(f.timestamp).toLocaleString()})`);
            });
        }
        console.log(`[反馈文件拼接] 最终拼接顺序: 工作流反馈(${feedbacks.length}个)`);
        
        // 输出所有工作流反馈文件的具体内容
        if (feedbacks.length > 0) {
            console.log(`[反馈文件拼接] ========== 开始输出工作流反馈文件具体内容 ==========`);
            feedbacks.forEach((feedback, index) => {
                console.log(`[反馈文件拼接] --- 工作流反馈 ${index + 1} / ${feedbacks.length} ---`);
                console.log(`[反馈文件拼接] 文件路径: ${feedback.filePath}`);
                console.log(`[反馈文件拼接] 时间戳: ${new Date(feedback.timestamp).toLocaleString()}`);
                console.log(`[反馈文件拼接] 内容长度: ${feedback.content.length} 字符`);
                // 关键修复：只打印文件路径，不打印完整内容，避免占用过多浏览器内存
                // console.log(`[反馈文件拼接] 内容预览（前500字符）:`);
                // const preview = feedback.content.length > 500 
                //     ? feedback.content.substring(0, 500) + '...' 
                //     : feedback.content;
                // console.log(preview);
                // console.log(`[反馈文件拼接] 完整内容:`);
                // console.log(feedback.content);
                console.log(`[反馈文件拼接] --- 工作流反馈 ${index + 1} 结束 ---`);
            });
            console.log(`[反馈文件拼接] ========== 工作流反馈文件内容输出完成 ==========`);
        }
        
    } catch (err) {
        console.error(`[readRecentWorkflowFeedbacks] 读取工作流反馈文件失败:`, err);
    }
    
    console.log(`[readRecentWorkflowFeedbacks] 返回 ${feedbacks.length} 个工作流反馈`);
    return feedbacks;
}

/**
 * 检查是否是第一次执行该节点（检查是否已有同名反馈文件）
 * @param {string} eventName - 事件名称
 * @param {string} eventTimestamp - 事件时间戳
 * @param {string} filePath - 文件路径
 * @param {string} viewId - 视图ID
 * @returns {Promise<boolean>} true表示是第一次执行，false表示不是第一次执行
 */
export async function checkIsFirstNodeExecution(eventName, eventTimestamp, filePath, viewId) {
    try {
        const { getFile } = await import('../core/api.js');
        const fileName = filePath.split(/[/\\]/).pop();
        const lastDotIndex = fileName.lastIndexOf('.');
        const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
        const ext = lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1) : '';
        const timestampStr = eventTimestamp.replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
        // 文件名格式：事件名_时间戳_文件名_视图ID_反馈.md
        const feedbackFileName = `${eventName}_${timestampStr}_${baseName}_${viewId}_反馈.${ext || 'md'}`;
        
        // 构建反馈文件路径
        const date = new Date(eventTimestamp);
        const yearMonth = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
        const day = String(date.getDate()).padStart(2, '0');
        const feedbackDir = `fankui_log/${yearMonth}/${day}/${eventName}`;
        const feedbackFilePath = `${feedbackDir}/${feedbackFileName}`;
        
        // 尝试读取文件，如果文件存在则不是第一次执行
        try {
            await getFile(feedbackFilePath);
            return false; // 文件已存在，不是第一次执行
        } catch (err) {
            return true; // 文件不存在，是第一次执行
        }
    } catch (err) {
        // 出错时默认认为是第一次执行
        console.warn(`[checkIsFirstNodeExecution] 检查失败，默认认为是第一次执行:`, err);
        return true;
    }
}

/**
 * 检查是否是第一次执行该工作流（检查是否已有同名反馈文件）
 * @param {string} eventName - 事件名称
 * @param {string} eventTimestamp - 事件时间戳
 * @param {string} filePath - 文件路径
 * @param {string} workflowName - 工作流名称
 * @returns {Promise<boolean>} true表示是第一次执行，false表示不是第一次执行
 */
export async function checkIsFirstWorkflowExecution(eventName, eventTimestamp, filePath, workflowName) {
    try {
        const { getFile } = await import('../core/api.js');
        const timestampStr = eventTimestamp.replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
        // 文件名格式：时间戳_工作流名_事件名_工作流反馈.md
        const feedbackFileName = `${timestampStr}_${workflowName}_${eventName}_工作流反馈.md`;
        
        // 构建反馈文件路径
        const date = new Date(eventTimestamp);
        const yearMonth = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
        const day = String(date.getDate()).padStart(2, '0');
        const feedbackDir = `fankui_log/${yearMonth}/${day}/${workflowName}`;
        const feedbackFilePath = `${feedbackDir}/${feedbackFileName}`;
        
        // 尝试读取文件，如果文件存在则不是第一次执行
        try {
            await getFile(feedbackFilePath);
            return false; // 文件已存在，不是第一次执行
        } catch (err) {
            return true; // 文件不存在，是第一次执行
        }
    } catch (err) {
        // 出错时默认认为是第一次执行
        console.warn(`[checkIsFirstWorkflowExecution] 检查失败，默认认为是第一次执行:`, err);
        return true;
    }
}

/**
 * 处理反馈文件的关键字提取（异步，不阻塞主流程）
 */
async function processFeedbackFileForKeywords(filePath) {
    try {
        const { processFeedbackFile } = await import('./usage/keywordStats.js');
        await processFeedbackFile(filePath);
    } catch (err) {
        // 静默失败，不影响反馈生成
        console.warn(`[反馈系统] 关键字提取失败: ${filePath}`, err);
    }
}

/**
 * 获取反馈配置
 */
export function getFeedbackConfig() {
    return feedbackConfig;
}

/**
 * 设置工作流反馈提示词（兼容旧接口，设置默认工作流的提示词）
 */
export function setWorkflowFeedbackPrompt(promptName) {
    if (promptName) {
        feedbackConfig.workflowFeedbackPrompts['默认'] = promptName;
    } else {
        delete feedbackConfig.workflowFeedbackPrompts['默认'];
    }
}

/**
 * 设置特定工作流的反馈提示词
 */
export function setWorkflowFeedbackPromptForWorkflow(workflowName, promptName) {
    if (promptName) {
        feedbackConfig.workflowFeedbackPrompts[workflowName] = promptName;
    } else {
        delete feedbackConfig.workflowFeedbackPrompts[workflowName];
    }
}

/**
 * 获取特定工作流的反馈提示词
 */
export function getWorkflowFeedbackPrompt(workflowName) {
    return feedbackConfig.workflowFeedbackPrompts[workflowName] || null;
}

/**
 * 设置节点反馈提示词
 */
export function setNodeFeedbackPrompt(viewId, promptName) {
    if (promptName) {
        feedbackConfig.nodeFeedbackPrompts[viewId] = promptName;
    } else {
        delete feedbackConfig.nodeFeedbackPrompts[viewId];
    }
}

/**
 * 初始化永久发送配置面板
 */
export function initPermanentFeedbackPanel() {
    // 打开永久发送配置面板按钮
    const openBtn = document.getElementById('open-permanent-feedback-btn');
    const panel = document.getElementById('permanent-feedback-panel');
    const closeBtn = document.getElementById('close-permanent-feedback-panel');
    const saveBtn = document.getElementById('save-permanent-feedback-btn');
    const addViewBtn = document.getElementById('add-permanent-feedback-view-btn');
    
    if (openBtn && panel) {
        openBtn.addEventListener('click', () => {
            panel.style.display = 'flex';
            panel.focus();
            renderPermanentFeedbackConfig();
            
            // 在永久发送面板打开时，监听 Esc 关闭（返回反馈面板）
            const handleEsc = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    panel.style.display = 'none';
                    document.removeEventListener('keydown', handleEsc, true);
                }
            };
            // 使用捕获阶段，优先于全局快捷键处理
            document.addEventListener('keydown', handleEsc, true);
        });
    }
    
    if (closeBtn && panel) {
        closeBtn.addEventListener('click', () => {
            panel.style.display = 'none';
        });
    }
    
    if (saveBtn && !saveBtn._permanentFeedbackBound) {
        saveBtn._permanentFeedbackBound = true;
        saveBtn.addEventListener('click', async (e) => {
            e.stopPropagation(); // 阻止事件冒泡
            await savePermanentFeedbackConfig();
        });
    }
    
    if (addViewBtn) {
        addViewBtn.addEventListener('click', () => {
            addPermanentFeedbackView();
        });
    }
    
    if (addViewBtn) {
        addViewBtn.addEventListener('click', () => {
            addPermanentFeedbackView();
        });
    }
    
    // 点击面板外部关闭
    if (panel) {
        panel.addEventListener('click', (e) => {
            if (e.target === panel) {
                panel.style.display = 'none';
            }
        });
    }
}

/**
 * 渲染永久反馈配置列表
 */
function renderPermanentFeedbackConfig() {
    const configList = document.getElementById('permanent-feedback-config-list');
    if (!configList) return;
    
    configList.innerHTML = '';
    
    // 确保配置已加载（从localStorage重新加载最新配置）
    try {
        const saved = localStorage.getItem('feedbackConfig');
        if (saved) {
            const parsed = JSON.parse(saved);
            // 更新内存中的配置
            feedbackConfig.permanentFeedbacks = parsed.permanentFeedbacks || {};
        } else {
            feedbackConfig.permanentFeedbacks = feedbackConfig.permanentFeedbacks || {};
        }
    } catch (err) {
        console.warn('加载永久反馈配置失败:', err);
        feedbackConfig.permanentFeedbacks = feedbackConfig.permanentFeedbacks || {};
    }
    
    // 获取所有视图ID
    const viewIds = state.views.map(v => v.id);
    
    // 为每个已配置的视图ID创建配置项
    const configuredViewIds = Object.keys(feedbackConfig.permanentFeedbacks || {});
    const allViewIds = [...new Set([...viewIds, ...configuredViewIds])];
    
    if (allViewIds.length === 0) {
        configList.innerHTML = '<div style="padding: 12px; color: var(--text-muted); text-align: center;">暂无视图配置，点击"添加视图"开始配置</div>';
        return;
    }
    
    allViewIds.forEach(viewId => {
        const configItem = document.createElement('div');
        configItem.className = 'form-section';
        configItem.style.border = '1px solid var(--border)';
        configItem.style.padding = '16px';
        configItem.style.borderRadius = 'var(--border-radius)';
        configItem.style.marginBottom = '12px';
        
        const filePaths = feedbackConfig.permanentFeedbacks[viewId] || [];
        
        configItem.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <label class="form-label" style="margin: 0; font-weight: 600;">视图ID: ${viewId}</label>
            </div>
            <div style="margin-bottom: 12px;">
                <button class="btn btn-secondary btn-small" onclick="window.selectPermanentFeedbackFiles('${viewId}')" style="width: 100%;">
                    <span>📁</span>
                    <span>选择反馈文件</span>
                </button>
            </div>
            <div id="permanent-feedback-files-${viewId}" style="display: flex; flex-direction: column; gap: 8px;">
            </div>
        `;
        
        configList.appendChild(configItem);
        
        // 渲染已配置的文件列表（无论是否有文件都调用，让函数处理空列表）
        // 注意：renderPermanentFeedbackFiles 现在是异步函数，需要 await
        renderPermanentFeedbackFiles(viewId, filePaths).catch(err => {
            console.error(`[renderPermanentFeedbackConfig] 渲染永久反馈文件列表失败 (${viewId}):`, err);
        });
    });
}

/**
 * 渲染永久反馈文件列表（异步验证文件是否存在）
 */
async function renderPermanentFeedbackFiles(viewId, filePaths) {
    const container = document.getElementById(`permanent-feedback-files-${viewId}`);
    if (!container) return;
    
    container.innerHTML = '';
    
    if (!filePaths || filePaths.length === 0) {
        container.innerHTML = '<div style="padding: 8px; color: var(--text-muted); font-size: 12px; text-align: center;">暂无永久反馈文件</div>';
        return;
    }
    
    // 显示加载状态
    container.innerHTML = '<div style="padding: 8px; color: var(--text-muted); font-size: 12px; text-align: center;">正在验证文件...</div>';
    
    const { getFile } = await import('../core/api.js');
    const validFilePaths = [];
    const invalidFilePaths = [];
    
    // 并行验证所有文件是否存在
    const fileChecks = filePaths.map(async (filePath) => {
        // 排除 .deleted 文件
        if (filePath.endsWith('.deleted')) {
            console.warn(`[renderPermanentFeedbackFiles] 跳过 .deleted 文件: ${filePath}`);
            return { filePath, exists: false };
        }
        
        try {
            const content = await getFile(filePath);
            // 检查返回的内容是否是错误信息
            if (content && typeof content === 'string' && content.includes('"error": "File not found"')) {
                return { filePath, exists: false };
            }
            return { filePath, exists: true };
        } catch (err) {
            return { filePath, exists: false };
        }
    });
    
    const results = await Promise.all(fileChecks);
    
    // 分离有效和无效的文件
    results.forEach(result => {
        if (result.exists) {
            validFilePaths.push(result.filePath);
        } else {
            invalidFilePaths.push(result.filePath);
        }
    });
    
    // 如果有无效文件，自动从配置中移除并保存
    if (invalidFilePaths.length > 0) {
        console.warn(`[renderPermanentFeedbackFiles] 发现 ${invalidFilePaths.length} 个不存在的永久反馈文件，将从配置中移除:`, invalidFilePaths);
        
        // 更新配置，只保留有效文件
        const updatedFilePaths = validFilePaths;
        feedbackConfig.permanentFeedbacks[viewId] = updatedFilePaths;
        
        // 保存到localStorage
        try {
            const saved = localStorage.getItem('feedbackConfig');
            if (saved) {
                const parsed = JSON.parse(saved);
                parsed.permanentFeedbacks = feedbackConfig.permanentFeedbacks;
                localStorage.setItem('feedbackConfig', JSON.stringify(parsed));
            } else {
                localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
            }
        } catch (err) {
            console.warn('[renderPermanentFeedbackFiles] 保存配置失败:', err);
        }
        
        // 使用更新后的文件路径列表
        filePaths = updatedFilePaths;
    }
    
    // 清空容器，准备渲染
    container.innerHTML = '';
    
    // 如果有无效文件被移除，显示提示
    if (invalidFilePaths.length > 0) {
        const warningDiv = document.createElement('div');
        warningDiv.style.cssText = `
            padding: 8px 12px;
            background: var(--accent-yellow, #fff3cd);
            border: 1px solid var(--accent-yellow-dark, #ffc107);
            border-radius: var(--border-radius);
            margin-bottom: 8px;
            font-size: 12px;
            color: var(--text-primary);
        `;
        warningDiv.textContent = `已自动移除 ${invalidFilePaths.length} 个不存在的文件`;
        container.appendChild(warningDiv);
    }
    
    // 渲染有效文件列表
    if (filePaths.length === 0) {
        container.innerHTML = '<div style="padding: 8px; color: var(--text-muted); font-size: 12px; text-align: center;">暂无永久反馈文件</div>';
        return;
    }
    
    filePaths.forEach((filePath, index) => {
        const fileItem = document.createElement('div');
        fileItem.style.padding = '8px 12px';
        fileItem.style.background = 'var(--bg-secondary)';
        fileItem.style.border = '1px solid var(--border)';
        fileItem.style.borderRadius = 'var(--border-radius)';
        fileItem.style.display = 'flex';
        fileItem.style.justifyContent = 'space-between';
        fileItem.style.alignItems = 'center';
        
        const fileName = filePath.split(/[/\\]/).pop();
        
        // 转义viewId中的特殊字符，防止XSS和onclick错误
        const escapedViewId = viewId.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        
        fileItem.innerHTML = `
            <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 500; color: var(--text-primary); margin-bottom: 4px; word-break: break-all;">${fileName}</div>
                <div style="font-size: 11px; color: var(--text-muted); word-break: break-all;">${filePath}</div>
            </div>
            <button class="btn btn-small" data-view-id="${escapedViewId}" data-index="${index}" style="font-size: 12px; padding: 4px 8px; margin-left: 8px; flex-shrink: 0; cursor: pointer;">删除</button>
        `;
        
        // 使用事件委托，避免onclick字符串拼接问题
        const deleteBtn = fileItem.querySelector('button');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const btnViewId = deleteBtn.getAttribute('data-view-id');
            const btnIndex = parseInt(deleteBtn.getAttribute('data-index'), 10);
            removePermanentFeedbackFile(btnViewId, btnIndex);
        });
        
        container.appendChild(fileItem);
    });
}

/**
 * 添加永久反馈视图配置
 */
export function addPermanentFeedbackView() {
    const viewIdInput = prompt('请输入视图ID:');
    if (!viewIdInput || !viewIdInput.trim()) return;
    
    const viewId = viewIdInput.trim();
    if (!feedbackConfig.permanentFeedbacks[viewId]) {
        feedbackConfig.permanentFeedbacks[viewId] = [];
        renderPermanentFeedbackConfig();
    }
}

/**
 * 删除永久反馈视图配置
 */
export function removePermanentFeedbackView(viewId) {
    if (confirm(`确定要删除视图 "${viewId}" 的永久反馈配置吗？`)) {
        delete feedbackConfig.permanentFeedbacks[viewId];
        renderPermanentFeedbackConfig();
    }
}

/**
 * 选择永久反馈文件
 */
export async function selectPermanentFeedbackFiles(viewId) {
    // 打开文件选择对话框，让用户选择反馈文件
    // 这里我们使用一个简化的方式：让用户输入文件路径，或者从反馈列表中选择
    
    // 创建一个模态对话框来选择文件
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;
    
    const dialog = document.createElement('div');
    dialog.style.cssText = `
        background: var(--bg-primary);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        padding: 24px;
        max-width: 600px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
    `;
    
    dialog.innerHTML = `
        <h3 style="margin: 0 0 16px 0; color: var(--text-primary);">选择反馈文件（可多选）</h3>
        
        <!-- 筛选条件 -->
        <div style="margin-bottom: 16px; padding: 12px; background: var(--bg-secondary); border-radius: var(--border-radius); border: 1px solid var(--border);">
            <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 12px; font-size: 14px;">🔍 筛选条件</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
                <div>
                    <label style="display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">事件名称</label>
                    <select id="filter-event-name" class="form-input" style="width: 100%; font-size: 13px;">
                        <option value="">全部事件</option>
                    </select>
                </div>
                <div>
                    <label style="display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">视图ID</label>
                    <select id="filter-view-id" class="form-input" style="width: 100%; font-size: 13px;">
                        <option value="">全部视图</option>
                    </select>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
                <div>
                    <label style="display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">工作流名称</label>
                    <select id="filter-workflow-name" class="form-input" style="width: 100%; font-size: 13px;">
                        <option value="">全部工作流</option>
                    </select>
                </div>
                <div>
                    <label style="display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">文件类型</label>
                    <select id="filter-file-type" class="form-input" style="width: 100%; font-size: 13px;">
                        <option value="">全部类型</option>
                        <option value="node">节点反馈</option>
                        <option value="workflow">工作流反馈</option>
                    </select>
                </div>
            </div>
            <div style="display: flex; gap: 8px;">
                <button class="btn btn-primary btn-small" id="apply-filter" style="flex: 1; font-size: 12px;">应用筛选</button>
                <button class="btn btn-secondary btn-small" id="reset-filter" style="flex: 1; font-size: 12px;">重置</button>
            </div>
        </div>
        
        <!-- 手动输入路径 -->
        <div style="margin-bottom: 16px;">
            <input type="text" id="permanent-feedback-file-input" class="form-input" placeholder="例如: fankui_log/202512/22/辅助学习/xxx_反馈.md" style="width: 100%;">
            <button class="btn btn-secondary btn-small" id="add-manual-file" style="margin-top: 8px; width: 100%;">➕ 添加手动输入的路径</button>
        </div>
        
        <!-- 文件列表 -->
        <div style="margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="color: var(--text-muted); font-size: 13px;">已选择: <span id="selected-file-count">0</span> 个文件 | 共 <span id="total-file-count">0</span> 个文件</span>
                <button class="btn btn-small" id="select-all-files" style="font-size: 12px; padding: 4px 8px;">全选</button>
            </div>
            <div id="permanent-feedback-file-list" style="max-height: 400px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--border-radius); padding: 8px;"></div>
        </div>
        
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button class="btn btn-secondary" id="cancel-select-file">取消</button>
            <button class="btn btn-primary" id="confirm-select-file">确定</button>
        </div>
    `;
    
    modal.appendChild(dialog);
    document.body.appendChild(modal);
    
    // 动态填充筛选条件下拉框
    async function populateFilterDropdowns() {
        // 填充事件名称下拉框
        const eventSelect = document.getElementById('filter-event-name');
        if (eventSelect) {
            try {
                let events = state.events && state.events.length > 0 ? state.events : null;
                if (!events) {
                    const { getEvents } = await import('../core/api.js');
                    const data = await getEvents();
                    events = data.events || [];
                    state.events = events;
                }
                
                events.forEach(ev => {
                    const opt = document.createElement('option');
                    opt.value = ev.name;
                    opt.textContent = ev.name;
                    eventSelect.appendChild(opt);
                });
            } catch (err) {
                console.error('加载事件列表失败:', err);
            }
        }
        
        // 填充视图ID下拉框
        const viewIdSelect = document.getElementById('filter-view-id');
        if (viewIdSelect) {
            try {
                if (state.views && state.views.length > 0) {
                    state.views.forEach(view => {
                        const opt = document.createElement('option');
                        opt.value = view.id;
                        opt.textContent = view.id;
                        viewIdSelect.appendChild(opt);
                    });
                }
            } catch (err) {
                console.error('加载视图ID列表失败:', err);
            }
        }
        
        // 填充工作流名称下拉框
        const workflowSelect = document.getElementById('filter-workflow-name');
        if (workflowSelect) {
            try {
                if (!state.workflows || state.workflows.length === 0) {
                    const { loadWorkflows } = await import('./workflowManager.js');
                    await loadWorkflows();
                }
                
                if (state.workflows && state.workflows.length > 0) {
                    state.workflows.forEach(workflow => {
                        const opt = document.createElement('option');
                        opt.value = workflow.name;
                        opt.textContent = workflow.name;
                        workflowSelect.appendChild(opt);
                    });
                }
            } catch (err) {
                console.error('加载工作流列表失败:', err);
            }
        }
    }
    
    // 立即填充下拉框
    populateFilterDropdowns();
    
    // 获取当前已配置的文件路径（用于预选）
    const currentFilePaths = new Set(feedbackConfig.permanentFeedbacks[viewId] || []);
    const selectedFiles = new Set([...currentFilePaths]); // 初始选中已配置的文件
    
    // 存储所有文件数据（用于筛选）
    let allFeedbackFiles = [];
    
    // 更新选中数量显示
    function updateSelectedCount() {
        const countEl = document.getElementById('selected-file-count');
        if (countEl) {
            countEl.textContent = selectedFiles.size;
        }
    }
    
    // 渲染文件列表
    function renderFileList(files) {
        const fileList = document.getElementById('permanent-feedback-file-list');
        const totalCountEl = document.getElementById('total-file-count');
        
        if (totalCountEl) {
            totalCountEl.textContent = files.length;
        }
        
        fileList.innerHTML = '';
        
        if (files.length === 0) {
            fileList.innerHTML = '<div style="padding: 12px; color: var(--text-muted); text-align: center;">暂无反馈文件</div>';
            return;
        }
        
        files.forEach(file => {
            const item = document.createElement('div');
            const isSelected = selectedFiles.has(file.path);
            item.style.cssText = `
                padding: 10px 12px;
                cursor: pointer;
                border-radius: var(--border-radius);
                margin-bottom: 6px;
                border: 1px solid var(--border);
                background: ${isSelected ? 'var(--bg-secondary)' : 'var(--bg-primary)'};
                display: flex;
                align-items: flex-start;
                gap: 10px;
                transition: background-color 0.2s;
            `;
            
            item.onmouseenter = () => {
                if (!isSelected) {
                    item.style.background = 'var(--bg-secondary)';
                }
            };
            item.onmouseleave = () => {
                if (!selectedFiles.has(file.path)) {
                    item.style.background = 'var(--bg-primary)';
                }
            };
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = isSelected;
            checkbox.style.cursor = 'pointer';
            checkbox.style.marginTop = '2px';
            checkbox.style.flexShrink = '0';
            
            const content = document.createElement('div');
            content.style.flex = '1';
            content.style.minWidth = '0';
            
            // 格式化文件名中的时间戳
            const formattedFileName = formatFileNameTimestamp(file.name);
            
            // 提取文件类型标签
            const typeLabel = file.type === 'workflow' ? '工作流反馈' : '节点反馈';
            
            // 创建标签元素，使用CSS类动态获取颜色，完全避免硬编码
            // 关键：所有颜色都从主题系统动态获取，不写死任何值
            const typeTag = document.createElement('span');
            typeTag.textContent = typeLabel;
            typeTag.className = 'feedback-type-tag';
            
            if (file.type === 'workflow') {
                // 工作流反馈：背景色（动态获取success）+ 字体色（动态获取inverse-text）
                typeTag.classList.add('feedback-type-tag-workflow');
            } else {
                // 节点反馈：字体色（动态获取success）+ 背景色（动态获取surface-0）
                typeTag.classList.add('feedback-type-tag-node');
            }
            
            // 创建第一行容器
            const firstLine = document.createElement('div');
            firstLine.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;';
            firstLine.appendChild(typeTag);
            
            const fileNameDiv = document.createElement('div');
            fileNameDiv.style.cssText = 'font-weight: 500; color: var(--text-primary); flex: 1; word-break: break-all;';
            fileNameDiv.textContent = formattedFileName;
            firstLine.appendChild(fileNameDiv);
            
            // 创建路径行
            const pathLine = document.createElement('div');
            pathLine.style.cssText = 'font-size: 11px; color: var(--text-muted); word-break: break-all; line-height: 1.4;';
            pathLine.textContent = file.path;
            
            // 组装内容
            content.appendChild(firstLine);
            content.appendChild(pathLine);
            
            item.appendChild(checkbox);
            item.appendChild(content);
            
            // 点击整个项目切换选中状态
            const toggleSelection = () => {
                if (selectedFiles.has(file.path)) {
                    selectedFiles.delete(file.path);
                    checkbox.checked = false;
                    item.style.background = 'var(--bg-primary)';
                } else {
                    selectedFiles.add(file.path);
                    checkbox.checked = true;
                    item.style.background = 'var(--bg-secondary)';
                }
                updateSelectedCount();
            };
            
            checkbox.onchange = toggleSelection;
            content.onclick = toggleSelection;
            item.onclick = (e) => {
                if (e.target !== checkbox && e.target !== content && !content.contains(e.target)) {
                    toggleSelection();
                }
            };
            
            fileList.appendChild(item);
        });
        
        updateSelectedCount();
    }
    
    // 应用筛选
    async function applyFilter() {
        const eventName = document.getElementById('filter-event-name').value.trim();
        const viewId = document.getElementById('filter-view-id').value.trim();
        const workflowName = document.getElementById('filter-workflow-name').value.trim();
        const fileType = document.getElementById('filter-file-type').value;
        
        try {
            const filteredFiles = await scanFeedbackFiles(eventName || '', viewId || '', workflowName || '', null, 0, 0);
            
            // 如果指定了文件类型，进一步筛选
            let finalFiles = filteredFiles;
            if (fileType) {
                finalFiles = filteredFiles.filter(f => f.type === fileType);
            }
            
            allFeedbackFiles = finalFiles;
            renderFileList(finalFiles);
        } catch (err) {
            console.error('筛选反馈文件失败:', err);
            const fileList = document.getElementById('permanent-feedback-file-list');
            fileList.innerHTML = '<div style="padding: 12px; color: var(--accent-red);">筛选失败: ' + err.message + '</div>';
        }
    }
    
    // 重置筛选
    function resetFilter() {
        document.getElementById('filter-event-name').value = '';
        document.getElementById('filter-view-id').value = '';
        document.getElementById('filter-workflow-name').value = '';
        document.getElementById('filter-file-type').value = '';
        applyFilter();
    }
    
    // 加载反馈文件列表
    const fileList = document.getElementById('permanent-feedback-file-list');
    try {
        allFeedbackFiles = await scanFeedbackFiles('', '', '', null, 0, 0);
        renderFileList(allFeedbackFiles);
    } catch (err) {
        console.error('加载反馈文件列表失败:', err);
        fileList.innerHTML = '<div style="padding: 12px; color: var(--accent-red);">加载失败: ' + err.message + '</div>';
    }
    
    // 绑定筛选事件
    document.getElementById('apply-filter').onclick = applyFilter;
    document.getElementById('reset-filter').onclick = resetFilter;
    
    // 绑定事件
    document.getElementById('cancel-select-file').onclick = () => {
        document.body.removeChild(modal);
    };
    
    // 全选/取消全选
    const selectAllBtn = document.getElementById('select-all-files');
    let isAllSelected = false;
    selectAllBtn.onclick = () => {
        const fileList = document.getElementById('permanent-feedback-file-list');
        const checkboxes = fileList.querySelectorAll('input[type="checkbox"]');
        isAllSelected = !isAllSelected;
        
        // 获取当前显示的文件列表（筛选后的）
        const currentDisplayedFiles = Array.from(fileList.querySelectorAll('div[style*="padding"]')).map(item => {
            const filePathEl = item.querySelector('div[style*="word-break"]');
            return filePathEl ? filePathEl.textContent.trim() : null;
        }).filter(path => path);
        
        checkboxes.forEach((checkbox, index) => {
            const item = checkbox.closest('div[style*="padding"]');
            if (item && currentDisplayedFiles[index]) {
                const filePath = currentDisplayedFiles[index];
                if (isAllSelected) {
                    selectedFiles.add(filePath);
                    checkbox.checked = true;
                    item.style.background = 'var(--bg-secondary)';
                } else {
                    selectedFiles.delete(filePath);
                    checkbox.checked = false;
                    item.style.background = 'var(--bg-primary)';
                }
            }
        });
        updateSelectedCount();
        selectAllBtn.textContent = isAllSelected ? '取消全选' : '全选';
    };
    
    // 添加手动输入的路径
    document.getElementById('add-manual-file').onclick = () => {
        const filePath = document.getElementById('permanent-feedback-file-input').value.trim();
        if (filePath) {
            selectedFiles.add(filePath);
            document.getElementById('permanent-feedback-file-input').value = '';
            updateSelectedCount();
            alert('已添加到选择列表，请点击"确定"保存');
        } else {
            alert('请输入文件路径');
        }
    };
    
    // 确定按钮：保存所有选中的文件
    document.getElementById('confirm-select-file').onclick = () => {
        // 确保配置对象存在
        if (!feedbackConfig.permanentFeedbacks) {
            feedbackConfig.permanentFeedbacks = {};
        }
        if (!feedbackConfig.permanentFeedbacks[viewId]) {
            feedbackConfig.permanentFeedbacks[viewId] = [];
        }
        
        // 更新配置：使用选中的文件列表
        feedbackConfig.permanentFeedbacks[viewId] = Array.from(selectedFiles);
        
        // 立即保存到localStorage
        try {
            localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
            console.log(`[永久反馈配置] 已保存视图 ${viewId} 的 ${selectedFiles.size} 个文件`);
        } catch (err) {
            console.error('[永久反馈配置] 保存失败:', err);
            alert('保存失败: ' + err.message);
            document.body.removeChild(modal);
            return;
        }
        
        // 重新渲染配置列表
        renderPermanentFeedbackConfig();
        
        // 关闭对话框
        document.body.removeChild(modal);
    };
    
    // 点击外部关闭
    modal.onclick = (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    };
}

/**
 * 删除永久反馈文件
 */
/**
 * 初始化全屏反馈配置面板
 */
export function initFeedbackConfigFullscreenPanel() {
    const panel = document.getElementById('feedback-config-fullscreen-panel');
    const openBtn = document.getElementById('open-feedback-config-fullscreen-btn');
    const closeBtn = document.getElementById('close-feedback-config-fullscreen-btn');
    const saveBtn = document.getElementById('save-feedback-config-fullscreen-btn');
    const navButtons = document.querySelectorAll('.feedback-config-nav-btn');
    const contentAreas = document.querySelectorAll('.feedback-config-content');
    
    if (!panel) return;
    
    // 打开面板
    if (openBtn) {
        openBtn.addEventListener('click', async () => {
            panel.classList.add('show');
            panel.focus();
            // 加载配置内容
            await renderFeedbackConfigFullscreen();
        });
    }
    
    // 关闭面板
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            panel.classList.remove('show');
        });
    }
    
    // 导航栏切换
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');
            
            // 更新按钮状态
            navButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // 更新内容区域
            contentAreas.forEach(area => {
                area.classList.remove('active');
            });
            
            const targetContent = document.getElementById(`feedback-config-${tab}-content`);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        });
    });
    
    // 保存配置
    if (saveBtn && !saveBtn._fullscreenBound) {
        saveBtn._fullscreenBound = true;
        saveBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await saveFeedbackConfig();
        });
    }
    
    // ESC键关闭
    const handleEsc = (e) => {
        if (e.key === 'Escape' && panel.classList.contains('show')) {
            panel.classList.remove('show');
        }
    };
    document.addEventListener('keydown', handleEsc);
}

/**
 * 渲染全屏反馈配置面板内容
 */
export async function renderFeedbackConfigFullscreen() {
    // 加载提示词列表
    await loadPrompts();
    
    // 加载工作流列表
    try {
        const { loadWorkflows } = await import('./workflowManager.js');
        await loadWorkflows();
    } catch (err) {
        console.warn('加载工作流列表失败:', err);
    }
    
    // 渲染反馈数量配置
    const feedbackCountInput = document.getElementById('feedback-count-input-fullscreen');
    if (feedbackCountInput) {
        feedbackCountInput.value = feedbackConfig.feedbackCount || 3;
        feedbackCountInput.addEventListener('change', (e) => {
            const count = parseInt(e.target.value);
            if (isNaN(count) || count < 0) {
                e.target.value = 0;
                feedbackConfig.feedbackCount = 0;
            } else {
                feedbackConfig.feedbackCount = count;
            }
            // 同步到原面板（如果存在）
            const originalInput = document.getElementById('feedback-count-input');
            if (originalInput) {
                originalInput.value = feedbackConfig.feedbackCount;
            }
            // 立即保存
            try {
                localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
            } catch (err) {
                console.warn('实时保存反馈配置失败:', err);
            }
        });
    }
    
    const workflowFeedbackCountInput = document.getElementById('workflow-feedback-count-input-fullscreen');
    if (workflowFeedbackCountInput) {
        const displayValue = feedbackConfig.workflowFeedbackCount !== undefined 
            ? feedbackConfig.workflowFeedbackCount 
            : (feedbackConfig.feedbackCount || 3);
        workflowFeedbackCountInput.value = displayValue;
        workflowFeedbackCountInput.addEventListener('change', (e) => {
            const count = parseInt(e.target.value);
            if (isNaN(count) || count < 0) {
                e.target.value = 0;
                feedbackConfig.workflowFeedbackCount = 0;
            } else {
                feedbackConfig.workflowFeedbackCount = count;
            }
            // 同步到原面板（如果存在）
            const originalInput = document.getElementById('workflow-feedback-count-input');
            if (originalInput) {
                originalInput.value = feedbackConfig.workflowFeedbackCount;
            }
            // 立即保存
            try {
                localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
            } catch (err) {
                console.warn('实时保存反馈配置失败:', err);
            }
        });
    }
    
    // 渲染工作流反馈配置列表
    renderWorkflowFeedbackConfigListFullscreen();
    
    // 渲染节点反馈配置列表
    renderNodeFeedbackConfigListFullscreen();
}

/**
 * 渲染工作流反馈配置列表（全屏面板）
 */
function renderWorkflowFeedbackConfigListFullscreen() {
    const listEl = document.getElementById('workflow-feedback-config-list-fullscreen');
    if (!listEl) return;
    
    // 清空列表
    listEl.innerHTML = '';
    
    // 获取工作流列表
    const workflows = state.workflows || [];
    
    if (workflows.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.textContent = '暂无工作流，请先创建工作流';
        emptyMsg.style.cssText = 'padding: 20px; text-align: center; color: var(--text-muted);';
        listEl.appendChild(emptyMsg);
        return;
    }
    
    workflows.forEach(workflow => {
        const workflowName = workflow.name;
        const currentPrompt = feedbackConfig.workflowFeedbackPrompts?.[workflowName] || '';
        
        const item = document.createElement('div');
        item.style.cssText = 'margin-bottom: 12px; padding: 12px; background: var(--surface-2); border-radius: var(--border-radius); border: 1px solid var(--border-subtle);';
        
        const label = document.createElement('label');
        label.className = 'form-label';
        label.textContent = `工作流: ${workflowName}`;
        label.style.cssText = 'display: block; margin-bottom: 8px;';
        
        const select = document.createElement('select');
        select.className = 'form-select';
        select.style.cssText = 'width: 100%;';
        
        // 添加空选项
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = '未配置';
        select.appendChild(emptyOpt);
        
        // 添加提示词选项
        (state.prompts || []).forEach(prompt => {
            const opt = document.createElement('option');
            opt.value = prompt.name;
            opt.textContent = prompt.name;
            if (prompt.name === currentPrompt) {
                opt.selected = true;
            }
            select.appendChild(opt);
        });
        
        select.addEventListener('change', (e) => {
            const promptName = e.target.value;
            setWorkflowFeedbackPromptForWorkflow(workflowName, promptName);
            // 同步到原面板
            renderWorkflowFeedbackConfigList();
            // 立即保存
            try {
                localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
            } catch (err) {
                console.warn('实时保存反馈配置失败:', err);
            }
        });
        
        item.appendChild(label);
        item.appendChild(select);
        listEl.appendChild(item);
    });
}

/**
 * 渲染节点反馈配置列表（全屏面板）
 */
function renderNodeFeedbackConfigListFullscreen() {
    const listEl = document.getElementById('node-feedback-config-list-fullscreen');
    if (!listEl) return;
    
    // 清空列表
    listEl.innerHTML = '';
    
    // 获取视图列表
    const views = state.views || [];
    
    if (views.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.textContent = '暂无视图，请先创建视图';
        emptyMsg.style.cssText = 'padding: 20px; text-align: center; color: var(--text-muted);';
        listEl.appendChild(emptyMsg);
        return;
    }
    
    views.forEach(view => {
        const viewId = view.id;
        const currentPrompt = feedbackConfig.nodeFeedbackPrompts?.[viewId] || '';
        
        const item = document.createElement('div');
        item.style.cssText = 'margin-bottom: 12px; padding: 12px; background: var(--surface-2); border-radius: var(--border-radius); border: 1px solid var(--border-subtle);';
        
        const label = document.createElement('label');
        label.className = 'form-label';
        label.textContent = `视图ID: ${viewId}`;
        label.style.cssText = 'display: block; margin-bottom: 8px;';
        
        const select = document.createElement('select');
        select.className = 'form-select';
        select.style.cssText = 'width: 100%;';
        
        // 添加空选项
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = '未配置';
        select.appendChild(emptyOpt);
        
        // 添加提示词选项
        (state.prompts || []).forEach(prompt => {
            const opt = document.createElement('option');
            opt.value = prompt.name;
            opt.textContent = prompt.name;
            if (prompt.name === currentPrompt) {
                opt.selected = true;
            }
            select.appendChild(opt);
        });
        
        select.addEventListener('change', (e) => {
            const promptName = e.target.value;
            setNodeFeedbackPrompt(viewId, promptName);
            // 同步到原面板
            renderNodeFeedbackConfigList();
            // 立即保存
            try {
                localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
            } catch (err) {
                console.warn('实时保存反馈配置失败:', err);
            }
        });
        
        item.appendChild(label);
        item.appendChild(select);
        listEl.appendChild(item);
    });
}

export function removePermanentFeedbackFile(viewId, index) {
    if (feedbackConfig.permanentFeedbacks && feedbackConfig.permanentFeedbacks[viewId]) {
        feedbackConfig.permanentFeedbacks[viewId].splice(index, 1);
        if (feedbackConfig.permanentFeedbacks[viewId].length === 0) {
            delete feedbackConfig.permanentFeedbacks[viewId];
        }
        
        // 立即保存到localStorage
        try {
            const saved = localStorage.getItem('feedbackConfig');
            if (saved) {
                const parsed = JSON.parse(saved);
                parsed.permanentFeedbacks = feedbackConfig.permanentFeedbacks;
                localStorage.setItem('feedbackConfig', JSON.stringify(parsed));
            } else {
                localStorage.setItem('feedbackConfig', JSON.stringify(feedbackConfig));
            }
        } catch (err) {
            console.error('[删除永久反馈文件] 保存失败:', err);
        }
        
        // 重新渲染配置列表
        renderPermanentFeedbackConfig();
    }
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.loadFeedbackConfig = loadFeedbackConfig;
    window.saveFeedbackConfig = saveFeedbackConfig;
    window.renderFeedbackConfig = renderFeedbackConfig;
    window.initFeedbackPanelControls = initFeedbackPanelControls;
    window.initFeedbackPanelControls = initFeedbackPanelControls;
    window.addNodeFeedbackConfig = addNodeFeedbackConfig;
    window.removeNodeFeedbackConfig = removeNodeFeedbackConfig;
    window.viewFeedbackFiles = viewFeedbackFiles;
    window.generateWorkflowFeedback = generateWorkflowFeedback;
    window.generateNodeFeedback = generateNodeFeedback;
    window.getFeedbackConfig = getFeedbackConfig;
    window.setWorkflowFeedbackPrompt = setWorkflowFeedbackPrompt;
    window.setWorkflowFeedbackPromptForWorkflow = setWorkflowFeedbackPromptForWorkflow;
    window.getWorkflowFeedbackPrompt = getWorkflowFeedbackPrompt;
    window.addWorkflowFeedbackConfig = addWorkflowFeedbackConfig;
    window.removeWorkflowFeedbackConfig = removeWorkflowFeedbackConfig;
    window.setNodeFeedbackPrompt = setNodeFeedbackPrompt;
    window.readRecentNodeFeedbacks = readRecentNodeFeedbacks;
    window.checkIsFirstNodeExecution = checkIsFirstNodeExecution;
    window.checkIsFirstWorkflowExecution = checkIsFirstWorkflowExecution;
    window.initPermanentFeedbackPanel = initPermanentFeedbackPanel;
    window.addPermanentFeedbackView = addPermanentFeedbackView;
    window.removePermanentFeedbackView = removePermanentFeedbackView;
    window.selectPermanentFeedbackFiles = selectPermanentFeedbackFiles;
    window.removePermanentFeedbackFile = removePermanentFeedbackFile;
    window.savePermanentFeedbackConfig = savePermanentFeedbackConfig;
    window.initFeedbackConfigFullscreenPanel = initFeedbackConfigFullscreenPanel;
    window.renderFeedbackConfigFullscreen = renderFeedbackConfigFullscreen;
}

