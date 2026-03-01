/**
 * 事件管理模块
 * 负责事件的创建、编辑和执行
 */

import { state, saveStateToStorage } from '../core/state.js';
import { getEvents, getEvent, saveEvent as saveEventAPI, deleteEvent, getPrompt } from '../core/api.js';
import { executeWorkflow } from './workflowManager.js';
import { readCurrentView, writeCurrentView, loadFileContentToState } from './editor.js';
import { getFile, saveFile } from '../core/api.js';
import { getFileInFolderPath, getAllFilesInDirectory } from '../utils/fileUtils.js';
import { logEventExecution } from './logManager.js';
import { formatFeedbackContent } from '../utils/promptFormatter.js';

/**
 * 加载事件列表
 */
export async function loadEvents() {
    try {
        const data = await getEvents();
        state.events = data.events || [];
        renderEventsList();
    } catch (err) {
        console.error('Failed to load events:', err);
        state.events = [];
    }
}

/**
 * 渲染事件列表
 */
export function renderEventsList(searchTerm = '') {
    const list = document.getElementById('events-list');
    if (!list) return;

    list.innerHTML = '';
    state.eventItems = [];
    state.selectedEventIndex = -1;

    const filteredEvents = state.events.filter(event =>
        !searchTerm ||
        event.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (filteredEvents.length === 0) {
        list.innerHTML = '<div style="color: var(--text-muted); font-style: italic; padding: 10px;">没有找到匹配的事件</div>';
        return;
    }

    filteredEvents.forEach((event, index) => {
        const item = document.createElement('div');
        item.className = 'event-item';
        item.innerHTML = `
            <div class="file-item type-file event-list-item" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; margin-bottom: 6px; cursor: pointer; position: relative;" onclick="window.selectEvent('${event.name}')">
                <div style="flex: 1; min-width: 0; text-align: left;">
                    <div class="event-name-display" style="font-weight: bold; color: var(--accent-blue); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 60px;">${event.name}</div>
                    <div style="font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-left: 2em;">&nbsp;&nbsp;工作流: ${event.workflowName || '无'}</div>
                </div>
                <div style="display: flex; gap: 5px; position: absolute; right: 14px; transition: opacity 0.3s; opacity: 0;" class="event-actions">
                    <button class="btn" onclick="event.stopPropagation(); window.editEvent('${event.name}')" style="font-size: 12px; padding: 4px 8px;">编辑</button>
                    <button class="btn" onclick="event.stopPropagation(); window.removeEvent('${event.name}')" style="font-size: 12px; padding: 4px 8px;">删除</button>
                </div>
            </div>
        `;
        list.appendChild(item);

        // 保存事件项引用
        const eventItemEl = item.querySelector('.event-list-item');
        state.eventItems.push({
            el: eventItemEl,
            name: event.name
        });

        // 添加悬停效果
        const actions = item.querySelector('.event-actions');
        item.addEventListener('mouseenter', () => {
            if (actions) actions.style.opacity = '1';
        });
        item.addEventListener('mouseleave', () => {
            if (actions) actions.style.opacity = '0';
        });
    });
}

/**
 * 移动事件列表选择
 * @param {number} step - 移动步数（-1 向上，1 向下）
 */
export async function moveEventSelection(step) {
    if (state.eventItems.length === 0) return;
    
    let newIndex = state.selectedEventIndex + step;
    if (newIndex < 0) newIndex = state.eventItems.length - 1;
    if (newIndex >= state.eventItems.length) newIndex = 0;
    
    state.selectedEventIndex = newIndex;
    
    // 移除所有选中状态
    state.eventItems.forEach(item => {
        item.el.classList.remove('selected');
    });
    
    // 添加选中状态
    const selectedItem = state.eventItems[newIndex];
    if (selectedItem) {
        selectedItem.el.classList.add('selected');
        selectedItem.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        
        // 自动执行enter键的功能（选择当前事件）
        if (window.selectCurrentEvent) {
            await window.selectCurrentEvent();
        }
    }
}

/**
 * 选择当前选中的事件
 */
export async function selectCurrentEvent() {
    if (state.selectedEventIndex >= 0 && state.selectedEventIndex < state.eventItems.length) {
        const selectedItem = state.eventItems[state.selectedEventIndex];
        if (selectedItem && window.selectEvent) {
            // 直接调用selectEvent，相当于用户点击该事件
            await window.selectEvent(selectedItem.name);
        }
    }
}

/**
 * 合并事件执行的所有步骤文件
 * @param {string} eventName - 事件名称
 * @param {string} timestamp - 事件执行时间戳
 * @param {Array} executedSteps - 已执行的步骤列表
 * @param {boolean} sequential - 是否为顺序执行
 * @param {string} filePath - 目标文件路径（批量执行时使用，如果未提供则从全局状态读取）
 * @returns {Promise<string>} 合并后的文件路径
 */
async function mergeEventStepFiles(eventName, timestamp, executedSteps, sequential, filePath = null) {
    // 优先使用传入的filePath参数（批量执行时使用），如果没有则从全局状态读取
    // 这样可以避免在批量并发执行时读取到错误的文件路径
    const targetFilePath = filePath || 
                          state.workflowExecutionState?.batchFilePath || 
                          state.originalPath;
    
    if (!targetFilePath) {
        throw new Error('请先选择文件');
    }
    
    // 解析原文件路径
    const lastSeparatorIndex = Math.max(targetFilePath.lastIndexOf('\\'), targetFilePath.lastIndexOf('/'));
    const fileName = lastSeparatorIndex >= 0 ? targetFilePath.substring(lastSeparatorIndex + 1) : targetFilePath;
    const lastDotIndex = fileName.lastIndexOf('.');
    const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
    const ext = lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1) : '';
    
    // 合并文件名：执行项目路径:显示的文件
    const mergedFileName = `${eventName}:${fileName}`;
    const mergedFilePath = getFileInFolderPath(targetFilePath, mergedFileName);
    
    // 调试日志：记录使用的文件路径
    if (filePath || state.workflowExecutionState?.batchFilePath) {
        console.log(`[mergeEventStepFiles] 批量执行模式，使用文件路径: ${targetFilePath}`);
    }
    
    // 检查合并文件是否已存在
    let existingContent = '';
    let hasOriginalFile = false;
    const existingStepIndices = new Set();
    
    try {
        existingContent = await getFile(mergedFilePath);
        // 检查是否已有原文件部分
        if (existingContent.includes('原文件：')) {
            hasOriginalFile = true;
        }
        
        // 提取已有的步骤索引
        const stepPattern = new RegExp(`${eventName}\\+(\\d+)：`, 'g');
        let match;
        while ((match = stepPattern.exec(existingContent)) !== null) {
            existingStepIndices.add(parseInt(match[1], 10));
        }
    } catch (error) {
        // 文件不存在，这是第一次合并
        existingContent = '';
    }
    
    let mergedContent = existingContent;
    
    // 如果还没有原文件部分，添加原文件内容
    if (!hasOriginalFile) {
        try {
            const originalContent = await getFile(targetFilePath);
            mergedContent += `原文件：\n${originalContent}\n\n`;
        } catch (error) {
            console.warn('读取原文件失败:', error);
            mergedContent += `原文件：\n（无法读取原文件内容）\n\n`;
        }
    }
    
    // 按步骤顺序合并内容
    // 如果是顺序执行，executedSteps已经按顺序排列
    // 如果是并发执行，需要按stepIndex排序
    const sortedSteps = sequential 
        ? executedSteps 
        : executedSteps.sort((a, b) => (a.stepIndex || 0) - (b.stepIndex || 0));
    
    for (let i = 0; i < sortedSteps.length; i++) {
        const step = sortedSteps[i];
        const stepIndex = step.stepIndex || (i + 1);
        
        // 如果这个步骤已经存在，跳过
        if (existingStepIndices.has(stepIndex)) {
            continue;
        }
        
        // 读取步骤文件内容
        if (step.stepFilePath) {
            try {
                const stepContent = await getFile(step.stepFilePath);
                // 提取实际内容（去掉时间戳和视图ID头部）
                const contentLines = stepContent.split('\n');
                const contentStartIndex = contentLines.findIndex(line => line.trim() === '') + 1;
                const actualContent = contentLines.slice(contentStartIndex).join('\n');
                
                mergedContent += `${eventName}+${stepIndex}：\n${actualContent}\n\n`;
            } catch (error) {
                // 如果文件不存在，创建新文件并使用step.content作为内容
                if (error.message && error.message.includes('ENOENT')) {
                    try {
                        const { saveFile } = await import('../core/api.js');
                        const contentToWrite = step.content || '（无内容）';
                        await saveFile(step.stepFilePath, contentToWrite);
                        console.log(`[mergeEventStepFiles] 步骤文件不存在，已创建: ${step.stepFilePath}`);
                        mergedContent += `${eventName}+${stepIndex}：\n${contentToWrite}\n\n`;
                    } catch (createError) {
                        console.warn(`创建步骤${stepIndex}文件失败:`, createError);
                        mergedContent += `${eventName}+${stepIndex}：\n${step.content || '（无法创建步骤文件）'}\n\n`;
                    }
                } else {
                    console.warn(`读取步骤${stepIndex}文件失败:`, error);
                    mergedContent += `${eventName}+${stepIndex}：\n${step.content || '（无法读取步骤文件内容）'}\n\n`;
                }
            }
        } else {
            // 如果没有步骤文件，使用content
            mergedContent += `${eventName}+${stepIndex}：\n${step.content || '（无内容）'}\n\n`;
        }
    }
    
    // 保存合并文件
    try {
        await saveFile(mergedFilePath, mergedContent);
        return mergedFilePath;
    } catch (error) {
        console.error('保存合并文件失败:', error);
        throw new Error('保存合并文件失败: ' + error.message);
    }
}

/**
 * 执行事件（支持单文件和目录执行）
 * @param {string} eventName - 事件名称
 * @param {object} options - 执行选项 {concurrency: number, sequential: boolean, useStream: boolean, targetPath: string}
 * @param {string} options.targetPath - 目标路径（文件或目录），如果未提供则使用state.originalPath或state.currentFileItem
 */
export async function executeEvent(eventName, options = {}) {
    try {
        const event = await getEvent(eventName);
        if (!event.workflowName) {
            throw new Error('事件未关联工作流');
        }
        
        // 确定目标路径：如果options中有targetPath（批量执行时传入），优先使用它，忽略事件的projectPath
        // 否则优先使用事件配置的projectPath（目录），然后使用state.originalPath或state.currentFileItem
        let targetPath = null;
        let isDirectory = false;
        
        // 如果options中有明确的targetPath（批量执行时会传入文件路径），直接使用它，忽略事件的projectPath
        if (options.targetPath) {
            targetPath = options.targetPath;
            // 检查路径是文件还是目录
            try {
                const { getDirectory } = await import('../core/api.js');
                await getDirectory(targetPath);
                isDirectory = true;
            } catch (err) {
                // 如果getDirectory失败，可能是文件
                isDirectory = false;
            }
        } else if (event.projectPath && event.projectPath.trim()) {
            // 优先使用事件配置的目录路径（非批量执行时）
            targetPath = event.projectPath.trim();
            // 配置的路径通常是目录
            isDirectory = true;
        } else {
            // 如果没有配置目录，使用当前选中的文件/目录
            targetPath = state.originalPath;
            
            // 如果没有targetPath，检查当前选中的是文件还是目录
            if (!targetPath && state.currentFileItem) {
                targetPath = state.currentFileItem.path;
                isDirectory = state.currentFileItem.isDir || false;
            } else if (targetPath) {
                // 检查路径是文件还是目录
                try {
                    const { getDirectory } = await import('../core/api.js');
                    await getDirectory(targetPath);
                    isDirectory = true;
                } catch (err) {
                    // 如果getDirectory失败，可能是文件
                    isDirectory = false;
                }
            }
        }
        
        if (!targetPath) {
            throw new Error('请先选择文件或目录，或在事件配置中设置执行目录');
        }
        
        // 如果是目录，获取目录下所有文件
        let filesToProcess = [];
        if (isDirectory) {
            // 执行前提示用户确认目录
            const confirmMessage = `当前将要执行的目录：\n${targetPath}\n\n确认执行？`;
            const confirmed = confirm(confirmMessage);
            if (!confirmed) {
                return {
                    success: false,
                    cancelled: true,
                    eventName: eventName
                };
            }
            
            // 选择并发或顺序执行
            const executionMode = confirm(`是否使用并发执行模式？\n\n点击"确定"使用并发执行（更快，但可能消耗更多资源）\n点击"取消"使用顺序执行（较慢，但更稳定）`);
            options.concurrency = executionMode ? 3 : 1;
            options.sequential = !executionMode;
            
            // 获取目录下所有文件
            filesToProcess = await getAllFilesInDirectory(targetPath);
            
            if (filesToProcess.length === 0) {
                alert('目录下没有找到可处理的文件（仅处理.md和.txt文件）');
                return {
                    success: false,
                    eventName: eventName,
                    message: '目录下没有找到可处理的文件'
                };
            }
        } else {
            // 单文件执行
            filesToProcess = [targetPath];
        }
        
        // 生成事件执行时间戳
        const eventTimestamp = new Date().toISOString();
        
        // 存储所有文件的执行结果
        const allResults = [];
        const allSummaries = [];
        
        // 对每个文件执行工作流
        if (isDirectory && options.sequential) {
            // 顺序执行：逐个文件处理
            for (let i = 0; i < filesToProcess.length; i++) {
                const filePath = filesToProcess[i];
                const fileIndex = i + 1;
                
                // 注意：不在这里更新workflowExecutionState，因为executeEventForFile会清除并创建新的状态
                // 状态显示由executeEventForFile内部的工作流执行状态管理
                
                const result = await executeEventForFile(eventName, event, filePath, eventTimestamp, options);
                allResults.push(result);
                if (result.summary) {
                    allSummaries.push(result.summary);
                }
            }
        } else {
            // 并发执行：并行处理所有文件
            const filePromises = filesToProcess.map((filePath, index) => {
                return executeEventForFile(eventName, event, filePath, eventTimestamp, {
                    ...options,
                    fileIndex: index + 1,
                    totalFiles: filesToProcess.length
                });
            });
            
            const results = await Promise.all(filePromises);
            allResults.push(...results);
            results.forEach(result => {
                if (result.summary) {
                    allSummaries.push(result.summary);
                }
            });
        }
        
        // 生成汇总信息
        const totalSteps = allSummaries.reduce((sum, s) => sum + (s.totalSteps || 0), 0);
        const totalFiles = filesToProcess.length;
        
        const summary = {
            timestamp: eventTimestamp,
            event: eventName,
            workflow: event.workflowName,
            totalFiles: totalFiles,
            totalSteps: totalSteps,
            isDirectory: isDirectory,
            directoryPath: isDirectory ? targetPath : null,
            files: allSummaries
        };
        
        // 记录事件执行日志（目录执行时记录汇总信息）
        const viewId = event.viewId || (state.views.length > 0 ? state.views[0].id : null);
        const workflowName = event.workflowName;
        logEventExecution(eventName, workflowName, eventTimestamp, {
            viewId: viewId,
            isDirectory: isDirectory,
            directoryPath: isDirectory ? targetPath : null,
            totalFiles: totalFiles,
            totalSteps: totalSteps,
            files: allSummaries
        }).catch(err => console.error('记录事件日志失败:', err));
        
        return {
            success: true,
            eventName: eventName,
            isDirectory: isDirectory,
            totalFiles: totalFiles,
            totalSteps: totalSteps,
            results: allResults,
            summary: summary
        };
    } catch (err) {
        if (err.message && err.message.includes('workflowName is not defined')) {
            console.error('执行事件失败:', err);
            console.error('错误详情: workflowName is not defined');
            console.trace('调用堆栈:');
            return {
                success: false,
                eventName: eventName,
                workflowResult: null,
                summary: null,
                mergedFilePath: null
            };
        } else {
            console.error('执行事件失败:', err);
            throw err;
        }
    }
}

/**
 * 对单个文件执行事件
 * @param {string} eventName - 事件名称
 * @param {object} event - 事件对象
 * @param {string} filePath - 文件路径
 * @param {string} eventTimestamp - 事件时间戳
 * @param {object} options - 执行选项
 * @returns {Promise<object>} 执行结果
 */
export async function executeEventForFile(eventName, event, filePath, eventTimestamp, options = {}) {
    console.log(`[executeEventForFile] 开始执行文件: ${filePath}`);
    
    // 保存原始路径和相关状态的完整快照
    // 使用深拷贝，确保每个文件执行时都有独立的状态环境
    // 关键：在并发执行时，需要保存当前的 workflowExecutionState，执行完成后恢复
    // 这样可以避免多个文件同时执行时相互覆盖状态
    const originalStateSnapshot = {
        originalPath: state.originalPath,
        currentFileItem: state.currentFileItem ? JSON.parse(JSON.stringify(state.currentFileItem)) : null,
        rawContents: JSON.parse(JSON.stringify(state.rawContents || {})),
        panePaths: JSON.parse(JSON.stringify(state.panePaths || {})),
        workflowExecutionState: state.workflowExecutionState ? JSON.parse(JSON.stringify(state.workflowExecutionState)) : null
    };
    
    try {
        // 第一步：保存当前工作流执行状态（如果存在），然后清除
        // 这是关键：在并发执行时，需要保存当前状态，避免被其他文件清除
        // 但每个文件执行时，仍然需要从干净的状态开始
        const previousWorkflowState = state.workflowExecutionState;
        state.workflowExecutionState = null;
        
        // 第二步：设置当前文件路径和文件项
        // 这个路径会被后续的文件加载和工作流执行使用
        // 关键：批量执行时，必须完全覆盖主界面的路径，确保工作流使用批量处理的文件
        state.originalPath = filePath;
        
        // 设置 currentFileItem，确保工作流执行时能正确识别当前文件
        // 从文件路径构造文件项信息
        const lastSeparatorIndex = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
        const fileName = lastSeparatorIndex >= 0 ? filePath.substring(lastSeparatorIndex + 1) : filePath;
        state.currentFileItem = {
            path: filePath,
            name: fileName,
            isDir: false
        };
        
        console.log(`[executeEventForFile] 已设置 originalPath: ${filePath}`);
        console.log(`[executeEventForFile] 已设置 currentFileItem: ${fileName}`);
        
        // 第三步：清空并重新加载文件内容
        // 先清空现有内容，确保不会残留上一个文件的数据
        state.rawContents = {};
        state.panePaths = {};
        
        // 然后加载当前文件的视图内容到 state
        // 这是关键步骤：确保 state.rawContents 中包含的是当前文件的真实内容
        // 注意：loadFileContentToState 会使用 state.originalPath，所以必须先设置路径
        await loadFileContentToState(filePath);
        
        // 验证加载的内容是否正确
        const firstView = state.views.find(v => !v.suffix || String(v.suffix).trim() === '');
        if (firstView) {
            const loadedContent = state.rawContents[firstView.id] || '';
            const fileName = filePath.split(/[/\\]/).pop();
            console.log(`[executeEventForFile] 文件 ${fileName} 的内容已加载，长度: ${loadedContent.length} 字符`);
            console.log(`[executeEventForFile] 内容预览: ${loadedContent.substring(0, 100)}...`);
            
            // 额外验证：确保加载的内容确实是当前文件的，而不是主界面的文件
            if (loadedContent.length === 0) {
                console.warn(`[executeEventForFile] 警告：文件 ${fileName} 的内容为空，可能加载失败`);
            }
        }
        
        // 第四步：准备工作流执行选项
        // 添加批量执行标志，确保工作流执行时知道这是批量执行模式
        // 关键修复：确保 eventName 和 eventTimestamp 在顶层也能访问到（用于工作流反馈生成）
        const workflowOptions = {
            ...options,
            isBatchExecution: true,  // 标记这是批量执行模式
            batchFilePath: filePath,  // 明确指定批量处理的文件路径
            batchExecutionId: options.batchExecutionId || '',  // 关键修复：传递batchExecutionId，用于区分相同事件的多次执行
            eventName: eventName,  // 在顶层也传递事件名（用于工作流反馈生成）
            eventTimestamp: eventTimestamp,  // 在顶层也传递事件时间戳（用于工作流反馈生成）
            stepOptions: {
                eventTimestamp: eventTimestamp,
                eventName: eventName,
                workflowName: event.workflowName,
                useStream: options.useStream !== false,
                batchFilePath: filePath  // 在步骤选项中也传递文件路径
            }
        };
        
        // 第五步：在工作流执行前，如果是第一次执行，读取最近N个工作流反馈文件
        // 关键逻辑：第一次执行时读取历史反馈（用于指导第一次执行）
        let workflowFeedbackContent = '';
        if (options.isBatchExecution && eventName && eventTimestamp) {
            try {
                const { readRecentWorkflowFeedbacks, checkIsFirstWorkflowExecution, getFeedbackConfig } = await import('./feedbackManager.js');
                
                // 检查是否是第一次执行
                const isFirstExecution = await checkIsFirstWorkflowExecution(
                    eventName,
                    eventTimestamp,
                    filePath,
                    event.workflowName
                );
                
                if (isFirstExecution) {
                    // 第一次执行：读取最近N个工作流反馈文件
                    // 直接从localStorage读取最新配置，确保使用用户最新修改的值
                    let config;
                    try {
                        const saved = localStorage.getItem('feedbackConfig');
                        if (saved) {
                            const parsed = JSON.parse(saved);
                            config = {
                                feedbackCount: parsed.feedbackCount || 3,
                                workflowFeedbackCount: parsed.workflowFeedbackCount !== undefined ? parsed.workflowFeedbackCount : (parsed.feedbackCount || 3)
                            };
                        } else {
                            config = getFeedbackConfig();
                        }
                    } catch (err) {
                        console.warn(`[executeEventForFile] 读取配置失败，使用内存配置:`, err);
                        config = getFeedbackConfig();
                    }
                    
                    const feedbackCount = config.feedbackCount || 3;
                    // 读取工作流反馈数量配置（如果配置了且大于0，使用配置值；否则使用节点反馈数量作为默认值）
                    const workflowFeedbackReadCount = (config.workflowFeedbackCount !== undefined && config.workflowFeedbackCount > 0) 
                        ? config.workflowFeedbackCount 
                        : feedbackCount;
                    
                    const feedbackContents = await readRecentWorkflowFeedbacks(
                        eventName,
                        filePath,
                        event.workflowName,
                        workflowFeedbackReadCount
                    );
                    
                    if (feedbackContents.length > 0) {
                        workflowFeedbackContent = `历史工作流反馈（最近${feedbackContents.length}次）:\n`;
                        feedbackContents.forEach((feedback, index) => {
                            const timestampStr = ` (${new Date(feedback.timestamp).toLocaleString()})`;
                            workflowFeedbackContent += `\n--- 工作流反馈 ${index + 1}${timestampStr} ---\n`;
                            workflowFeedbackContent += formatFeedbackContent(feedback.content, '工作流反馈');
                        });
                        workflowFeedbackContent += '\n\n';
                        console.log(`[executeEventForFile] 第一次执行工作流，已读取 ${feedbackContents.length} 个工作流反馈文件`);
                    }
                }
            } catch (feedbackError) {
                console.warn(`[executeEventForFile] 读取工作流反馈失败:`, feedbackError);
                // 读取失败不影响执行，继续执行
            }
        }
        
        // 如果读取到了工作流反馈，将其传递给工作流执行选项
        if (workflowFeedbackContent) {
            workflowOptions.workflowFeedbackContent = workflowFeedbackContent;
        }
        
        // 第六步：执行工作流
        // executeWorkflow 会创建新的 workflowExecutionState，并读取 state.rawContents 中的内容
        // 由于已经设置了 state.originalPath 和 state.rawContents，工作流会使用批量处理的文件
        console.log(`[executeEventForFile] 开始执行工作流: ${event.workflowName}`);
        console.log(`[executeEventForFile] 工作流将使用文件: ${filePath}`);
        const result = await executeWorkflow(event.workflowName, null, workflowOptions);
        console.log(`[executeEventForFile] 工作流执行完成，共 ${result.steps.length} 个步骤`);
        
        // 关键修复：将计算好的totalSteps保存到workflowExecutionState中，用于批量执行日志显示
        // 这样在_updateWorkflowExecutionStatusInternal中就可以使用这个准确的值了
        if (state.workflowExecutionState && result.summary && result.summary.totalSteps) {
            state.workflowExecutionState.totalSteps = result.summary.totalSteps;
        }
        
        // 合并所有步骤文件
        // 关键修复：传递filePath参数，避免在批量并发执行时从全局状态读取到错误的路径
        let mergedFilePath = null;
        try {
            mergedFilePath = await mergeEventStepFiles(
                eventName, 
                eventTimestamp, 
                result.steps, 
                options.sequential || false,
                filePath  // 明确传递文件路径，确保批量并发执行时使用正确的路径
            );
        } catch (mergeError) {
            console.error('合并步骤文件失败:', mergeError);
        }
        
        // 工作流反馈现在在 workflowManager.js 中生成（工作流完成时），这里不再重复生成
        // 这样可以确保反馈文件在工作流真正完成时生成，并且文件夹会正确创建
        
        // 如果配置了视图ID（viewId），将总结写入到指定视图
        console.log(`[executeEventForFile] 检查总结位置配置: viewId="${event.viewId}"`);
        if (event.viewId && event.viewId.trim()) {
            try {
                const summaryViewId = event.viewId.trim();
                console.log(`[executeEventForFile] 准备写入总结到视图: ${summaryViewId}`);
                
                // 关键修复：在开始生成总结时，显示"执行中"状态
                const summaryViewEl = document.getElementById(`view-${summaryViewId}`);
                if (summaryViewEl) {
                    summaryViewEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">⏳ 正在生成总结...</div>';
                }
                
                // 检查视图是否存在，使用Map索引直接查找，O(1)复杂度
                const { getViewById } = await import('../core/state.js');
                const summaryView = getViewById(summaryViewId);
                if (summaryView) {
                    console.log(`[executeEventForFile] 找到总结视图: ${summaryViewId}, 开始构建总结内容`);
                    
                    // 构建总结内容
                    // 关键修复：区分普通步骤和工作流节点，工作流节点使用特殊格式记录
                    const formatStepResult = (step, index) => {
                        const stepViewId = step.step || step.viewId || '未知';
                        const stepContent = step.content || '';
                        
                        // 检查是否是工作流节点（从executedSteps中查找是否有isWorkflowNode标识）
                        // 或者在result.steps中查找是否有isWorkflowNode属性
                        const executedStepInfo = result.steps.find(s => (s.step || s.viewId) === stepViewId && s.stepIndex === step.stepIndex);
                        const isWorkflowNode = executedStepInfo && executedStepInfo.isWorkflowNode;
                        
                        if (isWorkflowNode) {
                            // 工作流节点：使用特殊格式 工作流节点：工作流节点名+步骤名
                            // 然后显示工作流节点内部的所有步骤信息
                            const workflowNodeName = executedStepInfo.workflowNodeName || stepViewId;
                            const stepDisplay = executedStepInfo.workflowNodeStepDisplay || `${step.stepIndex || index + 1}+${stepViewId}`;
                            
                            // 获取工作流节点内部的所有步骤
                            const internalSteps = executedStepInfo.workflowNodeInternalSteps || [];
                            const internalResults = executedStepInfo.workflowNodeInternalResults || {};
                            
                            // 构建工作流节点内部步骤的完整信息
                            let internalStepsContent = '';
                            if (internalSteps.length > 0) {
                                // 按步骤索引排序
                                const sortedInternalSteps = [...internalSteps].sort((a, b) => (a.stepIndex || 0) - (b.stepIndex || 0));
                                
                                internalStepsContent = sortedInternalSteps.map((internalStep, internalIndex) => {
                                    const internalStepViewId = internalStep.step || internalStep.viewId || '未知';
                                    const internalStepIndex = internalStep.stepIndex || internalIndex + 1;
                                    const internalStepContent = internalResults[internalStepViewId] || internalStep.content || '';
                                    
                                    // 格式：**步骤：步骤数+视图名**（加粗，换行后写内容）
                                    return `**步骤：${internalStepIndex}+${internalStepViewId}**\n\n${internalStepContent}`;
                                }).join('\n\n---\n\n');
                            } else {
                                // 如果没有内部步骤信息，使用总结内容
                                internalStepsContent = stepContent;
                            }
                            
                            // 最终格式：**工作流节点：工作流节点名+步骤名**（加粗，换行后写内容）
                            return `**工作流节点：${workflowNodeName}+${stepDisplay}**\n\n${internalStepsContent}`;
                        } else {
                            // 普通节点：使用格式 **步骤：步骤数+视图名**（加粗，换行后写内容）
                            const stepDisplay = `${step.stepIndex || index + 1}+${stepViewId}`;
                            return `**步骤：${stepDisplay}**\n\n${stepContent}`;
                        }
                    };
                    
                    // 格式化时间戳为中文格式：某某年某某月某某日某某小时某某分
                    const formatTimestampChinese = (timestamp) => {
                        const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
                        const year = date.getFullYear();
                        const month = date.getMonth() + 1;
                        const day = date.getDate();
                        const hours = date.getHours();
                        const minutes = date.getMinutes();
                        return `${year}年${month}月${day}日${hours}小时${minutes}分`;
                    };
                    
                    const formattedTimestamp = formatTimestampChinese(eventTimestamp);
                    
                    let summaryContent = `# 工作流执行总结

**事件名称**: ${eventName}
**工作流名称**: ${event.workflowName}
**执行时间**: ${new Date(eventTimestamp).toLocaleString()}
**执行步骤数**: ${result.steps.length}
${formattedTimestamp}

## 执行步骤

${result.steps.map((step, index) => {
    const stepViewId = step.step || step.viewId || '未知';
    return `${index + 1}. **${stepViewId}** (步骤索引: ${step.stepIndex || index + 1})`;
}).join('\n')}

## 步骤结果

${result.steps.map((step, index) => formatStepResult(step, index)).join('\n\n---\n\n')}
`;
                    
                    // 如果配置了提示词，使用提示词调用AI生成最终总结
                    if (event.promptId && event.promptId.trim()) {
                        try {
                            console.log(`[executeEventForFile] 检测到提示词配置: ${event.promptId}, 将使用AI生成总结`);
                            const prompt = await getPrompt(event.promptId.trim());
                            if (prompt && prompt.content) {
                                console.log(`[executeEventForFile] 提示词内容获取成功, 长度: ${prompt.content.length} 字符`);
                                
                                // 关键修复：读取所有视图的AI文件并拼接
                                let allAIFilesContent = '';
                                try {
                                    const { getFile } = await import('../core/api.js');
                                    const { getFileInFolderPath } = await import('../utils/fileUtils.js');
                                    const { getViewById } = await import('../core/state.js');
                                    
                                    // 获取所有视图
                                    const allViews = state.views || [];
                                    console.log(`[executeEventForFile] 开始读取所有视图的AI文件，共 ${allViews.length} 个视图`);
                                    
                                    // 构建AI文件路径
                                    const lastSeparatorIndex = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
                                    const fileName = lastSeparatorIndex >= 0 ? filePath.substring(lastSeparatorIndex + 1) : filePath;
                                    const lastDotIndex = fileName.lastIndexOf('.');
                                    const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
                                    const ext = lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1) : '';
                                    
                                    // 关键修复：同时读取所有视图的内容和AI文件
                                    // 并行读取所有视图的内容和AI文件
                                    const viewContentPromises = allViews.map(async (view) => {
                                        const viewId = view.id;
                                        
                                        // 读取视图ID的内容（从state.rawContents中读取）
                                        let viewContent = '';
                                        try {
                                            viewContent = state.rawContents[viewId] || '';
                                            console.log(`[executeEventForFile] 读取视图 ${viewId} 的内容，长度: ${viewContent.length} 字符`);
                                        } catch (err) {
                                            console.warn(`[executeEventForFile] 读取视图 ${viewId} 的内容失败:`, err);
                                        }
                                        
                                        // 读取视图ID的AI文件
                                        const aiFileName = `${baseName}_${viewId}_AI.${ext || 'md'}`;
                                        const aiFilePath = getFileInFolderPath(filePath, aiFileName);
                                        let aiFileContent = '';
                                        
                                        try {
                                            const rawContent = await getFile(aiFilePath);
                                            // 检查是否是错误响应
                                            if (!rawContent.trim().startsWith('{') || !rawContent.includes('"error"')) {
                                                aiFileContent = rawContent.trim();
                                                console.log(`[executeEventForFile] 读取视图 ${viewId} 的AI文件，长度: ${aiFileContent.length} 字符`);
                                            }
                                        } catch (err) {
                                            // AI文件不存在或读取失败，跳过
                                            console.warn(`[executeEventForFile] 读取视图 ${viewId} 的AI文件失败:`, err);
                                        }
                                        
                                        // 如果视图内容或AI文件有内容，返回
                                        if (viewContent || aiFileContent) {
                                            return {
                                                viewId: viewId,
                                                viewContent: viewContent,
                                                aiFileContent: aiFileContent
                                            };
                                        }
                                        return null;
                                    });
                                    
                                    const viewContentResults = await Promise.all(viewContentPromises);
                                    const validViews = viewContentResults.filter(r => r !== null);
                                    
                                    console.log(`[executeEventForFile] 成功读取 ${validViews.length}/${allViews.length} 个视图的内容和AI文件`);
                                    
                                    // 拼接所有视图的内容和AI文件
                                    if (validViews.length > 0) {
                                        console.log(`[executeEventForFile] 开始拼接 ${validViews.length} 个视图的内容和AI文件`);
                                        allAIFilesContent = validViews.map((result, index) => {
                                            console.log(`[executeEventForFile] 拼接视图 ${index + 1}/${validViews.length}: viewId=${result.viewId}, 视图内容长度=${result.viewContent?.length || 0}, AI文件内容长度=${result.aiFileContent?.length || 0}`);
                                            let viewSection = `## 视图 ${result.viewId} 的内容\n\n`;
                                            
                                            // 添加视图ID内容（用户消息）
                                            if (result.viewContent) {
                                                viewSection += `### 视图内容（用户消息）\n\n${result.viewContent}\n\n`;
                                            }
                                            
                                            // 添加AI文件内容（日志，思考角度）
                                            if (result.aiFileContent) {
                                                viewSection += `### AI对话记录（思考角度，仅供参考）\n\n${result.aiFileContent}\n\n`;
                                            }
                                            
                                            return viewSection;
                                        }).join('\n\n---\n\n');
                                        console.log(`[executeEventForFile] 所有视图内容和AI文件内容拼接完成，总长度: ${allAIFilesContent.length} 字符`);
                                    } else {
                                        console.log(`[executeEventForFile] 没有有效的视图内容或AI文件，跳过拼接`);
                                    }
                                } catch (aiFileError) {
                                    console.warn(`[executeEventForFile] 读取AI文件失败:`, aiFileError);
                                    // 读取失败不影响执行，继续使用提示词和总结内容
                                }
                                
                                // 构建发送给AI的消息：提示词 + AI文件内容 + 总结内容
                                let aiMessage = `${prompt.content}\n\n---\n\n`;
                                if (allAIFilesContent) {
                                    aiMessage += `${allAIFilesContent}\n\n---\n\n`;
                                }
                                aiMessage += summaryContent;
                                
                                // 调用AI生成最终总结
                                const { callOpenAI } = await import('./aiService.js');
                                console.log(`[executeEventForFile] 正在调用AI生成总结...`);
                                const aiGeneratedSummary = await callOpenAI(summaryViewId, aiMessage, {
                                    temperature: 0.7,
                                    max_tokens: 4000
                                });
                                console.log(`[executeEventForFile] AI生成总结完成, 长度: ${aiGeneratedSummary.length} 字符`);
                                
                                // 使用AI生成的内容作为最终总结
                                summaryContent = aiGeneratedSummary;
                            } else {
                                console.warn(`[executeEventForFile] 提示词内容为空, 跳过AI生成，使用原始总结`);
                            }
                        } catch (promptError) {
                            console.error(`[executeEventForFile] 获取提示词或调用AI失败: ${event.promptId}`, promptError);
                            // AI调用失败时，在总结内容前添加错误提示
                            summaryContent = `⚠️ **提示词AI处理失败**: ${promptError.message}\n\n---\n\n${summaryContent}`;
                            console.warn(`[executeEventForFile] 提示词AI处理失败，使用原始总结内容`);
                        }
                    } else {
                        console.log(`[executeEventForFile] 未配置提示词, 使用原始总结`);
                    }
                    
                    console.log(`[executeEventForFile] 总结内容已构建，长度: ${summaryContent.length} 字符`);
                    
                    // 写入总结到指定视图
                    const writeOptions = {
                        batchFilePath: filePath,
                        eventTimestamp: eventTimestamp,
                        eventName: eventName,
                        workflowName: event.workflowName
                    };
                    await writeCurrentView(summaryViewId, summaryContent, writeOptions);
                    console.log(`[executeEventForFile] ✅ 总结已成功写入到视图: ${summaryViewId}`);
                    
                    // 关键修复：总结视图生成后，才标记执行完毕，并更新导航栏的执行指示器
                    if (state.workflowExecutionState) {
                        state.workflowExecutionState.isCompleted = true;
                        state.workflowExecutionState.isCancelled = false;
                        state.workflowExecutionState.isPaused = false;
                        
                        // 更新状态显示
                        const { updateWorkflowExecutionStatus, updateNavigationExecutionIndicator } = await import('./workflowManager.js');
                        updateWorkflowExecutionStatus();
                        updateNavigationExecutionIndicator();
                        
                        console.log('[executeEventForFile] 总结视图生成完成，标记执行完毕');
                    }
                } else {
                    console.warn(`[executeEventForFile] ❌ 总结位置指定的视图不存在: ${summaryViewId}`);
                    console.warn(`[executeEventForFile] 可用视图列表: ${state.views.map(v => v.id).join(', ')}`);
                    
                    // 如果没有配置总结位置，工作流完成后就标记为已完成
                    if (state.workflowExecutionState) {
                        state.workflowExecutionState.isCompleted = true;
                        const { updateWorkflowExecutionStatus, updateNavigationExecutionIndicator } = await import('./workflowManager.js');
                        updateWorkflowExecutionStatus();
                        updateNavigationExecutionIndicator();
                    }
                }
            } catch (summaryError) {
                console.error('[executeEventForFile] ❌ 写入总结失败:', summaryError);
                console.error('[executeEventForFile] 错误堆栈:', summaryError.stack);
                // 写入失败不影响执行，继续执行
                // 即使失败，也标记为已完成（避免一直显示执行中）
                if (state.workflowExecutionState) {
                    state.workflowExecutionState.isCompleted = true;
                    const { updateWorkflowExecutionStatus, updateNavigationExecutionIndicator } = await import('./workflowManager.js');
                    updateWorkflowExecutionStatus();
                    updateNavigationExecutionIndicator();
                }
            }
        } else {
            console.log(`[executeEventForFile] 未配置总结位置，跳过总结写入`);
            // 如果没有配置总结位置，工作流完成后就标记为已完成
            if (state.workflowExecutionState) {
                state.workflowExecutionState.isCompleted = true;
                const { updateWorkflowExecutionStatus, updateNavigationExecutionIndicator } = await import('./workflowManager.js');
                updateWorkflowExecutionStatus();
                updateNavigationExecutionIndicator();
            }
        }
        
        // 生成AI消息：时间戳+事件+工作流
        // 关键修复：在映射steps时保留isWorkflowNode和workflowNodeInternalSteps属性，供countStepsDeeply使用
        const mappedSteps = (result.steps || []).map(s => ({
            viewId: s.step,
            stepIndex: s.stepIndex,
            aiFilePath: s.aiFilePath,
            stepFilePath: s.stepFilePath,
            // 保留工作流节点相关属性，供统计函数使用
            isWorkflowNode: s.isWorkflowNode || false,
            workflowNodeInternalSteps: s.workflowNodeInternalSteps || []
        }));
        
        // 深度统计函数：统计所有步骤（包括工作流节点内部的步骤）
        const countStepsDeeply = (steps) => {
            try {
                let totalSteps = 0;
                if (!steps || !Array.isArray(steps)) {
                    return 0;
                }
                steps.forEach(step => {
                    try {
                        // 检查是否是工作流节点
                        if (step && step.isWorkflowNode && step.workflowNodeInternalSteps) {
                            const internalSteps = Array.isArray(step.workflowNodeInternalSteps) ? step.workflowNodeInternalSteps : [];
                            // 递归统计内部步骤（包括嵌套的工作流节点）
                            const internalStepCount = countStepsDeeply(internalSteps);
                            // 工作流节点本身算作1个步骤，加上其内部的所有步骤
                            totalSteps += 1 + internalStepCount;
                        } else {
                            // 普通步骤
                            totalSteps += 1;
                        }
                    } catch (stepError) {
                        // 如果单个步骤统计出错，至少算作1个步骤
                        console.warn(`[executeEventForFile] 统计步骤时出错:`, stepError);
                        totalSteps += 1;
                    }
                });
                return totalSteps;
            } catch (error) {
                // 如果统计函数出错，返回步骤数组的长度作为后备
                console.warn(`[executeEventForFile] 深度统计步骤时出错，使用后备方案:`, error);
                return Array.isArray(steps) ? steps.length : 0;
            }
        };
        
        // 计算总步骤数，使用安全的统计函数
        let totalStepsCount = 0;
        try {
            totalStepsCount = countStepsDeeply(result.steps || []);
        } catch (error) {
            console.warn(`[executeEventForFile] 计算总步骤数时出错，使用后备方案:`, error);
            totalStepsCount = (result.steps || []).length;
        }
        
        const summary = {
            timestamp: eventTimestamp,
            event: eventName,
            workflow: event.workflowName,
            filePath: filePath,
            steps: mappedSteps,
            // 关键修复：正确统计所有节点（包括工作流节点内部的步骤）
            // 使用深度统计函数统计所有步骤（包括工作流节点内部的步骤）
            totalSteps: totalStepsCount,
            mergedFilePath: mergedFilePath,
            // 关键修复：保存执行ID，用于弹窗显示
            executionId: state.workflowExecutionState?.executionId || ''
        };
        
        return {
            success: true,
            eventName: eventName,
            filePath: filePath,
            workflowResult: result,
            summary: summary,
            mergedFilePath: mergedFilePath,
            // 关键修复：保存执行ID，用于弹窗显示
            executionId: state.workflowExecutionState?.executionId || ''
        };
    } catch (error) {
        console.error(`[executeEventForFile] 执行文件失败: ${filePath}`, error);
        throw error;
    } finally {
        // 恢复原始状态快照
        // 这是关键：确保每个文件执行完成后，state 恢复到执行前的状态
        // 这样下一个文件执行时，不会受到上一个文件的影响
        // 同时也不会影响主界面的状态
        state.originalPath = originalStateSnapshot.originalPath;
        state.currentFileItem = originalStateSnapshot.currentFileItem;
        state.rawContents = originalStateSnapshot.rawContents;
        state.panePaths = originalStateSnapshot.panePaths;
        
        // 恢复工作流执行状态
        // 关键修复：如果执行完成，保留执行状态，不清除（用于在事件面板中显示）
        // 检查当前执行状态是否已完成
        const currentExecutionState = state.workflowExecutionState;
        const isExecutionCompleted = currentExecutionState && currentExecutionState.isCompleted;
        
        if (isExecutionCompleted) {
            // 执行已完成，保留当前状态，不清除
            // 这样事件面板可以继续显示执行状态
            console.log(`[executeEventForFile] 执行已完成，保留执行状态以便在事件面板中显示`);
        } else {
            // 执行未完成，恢复原始状态
            // 关键：在并发执行时，需要恢复之前保存的状态，而不是简单地清除
            // 这样可以避免多个文件同时执行时相互覆盖状态
            if (originalStateSnapshot.workflowExecutionState) {
                // 如果之前有状态，恢复它（但需要深拷贝，避免引用问题）
                state.workflowExecutionState = JSON.parse(JSON.stringify(originalStateSnapshot.workflowExecutionState));
            } else {
                // 如果之前没有状态，清除它
                state.workflowExecutionState = null;
            }
        }
        
        console.log(`[executeEventForFile] 已恢复原始状态`);
        console.log(`[executeEventForFile] 恢复后的 originalPath: ${state.originalPath || 'null'}`);
        console.log(`[executeEventForFile] 恢复后的 workflowExecutionState: ${state.workflowExecutionState ? '已恢复' : 'null'}`);
    }
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.executeEvent = executeEvent;
    window.loadEvents = loadEvents;
    window.moveEventSelection = moveEventSelection;
    window.selectCurrentEvent = selectCurrentEvent;
}

