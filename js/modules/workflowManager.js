/**
 * 工作流管理模块
 * 负责工作流的创建、编辑、执行和可视化
 */

import { state, saveStateToStorage } from '../core/state.js';
import { getWorkflows, getWorkflow, saveWorkflow as saveWorkflowAPI, deleteWorkflow, saveFile } from '../core/api.js';
import { readCurrentView, writeCurrentView, writeEventStepFile, createStreamFileWriter } from './editor.js';
import { callOpenAI, batchCallOpenAI, streamOpenAI } from './aiService.js';
import { processContent } from '../utils/markdownConverter.js';
import { logWorkflowExecution } from './logManager.js';
import { formatPromptContent, formatFeedbackContent, formatWorkflowNodeContent, generateXYAxisGuide } from '../utils/promptFormatter.js';
import { executeWorkflowNode } from './workflowNodeExecutor.js';
import { generateExecutionId, updateProgressLog, appendDetailLog, appendWorkflowNodeStartLog, appendWorkflowNodeCompleteLog, limitLogLines, initEnhancedLogDisplay, renderEnhancedLogOnUpdate } from './workflowExecutionLogger.js';

/**
 * 全局工作流执行日志存储（永久保存，不清空）
 * 格式：数组，每个元素是一个执行记录
 * { executionId, eventName, workflowName, fileName, totalSteps, completedSteps, currentStep, timestamp, logs: [] }
 */
const globalWorkflowExecutionLogs = [];

/**
 * 更新全局工作流执行日志（参考批量执行面板的方式，永久保存，不清空）
 * @param {string} eventName - 事件名
 * @param {string} workflowName - 工作流名称
 * @param {string} fileName - 文件名（可选）
 * @param {number} totalSteps - 总步骤数
 * @param {number} completedSteps - 已完成步骤数
 * @param {string} currentStep - 当前步骤名称（可选）
 * @param {string} executionId - 执行ID（时间戳，用于区分相同事件的多次执行）
 */
function updateGlobalWorkflowExecutionLog(eventName, workflowName, fileName = '', totalSteps = 0, completedSteps = 0, currentStep = '', executionId = '') {
    const logElement = document.getElementById('workflow-execution-status');
    if (!logElement) return;
    
    // 获取当前日志内容（永久保存，不清空）
    let currentLog = logElement.textContent || '';
    const lines = currentLog.split('\n').filter(line => line.trim() !== '');
    
    // 使用executionId来区分相同事件的多次执行
    // 格式：事件名+工作流名称+[执行ID]+文件+共x步已完成x步当前步骤：步骤某某
    const progressLinePrefix = executionId 
        ? `${fileName ? fileName + '+' : ''}${eventName}+${workflowName}+[${executionId}]`
        : `${fileName ? fileName + '+' : ''}${eventName}+${workflowName}`;
    
    let found = false;
    
    // 查找并更新现有的进度行
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(progressLinePrefix)) {
            // 更新现有进度行
            const currentStepText = currentStep ? `当前步骤：${currentStep}` : '';
            lines[i] = `${progressLinePrefix}+共${totalSteps}步已完成${completedSteps}步${currentStepText ? ' ' + currentStepText : ''}`;
            found = true;
            break;
        }
    }
    
    // 如果没找到，在最后添加新的进度行
    if (!found && eventName && workflowName) {
        const currentStepText = currentStep ? `当前步骤：${currentStep}` : '';
        lines.push(`${progressLinePrefix}+共${totalSteps}步已完成${completedSteps}步${currentStepText ? ' ' + currentStepText : ''}`);
    }
    
    // 更新日志内容（永久保存，不清空）
    logElement.textContent = lines.join('\n');
    // 关键修复：取消自动滚动到底部，让用户可以查看历史日志
    // logElement.scrollTop = logElement.scrollHeight;
}

// marked和DOMPurify是全局的，从CDN加载
const marked = window.marked;
const DOMPurify = window.DOMPurify;

/**
 * 实时更新视图显示（不保存文件，仅显示）
 * 只在工作流执行中进行更新
 * @param {string} viewId - 视图ID
 * @param {string} content - 要显示的内容
 */
function updateViewDisplayRealTime(viewId, content) {
    // 检查工作流执行状态，只在执行中时更新
    if (!state.workflowExecutionState) {
        return; // 没有执行状态，不更新
    }
    
    const execState = state.workflowExecutionState;
    // 如果工作流已完成、已取消或已暂停，不更新视图显示
    if (execState.isCompleted || execState.isCancelled || execState.isPaused) {
        return;
    }
    
    const viewEl = document.getElementById(`view-${viewId}`);
    if (!viewEl) return;
    
    try {
        // 构建AI消息格式（与writeCurrentView格式一致）
        const timestamp = new Date().toISOString();
        const aiMessage = `时间戳: ${timestamp}\n视图ID: ${viewId}\n\n${content}`;
        
        // 渲染markdown内容
        const html = processContent(marked.parse(aiMessage));
        viewEl.innerHTML = DOMPurify.sanitize(html);
        
        // 自动滚动到底部（显示最新内容）
        viewEl.scrollTop = viewEl.scrollHeight;
        
        // 增强表格和跳转链接
        if (window.enhanceTables) window.enhanceTables();
        if (window.attachJumpLinkListeners) window.attachJumpLinkListeners(viewEl);
    } catch (err) {
        console.error(`更新视图显示失败 (${viewId}):`, err);
    }
}

// AI消息队列系统（用于并发处理多个步骤的AI消息）
const aiMessageQueues = new Map(); // viewId -> { queue: [], isProcessing: false, writer: writer, fullContent: '' }
let globalBatchProcessorScheduled = false; // 全局批量处理器调度标志

/**
 * 全局批量处理所有视图的消息队列（真正并行处理所有视图）
 * 每个视图的消息处理都是完全独立的，可以真正并发执行
 */
function processAllAiMessageQueues() {
    if (!state.workflowExecutionState || 
        state.workflowExecutionState.isCompleted || 
        state.workflowExecutionState.isCancelled || 
        state.workflowExecutionState.isPaused) {
        globalBatchProcessorScheduled = false;
        return;
    }
    
    globalBatchProcessorScheduled = false;
    
    // 收集所有有消息且未在处理中的视图
    const viewsToProcess = [];
    aiMessageQueues.forEach((queueData, viewId) => {
        if (queueData.queue.length > 0 && !queueData.isProcessing) {
            viewsToProcess.push(viewId);
        }
    });
    
    if (viewsToProcess.length === 0) {
        return;
    }
    
    // 获取UI更新队列
    const batchUpdateQueue = state.workflowExecutionState._batchUpdateQueue;
    let hasUpdates = false;
    
    // 关键修复：使用Promise.all并行处理所有视图，而不是forEach顺序处理
    // 每个视图的消息处理完全独立，可以真正并发执行
    const processingPromises = viewsToProcess.map(viewId => {
        return Promise.resolve().then(() => {
            const queueData = aiMessageQueues.get(viewId);
            if (!queueData || queueData.queue.length === 0) return;
            
            // 标记为处理中（防止重复处理）
            queueData.isProcessing = true;
            
            // 一次性处理该视图队列中的所有消息（同步处理，因为这是内存操作）
            // 文件写入和UI更新都是非阻塞的，所以可以立即处理所有消息
            while (queueData.queue.length > 0) {
                const { chunk, fullContent } = queueData.queue.shift();
                
                try {
                    // 批量写入文件（立即写入，不等待，fire-and-forget）
                    if (queueData.writer) {
                        queueData.writer.write(chunk);
                    }
                    
                    // 更新完整内容（内存操作，同步执行）
                    queueData.fullContent = fullContent;
                    
                    // 批量更新UI队列（内存操作，同步执行，不阻塞）
                    if (batchUpdateQueue) {
                        batchUpdateQueue.set(viewId, fullContent);
                        hasUpdates = true;
                    }
                } catch (err) {
                    console.error(`处理AI消息队列失败 (${viewId}):`, err);
                }
            }
            
            // 处理完成，重置标志
            queueData.isProcessing = false;
        });
    });
    
    // 等待所有视图处理完成（虽然是Promise.all，但因为处理是同步的内存操作，所以会立即完成）
    Promise.all(processingPromises).then(() => {
        // 所有视图处理完成后，统一调度UI更新（避免重复调度）
        if (hasUpdates && state.workflowExecutionState._scheduleBatchUpdate) {
            state.workflowExecutionState._scheduleBatchUpdate();
        }
        
        // 检查是否还有消息需要处理，如果有则继续调度
        let hasMoreMessages = false;
        aiMessageQueues.forEach((queueData) => {
            if (queueData.queue.length > 0) {
                hasMoreMessages = true;
            }
        });
        
        if (hasMoreMessages) {
            scheduleGlobalBatchProcessor();
        }
    }).catch(err => {
        console.error('批量处理消息队列时出错:', err);
    });
}

/**
 * 调度全局批量处理器
 */
function scheduleGlobalBatchProcessor() {
    if (globalBatchProcessorScheduled) {
        return; // 已经调度过了，不需要重复调度
    }
    
    globalBatchProcessorScheduled = true;
    
    // 使用 setTimeout(0) 立即调度，确保批量处理可以快速响应
    setTimeout(() => {
        processAllAiMessageQueues();
    }, 0);
}

/**
 * 添加AI消息到队列（非阻塞）
 * @param {string} viewId - 视图ID
 * @param {string} chunk - 消息块
 * @param {string} fullContent - 完整内容
 */
function enqueueAiMessage(viewId, chunk, fullContent) {
    if (!aiMessageQueues.has(viewId)) {
        aiMessageQueues.set(viewId, {
            queue: [],
            isProcessing: false,
            writer: null,
            fullContent: ''
        });
    }
    
    const queueData = aiMessageQueues.get(viewId);
    
    // 关键修复：立即处理消息，而不是先加入队列再批量处理
    // 这样每个视图的消息都能立即写入和更新UI，实现真正的并发
    try {
        // 立即写入文件（非阻塞，fire-and-forget）
        if (queueData.writer) {
            queueData.writer.write(chunk);
        }
        
        // 立即更新完整内容（内存操作，同步执行）
        queueData.fullContent = fullContent;
        
        // 立即更新UI队列（内存操作，同步执行）
        if (state.workflowExecutionState) {
            const batchUpdateQueue = state.workflowExecutionState._batchUpdateQueue;
            if (batchUpdateQueue) {
                batchUpdateQueue.set(viewId, fullContent);
                // 调度UI更新（如果还没有调度的话）
                if (state.workflowExecutionState._scheduleBatchUpdate) {
                    state.workflowExecutionState._scheduleBatchUpdate();
                }
            }
        }
    } catch (err) {
        console.error(`处理AI消息失败 (${viewId}):`, err);
    }
}

/**
 * 初始化AI消息队列（设置writer）
 * @param {string} viewId - 视图ID
 * @param {object} writer - 写入器对象
 */
function initAiMessageQueue(viewId, writer) {
    if (!aiMessageQueues.has(viewId)) {
        aiMessageQueues.set(viewId, {
            queue: [],
            isProcessing: false,
            writer: null,
            fullContent: ''
        });
    }
    
    const queueData = aiMessageQueues.get(viewId);
    queueData.writer = writer;
    queueData.fullContent = '';
}

/**
 * 清理AI消息队列
 * @param {string} viewId - 视图ID
 */
function cleanupAiMessageQueue(viewId) {
    const queueData = aiMessageQueues.get(viewId);
    if (queueData) {
        queueData.writer = null;
    }
    // 不删除队列，保留以便后续使用
}

/**
 * 获取队列中的完整内容
 * @param {string} viewId - 视图ID
 * @returns {string} 完整内容
 */
function getAiMessageQueueContent(viewId) {
    const queueData = aiMessageQueues.get(viewId);
    return queueData ? queueData.fullContent : '';
}

// 写入队列系统（用于非阻塞写入）
const statusUpdateQueue = {
    queue: [],
    isProcessing: false,
    pendingUpdate: null
};

/**
 * 处理状态更新队列（非阻塞）
 */
async function processStatusUpdateQueue() {
    if (statusUpdateQueue.isProcessing) {
        return;
    }
    
    statusUpdateQueue.isProcessing = true;
    
    while (statusUpdateQueue.queue.length > 0 || statusUpdateQueue.pendingUpdate) {
        // 处理待处理的更新（合并多个更新）
        if (statusUpdateQueue.pendingUpdate) {
            const updateFn = statusUpdateQueue.pendingUpdate;
            statusUpdateQueue.pendingUpdate = null;
            
            try {
                await updateFn();
            } catch (err) {
                console.error('状态更新失败:', err);
            }
        }
        
        // 处理队列中的更新
        if (statusUpdateQueue.queue.length > 0) {
            const updateFn = statusUpdateQueue.queue.shift();
            try {
                await updateFn();
            } catch (err) {
                console.error('状态更新失败:', err);
            }
        }
        
        // 短暂延迟，避免过于频繁的更新
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    statusUpdateQueue.isProcessing = false;
}

/**
 * 更新工作流执行状态显示（非阻塞，使用队列）
 */
export async function updateWorkflowExecutionStatus() {
    // 将更新操作加入队列（非阻塞）
    const updateFn = async () => {
        await _updateWorkflowExecutionStatusInternal();
    };
    
    // 如果队列正在处理，将更新加入队列
    if (statusUpdateQueue.isProcessing) {
        // 合并多个更新：只保留最新的更新
        statusUpdateQueue.pendingUpdate = updateFn;
    } else {
        // 队列空闲，直接加入队列并启动处理
        statusUpdateQueue.queue.push(updateFn);
        processStatusUpdateQueue().catch(err => {
            console.error('状态更新队列处理失败:', err);
        });
    }
}

/**
 * 检查F12日志是否启用
 * @returns {boolean} 是否启用F12日志
 */
function isF12LogEnabled() {
    return localStorage.getItem('f12LogEnabled') !== 'false'; // 默认开启
}

/**
 * F12日志输出（统一控制）
 * @param {...any} args - 要输出的参数
 */
function f12Log(...args) {
    // 输出到控制台（如果启用）
    if (isF12LogEnabled()) {
        console.log(...args);
    }
    
    // 关键修复：将F12日志也保存到工作流执行状态中，以便在UI中显示
    if (state.workflowExecutionState) {
        // 将参数转换为字符串
        const logMessage = args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');
        
        // 添加到执行日志中
        if (!state.workflowExecutionState.f12Logs) {
            state.workflowExecutionState.f12Logs = [];
        }
        
        state.workflowExecutionState.f12Logs.push({
            message: logMessage,
            timestamp: new Date().toISOString()
        });
        
        // 触发状态更新
        updateWorkflowExecutionStatus();
    }
}

/**
 * 添加日志到工作流执行状态（辅助函数）
 * @param {string} logMessage - 日志消息
 * @param {object} options - 日志选项 {stepIndex, viewId, status, isWorkflowNode, workflowNodeName}
 */
function addExecutionLog(logMessage, options = {}) {
    if (!state.workflowExecutionState) return;
    
    if (!state.workflowExecutionState.executionLogs) {
        state.workflowExecutionState.executionLogs = [];
    }
    
    const logEntry = {
        stepIndex: options.stepIndex !== undefined ? options.stepIndex : (state.workflowExecutionState.stepIndexCounter || 0),
        viewId: options.viewId || '系统',
        log: logMessage,
        timestamp: new Date().toISOString(),
        status: options.status || 'info',
        prompt: options.prompt || null,
        sentContent: options.sentContent || null,
        nextViews: options.nextViews || [],
        isWorkflowNode: options.isWorkflowNode || false,
        workflowNodeName: options.workflowNodeName || null
    };
    
    state.workflowExecutionState.executionLogs.push(logEntry);
    
    // 触发状态更新
    if (state.workflowExecutionState) {
        updateWorkflowExecutionStatus();
    }
}

/**
 * 内部状态更新函数（实际执行更新）
 */
async function _updateWorkflowExecutionStatusInternal() {
    // 尝试从事件面板获取状态元素，如果不存在则创建一个全局的状态显示元素
    let statusEl = document.getElementById('workflow-execution-status');
    const pauseBtn = document.getElementById('pause-workflow-btn');
    const resumeBtn = document.getElementById('resume-workflow-btn');
    const cancelBtn = document.getElementById('cancel-workflow-btn');
    
    // 如果事件面板中的状态元素不存在，创建一个全局的状态显示元素（用于右键菜单执行时显示）
    if (!statusEl) {
        // 检查是否已存在全局状态元素
        statusEl = document.getElementById('workflow-execution-status-global');
        if (!statusEl) {
            // 创建全局状态显示元素（隐藏，但可以显示）
            statusEl = document.createElement('div');
            statusEl.id = 'workflow-execution-status-global';
            statusEl.className = 'execution-status-box';
            statusEl.style.cssText = `
                position: fixed;
                top: 60px;
                right: 20px;
                width: 400px;
                max-width: calc(100vw - 40px);
                max-height: calc(100vh - 100px);
                padding: 16px;
                border: 1px solid var(--border);
                border-radius: var(--border-radius);
                background: var(--bg-pane);
                color: var(--text-primary);
                font-family: var(--font-code);
                font-size: 12px;
                white-space: pre-wrap;
                z-index: 9999;
                box-shadow: var(--shadow-hover);
                display: none;
                overflow-y: auto;
            `;
            document.body.appendChild(statusEl);
        }
    }
    
    // 如果状态元素仍然不存在，直接返回
    if (!statusEl) return;
    
    // 关键修复：如果状态为null，直接返回，不创建或更新任何UI元素
    // 这样可以避免在页面加载时创建状态显示元素
    if (!state.workflowExecutionState) {
        // 如果状态元素存在，隐藏它（但不创建新元素）
        if (statusEl) {
            statusEl.style.display = 'none';
        }
        if (pauseBtn) pauseBtn.style.display = 'none';
        if (resumeBtn) resumeBtn.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'none';
        return;
    }
    
    const execState = state.workflowExecutionState;
    const stepResults = execState.stepResults || {};
    const executedSteps = execState.executedSteps || [];
    const executingSteps = Array.from(execState.executingSteps || []);
    
    let statusText = `工作流: ${execState.workflowName || '未知'}\n`;
    if (execState.isTestMode) {
        statusText += `[测试模式] 不会调用AI，不会创建文件\n`;
    }
    
    // 显示目录执行信息
    if (execState.currentFilePath && execState.totalFiles) {
        statusText += `目录执行: ${execState.currentFileIndex || 0}/${execState.totalFiles} 个文件\n`;
        statusText += `当前文件: ${execState.currentFilePath}\n`;
    }
    
    // 显示状态：已完成 > 已终止 > 已暂停 > 执行中
    let statusLabel = '执行中';
    if (execState.isCompleted) {
        statusLabel = '已完成';
    } else if (execState.isCancelled) {
        statusLabel = '已终止';
    } else if (execState.isPaused) {
        statusLabel = '已暂停';
    }
    statusText += `状态: ${statusLabel}\n`;
    
    // 文件和步骤分开计算并显示
    const totalFiles = execState.totalFiles || 1;
    const completedFiles = execState.currentFileIndex || (execState.isCompleted ? totalFiles : 0);
    statusText += `已完成文件: ${completedFiles}/${totalFiles}\n`;
    statusText += `已完成步骤: ${executedSteps.length}\n`;
    statusText += `正在执行: ${executingSteps.length > 0 ? executingSteps.join(', ') : '无'}\n\n`;
    
    // 如果是批量执行模式，更新批量执行进度日志
    if (execState.batchFilePath) {
        try {
            const { updateBatchProgressLog } = await import('./batchExecutor.js');
            const fileName = execState.batchFilePath.split(/[/\\]/).pop() || '';
            const workflowName = execState.workflowName || '';
            // 从options中获取事件名，或者从其他地方获取
            const eventName = execState.options?.eventName || '';
            
            // 关键修复：计算总步骤数（包括视图节点和工作流节点）
            // 优先使用execState中保存的totalSteps（如果存在），这是从executeEventForFile中传递过来的准确值
            // 如果视图ID找不到，就在工作流列表里找，匹配工作流节点的名字
            let totalSteps = 0;
            if (execState.totalSteps !== undefined && execState.totalSteps > 0) {
                // 使用从executeEventForFile传递过来的准确总步骤数（包括工作流节点内部的步骤）
                totalSteps = execState.totalSteps;
            } else if (execState.allSteps) {
                // 统计所有节点（视图节点+工作流节点）
                totalSteps = execState.allSteps.length;
                
                // 如果allSteps中有工作流节点，需要确保统计正确
                // 检查是否有视图ID在工作流列表中找不到的情况
                if (state.workflows && state.workflows.length > 0) {
                    // 遍历allSteps，检查是否有工作流节点
                    const workflowNodeCount = execState.allSteps.filter(step => {
                        const viewId = step.viewId || step.self;
                        // 检查是否是工作流节点
                        return step.workflowId || state.workflows.some(w => w.name === viewId);
                    }).length;
                    // totalSteps已经包含了所有节点，不需要额外添加
                }
            } else {
                // 如果没有allSteps，使用executedSteps的长度
                totalSteps = executedSteps.length;
            }
            const completedStepsCount = executedSteps.length;
            
            // 获取当前正在执行的步骤名称
            // 关键修复：安全访问executingSteps数组，避免访问undefined
            let currentStepName = '';
            let isCurrentStepWorkflowNode = false;
            if (executingSteps && executingSteps.length > 0) {
                currentStepName = executingSteps[0] || ''; // 取第一个正在执行的步骤
                // 检查是否是工作流节点
                if (execState.allSteps && currentStepName) {
                    const currentStep = execState.allSteps.find(step => {
                        const stepId = step.viewId || step.self;
                        return stepId === currentStepName || step.workflowId === currentStepName;
                    });
                    if (currentStep) {
                        isCurrentStepWorkflowNode = !!currentStep.workflowId || (state.workflows && state.workflows.some(w => w.name === (currentStep.viewId || currentStep.self)));
                    }
                }
            } else if (execState.executionLogs && execState.executionLogs.length > 0) {
                // 如果没有正在执行的步骤，取最后一个日志中的步骤
                const lastLog = execState.executionLogs[execState.executionLogs.length - 1];
                if (lastLog && lastLog.status === 'executing') {
                    currentStepName = lastLog.viewId || '';
                    isCurrentStepWorkflowNode = lastLog.isWorkflowNode || false;
                }
            }
            
            // 更新批量执行进度日志
            // 关键修复：从execState中获取batchExecutionId（如果有），用于区分相同事件的多次执行
            const executionId = execState.batchExecutionId || '';
            if (fileName && eventName && workflowName) {
                updateBatchProgressLog(fileName, eventName, workflowName, totalSteps, completedStepsCount, currentStepName, executionId, isCurrentStepWorkflowNode);
            }
        } catch (err) {
            // 如果导入失败或更新失败，不影响工作流执行，只记录错误
            console.warn('[updateWorkflowExecutionStatus] 更新批量执行进度日志失败:', err);
        }
    }
    
    // 显示执行日志
    if (execState.executionLogs && execState.executionLogs.length > 0) {
        statusText += `执行日志:\n`;
        statusText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        execState.executionLogs.forEach((log) => {
            // 确保步骤索引从1开始显示（如果stepIndex为0或undefined，显示为步骤1）
            const displayStepIndex = (log.stepIndex && log.stepIndex > 0) ? log.stepIndex : 1;
            
            // 如果是工作流节点，显示为"工作流：工作流名称"
            if (log.isWorkflowNode && log.workflowNodeName) {
                statusText += `[工作流：${log.workflowNodeName}] ${log.log}\n`;
            } else {
                // 普通步骤显示为"步骤X"
                statusText += `[步骤${displayStepIndex}] ${log.log}\n`;
            }
        });
        statusText += `\n`;
    }
    
    // 关键修复：显示F12日志（放在执行日志下方）
    if (execState.f12Logs && execState.f12Logs.length > 0) {
        statusText += `F12控制台日志:\n`;
        statusText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        execState.f12Logs.forEach((log) => {
            const timestamp = new Date(log.timestamp).toLocaleTimeString('zh-CN');
            statusText += `[${timestamp}] ${log.message}\n`;
        });
        statusText += `\n`;
    }
    
    // 显示等待状态（多个节点发送到一个节点的情况）
    if (execState.nodeOutputSteps && execState.allSteps) {
        const waitingNodes = [];
        const nodeOutputSteps = execState.nodeOutputSteps;
        const steps = execState.allSteps;
        const getStepId = (step) => step.viewId || step.self;
        
        // 查找所有有多个输入源且还在等待的节点
        nodeOutputSteps.forEach((outputStepIndices, nodeId) => {
            if (outputStepIndices.size > 1 && !stepResults[nodeId]) {
                // 有多个步骤输出到这个节点，且节点还未完成
                const waitingSteps = [];
                const completedSteps = [];
                
                Array.from(outputStepIndices).forEach(stepIndex => {
                    const step = steps[stepIndex];
                    const stepId = getStepId(step);
                    const stepResult = stepResults[stepId];
                    const executedStep = executedSteps.find(es => es.step === stepId);
                    const stepIndexNumber = executedStep ? executedStep.stepIndex : null;
                    const isExecuting = executingSteps.includes(stepId);
                    
                    if (stepResult) {
                        completedSteps.push({
                            stepIndex: stepIndexNumber,
                            viewId: stepId,
                            isExecuting: isExecuting
                        });
                    } else {
                        waitingSteps.push({
                            stepIndex: stepIndexNumber,
                            viewId: stepId,
                            isExecuting: isExecuting
                        });
                    }
                });
                
                if (waitingSteps.length > 0) {
                    waitingNodes.push({
                        nodeId: nodeId,
                        waitingSteps: waitingSteps,
                        completedSteps: completedSteps,
                        totalSteps: outputStepIndices.size,
                        completedCount: completedSteps.length,
                        waitingCount: waitingSteps.length
                    });
                }
            }
        });
        
        if (waitingNodes.length > 0) {
            statusText += `等待状态（多节点输入）:\n`;
            statusText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            waitingNodes.forEach(waitingInfo => {
                const waitingStepIndexes = waitingInfo.waitingSteps
                    .filter(ws => ws.stepIndex !== null)
                    .map(ws => `步骤${ws.stepIndex}`)
                    .join('、');
                const waitingStepIds = waitingInfo.waitingSteps
                    .filter(ws => ws.stepIndex === null)
                    .map(ws => ws.viewId)
                    .join('、');
                const waitingList = waitingStepIndexes + (waitingStepIds ? (waitingStepIndexes ? '、' : '') + waitingStepIds : '');
                
                statusText += `节点 "${waitingInfo.nodeId}":\n`;
                statusText += `  当前有 ${waitingList || '未知步骤'} 还未生成文件\n`;
                statusText += `  下一步: ${waitingInfo.waitingCount} 个文件未生成，${waitingInfo.completedCount} 个文件已生成\n`;
                statusText += `  当前正在等待，请稍后...\n`;
                statusText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            });
            statusText += `\n`;
        }
    }
    
    // 格式化步骤结果显示
    statusText += `步骤结果 (共 ${executedSteps.length} 个步骤):\n`;
    statusText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    
    // 按执行顺序显示步骤结果
    // 只显示executedSteps中的步骤，使用viewId作为标识（过滤掉stepUniqueId）
    if (executedSteps.length === 0) {
        statusText += `暂无步骤结果\n`;
    } else {
        // 按stepIndex排序，然后提取viewId（去除重复的viewId，因为可能有多个步骤使用相同的viewId）
        const sortedExecutedSteps = [...executedSteps].sort((a, b) => (a.stepIndex || 0) - (b.stepIndex || 0));
        // 使用Map来存储每个viewId对应的最后一个步骤（用于显示）
        const viewIdToStepMap = new Map();
        sortedExecutedSteps.forEach(es => {
            // 如果viewId不是stepUniqueId格式（step_数字），则使用它
            if (!es.step.startsWith('step_')) {
                viewIdToStepMap.set(es.step, es);
            }
        });
        
        // 如果所有步骤都是stepUniqueId格式，则使用所有步骤（这种情况不应该发生）
        if (viewIdToStepMap.size === 0) {
            sortedExecutedSteps.forEach(es => viewIdToStepMap.set(es.step, es));
        }
        
        const sortedSteps = Array.from(viewIdToStepMap.keys()).sort((a, b) => {
            const aStep = viewIdToStepMap.get(a);
            const bStep = viewIdToStepMap.get(b);
            return (aStep.stepIndex || 0) - (bStep.stepIndex || 0);
        });
        
        // 并行读取所有步骤文件的内容
        const fileContentPromises = sortedSteps.map(async (viewId) => {
            const executedStep = viewIdToStepMap.get(viewId);
            let fileContent = '';
            
            // 如果有步骤文件路径，直接读取文件内容
            if (executedStep && executedStep.stepFilePath) {
                try {
                    // 关键修复：检查文件路径中的视图ID是否与当前viewId匹配
                    // 从文件路径中提取视图ID（文件名格式：时间戳_文件名_视图ID.扩展名 或 时间戳_文件名_视图ID_事件名.扩展名）
                    const stepFilePath = executedStep.stepFilePath;
                    const fileName = stepFilePath.split(/[/\\]/).pop() || '';
                    // 去掉扩展名
                    const fileNameWithoutExt = fileName.replace(/\.(md|txt|json)$/, '');
                    // 提取视图ID：文件名格式为 时间戳_文件名_视图ID_事件名 或 时间戳_文件名_视图ID
                    // 由于文件名可能包含下划线，我们需要从文件路径中提取视图ID
                    // 最简单的方法：检查文件名是否包含当前viewId
                    const fileNameContainsViewId = fileNameWithoutExt.includes(`_${viewId}_`) || fileNameWithoutExt.endsWith(`_${viewId}`);
                    
                    // 如果文件路径中的视图ID与当前viewId不匹配，跳过读取
                    if (!fileNameContainsViewId) {
                        // 文件路径中的视图ID与当前viewId不匹配，使用流式状态中的内容
                        fileContent = stepResults[viewId] || '';
                    } else {
                        // 视图ID匹配，尝试读取文件（如果文件不存在，不创建文件，直接使用流式状态中的内容）
                        const { getFile } = await import('../core/api.js');
                        try {
                            const rawContent = await getFile(stepFilePath);
                            // 检查是否是错误响应
                            if (rawContent.trim().startsWith('{') && rawContent.includes('"error"')) {
                                // 文件不存在，使用流式状态中的内容（不创建文件）
                                fileContent = stepResults[viewId] || '';
                            } else {
                                // 文件存在，解析内容（跳过头部信息）
                                const lines = rawContent.split('\n');
                                // 查找最后一个步骤的内容（因为可能是追加模式）
                                const stepMarker = /步骤：[\dN]+\+.*/;
                                let contentStartIndex = 0;
                                for (let i = lines.length - 1; i >= 0; i--) {
                                    if (stepMarker.test(lines[i])) {
                                        contentStartIndex = i + 1;
                                        break;
                                    }
                                }
                                if (contentStartIndex > 0 && contentStartIndex < lines.length) {
                                    fileContent = lines.slice(contentStartIndex).join('\n').trim();
                                } else if (lines.length > 3) {
                                    fileContent = lines.slice(3).join('\n');
                                } else {
                                    fileContent = rawContent;
                                }
                            }
                        } catch (err) {
                            // 文件不存在或读取失败，使用流式状态中的内容（不创建文件）
                            fileContent = stepResults[viewId] || '';
                        }
                    }
                } catch (err) {
                    // 文件创建或读取失败，使用流式状态中的内容
                    // 不输出错误日志，避免404错误污染控制台
                    fileContent = stepResults[viewId] || '';
                }
            } else if (executingSteps.includes(viewId)) {
                // 执行中的步骤，尝试根据文件命名规则构造路径并读取（带事件名后缀的格式）
                // 优先使用批量处理的文件路径（如果存在）
                const targetFilePath = execState.batchFilePath || state.originalPath;
                if (targetFilePath && execState.options && execState.options.eventTimestamp && execState.options.eventName) {
                    try {
                        const { getFileInFolderPath } = await import('../utils/fileUtils.js');
                        const { getFile } = await import('../core/api.js');
                        const lastSeparatorIndex = Math.max(targetFilePath.lastIndexOf('\\'), targetFilePath.lastIndexOf('/'));
                        const fileName = lastSeparatorIndex >= 0 ? targetFilePath.substring(lastSeparatorIndex + 1) : targetFilePath;
                        const lastDotIndex = fileName.lastIndexOf('.');
                        const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
                        const ext = lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1).trim() : '';
                        const timestamp = execState.options.eventTimestamp;
                        const timestampStr = timestamp.replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
                        const eventName = execState.options.eventName;
                        
                        // 关键修复：只读取带事件名后缀的步骤文件（格式：时间戳_文件名_视图名_事件名.md）
                        // 不再创建不带事件名后缀的文件，如果文件不存在，直接使用流式状态中的内容
                        const eventSuffix = `_${eventName}`;
                        const stepFileName = `${timestampStr}_${baseName}_${viewId}${eventSuffix}.${ext || 'md'}`;
                        const stepFilePath = getFileInFolderPath(targetFilePath, stepFileName);
                        
                        // 尝试读取文件（如果文件不存在，直接使用流式状态中的内容，不创建文件）
                        try {
                            const rawContent = await getFile(stepFilePath);
                            // 检查是否是错误响应
                            if (rawContent.trim().startsWith('{') && rawContent.includes('"error"')) {
                                // 文件不存在，使用流式状态中的内容（不创建文件）
                                fileContent = stepResults[viewId] || '';
                            } else {
                                // 文件存在，解析内容（跳过头部信息）
                                const lines = rawContent.split('\n');
                                // 查找最后一个步骤的内容（因为可能是追加模式）
                                const stepMarker = /步骤：[\dN]+\+.*/;
                                let contentStartIndex = 0;
                                for (let i = lines.length - 1; i >= 0; i--) {
                                    if (stepMarker.test(lines[i])) {
                                        contentStartIndex = i + 1;
                                        break;
                                    }
                                }
                                if (contentStartIndex > 0 && contentStartIndex < lines.length) {
                                    fileContent = lines.slice(contentStartIndex).join('\n').trim();
                                } else if (lines.length > 3) {
                                    fileContent = lines.slice(3).join('\n');
                                } else {
                                    fileContent = rawContent;
                                }
                            }
                        } catch (err) {
                            // 文件不存在或读取失败，使用流式状态中的内容（不创建文件）
                            fileContent = stepResults[viewId] || '';
                        }
                    } catch (err) {
                        // 文件不存在或读取失败，使用流式状态中的内容
                        // 不输出错误日志，避免404错误污染控制台
                        fileContent = stepResults[viewId] || '';
                    }
                } else {
                    // 无法构造路径或没有eventName，使用流式状态中的内容
                    fileContent = stepResults[viewId] || '';
                }
            } else {
                // 已完成的步骤但没有文件路径，使用流式状态中的内容
                fileContent = stepResults[viewId] || '';
            }
            
            return { viewId, fileContent };
        });
        
        const fileContents = await Promise.all(fileContentPromises);
        
        // 使用文件内容显示
        fileContents.forEach(({ viewId, fileContent }, index) => {
            const isExecuting = executingSteps.includes(viewId);
            const statusIcon = isExecuting ? '⏳' : '✓';
            const statusLabel = isExecuting ? '[执行中]' : '[已完成]';
            
            // 获取步骤信息，使用stepIndex作为步骤编号
            const stepInfo = viewIdToStepMap.get(viewId);
            const stepNumber = stepInfo ? stepInfo.stepIndex : (index + 1);
            
            // 使用文件内容的长度，而不是流式状态中的内容长度
            const contentLength = fileContent.length;
            
            // 显示更多内容预览
            const contentPreview = contentLength > 800 
                ? fileContent.substring(0, 800) + '...' 
                : fileContent;
            
            statusText += `${statusIcon} [步骤${stepNumber}] ${statusLabel} 视图: ${viewId}\n`;
            statusText += `内容长度: ${contentLength} 字符\n`;
            if (isExecuting) {
                // 执行中时，如果有内容就显示文件内容，否则显示"正在生成..."
                if (fileContent && fileContent.length > 0) {
                    // 执行中时显示文件内容（完整显示，不截断）
                    statusText += `实时内容:\n${contentPreview}\n`;
                } else {
                    // 执行中但还没有内容，显示"正在生成..."
                    statusText += `正在生成...\n`;
                }
            } else if (fileContent) {
                statusText += `预览: ${contentPreview.replace(/\n/g, ' ').substring(0, 200)}...\n`;
            } else {
                statusText += `等待中...\n`;
            }
            statusText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        });
    }
    
    // 创建状态显示容器（包含复制按钮和终止按钮）
    const isGlobalStatus = statusEl.id === 'workflow-execution-status-global';
    if (isGlobalStatus) {
        // 如果是全局状态元素，需要创建完整的UI结构
        statusEl.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border);">
                <div style="font-weight: bold; color: var(--accent-blue);">工作流执行状态</div>
                <div style="display: flex; gap: 8px;">
                    <button id="copy-workflow-log-btn" class="btn btn-secondary" style="font-size: 12px; padding: 4px 12px;">复制日志</button>
                    <button id="cancel-workflow-global-btn" class="btn btn-secondary" style="font-size: 12px; padding: 4px 12px;">终止</button>
                    <button id="close-workflow-status-btn" class="btn btn-secondary" style="font-size: 12px; padding: 4px 12px;">关闭</button>
                </div>
            </div>
            <div id="workflow-execution-status-content" style="white-space: pre-wrap; word-break: break-all; overflow-wrap: break-word;"></div>
        `;
        
        const contentEl = statusEl.querySelector('#workflow-execution-status-content');
        if (contentEl) {
            contentEl.textContent = statusText;
            // 关键修复：取消自动滚动到底部，让用户可以查看历史日志
            // contentEl.scrollTop = contentEl.scrollHeight;
        }
        
        // 绑定复制按钮
        const copyBtn = statusEl.querySelector('#copy-workflow-log-btn');
        if (copyBtn) {
            copyBtn.onclick = async () => {
                try {
                    await navigator.clipboard.writeText(statusText);
                    const originalText = copyBtn.textContent;
                    copyBtn.textContent = '已复制';
                    setTimeout(() => {
                        copyBtn.textContent = originalText;
                    }, 1500);
                } catch (err) {
                    alert('复制失败: ' + err.message);
                }
            };
        }
        
        // 绑定终止按钮
        const cancelGlobalBtn = statusEl.querySelector('#cancel-workflow-global-btn');
        if (cancelGlobalBtn) {
            cancelGlobalBtn.onclick = () => {
                if (confirm('确定要终止当前工作流执行吗？')) {
                    if (window.cancelWorkflow) {
                        window.cancelWorkflow();
                    }
                }
            };
        }
        
        // 绑定关闭按钮
        const closeBtn = statusEl.querySelector('#close-workflow-status-btn');
        if (closeBtn) {
            closeBtn.onclick = () => {
                statusEl.style.display = 'none';
            };
        }
        
        // 显示全局状态元素
        statusEl.style.display = 'block';
    } else {
        // 事件面板中的状态元素
        // 关键修复：如果还没有初始化增强显示，先初始化
        if (statusEl && statusEl.dataset.enhanced !== 'true') {
            // 保存原始内容
            const originalContent = statusEl.textContent || '';
            // 初始化增强显示
            initEnhancedLogDisplay();
            // 恢复原始内容（如果存在）
            if (originalContent) {
                const hiddenTextArea = statusEl.querySelector('#workflow-execution-status-text-hidden');
                if (hiddenTextArea) {
                    hiddenTextArea.value = originalContent + '\n' + statusText;
                }
                renderEnhancedLogOnUpdate();
            }
        } else if (statusEl && statusEl.dataset.enhanced === 'true') {
            // 已经使用增强显示，直接更新文本内容到隐藏区域
            const hiddenTextArea = statusEl.querySelector('#workflow-execution-status-text-hidden');
            if (hiddenTextArea) {
                // 追加新内容，而不是替换
                const currentContent = hiddenTextArea.value || '';
                hiddenTextArea.value = currentContent + (currentContent ? '\n' : '') + statusText;
                renderEnhancedLogOnUpdate();
            } else {
                // 回退到普通模式
                statusEl.textContent = statusText;
            }
        } else {
            // 普通模式
            statusEl.textContent = statusText;
        }
        // 关键修复：取消自动滚动到底部，让用户可以查看历史日志
        // statusEl.scrollTop = statusEl.scrollHeight;
    }
    
    // 更新全屏日志显示（如果全屏日志模态框已打开）
    const fullscreenModal = document.getElementById('workflow-log-fullscreen-modal');
    const fullscreenContent = document.getElementById('workflow-log-fullscreen-content');
    if (fullscreenModal && fullscreenContent && fullscreenModal.style.display === 'flex') {
        // 构建全屏日志内容（包含目录执行信息）
        let fullscreenText = statusText;
        
        // 如果是目录执行，添加更详细的文件列表信息
        if (execState.currentFilePath && execState.totalFiles) {
            fullscreenText += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            fullscreenText += `目录执行详情:\n`;
            fullscreenText += `总文件数: ${execState.totalFiles}\n`;
            fullscreenText += `当前文件索引: ${execState.currentFileIndex || 0}\n`;
            fullscreenText += `当前文件路径: ${execState.currentFilePath}\n`;
            fullscreenText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        }
        
        fullscreenContent.textContent = fullscreenText;
        // 关键修复：取消自动滚动到底部，让用户可以查看历史日志
        // fullscreenContent.scrollTop = fullscreenContent.scrollHeight;
    }
    
    // 显示/隐藏控制按钮（只在事件面板中）
    if (!isGlobalStatus) {
        if (execState.isCancelled) {
            if (pauseBtn) pauseBtn.style.display = 'none';
            if (resumeBtn) resumeBtn.style.display = 'none';
            if (cancelBtn) cancelBtn.style.display = 'none';
        } else if (execState.isPaused) {
            if (pauseBtn) pauseBtn.style.display = 'none';
            if (resumeBtn) resumeBtn.style.display = 'inline-block';
            if (cancelBtn) cancelBtn.style.display = 'inline-block';
        } else {
            if (pauseBtn) pauseBtn.style.display = 'inline-block';
            if (resumeBtn) resumeBtn.style.display = 'none';
            if (cancelBtn) cancelBtn.style.display = 'inline-block';
        }
    }
    
    // 更新导航栏的执行指示器
    updateNavigationExecutionIndicator();
    
    // 如果全屏日志模态框是打开的，也更新它的内容（合并到上面的代码块中，避免重复声明）
    // 注意：fullscreenModal 和 fullscreenContent 已在上面声明，这里直接使用
}

/**
 * 更新导航栏的执行指示器
 */
export function updateNavigationExecutionIndicator() {
    const indicator = document.getElementById('workflow-execution-indicator');
    const execState = state.workflowExecutionState;
    
    if (!execState || execState.isCompleted || execState.isCancelled) {
        // 没有执行状态或已结束，隐藏指示器
        if (indicator) {
            indicator.style.display = 'none';
            // 如果指示器在feedback-notices-row中，检查是否需要隐藏整个row
            const noticesRow = document.getElementById('feedback-notices-row');
            if (noticesRow && indicator.parentElement === noticesRow) {
                // 检查是否还有反馈生成提示显示
                const feedbackNotice = document.getElementById('feedback-generating-notice');
                if (!feedbackNotice || feedbackNotice.style.display === 'none') {
                    noticesRow.style.display = 'none';
                }
            }
        }
        state.isWorkflowExecuting = false;
        return;
    }
    
    // 有执行状态且未结束，显示指示器
    const noticesRow = document.getElementById('feedback-notices-row');
    
    if (!indicator) {
        // 创建指示器，插入到feedback-notices-row中
        // 如果noticesRow存在，显示它（即使反馈生成提示未显示）
        if (noticesRow) {
            noticesRow.style.display = 'flex';
            const newIndicator = document.createElement('div');
            newIndicator.id = 'workflow-execution-indicator';
            newIndicator.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 4px 12px;
                background: var(--accent-bg);
                color: var(--accent-blue);
                border: 1px solid var(--accent-blue);
                border-radius: var(--border-radius);
                font-size: 12px;
                cursor: pointer;
            `;
            newIndicator.innerHTML = `
                <span>⏳</span>
                <span>执行中</span>
            `;
            newIndicator.title = '点击查看工作流执行状态';
            newIndicator.onclick = () => {
                // 打开事件面板或显示全局状态
                const eventPanel = document.getElementById('event-panel');
                if (eventPanel) {
                    eventPanel.style.display = 'flex';
                    eventPanel.focus();
                } else {
                    // 显示全局状态
                    const globalStatus = document.getElementById('workflow-execution-status-global');
                    if (globalStatus) {
                        globalStatus.style.display = 'block';
                    }
                }
            };
            // 插入到feedback-notices-row中（在反馈生成提示之后）
            noticesRow.appendChild(newIndicator);
        } else {
            // 如果feedback-notices-row不存在，回退到header-controls
            const headerControls = document.getElementById('header-controls');
            if (headerControls) {
                const newIndicator = document.createElement('div');
                newIndicator.id = 'workflow-execution-indicator';
                newIndicator.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 4px 12px;
                    background: var(--accent-bg);
                    color: var(--accent-blue);
                    border: 1px solid var(--accent-blue);
                    border-radius: var(--border-radius);
                    font-size: 12px;
                    cursor: pointer;
                    margin-right: 8px;
                `;
                newIndicator.innerHTML = `
                    <span>⏳</span>
                    <span>执行中</span>
                `;
                newIndicator.title = '点击查看工作流执行状态';
                newIndicator.onclick = () => {
                    const eventPanel = document.getElementById('event-panel');
                    if (eventPanel) {
                        eventPanel.style.display = 'flex';
                        eventPanel.focus();
                    } else {
                        const globalStatus = document.getElementById('workflow-execution-status-global');
                        if (globalStatus) {
                            globalStatus.style.display = 'block';
                        }
                    }
                };
                headerControls.insertBefore(newIndicator, headerControls.firstChild);
            }
        }
    } else {
        // 更新现有指示器
        // 如果指示器不在feedback-notices-row中，移动到那里
        if (noticesRow && indicator.parentElement !== noticesRow) {
            // 从原位置移除
            indicator.remove();
            // 添加到feedback-notices-row
            noticesRow.appendChild(indicator);
        }
        
        // 确保指示器有正确的内容（如果HTML中已有空元素）
        if (!indicator.innerHTML || indicator.innerHTML.trim() === '') {
            indicator.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 4px 12px;
                background: var(--accent-bg);
                color: var(--accent-blue);
                border: 1px solid var(--accent-blue);
                border-radius: var(--border-radius);
                font-size: 12px;
                cursor: pointer;
            `;
            indicator.innerHTML = `
                <span>⏳</span>
                <span>执行中</span>
            `;
            indicator.title = '点击查看工作流执行状态';
            indicator.onclick = () => {
                // 打开事件面板或显示全局状态
                const eventPanel = document.getElementById('event-panel');
                if (eventPanel) {
                    eventPanel.style.display = 'flex';
                    eventPanel.focus();
                } else {
                    // 显示全局状态
                    const globalStatus = document.getElementById('workflow-execution-status-global');
                    if (globalStatus) {
                        globalStatus.style.display = 'block';
                    }
                }
            };
        }
        
        // 确保显示
        indicator.style.display = 'inline-flex';
        state.isWorkflowExecuting = true;
        
        // 确保feedback-notices-row显示
        if (noticesRow) {
            noticesRow.style.display = 'flex';
        }
    }
}

/**
 * 加载工作流列表
 */
export async function loadWorkflows() {
    try {
        const data = await getWorkflows();
        state.workflows = data.workflows || [];
        renderWorkflowsList();
    } catch (err) {
        console.error('Failed to load workflows:', err);
        state.workflows = [];
    }
}

/**
 * 渲染工作流列表
 */
export function renderWorkflowsList(searchTerm = '') {
    const list = document.getElementById('workflows-list');
    if (!list) return;

    list.innerHTML = '';

    const filteredWorkflows = state.workflows.filter(workflow =>
        !searchTerm ||
        workflow.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (filteredWorkflows.length === 0) {
        list.innerHTML = '<div style="color: var(--text-muted); font-style: italic; padding: 10px;">没有找到匹配的工作流</div>';
        return;
    }

    filteredWorkflows.forEach(workflow => {
        const item = document.createElement('div');
        item.className = 'workflow-item';
        item.innerHTML = `
            <div class="file-item type-file" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; margin-bottom: 6px; cursor: pointer; position: relative;" onclick="window.selectWorkflow('${workflow.name}')">
                <div style="flex: 1; min-width: 0; text-align: left;">
                    <div class="workflow-name-display" style="font-weight: bold; color: var(--accent-blue); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 60px;">${workflow.name}</div>
                    <div style="font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-left: 2em;">&nbsp;&nbsp;${new Date(workflow.updatedAt).toLocaleString()}</div>
                </div>
                <div style="display: flex; gap: 5px; position: absolute; right: 14px; transition: opacity 0.3s; opacity: 0;" class="workflow-actions">
                    <button class="btn" onclick="event.stopPropagation(); window.previewWorkflow('${workflow.name}')" style="font-size: 12px; padding: 4px 8px;">预览</button>
                    <button class="btn" onclick="event.stopPropagation(); window.editWorkflow('${workflow.name}')" style="font-size: 12px; padding: 4px 8px;">编辑</button>
                    <button class="btn" onclick="event.stopPropagation(); window.removeWorkflow('${workflow.name}')" style="font-size: 12px; padding: 4px 8px;">删除</button>
                </div>
            </div>
        `;
        list.appendChild(item);

        // 添加悬停效果
        const actions = item.querySelector('.workflow-actions');
        item.addEventListener('mouseenter', () => {
            if (actions) actions.style.opacity = '1';
        });
        item.addEventListener('mouseleave', () => {
            if (actions) actions.style.opacity = '0';
        });
    });
}

/**
 * 解析工作流格式：((x)(y)[上一个id]+[自己id]+(x)(y)[下一个id]) +((x)(y)[上一个工作流id]+[工作流自己id]+(x)(y)[工作流的下一个id])
 * @param {string} workflowContent - 工作流内容
 * @returns {Array<{x: number, y: number, viewId: string, workflowId: string|null, viewPrev: string[], viewNext: string[], workflowPrev: string[], workflowNext: string[]}>}
 */
export function parseWorkflowFormat(workflowContent) {
    const steps = [];
    // 匹配完整格式：((x)(y)[prev]+[self]+(x)(y)[next]) +((x)(y)[prev_workflow]+[self_workflow]+(x)(y)[next_workflow])
    // 也兼容只有视图部分的情况：((x)(y)[prev]+[self]+(x)(y)[next])
    const regex = /\(\((\d+)\)\((\d+)\)\[([^\]]*)\]\+\[([^\]]+)\]\+\((\d+)\)\((\d+)\)\[([^\]]*)\]\)(?:\s*\+\s*\(\((\d+)\)\((\d+)\)\[([^\]]*)\]\+\[([^\]]*)\]\+\((\d+)\)\((\d+)\)\[([^\]]*)\]\))?/g;
    let match;
    
    while ((match = regex.exec(workflowContent)) !== null) {
        // 视图部分
        const viewX = parseInt(match[1]) || 0;
        const viewY = parseInt(match[2]) || 0;
        const viewPrevStr = match[3] ? match[3].trim() : '无';
        const viewId = match[4] ? match[4].trim() : '';
        const viewNextX = parseInt(match[5]) || 0;
        const viewNextY = parseInt(match[6]) || 0;
        const viewNextStr = match[7] ? match[7].trim() : '无';
        
        // 工作流部分（可选）
        let workflowX = 0, workflowY = 0, workflowId = null;
        let workflowPrevStr = '无', workflowNextStr = '无';
        let workflowNextX = 0, workflowNextY = 0;
        
        if (match[8] !== undefined) {
            workflowX = parseInt(match[8]) || 0;
            workflowY = parseInt(match[9]) || 0;
            workflowPrevStr = match[10] ? match[10].trim() : '无';
            workflowId = match[11] ? match[11].trim() : null;
            workflowNextX = parseInt(match[12]) || 0;
            workflowNextY = parseInt(match[13]) || 0;
            workflowNextStr = match[14] ? match[14].trim() : '无';
            if (workflowId === '' || workflowId === '无') workflowId = null;
        }
        
        // 处理"无"的情况
        const viewPrevIds = viewPrevStr === '无' ? [] : viewPrevStr.split(',').map(id => id.trim()).filter(id => id && id !== '无');
        const viewNextIds = viewNextStr === '无' ? [] : viewNextStr.split(',').map(id => id.trim()).filter(id => id && id !== '无');
        const workflowPrevIds = workflowPrevStr === '无' ? [] : workflowPrevStr.split(',').map(id => id.trim()).filter(id => id && id !== '无');
        const workflowNextIds = workflowNextStr === '无' ? [] : workflowNextStr.split(',').map(id => id.trim()).filter(id => id && id !== '无');
        
        steps.push({
            x: viewX,
            y: viewY,
            viewId: viewId,
            workflowId: workflowId,
            viewPrev: viewPrevIds,
            viewNext: viewNextIds,
            workflowPrev: workflowPrevIds,
            workflowNext: workflowNextIds
        });
    }
    
    // 如果没有匹配到新格式，尝试旧格式兼容
    if (steps.length === 0) {
        const oldRegex = /\(\[([^\]]+)\]\+\[([^\]]+)\]\+\[([^\]]+)\]\)/g;
        let oldMatch;
        let index = 0;
        while ((oldMatch = oldRegex.exec(workflowContent)) !== null) {
            const prevStr = oldMatch[1].trim();
            const selfId = oldMatch[2].trim();
            const nextStr = oldMatch[3].trim();
            
            const prevIds = prevStr === '无' ? [] : prevStr.split(',').map(id => id.trim()).filter(id => id && id !== '无');
            const nextIds = nextStr === '无' ? [] : nextStr.split(',').map(id => id.trim()).filter(id => id && id !== '无');
            
            steps.push({
                x: 0,
                y: index,
                viewId: selfId,
                workflowId: null,
                viewPrev: prevIds,
                viewNext: nextIds,
                workflowPrev: [],
                workflowNext: []
            });
            index++;
        }
    }
    
    return steps;
}

/**
 * 生成工作流格式：((x)(y)[上一个id]+[自己id]+(x)(y)[下一个id]) +((x)(y)[上一个工作流id]+[工作流自己id]+(x)(y)[工作流的下一个id])
 * @param {Array<{x: number, y: number, viewId: string, workflowId: string|null, viewPrev: string[], viewNext: string[], workflowPrev: string[], workflowNext: string[]}>} steps - 工作流步骤
 * @returns {string}
 */
export function generateWorkflowFormat(steps) {
    // 构建步骤映射：viewId -> step（用于查找下一个节点的坐标）
    const stepMapByViewId = new Map();
    const stepMapByWorkflowId = new Map();
    steps.forEach(step => {
        if (step.viewId) {
            if (!stepMapByViewId.has(step.viewId)) {
                stepMapByViewId.set(step.viewId, []);
            }
            stepMapByViewId.get(step.viewId).push(step);
        }
        if (step.workflowId) {
            if (!stepMapByWorkflowId.has(step.workflowId)) {
                stepMapByWorkflowId.set(step.workflowId, []);
            }
            stepMapByWorkflowId.get(step.workflowId).push(step);
        }
    });
    
    // 辅助函数：查找下一个节点的坐标
    // 关键修复：nextIds可能包含viewId或workflowId，需要同时检查两个映射
    const findNextNodeCoordinates = (nextIds, isWorkflow = false) => {
        if (nextIds.length === 0) {
            return { x: 0, y: 0 };
        }
        // 如果有多个next，返回第一个next的坐标
        const firstNextId = nextIds[0];
        
        // 关键修复：同时检查viewId和workflowId映射，因为viewNext可能包含两种类型的ID
        let candidates = stepMapByViewId.get(firstNextId) || [];
        if (candidates.length === 0) {
            // 如果viewId映射中找不到，尝试workflowId映射
            candidates = stepMapByWorkflowId.get(firstNextId) || [];
        }
        
        if (candidates.length > 0) {
            // 如果有多个候选，选择y坐标最小的（最接近当前节点的）
            const sortedCandidates = candidates.sort((a, b) => {
                if (a.y !== b.y) return a.y - b.y;
                return a.x - b.x;
            });
            return { x: sortedCandidates[0].x, y: sortedCandidates[0].y };
        }
        
        // 如果还是找不到，尝试在所有步骤中查找（可能是跨类型的连接）
        for (const step of steps) {
            if (step.viewId === firstNextId || step.workflowId === firstNextId) {
                return { x: step.x, y: step.y };
            }
        }
        
        return { x: 0, y: 0 };
    };
    
    return steps.map(step => {
        // 关键修复：如果步骤有工作流节点，清除视图节点，避免视图节点和工作流节点在同一个步骤
        const hasWorkflowNode = step.workflowId && step.workflowId.trim() !== '';
        const hasViewNode = step.viewId && step.viewId.trim() !== '';
        
        if (hasWorkflowNode) {
            // 有工作流节点：只生成工作流部分，不生成视图部分
            // 工作流节点的前一个节点应该从viewPrev中获取（因为工作流节点替换了视图节点）
            // 工作流节点的下一个节点应该从viewNext中获取（因为工作流节点替换了视图节点）
            const effectiveWorkflowPrev = step.viewPrev.length > 0 ? step.viewPrev : step.workflowPrev;
            const effectiveWorkflowNext = step.viewNext.length > 0 ? step.viewNext : step.workflowNext;
            
            const workflowPrevStr = effectiveWorkflowPrev.length > 0 ? effectiveWorkflowPrev.join(',') : '无';
            const workflowNextStr = effectiveWorkflowNext.length > 0 ? effectiveWorkflowNext.join(',') : '无';
            
            // 关键修复：查找下一个节点的实际坐标
            const nextCoords = findNextNodeCoordinates(effectiveWorkflowNext, true);
            const workflowNextX = nextCoords.x;
            const workflowNextY = nextCoords.y;
            
            return `((${step.x})(${step.y})[${workflowPrevStr}]+[${step.workflowId}]+(${workflowNextX})(${workflowNextY})[${workflowNextStr}])`;
        } else if (hasViewNode) {
            // 没有工作流节点但有视图节点：只生成视图部分
            const viewPrevStr = step.viewPrev.length > 0 ? step.viewPrev.join(',') : '无';
            const viewNextStr = step.viewNext.length > 0 ? step.viewNext.join(',') : '无';
            
            // 关键修复：查找下一个节点的实际坐标
            const nextCoords = findNextNodeCoordinates(step.viewNext, false);
            const viewNextX = nextCoords.x;
            const viewNextY = nextCoords.y;
            
            return `((${step.x})(${step.y})[${viewPrevStr}]+[${step.viewId}]+(${viewNextX})(${viewNextY})[${viewNextStr}])`;
        } else {
            // 既没有工作流节点也没有视图节点：跳过这个步骤（不应该发生）
            return '';
        }
    }).filter(result => result !== '').join('\n');
}

/**
 * 在工作流列表中查找匹配的工作流名称（支持精确匹配和模糊匹配）
 * @param {string} workflowName - 要查找的工作流名称
 * @returns {string|null} 匹配的工作流名称（精确匹配优先，否则返回最相似的）
 */
function findWorkflowInList(workflowName) {
    if (!workflowName || !state.workflows || state.workflows.length === 0) {
        return null;
    }
    
    const normalizedName = workflowName.trim();
    if (!normalizedName) return null;
    
    // 1. 精确匹配（大小写不敏感）
    const exactMatch = state.workflows.find(w => 
        w.name && w.name.trim().toLowerCase() === normalizedName.toLowerCase()
    );
    if (exactMatch) {
        return exactMatch.name;
    }
    
    // 2. 包含匹配（工作流名称包含输入的名称，或输入的名称包含工作流名称）
    const containsMatch = state.workflows.find(w => {
        if (!w.name) return false;
        const wName = w.name.trim().toLowerCase();
        const inputName = normalizedName.toLowerCase();
        return wName.includes(inputName) || inputName.includes(wName);
    });
    if (containsMatch) {
        return containsMatch.name;
    }
    
    // 3. 开头匹配（工作流名称以输入的名称开头，或输入的名称以工作流名称开头）
    const startsWithMatch = state.workflows.find(w => {
        if (!w.name) return false;
        const wName = w.name.trim().toLowerCase();
        const inputName = normalizedName.toLowerCase();
        return wName.startsWith(inputName) || inputName.startsWith(wName);
    });
    if (startsWithMatch) {
        return startsWithMatch.name;
    }
    
    return null;
}

/**
 * 检测AI消息中是否包含工作流控制指令
 * @param {string} message - AI消息内容
 * @param {boolean} validateWorkflow - 是否验证工作流是否存在于列表中（默认true）
 * @returns {object|null} {action: 'terminate'|'continue', workflowName: string|null, matchedWorkflowName: string|null}
 */
function detectWorkflowControl(message, validateWorkflow = true) {
    if (!message) return null;
    
    // 检测终止工作流：支持多种写法
    const terminatePatterns = [
        /终止工作流[：:：:]\s*([^\n\r]+)?/i,
        /stop\s+workflow[：:：:]\s*([^\n\r]+)?/i,
        /terminate\s+workflow[：:：:]\s*([^\n\r]+)?/i,
        /<终止工作流[^>]*>([^<]+)?<\/终止工作流>/i,
        /```workflow-control\s+terminate\s+([^`]+)?```/i
    ];
    
    // 检测继续工作流
    const continuePatterns = [
        /继续工作流[：:：:]\s*([^\n\r]+)/i,
        /continue\s+workflow[：:：:]\s*([^\n\r]+)/i,
        /resume\s+workflow[：:：:]\s*([^\n\r]+)/i,
        /<继续工作流[^>]*>([^<]+)<\/继续工作流>/i,
        /```workflow-control\s+continue\s+([^`]+)```/i
    ];
    
    for (const pattern of terminatePatterns) {
        const match = message.match(pattern);
        if (match) {
            const workflowName = match[1] ? match[1].trim() : null;
            return { action: 'terminate', workflowName };
        }
    }
    
    for (const pattern of continuePatterns) {
        const match = message.match(pattern);
        if (match) {
            let workflowName = match[1] ? match[1].trim() : null;
            // 去除可能的加粗标记（**）和其他格式标记，兼容工作流列表中的格式
            if (workflowName) {
                workflowName = workflowName.replace(/\*\*/g, '').trim(); // 去除加粗标记
                workflowName = workflowName.replace(/^[0-9]+\.\s*/, '').trim(); // 去除列表序号
            }
            
            // 如果启用验证，在工作流列表中查找匹配的工作流
            let matchedWorkflowName = null;
            if (validateWorkflow && workflowName) {
                matchedWorkflowName = findWorkflowInList(workflowName);
                // 如果找到匹配的工作流，使用匹配的名称（确保使用正确的工作流名称）
                if (matchedWorkflowName) {
                    workflowName = matchedWorkflowName;
                }
            }
            
            return { 
                action: 'continue', 
                workflowName: workflowName,
                matchedWorkflowName: matchedWorkflowName, // 如果找到匹配，返回匹配的名称
                isValid: validateWorkflow ? (matchedWorkflowName !== null) : true // 是否在列表中找到匹配
            };
        }
    }
    
    return null;
}

/**
 * 安全地更新 workflowExecutionState 的 stepResults
 * 
 * 使用场景：在工作流步骤执行时，更新单个步骤的结果。
 * 此函数用于单个工作流内的步骤执行，不用于批量文件并发执行。
 * 
 * @param {string} viewId - 视图ID
 * @param {string} content - 内容
 * @param {object} options - 执行选项，包含 batchFilePath
 * @returns {boolean} 是否成功更新
 */
function safeUpdateStepResults(viewId, content, options = {}) {
    // 检查 workflowExecutionState 是否存在
    if (!state.workflowExecutionState) {
        console.warn(`[safeUpdateStepResults] workflowExecutionState 不存在，跳过更新 ${viewId}`);
        return false;
    }
    
    // 确保 stepResults 存在
    if (!state.workflowExecutionState.stepResults) {
        state.workflowExecutionState.stepResults = {};
    }
    
    // 更新 stepResults
    state.workflowExecutionState.stepResults[viewId] = content;
    return true;
}

/**
 * 安全地更新 workflowExecutionState 的完整状态
 * 
 * 使用场景：在工作流步骤并发执行时（单个文件的工作流内部），使用增量更新而不是替换，
 * 确保多个步骤同时更新状态时不会丢失数据。
 * 
 * 注意：此函数用于单个工作流内的步骤并发执行，不用于批量文件并发执行。
 * 批量文件并发执行时，每个文件有独立的executeEventForFile执行上下文，
 * 每个上下文会创建和恢复自己的workflowExecutionState。
 * 
 * @param {object} stepResults - 步骤结果（增量更新）
 * @param {Array} executedSteps - 已执行步骤（增量更新）
 * @param {Set} executingSteps - 执行中步骤
 * @param {object} options - 执行选项
 * @returns {boolean} 是否成功更新
 */
function safeUpdateWorkflowState(stepResults, executedSteps, executingSteps, options = {}) {
    // 检查 workflowExecutionState 是否存在
    if (!state.workflowExecutionState) {
        console.warn(`[safeUpdateWorkflowState] workflowExecutionState 不存在，跳过更新`);
        return false;
    }
    
    // 使用增量更新而不是替换，确保工作流步骤并发执行时的并发更新不会丢失
    // 对于 stepResults，合并更新而不是替换
    if (stepResults) {
        if (!state.workflowExecutionState.stepResults) {
            state.workflowExecutionState.stepResults = {};
        }
        // 合并新的 stepResults 到现有状态中
        Object.assign(state.workflowExecutionState.stepResults, stepResults);
    }
    
    // 对于 executedSteps，合并更新而不是替换
    if (executedSteps) {
        if (!state.workflowExecutionState.executedSteps) {
            state.workflowExecutionState.executedSteps = [];
        }
        // 合并新的 executedSteps 到现有状态中（去重）
        // 使用stepIndex来去重，而不是viewId，因为不同位置的步骤可能有相同的viewId
        const existingStepIndices = new Set(state.workflowExecutionState.executedSteps.map(es => es.stepIndex));
        executedSteps.forEach(es => {
            if (!existingStepIndices.has(es.stepIndex)) {
                state.workflowExecutionState.executedSteps.push(es);
                existingStepIndices.add(es.stepIndex);
            }
        });
    }
    
    // 对于 executingSteps，直接更新（这个不需要合并）
    if (executingSteps !== undefined) {
        state.workflowExecutionState.executingSteps = executingSteps instanceof Set ? executingSteps : new Set(executingSteps);
    }
    return true;
}

/**
 * 执行工作流步骤（单个步骤）
 * @param {object} step - 工作流步骤 {x, y, viewId, workflowId, viewPrev, viewNext, workflowPrev, workflowNext} 或旧格式 {prev, self, next}
 * @param {object} stepResults - 已执行步骤的结果 {viewId: content}
 * @param {object} options - 执行选项 {stepIndex: number, useStream: boolean, eventTimestamp: string}
 * @returns {Promise<{viewId: string, content: string, aiFilePath: string, stepFilePath: string, workflowControl: object|null}>}
 */
async function executeWorkflowStep(step, stepResults, options = {}) {
    // 兼容新旧格式
    const viewId = step.viewId || step.self;
    const viewPrev = step.viewPrev || step.prev || [];
    
    // 在步骤开始时立即写入日志（以便并发步骤的日志能同时显示）
    // 关键修复：嵌套工作流中的步骤应该写入日志，使用本体工作流的事件信息
    const stepStartTimestamp = new Date().toISOString();
    if (state.workflowExecutionState) {
        // 如果是嵌套工作流，从父状态获取事件信息
        const parentState = options.isNestedWorkflow ? state.workflowExecutionState.parentWorkflowState : null;
        // 关键修复：优先从 eventName 字段获取（新保存的字段），其次从 options.eventName 获取
        const actualEventName = parentState?.eventName || parentState?.options?.eventName || state.workflowExecutionState.eventName || state.workflowExecutionState.options?.eventName || options.eventName || '';
        const actualExecutionId = parentState?.executionId || parentState?.batchExecutionId || state.workflowExecutionState.executionId || state.workflowExecutionState.batchExecutionId || '';
        const actualWorkflowName = parentState?.workflowName || state.workflowExecutionState.workflowName || '';
        
        // 关键修复：嵌套工作流中的步骤应该写入日志，使用本体工作流的事件信息
        if (!options.isNestedWorkflow || (actualEventName && actualExecutionId)) {
            // 如果是嵌套工作流，写入到父状态的日志中；否则写入到当前状态的日志中
            const targetState = options.isNestedWorkflow && parentState ? parentState : state.workflowExecutionState;
            if (!targetState.executionLogs) {
                targetState.executionLogs = [];
            }
            
            // 添加步骤开始的日志
            // 关键修复：从options中获取工作流节点信息，而不是硬编码
            const isWorkflowNode = options.isWorkflowNode || false;
            const workflowNodeName = options.workflowNodeName || null;
            
            const startLogMessage = `${viewId} -> [开始执行]`;
            targetState.executionLogs.push({
                stepIndex: options.stepIndex || 0,
                viewId: viewId,
                log: startLogMessage,
                timestamp: stepStartTimestamp,
                status: 'executing', // 标记为执行中
                prompt: null,
                sentContent: null,
                nextViews: step.viewNext || step.next || [],
                isWorkflowNode: isWorkflowNode,
                workflowNodeName: workflowNodeName
            });
            
            // 关键修复：嵌套工作流中的步骤应该使用appendDetailLog写入统一日志系统
            // 使用本体工作流的事件信息
            if (actualEventName && actualExecutionId && actualWorkflowName) {
                try {
                    const { appendDetailLog } = await import('./workflowExecutionLogger.js');
                    appendDetailLog(
                        actualExecutionId,
                        actualEventName,
                        actualWorkflowName,
                        options.stepIndex || 0,
                        '普通节点',
                        viewId,
                        `${viewId} -> [开始执行]`,
                        {
                            isWorkflowNode: false,
                            workflowNodeName: null
                        }
                    );
                } catch (logError) {
                    console.warn('[executeWorkflowStep] 写入开始日志失败:', logError);
                }
            }
            
            // 关键修复：只有在工作流执行状态存在时才触发状态更新
            if (state.workflowExecutionState) {
                updateWorkflowExecutionStatus();
            }
        }
    }
    
    // 使用内存传递stepResults，而不是传参
    // 确保从state中读取最新的stepResults（节点间消息传递使用内存）
    const memoryStepResults = state.workflowExecutionState?.stepResults || {};
    // 合并传入的stepResults和内存中的stepResults（内存优先）
    const finalStepResults = { ...stepResults, ...memoryStepResults };
    
    // 读取当前视图内容
    // 这是关键：readCurrentView 会从 state.rawContents[viewId] 读取内容
    // 在批量执行时，这个内容应该是当前正在处理的文件的真实内容
    const viewData = await readCurrentView(viewId);
    
    // 调试日志：验证读取的内容是否正确
    if (options.eventTimestamp) {
        // 使用批量处理的路径（如果存在），而不是主界面的路径
        const currentFilePath = state.workflowExecutionState?.batchFilePath || state.originalPath;
        const fileName = currentFilePath ? currentFilePath.split(/[/\\]/).pop() : 'unknown';
        const logMsg = `步骤 ${viewId} 读取文件 ${fileName} 的视图内容，长度: ${viewData.content.length} 字符`;
        f12Log(`[executeWorkflowStep] ${logMsg}`);
        // 关键修复：将日志保存到执行状态，以便在工作流执行状态日志中显示
        if (state.workflowExecutionState && !options.isNestedWorkflow) {
            addExecutionLog(logMsg, {
                stepIndex: options.stepIndex || 0,
                viewId: viewId,
                status: 'info'
            });
        }
    }
    
    // 构建消息内容
    let messages = [];
    
    // 构建用户消息：按照 前置节点内容 + 当前节点内容 + 下一节点提示 + 提示词 + 指令提示词 的顺序
    let userContent = '';
    // 关键修复：记录反馈部分的长度，用于日志显示
    let feedbackContentLength = 0;
    
    // 获取下一节点信息（用于提示AI）
    const viewNext = step.viewNext || step.next || [];
    
    // 1. 添加前置步骤的AI消息（使用节点标记格式）
    // 关键：当x轴、y轴下当前视图有同名视图时，把所有同名视图的结果拼接后再发送
    // 关键修复：优先从步骤文件读取内容，这样可以获取完整的步骤信息（包括步骤标记等）
    // 同时处理viewPrev和workflowPrev
    const workflowPrev = step.workflowPrev || [];
    const allPrevIds = [...(viewPrev || []), ...workflowPrev];
    if (allPrevIds.length > 0) {
        const prevContentsList = [];
        
        // 获取已执行的步骤信息（包含步骤文件路径）
        const executedStepsInfo = state.workflowExecutionState?.executedSteps || [];
        
        // 辅助函数：从AI文件读取内容，如果文件不存在则从内存读取
        const getStepContent = async (stepViewId) => {
            // 关键修复：读取AI文件而不是步骤文件
            // AI文件格式：文件名_视图ID_AI.md
            const targetFilePath = options.batchFilePath || 
                                  state.workflowExecutionState?.batchFilePath || 
                                  state.originalPath;
            
            if (!targetFilePath) {
                // 没有文件路径，从内存读取
                return finalStepResults[stepViewId] || null;
            }
            
            try {
                const { getFile } = await import('../core/api.js');
                const { getFileInFolderPath } = await import('../utils/fileUtils.js');
                
                // 构建AI文件路径
                const lastSeparatorIndex = Math.max(targetFilePath.lastIndexOf('\\'), targetFilePath.lastIndexOf('/'));
                const fileName = lastSeparatorIndex >= 0 ? targetFilePath.substring(lastSeparatorIndex + 1) : targetFilePath;
                const lastDotIndex = fileName.lastIndexOf('.');
                const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
                const ext = lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1).trim() : '';
                const aiFileName = `${baseName}_${stepViewId}_AI.${ext || 'md'}`;
                const aiFilePath = getFileInFolderPath(targetFilePath, aiFileName);
                
                // 读取AI文件
                const rawContent = await getFile(aiFilePath);
                // 检查是否是错误响应
                if (!rawContent.trim().startsWith('{') || !rawContent.includes('"error"')) {
                    // 文件存在，返回完整内容（AI文件包含时间戳和视图ID头部，但我们需要完整内容）
                    return rawContent.trim();
                }
            } catch (err) {
                // 文件读取失败，回退到内存读取
                console.warn(`[executeWorkflowStep] 从AI文件读取内容失败 (${stepViewId}):`, err);
            }
            
            // 文件不存在或读取失败，从内存读取（向后兼容）
            return finalStepResults[stepViewId] || null;
        };
        
        // 并行读取所有前置节点的内容（包括viewPrev和workflowPrev）
        const prevContentPromises = allPrevIds.map(async (prevId) => {
            // 检查是否有多个步骤输出到同一个节点（同名视图的情况）
            if (options.nodeOutputSteps && options.nodeOutputSteps.has(prevId)) {
                const outputStepIndices = options.nodeOutputSteps.get(prevId);
                const outputSteps = Array.from(outputStepIndices).map(idx => options.allSteps[idx]).filter(Boolean);
                
                // 如果找到多个步骤输出到同一个节点，需要拼接它们的结果
                if (outputSteps.length > 1) {
                    // 检查是否所有输出步骤都已完成
                    const allCompleted = outputSteps.every(s => {
                        const stepViewId = s.viewId || s.self;
                        return finalStepResults[stepViewId] || executedStepsInfo.some(es => es.step === stepViewId);
                    });
                    
                    if (allCompleted) {
                        // 所有输出步骤都已完成，并行读取它们的内容（优先从文件读取）
                        const contentPromises = outputSteps.map(s => {
                            const stepViewId = s.viewId || s.self;
                            return getStepContent(stepViewId).then(content => ({
                                step: s,
                                content: content,
                                x: s.x || 0,
                                y: s.y || 0
                            }));
                        });
                        const stepContents = await Promise.all(contentPromises);
                        const sortedSteps = stepContents
                            .filter(item => item.content)
                            .sort((a, b) => {
                                // 先按y坐标排序（时间轴），再按x坐标排序
                                if (a.y !== b.y) return a.y - b.y;
                                return a.x - b.x;
                            });
                        
                        if (sortedSteps.length > 0) {
                            // 拼接所有同名视图的内容
                            const combinedContent = sortedSteps.map(item => item.content).join('\n\n---\n\n');
                            return {
                                viewId: prevId,
                                content: combinedContent,
                                count: sortedSteps.length
                            };
                        }
                    } else {
                        // 有步骤未完成，这种情况不应该在这里被调用（应该在isNodeReady中处理）
                        // 如果单个步骤的结果存在，使用它
                        const content = await getStepContent(prevId);
                        if (content) {
                            return {
                                viewId: prevId,
                                content: content,
                                count: 1
                            };
                        }
                    }
                } else {
                    // 只有一个步骤输出到这个节点，使用单个结果（优先从文件读取）
                    const content = await getStepContent(prevId);
                    if (content) {
                        return {
                            viewId: prevId,
                            content: content,
                            count: 1
                        };
                    }
                }
            } else {
                // 没有nodeOutputSteps信息（向后兼容），直接使用单个结果（优先从文件读取）
                const content = await getStepContent(prevId);
                if (content) {
                    return {
                        viewId: prevId,
                        content: content,
                        count: 1
                    };
                }
            }
            return null;
        });
        
        const prevContents = await Promise.all(prevContentPromises);
        prevContents.forEach(item => {
            if (item) {
                prevContentsList.push(item);
            }
        });
        
        // 格式化前置内容，添加节点标记和坐标信息
        if (prevContentsList.length > 0) {
            prevContentsList.forEach((item) => {
                // 查找前置节点的坐标信息
                let prevX = null, prevY = null;
                if (options.allSteps) {
                    const prevStep = options.allSteps.find(s => (s.viewId || s.self) === item.viewId);
                    if (prevStep) {
                        prevX = prevStep.x !== undefined ? prevStep.x : null;
                        prevY = prevStep.y !== undefined ? prevStep.y : null;
                    }
                }
                // 为每个前置节点添加明确的标记和坐标
                userContent += formatWorkflowNodeContent(item.content, item.viewId, '前置节点', prevX, prevY);
            });
        }
    }
    
    // 2. 添加xy轴坐标系统阅读指南（只在第一个步骤时添加，避免重复）
    const currentStepX = step.x !== undefined ? step.x : null;
    const currentStepY = step.y !== undefined ? step.y : null;
    if (options.allSteps && options.allSteps.length > 0 && (!state.workflowExecutionState?._xyAxisGuideAdded)) {
        userContent += generateXYAxisGuide(options.allSteps);
        // 标记已添加指南，避免重复
        if (state.workflowExecutionState) {
            state.workflowExecutionState._xyAxisGuideAdded = true;
        }
    }
    
    // 3. 添加当前节点内容（使用节点标记格式，包含坐标信息）
    userContent += formatWorkflowNodeContent(viewData.content, viewId, '当前节点', currentStepX, currentStepY);
    
    // 4. 添加下一节点提示信息（让AI知道接下来要处理哪些节点，但不包含内容，包含坐标信息）
    if (viewNext.length > 0) {
        userContent += `下一节点提示:\n`;
        viewNext.forEach((nextId, index) => {
            // 查找下一节点的坐标信息
            let nextX = null, nextY = null;
            if (options.allSteps) {
                const nextStep = options.allSteps.find(s => (s.viewId || s.self) === nextId);
                if (nextStep) {
                    nextX = nextStep.x !== undefined ? nextStep.x : null;
                    nextY = nextStep.y !== undefined ? nextStep.y : null;
                }
            }
            const coordInfo = (nextX !== null && nextY !== null) ? `[坐标(x:${nextX}, y:${nextY})]` : '';
            userContent += `下一节点${index + 1}：${nextId}${coordInfo}（此节点尚未执行，你只需要知道它的存在，不要声称已处理或已完成它）\n`;
        });
        userContent += '\n';
    }
    
    // 3. 添加提示词（用户配置的提示词）
    if (viewData.prompt) {
        userContent += formatPromptContent(viewData.prompt, '视图提示词');
    }
    
    // 3.3. 添加工作流反馈内容（如果提供了）
    if (options.workflowFeedbackContent) {
        userContent += options.workflowFeedbackContent;
    }
    
    // 3.5. 添加工作流列表（从工作流管理面板动态获取）
    const workflows = state.workflows || [];
    if (workflows.length > 0) {
        userContent += `## 可用工作流列表\n\n`;
        workflows.forEach((workflow, index) => {
            userContent += `${index + 1}. **${workflow.name}**`;
            if (workflow.description) {
                userContent += `\n   功能：${workflow.description}`;
            }
            userContent += `\n\n`;
        });
    }
    
    // 4. 添加指令提示词（工作流控制指令）
    if (viewData.enableWorkflowControl !== false) {
        // 如果提示词配置启用了工作流控制（默认启用，如果字段不存在则启用），则追加指令说明
        const workflowControlPrompt = generateWorkflowControlPrompt();
        userContent += formatPromptContent(workflowControlPrompt, '工作流控制指令');
    } else if (!viewData.prompt) {
        // 即使没有原始提示词且工作流控制被禁用，如果完全没有提示词，也添加工作流控制指令说明
        const workflowControlPrompt = generateWorkflowControlPrompt();
        userContent += formatPromptContent(workflowControlPrompt, '工作流控制指令');
    }
    
    // 4.5. 添加关键字识别规则提示词（新增）
    const keywordRecognitionPrompt = await generateKeywordRecognitionPrompt();
    if (keywordRecognitionPrompt) {
        userContent += formatPromptContent(keywordRecognitionPrompt, '关键字识别规则');
    }
    
    // 4.6. 添加上一步关键字识别后的处理函数执行结果（如果有）
    // 关键修复：确保处理函数执行结果正确拼接发送给AI
    if (state.workflowExecutionState?.keywordExecutionResults) {
        const stepResults = state.workflowExecutionState.keywordExecutionResults.filter(
            r => r.stepIndex === (options.stepIndex || 0)
        );
        if (stepResults.length > 0) {
            // 使用导出的格式化函数
            const executionResultsContent = formatKeywordFunctionResults(stepResults.flatMap(sr => sr.results));
            if (executionResultsContent) {
                userContent += formatPromptContent(executionResultsContent, '关键字识别处理函数执行结果');
            }
        }
    }
    
    // 5. 添加处理指令
    userContent += '请根据以上内容进行处理和分析。\n\n';
    userContent += '【重要提示】以上内容中包含的节点标记（如"前置节点开始"、"当前节点开始"等）和坐标信息、提示词、工作流控制指令等，都是系统提供给你用于理解和执行任务的辅助信息。这些信息不需要在你的回复中明确提及或重复。请直接给出针对用户内容的核心处理结果，专注于提供有价值的分析和回答，而不是重复这些系统指令或标记信息。';
    
    // 5.5. 添加历史反馈文件内容（如果是事件执行）
    // 关键逻辑：
    // - 统一读取现有的工作流反馈、节点反馈文件拼接使用（不区分第一次执行）
    // - 执行后异步生成新的反馈文件，不等待完成
    //
    // 注意：此处不能使用尚未声明的 isEventExecution（否则会触发 "Cannot access 'isEventExecution' before initialization"）
    // 直接根据 options 计算是否为事件执行，避免暂时性死区问题
    // 关键修复：从 state.workflowExecutionState 中获取参数，确保每个节点都执行反馈拼接
    const isEventExecutionEarly = options.stepIndex !== undefined && (options.eventTimestamp || state.workflowExecutionState?.eventTimestamp);
    const eventName = options.eventName || state.workflowExecutionState?.eventName || state.workflowExecutionState?.options?.eventName || '';
    const eventTimestamp = options.eventTimestamp || state.workflowExecutionState?.eventTimestamp || '';
    const batchFilePath = options.batchFilePath || state.workflowExecutionState?.batchFilePath || state.originalPath;
    if (isEventExecutionEarly && eventName && eventTimestamp && batchFilePath) {
        try {
            const { readRecentNodeFeedbacks, readRecentWorkflowFeedbacks, getFeedbackConfig, countWorkflowFeedbackFiles } = await import('./feedbackManager.js');
            const targetFilePath = batchFilePath;
            
            // 获取当前工作流名称（用于读取工作流反馈）
            // 关键修复：嵌套工作流中的节点应该读取父工作流的反馈，而不是嵌套工作流自己的反馈
            // 这样可以避免反馈内容重复且过大
            let currentWorkflowName = '';
            if (options.isNestedWorkflow && options.parentWorkflowState) {
                // 嵌套工作流：使用父工作流的名称
                currentWorkflowName = options.parentWorkflowState.workflowName || '';
            } else {
                // 主工作流：使用当前工作流的名称
                currentWorkflowName = state.workflowExecutionState?.workflowName || '';
            }
            
            // 统计工作流反馈文件数量（根据事件名和工作流名）
            let workflowFeedbackCount = 0;
            try {
                workflowFeedbackCount = await countWorkflowFeedbackFiles(eventName, currentWorkflowName);
            } catch (countError) {
                console.warn(`[executeWorkflowStep] 统计工作流反馈文件数量失败:`, countError);
            }
            
            // 统一读取现有反馈文件（节点反馈和工作流反馈）
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
                    // 如果localStorage中没有配置，使用内存中的配置
                    config = getFeedbackConfig();
                }
            } catch (err) {
                console.warn(`[executeWorkflowStep] 读取配置失败，使用内存配置:`, err);
                config = getFeedbackConfig();
            }
            
            const feedbackCount = config.feedbackCount || 3;
            // 读取工作流反馈数量配置（如果配置了且大于0，使用配置值；否则使用节点反馈数量作为默认值）
            // 注意：如果workflowFeedbackCount为0或未配置，使用feedbackCount作为默认值
            const workflowFeedbackReadCount = (config.workflowFeedbackCount !== undefined && config.workflowFeedbackCount > 0) 
                ? config.workflowFeedbackCount 
                : feedbackCount;
            
            const feedbackConfigMsg = `反馈数量配置: feedbackCount=${feedbackCount}, workflowFeedbackCount=${config.workflowFeedbackCount}, 实际使用的工作流反馈数量=${workflowFeedbackReadCount}`;
            f12Log(`[executeWorkflowStep] ${feedbackConfigMsg}`);
            // 关键修复：将日志保存到执行状态
            if (state.workflowExecutionState && !options.isNestedWorkflow) {
                addExecutionLog(feedbackConfigMsg, {
                    stepIndex: options.stepIndex || 0,
                    viewId: viewId,
                    status: 'info'
                });
            }
            
            // 读取节点反馈
            const nodeFeedbackContents = await readRecentNodeFeedbacks(
                eventName,
                targetFilePath,
                viewId,
                feedbackCount
            );
            
            // 读取工作流反馈（只要有工作流名称就读取，使用计算出的数量）
            let workflowFeedbackContents = [];
            if (currentWorkflowName) {
                try {
                    const readFeedbackStartMsg = `开始读取工作流反馈: eventName=${eventName}, workflowName=${currentWorkflowName}, count=${workflowFeedbackReadCount}`;
                    f12Log(`[executeWorkflowStep] ${readFeedbackStartMsg}`);
                    workflowFeedbackContents = await readRecentWorkflowFeedbacks(
                        eventName,
                        targetFilePath,
                        currentWorkflowName,
                        workflowFeedbackReadCount
                    );
                    const readFeedbackCompleteMsg = `工作流反馈读取完成: 找到 ${workflowFeedbackContents.length} 个工作流反馈文件`;
                    f12Log(`[executeWorkflowStep] ${readFeedbackCompleteMsg}`);
                    // 关键修复：将日志保存到执行状态
                    if (state.workflowExecutionState && !options.isNestedWorkflow) {
                        addExecutionLog(readFeedbackStartMsg, {
                            stepIndex: options.stepIndex || 0,
                            viewId: viewId,
                            status: 'info'
                        });
                        addExecutionLog(readFeedbackCompleteMsg, {
                            stepIndex: options.stepIndex || 0,
                            viewId: viewId,
                            status: 'info'
                        });
                    }
                } catch (workflowFeedbackError) {
                    console.warn(`[executeWorkflowStep] 读取工作流反馈失败:`, workflowFeedbackError);
                }
            } else {
                const skipFeedbackMsg = `跳过读取工作流反馈: 工作流名称为空`;
                f12Log(`[executeWorkflowStep] ${skipFeedbackMsg}`);
                // 关键修复：将日志保存到执行状态
                if (state.workflowExecutionState && !options.isNestedWorkflow) {
                    addExecutionLog(skipFeedbackMsg, {
                        stepIndex: options.stepIndex || 0,
                        viewId: viewId,
                        status: 'info'
                    });
                }
            }
            
            // 拼接反馈内容
            if (nodeFeedbackContents.length > 0 || workflowFeedbackContents.length > 0) {
                const nodePermanentCount = nodeFeedbackContents.filter(f => f.isPermanent).length;
                const nodeTemporalCount = nodeFeedbackContents.length - nodePermanentCount;
                
                // 统一统计和打印反馈信息（与节点反馈的拼接日志格式保持一致）
                // 关键修复：将反馈统计日志保存到执行状态
                const feedbackSummaryMsg = `节点 ${viewId} 反馈统计: 时间戳反馈 ${nodeTemporalCount}个, 永久反馈 ${nodePermanentCount}个, 工作流反馈 ${workflowFeedbackContents.length}个, 总计 ${nodeFeedbackContents.length + workflowFeedbackContents.length}个`;
                f12Log(`[反馈文件拼接] ========== 节点 ${viewId} 反馈统计汇总 ==========`);
                f12Log(`[反馈文件拼接] 节点反馈统计: 时间戳反馈 ${nodeTemporalCount}个, 永久反馈 ${nodePermanentCount}个`);
                f12Log(`[反馈文件拼接] 工作流反馈统计: ${workflowFeedbackContents.length}个`);
                f12Log(`[反馈文件拼接] 反馈文件总数: ${nodeFeedbackContents.length + workflowFeedbackContents.length}个`);
                f12Log(`[反馈文件拼接] ==========================================`);
                if (state.workflowExecutionState && !options.isNestedWorkflow) {
                    addExecutionLog(feedbackSummaryMsg, {
                        stepIndex: options.stepIndex || 0,
                        viewId: viewId,
                        status: 'info'
                    });
                }
                
                // 关键修复：记录反馈拼接前的userContent长度，用于计算反馈部分的长度
                const userContentBeforeFeedback = userContent.length;
                
                userContent += `\n\n历史反馈（节点反馈: ${nodeFeedbackContents.length}个，工作流反馈: ${workflowFeedbackContents.length}个）:\n`;
                
                // 先添加工作流反馈
                if (workflowFeedbackContents.length > 0) {
                    f12Log(`[反馈文件拼接] 开始拼接工作流反馈，共 ${workflowFeedbackContents.length} 个`);
                    workflowFeedbackContents.forEach((feedback, index) => {
                        const timestampStr = ` (${new Date(feedback.timestamp).toLocaleString()})`;
                        const feedbackHeader = `\n--- 工作流反馈 ${index + 1}${timestampStr} ---\n`;
                        const feedbackFormatted = formatFeedbackContent(feedback.content, '工作流反馈');
                        f12Log(`[反馈文件拼接] 拼接工作流反馈 ${index + 1}/${workflowFeedbackContents.length}，内容长度: ${feedback.content.length} 字符，格式化后长度: ${feedbackFormatted.length} 字符`);
                        userContent += feedbackHeader;
                        userContent += feedbackFormatted;
                    });
                    f12Log(`[反馈文件拼接] 工作流反馈拼接完成，当前userContent长度: ${userContent.length} 字符`);
                }
                
                // 再添加节点反馈
                if (nodeFeedbackContents.length > 0) {
                    f12Log(`[反馈文件拼接] 开始拼接节点反馈，共 ${nodeFeedbackContents.length} 个`);
                    nodeFeedbackContents.forEach((feedback, index) => {
                        const label = feedback.isPermanent ? '永久反馈' : '反馈';
                        const timestampStr = ` (${new Date(feedback.timestamp).toLocaleString()})`;
                        const feedbackHeader = `\n--- ${label} ${index + 1}${timestampStr} ---\n`;
                        const feedbackFormatted = formatFeedbackContent(feedback.content, '节点反馈');
                        f12Log(`[反馈文件拼接] 拼接节点反馈 ${index + 1}/${nodeFeedbackContents.length}，类型: ${label}，内容长度: ${feedback.content.length} 字符，格式化后长度: ${feedbackFormatted.length} 字符`);
                        userContent += feedbackHeader;
                        userContent += feedbackFormatted;
                    });
                    f12Log(`[反馈文件拼接] 节点反馈拼接完成，当前userContent长度: ${userContent.length} 字符`);
                }
                
                userContent += '\n';
                f12Log(`[反馈文件拼接] 所有反馈拼接完成，最终userContent长度: ${userContent.length} 字符`);
                // 关键修复：计算反馈部分的长度（反馈拼接后的长度 - 反馈拼接前的长度）
                feedbackContentLength = userContent.length - userContentBeforeFeedback;
                const totalFeedbackCount = nodeFeedbackContents.length + workflowFeedbackContents.length;
                const feedbackResultMsg = `节点 ${viewId}，已读取 ${nodeFeedbackContents.length} 个节点反馈，${workflowFeedbackContents.length} 个工作流反馈，反馈文件总数: ${totalFeedbackCount}`;
                f12Log(`[executeWorkflowStep] ${feedbackResultMsg}`);
                // 关键修复：将日志保存到执行状态
                if (state.workflowExecutionState && !options.isNestedWorkflow) {
                    addExecutionLog(feedbackResultMsg, {
                        stepIndex: options.stepIndex || 0,
                        viewId: viewId,
                        status: 'info'
                    });
                }
            } else {
                const noFeedbackMsg = `节点 ${viewId}，未读取到历史反馈，反馈文件总数: 0`;
                f12Log(`[executeWorkflowStep] ${noFeedbackMsg}`);
                // 关键修复：将日志保存到执行状态
                if (state.workflowExecutionState && !options.isNestedWorkflow) {
                    addExecutionLog(noFeedbackMsg, {
                        stepIndex: options.stepIndex || 0,
                        viewId: viewId,
                        status: 'info'
                    });
                }
            }
        } catch (feedbackError) {
            console.warn(`[executeWorkflowStep] 读取历史反馈失败 (${viewId}):`, feedbackError);
            // 读取失败不影响执行，继续执行
        }
    }
    
    // 关键修复：读取当前视图ID的AI文件，与视图ID内容一起拼接发送
    // 视图ID内容作为用户消息，AI文件作为日志（思考角度）
    let viewIdContent = viewData.content; // 视图ID的原始内容（用户消息）
    let aiFileContent = ''; // AI文件内容（日志）
    
    // 读取当前视图ID的AI文件
    const targetFilePath = options.batchFilePath || 
                          state.workflowExecutionState?.batchFilePath || 
                          state.originalPath;
    
    if (targetFilePath) {
        try {
            const { getFile } = await import('../core/api.js');
            const { getFileInFolderPath } = await import('../utils/fileUtils.js');
            
            // 构建AI文件路径
            const lastSeparatorIndex = Math.max(targetFilePath.lastIndexOf('\\'), targetFilePath.lastIndexOf('/'));
            const fileName = lastSeparatorIndex >= 0 ? targetFilePath.substring(lastSeparatorIndex + 1) : targetFilePath;
            const lastDotIndex = fileName.lastIndexOf('.');
            const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
            const ext = lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1) : '';
            const aiFileName = `${baseName}_${viewId}_AI.${ext || 'md'}`;
            const aiFilePath = getFileInFolderPath(targetFilePath, aiFileName);
            
            // 读取AI文件
            const rawContent = await getFile(aiFilePath);
            // 检查是否是错误响应
            if (!rawContent.trim().startsWith('{') || !rawContent.includes('"error"')) {
                aiFileContent = rawContent.trim();
                const aiFileReadMsg = `已读取当前视图ID的AI文件: ${viewId}, 长度: ${aiFileContent.length} 字符`;
                f12Log(`[executeWorkflowStep] ${aiFileReadMsg}`);
                // 关键修复：将日志保存到执行状态
                if (state.workflowExecutionState && !options.isNestedWorkflow) {
                    addExecutionLog(aiFileReadMsg, {
                        stepIndex: options.stepIndex || 0,
                        viewId: viewId,
                        status: 'info'
                    });
                }
            }
        } catch (err) {
            // AI文件不存在或读取失败，继续执行（不影响工作流）
            console.warn(`[executeWorkflowStep] 读取当前视图ID的AI文件失败 (${viewId}):`, err);
        }
    }
    
    // 构建最终的用户消息：AI文件（日志）+ 步骤文件（日志）+ 其他拼接信息（日志）+ 视图ID内容（用户消息）
    // 关键修复：将用户消息拼接到最后方
    let finalUserContent = '';
    
    // 1. 添加AI文件内容（日志，思考角度）
    if (aiFileContent) {
        finalUserContent += `## 历史AI对话记录（思考角度，仅供参考）\n\n${aiFileContent}\n\n---\n\n`;
    }
    
    // 2. 添加其他拼接信息（前置节点、反馈等，作为日志）
    // 注意：userContent中已经包含了当前节点内容（formatWorkflowNodeContent），
    // 但我们已经用视图ID内容替换了它，所以直接添加其他信息即可
    finalUserContent += userContent;
    
    // 3. 添加视图ID内容（用户消息）- 拼接到最后方
    finalUserContent += `## 当前任务内容（用户消息）\n\n${viewIdContent}\n\n`;
    
    // 保存发送给AI的完整内容（用于后续生成反馈）
    const sentContentForFeedback = finalUserContent;
    
    // 添加用户消息
    messages.push({
        role: 'user',
        content: finalUserContent
    });
    
    // 如果是事件执行
    const isEventExecution = options.stepIndex !== undefined && options.eventTimestamp;
    let stepFilePath = null;
    let aiResponse = '';
    
    const stepInfo = {
        viewId: viewId,
        isEventExecution,
        stepIndex: options.stepIndex,
        eventTimestamp: options.eventTimestamp,
        useStream: options.useStream,
        originalPath: state.originalPath
    };
    
    // 输出步骤信息到控制台（F12）
    console.log('执行工作流步骤:', stepInfo);
    
    // 默认使用流式输出（如果useStream未明确设置为false）
    const shouldUseStream = isEventExecution && (options.useStream === true || options.useStream === undefined);
    
    if (shouldUseStream) {
        // 使用流式输出
        const timestamp = options.eventTimestamp;
        const stepIndex = options.stepIndex;
        
        // 创建步骤文件路径
        // 注意：相同视图名在不同y轴时，应该追加写入同一个文件，而不是创建新文件
        // 文件名格式：时间戳_文件名_视图名.扩展名（不包含步骤索引）
        // 批量执行时，优先使用批量处理的路径，完全忽略主界面的路径
        const targetFilePath = options.batchFilePath || 
                              state.workflowExecutionState?.batchFilePath || 
                              state.originalPath;
        
        if (!targetFilePath) {
            throw new Error('请先选择文件');
        }
        
        // 调试日志：记录使用的文件路径
        if (state.workflowExecutionState?.batchFilePath) {
            f12Log(`[executeWorkflowStep] 批量执行模式，使用文件路径: ${targetFilePath}`);
        }
        
        const lastSeparatorIndex = Math.max(targetFilePath.lastIndexOf('\\'), targetFilePath.lastIndexOf('/'));
        const fileName = lastSeparatorIndex >= 0 ? targetFilePath.substring(lastSeparatorIndex + 1) : targetFilePath;
        const lastDotIndex = fileName.lastIndexOf('.');
        const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
        const ext = lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1).trim() : '';
        const timestampStr = timestamp.replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
        
        // 关键修复：只有当eventName存在时才生成步骤文件（带事件名后缀的格式）
        // 如果eventName不存在，不生成步骤文件（不带事件名后缀的格式）
        const eventName = options.eventName || null;
        const workflowName = options.workflowName || state.workflowExecutionState?.workflowName || '未知工作流';
        // 关键修复：如果是嵌套工作流（工作流节点内部），不创建步骤文件
        const isNestedWorkflow = options.isNestedWorkflow || state.workflowExecutionState?.isNestedWorkflow || false;
        let writer = null;
        
        if (eventName && !isNestedWorkflow) {
            // 只有当eventName存在且不是嵌套工作流时，才生成步骤文件（格式：时间戳_文件名_步骤数+视图名_事件名.md）
            const eventSuffix = `_${eventName}`;
            // 关键修复：在文件名中包含步骤数，格式为：时间戳_文件名_步骤数+视图名_事件名.md
            const stepDisplay = stepIndex ? `${stepIndex}+${viewId}` : viewId;
            const stepFileName = `${timestampStr}_${baseName}_${stepDisplay}${eventSuffix}.${ext || 'md'}`;
            const { getFileInFolderPath } = await import('../utils/fileUtils.js');
            stepFilePath = getFileInFolderPath(targetFilePath, stepFileName);
            
            const createStepFileMsg = `创建步骤文件: ${stepFilePath}, 步骤索引: ${stepIndex}`;
            f12Log(`[executeWorkflowStep] ${createStepFileMsg}`);
            // 关键修复：将日志保存到执行状态
            if (state.workflowExecutionState && !options.isNestedWorkflow) {
                addExecutionLog(createStepFileMsg, {
                    stepIndex: options.stepIndex || 0,
                    viewId: viewId,
                    status: 'info'
                });
            }
            if (state.workflowExecutionState?.batchFilePath) {
                const batchFilePathMsg2 = `批量执行模式，使用文件路径: ${targetFilePath}`;
                console.log(`[executeWorkflowStep] ${batchFilePathMsg2}`);
                // 关键修复：将日志保存到执行状态
                if (state.workflowExecutionState && !options.isNestedWorkflow) {
                    addExecutionLog(batchFilePathMsg2, {
                        stepIndex: options.stepIndex || 0,
                        viewId: viewId,
                        status: 'info'
                    });
                }
            }
            
            // 检查文件是否已存在（相同视图名在不同y轴时）
            let isAppendMode = false;
            try {
                const { getFile } = await import('../core/api.js');
                await getFile(stepFilePath);
                // 文件已存在，使用追加模式
                isAppendMode = true;
                console.log('文件已存在，使用追加模式:', stepFilePath);
            } catch (err) {
                // 文件不存在，创建新文件
                isAppendMode = false;
            }
            
            // 创建流式写入器（支持追加模式）
            // 关键修复：如果是嵌套工作流，传递父工作流信息，用于在文件头部添加工作流节点标识
            // 关键修复：只有当前步骤是工作流节点时才传递isWorkflowNode标识
            const parentWorkflowName = state.workflowExecutionState?.parentWorkflowName || null;
            const parentWorkflowViewId = state.workflowExecutionState?.parentWorkflowViewId || null;
            // 检查当前步骤是否是工作流节点
            const isCurrentStepWorkflowNode = step.workflowId && step.workflowId.trim() !== '';
            writer = createStreamFileWriter(stepFilePath, viewId, isAppendMode, stepIndex, eventName, timestamp, workflowName, {
                isNestedWorkflow: false, // 这里不是嵌套工作流（因为已经检查过了）
                isWorkflowNode: isCurrentStepWorkflowNode, // 关键修复：只有工作流节点才传递此标识
                parentWorkflowName: parentWorkflowName,
                parentWorkflowViewId: parentWorkflowViewId
            });
        } else {
            // 如果eventName不存在或者是嵌套工作流，不生成步骤文件
            stepFilePath = null;
            if (isNestedWorkflow) {
                console.log(`[工作流节点内部] 步骤 ${viewId} 是嵌套工作流的一部分，跳过步骤文件生成`);
            } else {
                console.log(`[executeWorkflowStep] eventName为空，跳过步骤文件生成，只生成AI文件`);
            }
        }
        
        // 初始化AI消息队列（设置writer）
        // 如果跳过步骤文件，传递null（AI消息队列会处理null的情况，只写入AI文件）
        initAiMessageQueue(viewId, writer);
        
        try {
            // 流式调用AI
            // 为每个步骤创建独立的节流器，确保多个步骤的流式更新互不干扰
            // 如果 workflowExecutionState 不存在，创建空的节流器对象（回调函数中会提前返回）
            const stepThrottles = state.workflowExecutionState?._stepThrottles || {};
            if (state.workflowExecutionState && !state.workflowExecutionState._stepThrottles) {
                state.workflowExecutionState._stepThrottles = stepThrottles;
            }
            if (!stepThrottles[viewId]) {
                stepThrottles[viewId] = {
                    lastUpdateTime: 0,
                    updateTimer: null
                };
            }
            const throttle = stepThrottles[viewId];
            const updateThrottle = 16; // 使用16ms（约60fps），与 requestAnimationFrame 同步，让流式显示更流畅
            
            // 全局UI更新节流器（用于合并多个步骤的更新，避免过于频繁的DOM操作）
            // 注意：这个节流器不会阻止步骤级别的更新，只是作为额外的保护
            const globalThrottle = state.workflowExecutionState?._globalUpdateThrottle || {
                lastUpdateTime: 0,
                updateTimer: null
            };
            if (state.workflowExecutionState && !state.workflowExecutionState._globalUpdateThrottle) {
                state.workflowExecutionState._globalUpdateThrottle = globalThrottle;
            }
            
            // 为视图显示创建独立的节流器（使用 requestAnimationFrame 优化）
            // 注意：现在使用全局批量更新队列，每个视图只需要记录最后更新时间
            const viewDisplayThrottles = state.workflowExecutionState?._viewDisplayThrottles || {};
            if (state.workflowExecutionState && !state.workflowExecutionState._viewDisplayThrottles) {
                state.workflowExecutionState._viewDisplayThrottles = viewDisplayThrottles;
            }
            if (!viewDisplayThrottles[viewId]) {
                viewDisplayThrottles[viewId] = {
                    lastUpdateTime: 0
                };
            }
            const viewDisplayThrottle = viewDisplayThrottles[viewId];
            
            // 批量更新队列（用于 requestAnimationFrame，全局共享）
            if (!state.workflowExecutionState._batchUpdateQueue) {
                state.workflowExecutionState._batchUpdateQueue = new Map();
                state.workflowExecutionState._batchUpdateRafId = null;
            }
            const batchUpdateQueue = state.workflowExecutionState._batchUpdateQueue;
            
            // 批量更新函数（使用 requestAnimationFrame，全局共享）
            // 关键优化：每次调用都会更新队列，但 RAF 调度是全局共享的
            // 这样多个步骤的更新会被合并到同一个 RAF 中，提高性能
            const scheduleBatchUpdate = () => {
                // 关键修复：即使已经有 RAF 调度，也要确保新内容被加入队列
                // 因为 RAF 回调会在下一帧执行，而新内容可能在当前帧就已经到达
                // 所以不需要提前返回，而是让 RAF 回调处理队列中的所有内容（包括新加入的）
                if (!state.workflowExecutionState._batchUpdateRafId) {
                    // 调度新的 RAF
                    state.workflowExecutionState._batchUpdateRafId = requestAnimationFrame(() => {
                        // 批量更新所有待更新的视图（并发执行时，多个视图会一起更新）
                        // 注意：在 RAF 回调执行时，队列中可能已经有新的内容被加入了
                        const updatesToProcess = new Map(batchUpdateQueue);
                        batchUpdateQueue.clear();
                        state.workflowExecutionState._batchUpdateRafId = null;
                        
                        // 直接在RAF回调中更新所有视图，不使用Promise包装，减少延迟
                        for (const [vid, content] of updatesToProcess.entries()) {
                            if (state.workflowExecutionState && 
                                !state.workflowExecutionState.isCompleted && 
                                !state.workflowExecutionState.isCancelled && 
                                !state.workflowExecutionState.isPaused) {
                                updateViewDisplayRealTime(vid, content);
                            }
                        }
                        
                        // 更新后，如果队列中又有新内容（在 RAF 执行期间加入的），再次调度
                        if (batchUpdateQueue.size > 0 && state.workflowExecutionState) {
                            scheduleBatchUpdate();
                        }
                    });
                }
                // 如果已经有 RAF 调度，不需要重复调度，但新内容已经通过 batchUpdateQueue.set() 加入了队列
                // RAF 回调会在下一帧处理队列中的所有内容（包括新加入的）
            };
            
            // 保存 scheduleBatchUpdate 到 state，以便消息队列处理器可以调用
            if (state.workflowExecutionState) {
                state.workflowExecutionState._scheduleBatchUpdate = scheduleBatchUpdate;
            }
            
            // 关键修复：使用消息队列处理AI消息，确保多个步骤可以并发处理
            // onChunk回调现在只是将消息加入队列，全局批量处理器会一次性处理所有视图的消息
            aiResponse = await streamOpenAI(viewId, messages, (chunk, fullContent) => {
                // 将消息加入队列（非阻塞，立即返回）
                // 全局批量处理器会一次性处理所有视图的消息，实现真正的批量写入和批量UI更新
                enqueueAiMessage(viewId, chunk, fullContent);
                
                // 实时更新工作流执行状态（流式显示，立即更新状态数据）
                // 使用安全更新函数，确保在并发执行时只更新属于当前文件的状态
                safeUpdateStepResults(viewId, fullContent, options);
                
                // 每个步骤独立节流，避免单个步骤更新过于频繁
                const now = Date.now();
                const timeSinceLastUpdate = now - throttle.lastUpdateTime;
                
                if (timeSinceLastUpdate >= updateThrottle) {
                    // 立即更新UI（这个步骤的节流时间到了）
                    throttle.lastUpdateTime = now;
                    // 清除之前的延迟更新
                    if (throttle.updateTimer) {
                        clearTimeout(throttle.updateTimer);
                        throttle.updateTimer = null;
                    }
                    // 使用微任务更新UI，不阻塞流式接收
                    // 注意：这里更新的是所有步骤的状态，不仅仅是当前步骤
                    // 关键修复：只有在工作流执行状态存在时才触发状态更新
                    Promise.resolve().then(() => {
                        if (state.workflowExecutionState) {
                            updateWorkflowExecutionStatus();
                        }
                    });
                } else {
                    // 延迟更新，但确保会更新（防抖）
                    if (throttle.updateTimer) {
                        clearTimeout(throttle.updateTimer);
                    }
                    const delay = updateThrottle - timeSinceLastUpdate;
                    throttle.updateTimer = setTimeout(() => {
                        throttle.lastUpdateTime = Date.now();
                        // 更新所有步骤的状态
                        // 关键修复：只有在工作流执行状态存在时才触发状态更新
                        if (state.workflowExecutionState) {
                            updateWorkflowExecutionStatus();
                        }
                        throttle.updateTimer = null;
                    }, delay);
                }
                
                // 更新全局节流器的时间戳（用于统计，但不阻止更新）
                globalThrottle.lastUpdateTime = now;
            }, {
                temperature: 0.7,
                max_tokens: 2000
            });
            
            // 流式输出完成后，直接获取最终内容（消息已经立即处理，不需要等待）
            // 从队列获取最终内容
            aiResponse = getAiMessageQueueContent(viewId) || aiResponse;
            
            // 清理消息队列（但保留队列结构，以便后续使用）
            cleanupAiMessageQueue(viewId);
            
            // 流式输出完成后，确保最后一次更新UI（清除延迟更新，立即更新）
            if (state.workflowExecutionState) {
                if (globalThrottle.updateTimer) {
                    clearTimeout(globalThrottle.updateTimer);
                    globalThrottle.updateTimer = null;
                }
                // 使用安全更新函数，确保在并发执行时只更新属于当前文件的状态
                if (safeUpdateStepResults(viewId, aiResponse, options)) {
                    // 关键修复：只有在工作流执行状态存在时才触发状态更新
                    if (state.workflowExecutionState) {
                        updateWorkflowExecutionStatus();
                    }
                }
                
                // 最后更新一次视图显示（只在执行中时）
                // 检查是否仍在执行中（不是已完成、已取消或已暂停）
                const execState = state.workflowExecutionState;
                if (execState && !execState.isCompleted && !execState.isCancelled && !execState.isPaused) {
                    // 更新批量更新队列中的内容
                    batchUpdateQueue.set(viewId, aiResponse);
                    // 立即调度批量更新（确保最后的内容也能显示）
                    scheduleBatchUpdate();
                    // 立即更新一次（不等待 RAF），确保最终内容立即显示
                    updateViewDisplayRealTime(viewId, aiResponse);
                }
                
                // 清理步骤的节流器
                if (stepThrottles[viewId]) {
                    delete stepThrottles[viewId];
                }
                // 清理视图显示的节流器
                if (viewDisplayThrottles[viewId]) {
                    delete viewDisplayThrottles[viewId];
                }
            }
            
            // 关闭写入器（如果存在）
            // 注意：writer是步骤文件的writer，不是AI文件的writer
            // AI文件的写入是在流式输出完成后，通过writeCurrentView写入的（在下面的代码中）
            const closePromise = writer ? (async () => {
                try {
                    await writer.close();
                } catch (err) {
                    console.error(`关闭写入器失败 (${viewId}):`, err);
                }
            })() : Promise.resolve();
            
            // 预读步骤文件（只有当writer存在时才预读）
            const preReadPromise = writer && stepFilePath ? (async () => {
                if (!state.workflowExecutionState || 
                    state.workflowExecutionState.isCompleted || 
                    state.workflowExecutionState.isCancelled || 
                    state.workflowExecutionState.isPaused) {
                    return;
                }
                
                try {
                    const { getFile } = await import('../core/api.js');
                    // 智能等待：最多等待200ms，每50ms检查一次文件是否已写入完成
                    let attempts = 0;
                    const maxAttempts = 4;
                    let fileContent = null;
                    
                    while (attempts < maxAttempts) {
                        await new Promise(resolve => setTimeout(resolve, 50));
                        fileContent = await getFile(stepFilePath);
                        // 检查是否是错误响应
                        if (!fileContent.trim().startsWith('{') || !fileContent.includes('"error"')) {
                            // 文件存在，检查内容长度是否足够（至少是流式响应的80%）
                            const lines = fileContent.split('\n');
                            let actualContent = fileContent;
                            
                            // 尝试查找最后一个步骤的内容
                            const stepMarker = `步骤：${stepIndex ? `${stepIndex}+${viewId}` : viewId}`;
                            const lastStepIndex = lines.findLastIndex((line, idx) => 
                                idx > 0 && lines[idx - 1]?.includes(stepMarker)
                            );
                            if (lastStepIndex > 0) {
                                actualContent = lines.slice(lastStepIndex + 1).join('\n').trim();
                            } else {
                                // 非追加模式，跳过头部信息
                                if (lines.length > 3) {
                                    actualContent = lines.slice(3).join('\n');
                                }
                            }
                            
                            // 如果文件内容足够完整（至少是流式响应的80%），立即使用
                            if (actualContent.length >= aiResponse.length * 0.8) {
                                // 立即更新视图显示（使用文件中的完整内容）
                                updateViewDisplayRealTime(viewId, actualContent);
                                // 更新步骤结果（使用文件内容）
                                safeUpdateStepResults(viewId, actualContent, options);
                                return; // 提前返回，不需要继续等待
                            }
                        }
                        attempts++;
                    }
                } catch (err) {
                    // 文件读取失败，忽略错误，继续使用流式响应的内容
                    console.warn(`文件预读失败 (${viewId}):`, err);
                }
            })() : Promise.resolve();
            
            // 等待文件关闭完成（必须等待，确保文件写入完成）
            await closePromise;
            
            // 关键修复：步骤文件关闭后，记录文件长度并保存到变量中，用于后续日志显示
            let stepFileLength = null;
            if (stepFilePath && writer) {
                try {
                    const { getFile } = await import('../core/api.js');
                    // 等待一小段时间确保文件写入完成
                    await new Promise(resolve => setTimeout(resolve, 100));
                    const fileContent = await getFile(stepFilePath);
                    if (fileContent && !fileContent.trim().startsWith('{') && !fileContent.includes('"error"')) {
                        stepFileLength = fileContent.length;
                        const stepFileLengthMsg = `步骤文件已关闭: ${stepFilePath}, 长度: ${stepFileLength} 字符`;
                        f12Log(`[executeWorkflowStep] ${stepFileLengthMsg}`);
                        // 关键修复：将日志保存到执行状态
                        if (state.workflowExecutionState && !options.isNestedWorkflow) {
                            addExecutionLog(stepFileLengthMsg, {
                                stepIndex: options.stepIndex || 0,
                                viewId: viewId,
                                status: 'info'
                            });
                        }
                    }
                } catch (err) {
                    // 文件读取失败，忽略错误（不影响工作流执行）
                    console.warn(`[executeWorkflowStep] 读取步骤文件长度失败 (${viewId}):`, err);
                }
            }
            
            // 同时等待预读完成（如果还没完成的话）
            await preReadPromise;
        } catch (error) {
            // 关闭writer（如果存在）
            if (writer) {
                try {
                    await writer.close();
                } catch (closeError) {
                    // 忽略关闭错误
                }
            }
            console.error(`步骤 ${viewId} 流式AI调用失败，尝试使用普通调用:`, error);
            
            // 流式调用失败时，回退到普通调用
            try {
                aiResponse = await callOpenAI(viewId, messages, {
                    temperature: 0.7,
                    max_tokens: 2000
                });
                // 只有当eventName存在时才保存步骤文件
                if (eventName && stepFilePath) {
                    const { saveFile } = await import('../core/api.js');
                    await saveFile(stepFilePath, `时间戳: ${timestamp}\n视图ID: ${viewId}\n\n${aiResponse}`);
                }
            } catch (fallbackError) {
                console.error(`步骤 ${viewId} 普通AI调用也失败:`, fallbackError);
                throw new Error(`步骤 ${viewId} AI调用失败: ${fallbackError.message}`);
            }
        }
    } else {
        // 使用普通调用
        try {
            aiResponse = await callOpenAI(viewId, messages, {
                temperature: 0.7,
                max_tokens: 2000
            });
        } catch (error) {
            console.error(`步骤 ${viewId} AI调用失败:`, error);
            throw new Error(`步骤 ${viewId} AI调用失败: ${error.message}`);
        }
        
        // 关键修复：只有当eventName存在时才生成步骤文件（带事件名后缀的格式）
        // 如果eventName不存在，不生成步骤文件（不带事件名后缀的格式）
        if (isEventExecution) {
            const timestamp = options.eventTimestamp;
            const stepIndex = options.stepIndex;
            const eventName = options.eventName || null;
            
            if (eventName) {
                // 只有当eventName存在时，才生成步骤文件（格式：时间戳_文件名_视图名_事件名.md）
                const targetFilePath = options.batchFilePath || 
                                      state.workflowExecutionState?.batchFilePath || 
                                      state.originalPath;
                
                if (targetFilePath) {
                    const lastSeparatorIndex = Math.max(targetFilePath.lastIndexOf('\\'), targetFilePath.lastIndexOf('/'));
                    const fileName = lastSeparatorIndex >= 0 ? targetFilePath.substring(lastSeparatorIndex + 1) : targetFilePath;
                    const lastDotIndex = fileName.lastIndexOf('.');
                    const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
                    const ext = lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1).trim() : '';
                    const timestampStr = timestamp.replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
                    const workflowName = options.workflowName || state.workflowExecutionState?.workflowName || '未知工作流';
                    
                    const eventSuffix = `_${eventName}`;
                    const stepFileName = `${timestampStr}_${baseName}_${viewId}${eventSuffix}.${ext || 'md'}`;
                    const { getFileInFolderPath } = await import('../utils/fileUtils.js');
                    stepFilePath = getFileInFolderPath(targetFilePath, stepFileName);
                    
                    // 检查文件是否已存在（追加模式）
                    let existingContent = '';
                    let isAppend = false;
                    try {
                        const { getFile } = await import('../core/api.js');
                        const content = await getFile(stepFilePath);
                        if (!content.trim().startsWith('{') || !content.includes('"error"')) {
                            existingContent = content;
                            isAppend = true;
                        }
                    } catch (err) {
                        // 文件不存在，使用新文件模式
                        existingContent = '';
                        isAppend = false;
                    }
                    
                    // 构建消息内容
                    let finalContent = '';
                    const stepDisplay = `${stepIndex || 'N'}+${viewId}`;
                    if (isAppend) {
                        const stepHeader = `\n\n工作流：${workflowName}\n事件：${eventName}\n步骤：${stepDisplay}\n`;
                        finalContent = existingContent + stepHeader + aiResponse;
                    } else {
                        const header = `工作流：${workflowName}\n事件：${eventName}\n步骤：${stepDisplay}\n`;
                        finalContent = header + aiResponse;
                    }
                    
                    const { saveFile } = await import('../core/api.js');
                    await saveFile(stepFilePath, finalContent);
                    console.log('步骤文件已保存:', stepFilePath);
                } else {
                    stepFilePath = null;
                }
            } else {
                // 如果eventName不存在，不生成步骤文件
                stepFilePath = null;
                console.log(`[executeWorkflowStep] eventName为空，跳过步骤文件生成，只生成AI文件`);
            }
        } else {
            stepFilePath = null;
        }
    }
    
    // 保存AI消息（保留原有逻辑）
    const timestamp = new Date().toISOString();
    const aiMessage = `时间戳: ${timestamp}\n视图ID: ${viewId}\n\n${aiResponse}`;
    
    // 关键修复：如果是嵌套工作流（工作流节点），不写入文件
    // 工作流节点应该直接在内存中传递内容，不创建任何文件
    const isNestedWorkflow = options.isNestedWorkflow || false;
    let aiFilePath = null;
    
    // 关键修复：初始化AI文件写入完成状态（默认未完成）
    if (state.workflowExecutionState && !state.workflowExecutionState.aiFileWriteCompleted.has(viewId)) {
        state.workflowExecutionState.aiFileWriteCompleted.set(viewId, false);
    }
    
    if (!isNestedWorkflow) {
        // 只有非嵌套工作流才写入文件
        // 关键修复：工作流执行时总是传递事件信息用于追加写入_AI文件
        // 即使没有明确的 eventTimestamp，只要有 workflowExecutionState，就使用追加模式
        const writeOptions = {};
        const hasWorkflowState = state.workflowExecutionState && state.workflowExecutionState.workflowName;
        if (isEventExecution || hasWorkflowState) {
            // 优先使用 options 中的信息，然后从 state 中获取
            writeOptions.eventTimestamp = options.eventTimestamp || state.workflowExecutionState?.eventTimestamp;
            writeOptions.eventName = options.eventName || state.workflowExecutionState?.eventName || null;
            writeOptions.workflowName = options.workflowName || state.workflowExecutionState?.workflowName || null;
            writeOptions.stepIndex = options.stepIndex !== undefined ? options.stepIndex : 
                                     (state.workflowExecutionState?.currentStepIndex || null);
        }
        
        // 关键：传递 batchFilePath，确保批量执行时使用正确的文件路径
        // 优先使用 options 中的 batchFilePath（从 stepOptions 传递），然后是 workflowExecutionState 中的
        const batchFilePath = options.batchFilePath || state.workflowExecutionState?.batchFilePath;
        if (batchFilePath) {
            writeOptions.batchFilePath = batchFilePath;
        }
        
        aiFilePath = await writeCurrentView(viewId, aiMessage, writeOptions);
        
        // 关键修复：非流式模式下，writeCurrentView完成后标记为写入完成
        // 因为writeCurrentView是同步的（虽然返回Promise，但实际写入是同步的）
        if (!shouldUseStream && state.workflowExecutionState && state.workflowExecutionState.aiFileWriteCompleted) {
            state.workflowExecutionState.aiFileWriteCompleted.set(viewId, true);
            console.log(`[executeWorkflowStep] 非流式AI文件写入完成 (${viewId})`);
        }
    } else {
        // 嵌套工作流（工作流节点内部）：不写入文件，内容只在内存中传递
        console.log(`[工作流节点内部] 步骤 ${viewId} 是嵌套工作流的一部分，跳过文件写入，内容仅在内存中传递`);
        // 嵌套工作流不需要等待文件写入，直接标记为完成
        if (state.workflowExecutionState && state.workflowExecutionState.aiFileWriteCompleted) {
            state.workflowExecutionState.aiFileWriteCompleted.set(viewId, true);
        }
    }
    
    // 关键修复：如果是嵌套工作流，直接使用内存中的内容，不读取文件
    // 如果是非嵌套工作流，等待AI文件写入完成后再从文件读取，确保后续步骤使用文件中的内容（包含完整的步骤信息）
    // 注意：流式输出模式下，AI文件内容已经在上面重新读取了，这里只处理非流式模式
    // 关键修复：将当前步骤的AI响应拼接到历史AI文件内容后面，用于传递给下一个节点（临时拼接，不写入文件）
    let finalContent = aiResponse;
    if (aiFileContent) {
        // 将当前响应拼接到历史内容后面（临时拼接，不写入文件，只用于传递给下一个节点）
        finalContent = aiFileContent + '\n\n---\n\n' + aiResponse;
    }
    if (!isNestedWorkflow && aiFilePath && !shouldUseStream) {
        // 关键修复：非流式模式下，等待AI文件写入完成（最大5秒）
        if (state.workflowExecutionState && state.workflowExecutionState.aiFileWriteCompleted) {
            // 检查状态是否存在，如果不存在则不需要等待（可能文件不存在或写入失败）
            if (state.workflowExecutionState.aiFileWriteCompleted.has(viewId)) {
                const startWaitTime = Date.now();
                const maxWaitTime = 5000; // 最大等待5秒
                const checkInterval = 100; // 每100ms检查一次
                
                while (!state.workflowExecutionState.aiFileWriteCompleted.get(viewId)) {
                    const elapsedTime = Date.now() - startWaitTime;
                    if (elapsedTime >= maxWaitTime) {
                        console.warn(`[executeWorkflowStep] 等待AI文件写入完成超时 (${viewId})，继续执行`);
                        // 超时后强制标记为完成，避免无限等待
                        state.workflowExecutionState.aiFileWriteCompleted.set(viewId, true);
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, checkInterval));
                }
            }
        }
        
        try {
            const { getFile } = await import('../core/api.js');
            const fileContent = await getFile(aiFilePath);
            if (fileContent && !fileContent.trim().startsWith('{') && !fileContent.includes('"error"')) {
                // 从文件读取的内容，解析出实际内容（跳过头部信息）
                // 文件内容应该已经包含了历史+当前（因为writeCurrentView是追加模式）
                const lines = fileContent.split('\n');
                const stepMarker = /步骤：[\dN]+\+.*/;
                let contentStartIndex = 0;
                for (let i = lines.length - 1; i >= 0; i--) {
                    if (stepMarker.test(lines[i])) {
                        contentStartIndex = i + 1;
                        break;
                    }
                }
                if (contentStartIndex > 0 && contentStartIndex < lines.length) {
                    // 文件读取成功，使用文件内容（已经包含历史+当前）
                    finalContent = lines.slice(contentStartIndex).join('\n').trim();
                } else if (lines.length > 3) {
                    // 跳过前3行（工作流、事件、步骤等头部信息）
                    finalContent = lines.slice(3).join('\n').trim();
                } else {
                    finalContent = fileContent.trim();
                }
                console.log(`[executeWorkflowStep] 从AI文件读取最终内容成功，长度: ${finalContent.length}`);
            }
        } catch (readError) {
            // 文件读取失败，使用拼接后的内容（历史+当前）
            console.warn(`[executeWorkflowStep] 从AI文件读取最终内容失败，使用拼接后的内容:`, readError);
            // finalContent 已经在上面设置为拼接后的内容（如果有aiFileContent的话）
        }
    } else if (isNestedWorkflow) {
        // 嵌套工作流：直接使用内存中的内容，不读取文件
        console.log(`[工作流节点内部] 步骤 ${viewId} 使用内存中的内容，不读取文件`);
    }
    
    // 初始化 nodeFeedbackPath（用于返回值）
    let nodeFeedbackPath = null;
    
    // 使用反馈生成队列系统（如果是事件执行，立即加入队列，并发处理）
    // 关键逻辑：节点一完成就立即加入反馈生成队列，使用队列系统并发处理，不阻塞工作流执行
    if (isEventExecution && options.eventName && options.eventTimestamp) {
        try {
            const { enqueueFeedbackGeneration } = await import('./feedbackManager.js');
            const targetFilePath = options.batchFilePath || state.workflowExecutionState?.batchFilePath || state.originalPath;
            
            // 立即加入反馈生成队列（非阻塞，立即返回）
            // 队列系统会并发处理所有节点的反馈生成任务
            enqueueFeedbackGeneration(
                options.eventName,
                options.eventTimestamp,
                targetFilePath,
                viewId,
                aiResponse,
                sentContentForFeedback // 传递节点发送给AI的完整内容
            );
            
            console.log(`[executeWorkflowStep] 节点 ${viewId} 反馈生成任务已加入队列，将并发处理`);
        } catch (feedbackError) {
            console.error(`[executeWorkflowStep] 加入反馈生成队列失败 (${viewId}):`, feedbackError);
            // 加入队列失败不影响执行，继续执行
        }
    }
    
    // 提取文件名（用于日志显示）
    const getFileName = (filePath) => {
        if (!filePath) return '';
        const lastSeparatorIndex = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
        return lastSeparatorIndex >= 0 ? filePath.substring(lastSeparatorIndex + 1) : filePath;
    };
    
    // 生成执行日志：上一个id+文件名 -> 自己的id名+要发送的文件名 -> 下一个id名
    // 注意：viewNext已经在函数前面声明过了，这里直接使用
    const prevIds = step.viewPrev || step.prev || [];
    
    // 构建前置节点信息（上一个id+文件名）
    const prevInfoList = prevIds.map(prevId => {
        const prevStepResult = stepResults[prevId];
        if (!prevStepResult) return null;
        
        // 查找前置节点的文件路径（从executedSteps中查找）
        let prevFileName = '';
        if (state.workflowExecutionState && state.workflowExecutionState.executedSteps) {
            const prevExecutedStep = state.workflowExecutionState.executedSteps.find(es => es.step === prevId);
            if (prevExecutedStep && prevExecutedStep.aiFilePath) {
                prevFileName = getFileName(prevExecutedStep.aiFilePath);
            }
        }
        
        return prevFileName ? `${prevId}+${prevFileName}` : prevId;
    }).filter(Boolean);
    
    const prevInfo = prevInfoList.length > 0 ? prevInfoList.join(', ') : '无';
    
    // 当前节点的文件名
    const currentFileName = getFileName(aiFilePath);
    const currentInfo = currentFileName ? `${viewId}+${currentFileName}` : viewId;
    
    // 构建下一个节点信息（下一个id名）
    const nextInfo = viewNext.length > 0 ? viewNext.join(', ') : '无';
    
    // 关键修复：只打印路径信息，不打印完整内容，避免占用过多浏览器内存
    // 1. 当前视图的提示词路径（如果有）
    const promptInfo = viewData.prompt ? `提示词路径: 已配置 (长度: ${viewData.prompt.length} 字符)` : '提示词: 无';
    
    // 2. 发送给AI的完整内容信息（只显示长度，不显示完整内容）
    // 关键修复：使用sentContentForFeedback（发送给AI的完整内容），而不是userContent
    let contentSourceInfo = '';
    let sentContentDetailInfo = '';
    if (sentContentForFeedback) {
        const sentContentLength = sentContentForFeedback.length;
        contentSourceInfo = `发送内容: 长度 ${sentContentLength} 字符`;
        // 关键修复：只显示长度，不显示完整内容
        sentContentDetailInfo = `节点发送给AI的完整内容长度: ${sentContentLength} 字符`;
    } else {
        contentSourceInfo = '发送内容: 无';
        sentContentDetailInfo = '节点发送给AI的完整内容长度: 无';
    }
    
    // 3. AI文件长度（如果存在）
    let aiFileLengthInfo = '';
    if (aiFilePath) {
        try {
            const { getFile } = await import('../core/api.js');
            // 尝试读取AI文件长度（如果文件已存在）
            const fileContent = await getFile(aiFilePath);
            if (fileContent && !fileContent.trim().startsWith('{') && !fileContent.includes('"error"')) {
                const aiFileLength = fileContent.length;
                aiFileLengthInfo = `AI文件: 长度 ${aiFileLength} 字符`;
            } else {
                aiFileLengthInfo = 'AI文件: 写入中';
            }
        } catch (err) {
            // 文件不存在或读取失败，可能还在写入中
            aiFileLengthInfo = 'AI文件: 写入中';
        }
    } else {
        aiFileLengthInfo = 'AI文件: 无';
    }
    
    // 4. 下一个视图
    const nextViewInfo = `下一个视图: ${nextInfo}`;
    
    // 5. AI响应长度（步骤文件记录的是AI响应，而不是步骤文件本身的长度）
    let aiResponseLengthInfo = '';
    if (aiResponse) {
        const aiResponseLength = aiResponse.length;
        aiResponseLengthInfo = `AI响应: 长度 ${aiResponseLength} 字符`;
    } else {
        aiResponseLengthInfo = 'AI响应: 无';
    }
    
    // 6. 反馈文件拼接长度
    let feedbackLengthInfo = '';
    if (feedbackContentLength > 0) {
        feedbackLengthInfo = `反馈文件拼接: 长度 ${feedbackContentLength} 字符`;
    } else {
        feedbackLengthInfo = '反馈文件拼接: 无';
    }
    
    // 生成基础日志消息（保持原有格式）
    const logMessage = `${prevInfo} -> ${currentInfo} -> ${nextInfo}`;
    
    // 生成详细日志消息（只包含路径信息和长度，不包含完整内容）
    const detailedLogMessage = `${logMessage}\n  ${promptInfo}\n  ${contentSourceInfo}\n  ${aiFileLengthInfo}\n  ${aiResponseLengthInfo}\n  ${feedbackLengthInfo}\n  ${nextViewInfo}`;
    
    // 输出到控制台（F12）- 只显示路径信息和长度，不显示完整内容
    f12Log(`[工作流执行日志] ${detailedLogMessage}`);
    
    // 关键修复：添加节点发送给AI的完整内容长度日志（只显示长度，不显示完整内容）
    f12Log(`[工作流执行日志] ${sentContentDetailInfo}`);
    
    // 保存日志到执行状态（用于在状态显示中展示）
    // 更新步骤完成时的日志（替换之前的"开始执行"日志）
    // 关键修复：嵌套工作流中的步骤应该写入日志，使用本体工作流的事件信息
    if (state.workflowExecutionState) {
        // 如果是嵌套工作流，从父状态获取事件信息
        const parentState = options.isNestedWorkflow ? state.workflowExecutionState.parentWorkflowState : null;
        // 关键修复：优先从 eventName 字段获取（新保存的字段），其次从 options.eventName 获取
        const actualEventName = parentState?.eventName || parentState?.options?.eventName || state.workflowExecutionState.eventName || state.workflowExecutionState.options?.eventName || options.eventName || '';
        const actualExecutionId = parentState?.executionId || parentState?.batchExecutionId || state.workflowExecutionState.executionId || state.workflowExecutionState.batchExecutionId || '';
        const actualWorkflowName = parentState?.workflowName || state.workflowExecutionState.workflowName || '';
        
        // 关键修复：嵌套工作流中的步骤应该写入日志，使用本体工作流的事件信息
        if (!options.isNestedWorkflow || (actualEventName && actualExecutionId)) {
            // 如果是嵌套工作流，写入到父状态的日志中；否则写入到当前状态的日志中
            const targetState = options.isNestedWorkflow && parentState ? parentState : state.workflowExecutionState;
            if (!targetState.executionLogs) {
                targetState.executionLogs = [];
            }
            
            // 查找并移除之前的"开始执行"日志（如果有的话）
            const logIndex = targetState.executionLogs.findIndex(
                log => log.viewId === viewId && log.status === 'executing' && log.stepIndex === (options.stepIndex || 0)
            );
            if (logIndex >= 0) {
                // 移除"开始执行"日志
                targetState.executionLogs.splice(logIndex, 1);
            }
            
            // 添加完成日志
            // 关键修复：从options中获取工作流节点信息，而不是硬编码
            // 注意：executeWorkflowStep只处理普通节点，所以isWorkflowNode应该始终为false
            // 但如果options中传递了相关信息，应该使用它（用于向后兼容）
            const isWorkflowNode = options.isWorkflowNode || false;
            const workflowNodeName = options.workflowNodeName || null;
            
            targetState.executionLogs.push({
                stepIndex: options.stepIndex || 0,
                viewId: viewId,
                log: detailedLogMessage, // 使用详细日志消息
                timestamp: timestamp,
                status: 'completed', // 标记为已完成
                prompt: viewData.prompt || null, // 保存完整提示词
                sentContent: userContent, // 保存完整发送内容
                nextViews: viewNext, // 保存下一个视图列表
                isWorkflowNode: isWorkflowNode,
                workflowNodeName: workflowNodeName
            });
            
            // 关键修复：嵌套工作流中的步骤应该使用appendDetailLog写入统一日志系统
            // 使用本体工作流的事件信息
            if (actualEventName && actualExecutionId && actualWorkflowName) {
                try {
                    const { appendDetailLog } = await import('./workflowExecutionLogger.js');
                    appendDetailLog(
                        actualExecutionId,
                        actualEventName,
                        actualWorkflowName,
                        options.stepIndex || 0,
                        '普通节点',
                        viewId,
                        `${viewId} -> 执行完成`,
                        {
                            isWorkflowNode: false,
                            workflowNodeName: null
                        }
                    );
                } catch (logError) {
                    console.warn('[executeWorkflowStep] 写入详细日志失败:', logError);
                }
            }
            
            // 关键修复：只有在工作流执行状态存在时才触发状态更新
            if (state.workflowExecutionState) {
                updateWorkflowExecutionStatus();
            }
        }
    }
    
    // 注意：工作流控制指令的检测延迟到工作流执行逻辑中，在AI回复完毕后、执行下一步骤前进行检测
    
    // 记录工作流执行日志
    const workflowName = state.workflowExecutionState?.workflowName || '未知工作流';
    const isEventExec = isEventExecution && options.eventTimestamp;
    if (workflowName && !state.workflowExecutionState?.isTestMode) {
        logWorkflowExecution(workflowName, viewId, timestamp, {
            eventName: options.eventName || null,
            stepIndex: options.stepIndex || null,
            content: aiResponse.substring(0, 200), // 只记录前200字符
            stepFilePath: stepFilePath
        }).catch(err => console.error('记录工作流日志失败:', err));
    }
    
    return {
        viewId: viewId,
        content: finalContent, // 使用从文件读取的内容，而不是内存中的内容
        aiFilePath: aiFilePath,
        stepFilePath: stepFilePath,
        nodeFeedbackPath: nodeFeedbackPath
    };
}

/**
 * 测试模式：执行工作流步骤（不调用AI，不创建文件，仅用于展示执行流程）
 * @param {object} step - 工作流步骤
 * @param {object} stepResults - 已执行步骤的结果
 * @param {object} options - 执行选项
 * @returns {Promise<{viewId: string, content: string, aiFilePath: string|null, stepFilePath: string|null}>}
 */
async function executeWorkflowStepTest(step, stepResults, options = {}) {
    // 兼容新旧格式
    const viewId = step.viewId || step.self;
    const viewPrev = step.viewPrev || step.prev || [];
    
    // 读取当前视图内容（用于拼接）
    const viewData = await readCurrentView(viewId);
    
    // 构建模拟的AI回复内容（用于测试显示）
    let testContent = `[测试模式] 视图 ${viewId} 的处理结果\n\n`;
    testContent += `原始内容: ${viewData.content.substring(0, 100)}${viewData.content.length > 100 ? '...' : ''}\n\n`;
    
    // 添加前置步骤的内容（用于拼接测试）
    if (viewPrev && viewPrev.length > 0) {
        const prevContentsList = [];
        
        viewPrev.forEach(prevId => {
            // 检查是否有多个步骤输出到同一个节点
            if (options.nodeOutputSteps && options.nodeOutputSteps.has(prevId)) {
                const outputStepIndices = options.nodeOutputSteps.get(prevId);
                const outputSteps = Array.from(outputStepIndices).map(idx => options.allSteps[idx]).filter(Boolean);
                
                if (outputSteps.length > 1) {
                    // 多个步骤输出到同一个节点，拼接它们的结果
                    const sortedSteps = outputSteps
                        .map(s => ({
                            step: s,
                            content: stepResults[s.viewId || s.self],
                            x: s.x || 0,
                            y: s.y || 0
                        }))
                        .filter(item => item.content)
                        .sort((a, b) => {
                            if (a.y !== b.y) return a.y - b.y;
                            return a.x - b.x;
                        });
                    
                    if (sortedSteps.length > 0) {
                        const combinedContent = sortedSteps.map(item => item.content).join('\n\n---\n\n');
                        prevContentsList.push({
                            viewId: prevId,
                            content: combinedContent,
                            count: sortedSteps.length
                        });
                    }
                } else {
                    // 单个步骤
                    if (stepResults[prevId]) {
                        prevContentsList.push({
                            viewId: prevId,
                            content: stepResults[prevId],
                            count: 1
                        });
                    }
                }
            } else {
                // 向后兼容
                if (stepResults[prevId]) {
                    prevContentsList.push({
                        viewId: prevId,
                        content: stepResults[prevId],
                        count: 1
                    });
                }
            }
        });
        
        // 格式化前置内容
        if (prevContentsList.length > 0) {
            const prevContents = prevContentsList
                .map((item, index) => {
                    if (item.count > 1) {
                        return `前置步骤${index + 1}的AI回复（来自${item.count}个同名视图）:\n${item.content}`;
                    } else {
                        return `前置步骤${index + 1}的AI回复:\n${item.content}`;
                    }
                })
                .join('\n\n');
            
            testContent += `前置步骤内容:\n${prevContents}\n\n`;
        }
    }
    
    testContent += `[这是测试模式的模拟输出，实际执行时会调用AI生成内容]`;
    
    // 模拟AI处理延迟（让用户能看到效果）
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 生成执行日志（测试模式下文件名显示为"测试模式"）
    const viewNext = step.viewNext || step.next || [];
    const prevIds = step.viewPrev || step.prev || [];
    
    const prevInfoList = prevIds.map(prevId => {
        const prevStepResult = stepResults[prevId];
        if (!prevStepResult) return null;
        return `${prevId}+测试模式`;
    }).filter(Boolean);
    
    const prevInfo = prevInfoList.length > 0 ? prevInfoList.join(', ') : '无';
    const currentInfo = `${viewId}+测试模式`;
    const nextInfo = viewNext.length > 0 ? viewNext.join(', ') : '无';
    
    // 生成详细日志消息（测试模式）
    // 1. 当前视图的提示词
    const promptInfo = viewData.prompt ? `提示词: ${viewData.prompt.substring(0, 200)}${viewData.prompt.length > 200 ? '...' : ''}` : '提示词: 无';
    
    // 2. 发送给AI的内容（测试模式）
    const sentContentPreview = testContent.length > 200 
        ? testContent.substring(0, 200) + '...' 
        : testContent;
    const sentContentInfo = `发送内容: ${sentContentPreview.replace(/\n/g, ' ').substring(0, 300)}${sentContentPreview.length > 300 ? '...' : ''}`;
    
    // 3. 下一个视图
    const nextViewInfo = `下一个视图: ${nextInfo}`;
    
    // 生成基础日志消息（保持原有格式）
    const logMessage = `${prevInfo} -> ${currentInfo} -> ${nextInfo}`;
    
    // 生成详细日志消息（包含新增的三行信息）
    const detailedLogMessage = `${logMessage}\n  ${promptInfo}\n  ${sentContentInfo}\n  ${nextViewInfo}`;
    
    console.log(`[工作流执行日志-测试模式] ${detailedLogMessage}`);
    
    // 保存日志到执行状态
    if (state.workflowExecutionState) {
        if (!state.workflowExecutionState.executionLogs) {
            state.workflowExecutionState.executionLogs = [];
        }
        state.workflowExecutionState.executionLogs.push({
            stepIndex: options.stepIndex || 0,
            viewId: viewId,
            log: detailedLogMessage, // 使用详细日志消息
            timestamp: new Date().toISOString(),
            prompt: viewData.prompt || null, // 保存完整提示词
            sentContent: testContent, // 保存完整发送内容
            nextViews: viewNext // 保存下一个视图列表
        });
    }
    
    return {
        viewId: viewId,
        content: testContent,
        aiFilePath: null, // 测试模式不创建文件
        stepFilePath: null // 测试模式不创建文件
    };
}

/**
 * 测试模式：执行工作流（不调用AI，不创建文件，仅用于展示执行流程）
 * @param {string} workflowName - 工作流名称
 * @param {object} options - 执行选项
 */
export async function executeWorkflowTest(workflowName, options = {}) {
    try {
        const workflow = await getWorkflow(workflowName);
        const steps = parseWorkflowFormat(workflow.content);
        
        if (steps.length === 0) {
            throw new Error('工作流格式无效或为空');
        }
        
        // 测试模式使用顺序执行，以便更好地展示效果
        const sequential = true;
        
        // 构建步骤依赖图
        const stepMap = new Map();
        steps.forEach(step => {
            const stepId = step.viewId || step.self;
            stepMap.set(stepId, step);
        });
        
        // 执行结果存储
        let stepResults = {};
        let executedSteps = [];
        let executingSteps = new Set();
        let stepIndexCounter = 1;
        
        // 辅助函数
        const getStepId = (step) => step.viewId || step.self;
        const getStepNext = (step) => step.viewNext || step.next || [];
        const getStepPrev = (step) => step.viewPrev || step.prev || [];
        
        // 构建节点依赖图
        const nodeOutputSteps = new Map();
        steps.forEach((step, index) => {
            const nextIds = getStepNext(step);
            if (nextIds && nextIds.length > 0) {
                nextIds.forEach(nextId => {
                    if (!nodeOutputSteps.has(nextId)) {
                        nodeOutputSteps.set(nextId, new Set());
                    }
                    nodeOutputSteps.get(nextId).add(index);
                });
            }
        });
        
        // 检查节点是否真正就绪
        const isNodeReady = (nodeId, visited = new Set()) => {
            if (visited.has(nodeId)) {
                return !!stepResults[nodeId];
            }
            visited.add(nodeId);
            
            if (stepResults[nodeId]) {
                return true;
            }
            
            if (!nodeOutputSteps.has(nodeId)) {
                return false;
            }
            
            const outputStepIndices = nodeOutputSteps.get(nodeId);
            const allReady = Array.from(outputStepIndices).every(stepIndex => {
                const step = steps[stepIndex];
                const stepId = getStepId(step);
                if (!stepResults[stepId]) {
                    return false;
                }
                const prevIds = getStepPrev(step);
                if (prevIds && prevIds.length > 0) {
                    return prevIds.every(prevId => isNodeReady(prevId, new Set(visited)));
                }
                return true;
            });
            
            visited.delete(nodeId);
            return allReady;
        };
        
        // 获取就绪的步骤（按照y轴和x轴排序）
        const getReadySteps = () => {
            const minY = Math.min(...steps.map(s => s.y !== undefined ? s.y : 0));
            let maxAllowedY = minY;
            
            for (let y = minY; y <= Math.max(...steps.map(s => s.y !== undefined ? s.y : 0)); y++) {
                const nodesAtY = steps.filter(s => (s.y !== undefined ? s.y : 0) === y);
                const allCompletedAtY = nodesAtY.every(step => {
                    const stepId = getStepId(step);
                    return !!stepResults[stepId];
                });
                
                if (allCompletedAtY) {
                    maxAllowedY = y + 1;
                } else {
                    maxAllowedY = y;
                    break;
                }
            }
            
            const readySteps = steps.filter((step, stepIndex) => {
                const stepId = getStepId(step);
                const stepY = step.y !== undefined ? step.y : 0;
                
                if (executingSteps.has(stepId)) {
                    return false;
                }
                
                if (stepResults[stepId]) {
                    return false;
                }
                
                if (stepY > maxAllowedY) {
                    return false;
                }
                
                const prevIds = getStepPrev(step);
                if (prevIds && prevIds.length > 0) {
                    return prevIds.every(prevId => isNodeReady(prevId));
                }
                
                return true;
            });
            
            readySteps.sort((a, b) => {
                const aY = a.y !== undefined ? a.y : 0;
                const bY = b.y !== undefined ? b.y : 0;
                const aX = a.x !== undefined ? a.x : 0;
                const bX = b.x !== undefined ? b.x : 0;
                
                if (aY !== bY) {
                    return aY - bY;
                }
                
                return aX - bX;
            });
            
            return readySteps;
        };
        
        // 初始化执行状态（如果执行的是新工作流，清除旧状态）
        if (state.workflowExecutionState && 
            state.workflowExecutionState.workflowName !== workflowName) {
            // 执行新工作流时，清除旧状态
            state.workflowExecutionState = null;
        }
        
        state.workflowExecutionState = {
            workflowName: workflowName,
            stepResults: stepResults,
            executedSteps: executedSteps,
            executingSteps: executingSteps,
            isPaused: false,
            isCancelled: false,
            isCompleted: false, // 标记是否已完成
            options: { ...options, isTestMode: true },
            stepIndexCounter: stepIndexCounter,
            nodeOutputSteps: nodeOutputSteps,
            allSteps: steps,
            isTestMode: true // 标记为测试模式
        };
        
        updateWorkflowExecutionStatus();
        
        // 顺序执行模式（测试模式使用顺序执行以便展示效果）
        for (let i = 0; i < steps.length; i++) {
            // 检查是否被取消
            if (state.workflowExecutionState && state.workflowExecutionState.isCancelled) {
                throw new Error('工作流执行已终止');
            }
            
            // 检查是否被暂停
            while (state.workflowExecutionState && state.workflowExecutionState.isPaused) {
                await new Promise(resolve => setTimeout(resolve, 100));
                // 关键修复：只有在工作流执行状态存在时才触发状态更新
                if (state.workflowExecutionState) {
                    updateWorkflowExecutionStatus();
                }
            }
            
            if (state.workflowExecutionState && state.workflowExecutionState.isCancelled) {
                throw new Error('工作流执行已终止');
            }
            
            // 获取当前就绪的步骤（可能有多个，需要按顺序执行）
            const readySteps = getReadySteps();
            
            if (readySteps.length === 0) {
                // 没有就绪的步骤，可能是死锁或已全部完成
                break;
            }
            
            // 处理多个节点输入到同一节点的情况（测试模式下需要间隔5秒）
            // 对于每个就绪的步骤，检查是否有其他步骤也要输出到同一个目标节点
            for (const step of readySteps) {
                const stepId = getStepId(step);
                const stepNext = getStepNext(step);
                
                // 检查是否有多个步骤输出到同一个目标节点（测试模式下需要间隔5秒）
                let needsDelay = false;
                if (stepNext && stepNext.length > 0) {
                    for (const nextId of stepNext) {
                        if (nodeOutputSteps.has(nextId) && nodeOutputSteps.get(nextId).size > 1) {
                            // 有多个步骤输出到这个目标节点
                            const outputStepIndices = nodeOutputSteps.get(nextId);
                            const otherOutputSteps = Array.from(outputStepIndices)
                                .map(idx => {
                                    const s = steps[idx];
                                    return { step: s, stepId: getStepId(s) };
                                })
                                .filter(s => {
                                    // 查找已经执行过且输出到nextId的步骤
                                    return stepResults[s.stepId];
                                });
                            
                            // 如果已经有其他步骤输出到这个目标节点，当前步骤需要延迟5秒
                            if (otherOutputSteps.length > 0) {
                                needsDelay = true;
                                break;
                            }
                        }
                    }
                }
                
                // 如果当前步骤的目标节点已经有其他步骤的输出，需要等待5秒（展示多节点输入的效果）
                if (needsDelay) {
                    console.log(`[测试模式] 节点 ${stepId} 的目标节点已有其他输入，延迟5秒展示效果...`);
                    updateWorkflowExecutionStatus();
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
                
                // 标记为执行中
                executingSteps.add(stepId);
                state.workflowExecutionState.executingSteps = new Set(executingSteps);
                updateWorkflowExecutionStatus();
                
                // 执行步骤（测试模式）
                const result = await executeWorkflowStepTest(step, stepResults, {
                    stepIndex: stepIndexCounter++,
                    nodeOutputSteps: nodeOutputSteps,
                    allSteps: steps
                });
                
                // 保存结果
                stepResults[result.viewId] = result.content;
                executedSteps.push({
                    step: result.viewId,
                    aiFilePath: result.aiFilePath,
                    stepFilePath: result.stepFilePath,
                    content: result.content,
                    stepIndex: stepIndexCounter - 1
                });
                
                // 移除执行中标记
                executingSteps.delete(stepId);
                // 使用安全更新函数，确保在并发执行时只更新属于当前文件的状态
                if (safeUpdateWorkflowState(stepResults, executedSteps, new Set(executingSteps), options)) {
                    // 关键修复：只有在工作流执行状态存在时才触发状态更新
                    if (state.workflowExecutionState) {
                        updateWorkflowExecutionStatus();
                    }
                }
            }
        }
        
        // 执行完成，测试模式应该立即清空状态，避免影响其他地方
        // 关键修复：只有在工作流执行状态存在时才触发状态更新
        if (state.workflowExecutionState) {
            updateWorkflowExecutionStatus();
        }
        // 清除工作流执行锁定（在更新状态后）
        state.isWorkflowExecuting = false;
        // 关键修复：测试模式执行完毕后立即清空状态，避免影响其他地方
        state.workflowExecutionState = null;
        
        return {
            success: true,
            steps: executedSteps,
            results: stepResults
        };
    } catch (err) {
        if (err.message && err.message.includes('workflowName is not defined')) {
            // 如果是workflowName未定义错误，在控制台显示错误，不弹窗
            console.error('测试模式执行工作流失败:', err);
            console.error('错误详情: workflowName is not defined');
            console.trace('调用堆栈:');
        } else {
            console.error('测试模式执行工作流失败:', err);
            // 清除工作流执行锁定
            state.isWorkflowExecuting = false;
            if (err.message === '工作流执行已终止') {
                // 终止时才清除状态
                state.workflowExecutionState = null;
                updateWorkflowExecutionStatus();
            }
            throw err;
        }
    }
}

/**
 * 执行工作流（支持并发执行）
 * @param {string} workflowName - 工作流名称
 * @param {string} initialContent - 初始内容（可选）
 * @param {object} options - 执行选项 {concurrency: number, sequential: boolean}
 */
export async function executeWorkflow(workflowName, initialContent = null, options = {}) {
    // 检查workflowName是否已定义
    if (!workflowName) {
        console.error('工作流执行失败: workflowName is not defined');
        console.trace('调用堆栈:'); // 输出调用堆栈以便调试
        throw new Error('工作流执行失败: workflowName is not defined');
    }

    try {
        const workflow = await getWorkflow(workflowName);
        const steps = parseWorkflowFormat(workflow.content);
        
        if (steps.length === 0) {
            throw new Error('工作流格式无效或为空');
        }
        
        const concurrency = options.concurrency || 3;
        const sequential = options.sequential || false;
        
        // 构建步骤依赖图（兼容新旧格式）
        const stepMap = new Map();
        steps.forEach(step => {
            const stepId = step.viewId || step.self;
            stepMap.set(stepId, step);
        });
        
        // 执行结果存储 {viewId: content}
        // 如果是从暂停状态继续，使用已有状态
        // 如果执行新工作流，清除旧状态（保留执行结果显示）
        let stepResults = {};
        let executedSteps = [];
        let executingSteps = new Set();
        let stepIndexCounter = 1;
        
        // 辅助函数：获取步骤ID（兼容新旧格式）
        const getStepId = (step) => step.viewId || step.self;
        // 辅助函数：获取步骤的下一步列表（兼容新旧格式）
        const getStepNext = (step) => step.viewNext || step.next || [];
        // 辅助函数：获取步骤的前一步列表（兼容新旧格式）
        const getStepPrev = (step) => step.viewPrev || step.prev || [];
        
        // 构建节点依赖图：哪些步骤输出到哪些节点（必须在初始化状态之前定义）
        const nodeOutputSteps = new Map(); // nodeId -> Set of step indices that output to it
        const workflowOutputSteps = new Map(); // workflowId -> Set of step indices that output to it
        // 关键修复：构建节点到步骤的映射，用于直接检查节点对应的步骤状态
        const nodeToStepIndex = new Map(); // nodeId (viewId/workflowId) -> step index
        steps.forEach((step, index) => {
            const nextIds = getStepNext(step);
            if (nextIds && nextIds.length > 0) {
                nextIds.forEach(nextId => {
                    if (!nodeOutputSteps.has(nextId)) {
                        nodeOutputSteps.set(nextId, new Set());
                    }
                    nodeOutputSteps.get(nextId).add(index);
                });
            }
            // 同时构建工作流节点的依赖图
            const workflowNextIds = step.workflowNext || [];
            if (workflowNextIds && workflowNextIds.length > 0) {
                workflowNextIds.forEach(nextWorkflowId => {
                    if (!workflowOutputSteps.has(nextWorkflowId)) {
                        workflowOutputSteps.set(nextWorkflowId, new Set());
                    }
                    workflowOutputSteps.get(nextWorkflowId).add(index);
                });
            }
            
            // 关键修复：构建节点到步骤的映射
            // 视图节点映射：viewId -> step index
            const viewId = getStepId(step);
            if (viewId) {
                nodeToStepIndex.set(viewId, index);
            }
            // 工作流节点映射：workflowId -> step index
            const workflowId = step.workflowId;
            if (workflowId) {
                nodeToStepIndex.set(workflowId, index);
            }
            // 关键修复：如果viewId是工作流名称（但没有显式的workflowId），也应该映射到步骤索引
            // 这样当工作流节点使用viewId作为标识时，也能正确找到对应的步骤
            // 注意：如果已经有workflowId，就不需要再次设置viewId的映射（因为workflowId已经映射了）
            if (viewId && !workflowId && state.workflows && state.workflows.some(w => w.name === viewId)) {
                // viewId已经是工作流名称，但workflowId为空，说明viewId就是工作流标识
                // 这种情况下，viewId已经在上面设置了映射，不需要重复设置
                // 但为了确保工作流节点能通过viewId找到步骤，这里可以添加额外的日志
                console.log(`[节点映射] 步骤 ${index} 的 viewId "${viewId}" 是工作流名称，已映射到步骤索引`);
            }
        });
        
        // 如果执行的是新工作流（不是继续执行当前工作流），清除旧状态
        // 关键：在批量执行模式下，需要检查 workflowExecutionState 是否属于当前文件
        // 如果不属于（batchFilePath 不同），就不应该清除它，而是创建新的状态
        // 关键修复：如果是嵌套工作流（工作流节点），总是创建新状态，不影响本体工作流状态
        // 如果是本体工作流，检查是否需要重置状态
        const isNestedWorkflow = options.isNestedWorkflow || false;
        const shouldResetState = isNestedWorkflow ? true : (
            !state.workflowExecutionState || 
            state.workflowExecutionState.workflowName !== workflowName ||
            (options.batchFilePath && 
             state.workflowExecutionState.batchFilePath &&
             state.workflowExecutionState.batchFilePath !== options.batchFilePath)
        );
        
        // 关键修复：如果是嵌套工作流，不重置状态（让嵌套工作流创建自己的状态）
        // 如果是本体工作流，按原逻辑重置状态
        if (shouldResetState && state.workflowExecutionState && !isNestedWorkflow) {
            // 执行新工作流或不同文件时，清除旧状态（重置步骤计数）
            console.log(`[executeWorkflow] 检测到新工作流或不同文件，重置状态（工作流: ${workflowName}, batchFilePath: ${options.batchFilePath || 'null'})`);
            state.workflowExecutionState = null;
        } else if (isNestedWorkflow) {
            // 嵌套工作流：临时保存本体工作流状态，创建新的状态
            // 注意：这里不需要清空state.workflowExecutionState，因为已经在调用前保存了
            console.log(`[executeWorkflow] 嵌套工作流执行: ${workflowName}（本体工作流状态已保存）`);
        }
        
        if (state.workflowExecutionState && 
            state.workflowExecutionState.workflowName === workflowName &&
            state.workflowExecutionState.isPaused) {
            // 从暂停状态继续
            stepResults = { ...state.workflowExecutionState.stepResults };
            executedSteps = [...state.workflowExecutionState.executedSteps];
            executingSteps = new Set(state.workflowExecutionState.executingSteps);
            stepIndexCounter = state.workflowExecutionState.stepIndexCounter || 1;
            state.workflowExecutionState.isPaused = false;
            // 从暂停状态继续，也需要保存这些信息（用于等待状态显示）
            state.workflowExecutionState.nodeOutputSteps = nodeOutputSteps;
            state.workflowExecutionState.workflowOutputSteps = workflowOutputSteps;
            state.workflowExecutionState.allSteps = steps;
            // 关键修复：从暂停状态继续时，确保executionLogs已初始化
            if (!state.workflowExecutionState.executionLogs) {
                state.workflowExecutionState.executionLogs = [];
            }
        } else {
            // 新的执行（确保步骤计数从1开始）
            // 关键修复：每次新工作流开始时，都重置步骤计数
            // 关键修复：如果是嵌套工作流且有initialStepResults，使用它来初始化stepResults
            stepResults = options.initialStepResults ? { ...options.initialStepResults } : {};
            executedSteps = [];
            executingSteps = new Set();
            stepIndexCounter = 1;
            
            // 关键：在批量执行模式下，如果 workflowExecutionState 已经存在且属于其他文件
            // 需要先保存它，创建新状态，执行完成后恢复
            const previousState = (options.batchFilePath && 
                                  state.workflowExecutionState && 
                                  state.workflowExecutionState.batchFilePath &&
                                  state.workflowExecutionState.batchFilePath !== options.batchFilePath) 
                                  ? JSON.parse(JSON.stringify(state.workflowExecutionState)) 
                                  : null;
            
            // 关键修复：如果是嵌套工作流，在创建新状态前，父状态应该已经在调用前保存了
            // 这里直接创建新状态即可（父状态会在调用后恢复）
            // 关键修复：创建步骤状态机映射，用于跟踪每个步骤的状态（pending/executing/completed/failed）
            // stepStatusMap: { stepUniqueId: 'pending' | 'executing' | 'completed' | 'failed' }
            const stepStatusMap = new Map();
            steps.forEach((step, index) => {
                const stepUniqueId = `step_${index}`;
                stepStatusMap.set(stepUniqueId, 'pending');
            });
            
            // 关键修复：保留之前的日志，不清空，确保多次使用时日志能累积显示
            // 获取之前的日志（如果存在），用于累积显示
            const previousExecutionLogs = state.workflowExecutionState?.executionLogs || [];
            const previousF12Logs = state.workflowExecutionState?.f12Logs || [];
            
            // 计算总步骤数（包括工作流节点内部的步骤）
            // 使用同步方式计算，避免async/await问题
            const countStepsDeeply = (steps) => {
                let totalSteps = 0;
                if (!steps || !Array.isArray(steps)) {
                    return 0;
                }
                steps.forEach(step => {
                    try {
                        // 检查是否是工作流节点
                        if (step && step.workflowId) {
                            // 如果是工作流节点，需要查找对应的工作流并统计其步骤数
                            const workflow = state.workflows?.find(w => w.name === (step.viewId || step.self));
                            if (workflow && workflow.content) {
                                try {
                                    // 同步解析工作流格式
                                    const workflowSteps = parseWorkflowFormat(workflow.content);
                                    const internalStepCount = countStepsDeeply(workflowSteps);
                                    totalSteps += 1 + internalStepCount; // 工作流节点本身 + 内部步骤
                                } catch (parseErr) {
                                    // 如果解析失败，至少算作1个步骤
                                    totalSteps += 1;
                                }
                            } else {
                                totalSteps += 1; // 如果找不到工作流，至少算作1个步骤
                            }
                        } else {
                            // 普通步骤
                            totalSteps += 1;
                        }
                    } catch (stepError) {
                        // 如果单个步骤统计出错，至少算作1个步骤
                        totalSteps += 1;
                    }
                });
                return totalSteps;
            };
            
            // 计算总步骤数
            let calculatedTotalSteps = 0;
            try {
                calculatedTotalSteps = countStepsDeeply(steps);
            } catch (err) {
                // 如果计算失败，使用步骤数组长度作为后备
                calculatedTotalSteps = steps.length;
            }
            
            // 关键修复：生成或获取执行ID
            // 如果options中有batchExecutionId，使用它；否则生成新的执行ID
            const executionId = options.batchExecutionId || (options.eventName && options.eventTimestamp ? generateExecutionId() : '');
            
            // 关键修复：每次新工作流开始时，保留之前的日志，不清空
            state.workflowExecutionState = {
                workflowName: workflowName,
                stepResults: stepResults,
                executedSteps: executedSteps,
                executingSteps: executingSteps,
                isPaused: false,
                isCancelled: false,
                isCompleted: false, // 标记是否已完成
                options: options, // 保存options，包含eventName等信息（用于批量执行进度日志更新）
                stepIndexCounter: stepIndexCounter,
                nodeOutputSteps: nodeOutputSteps, // 保存nodeOutputSteps用于等待状态显示
                allSteps: steps, // 保存steps用于等待状态显示
                batchFilePath: options.batchFilePath || null,  // 保存批量处理的文件路径（如果有）
                _previousState: previousState,  // 保存之前的状态，用于恢复
                // 关键修复：保存嵌套工作流的上下文信息，用于在生成文件时添加标识
                isNestedWorkflow: options.isNestedWorkflow || false,
                parentWorkflowName: options.parentWorkflowName || null,
                parentWorkflowViewId: options.parentWorkflowViewId || null,
                parentWorkflowState: options.parentWorkflowState || null, // 保存父工作流状态，用于依赖判定
                stepStatusMap: stepStatusMap, // 步骤状态机映射
                executionLogs: previousExecutionLogs, // 关键修复：保留之前的执行日志，不清空，确保多次使用时日志能累积显示
                f12Logs: previousF12Logs, // 关键修复：保留之前的F12日志，不清空，确保一直全部显示
                totalSteps: calculatedTotalSteps, // 关键修复：保存计算好的总步骤数（包括工作流节点内部的步骤）
                aiFileWriteCompleted: new Map(), // 关键修复：AI文件写入完成状态映射，viewId -> boolean，用于跟踪每个视图的AI文件是否写入完成
                batchExecutionId: options.batchExecutionId || '', // 关键修复：保存batchExecutionId，用于区分相同事件的多次执行
                executionId: executionId, // 关键修复：保存执行ID，用于统一日志系统
                eventName: options.eventName || null // 关键修复：保存事件名，用于嵌套工作流中的步骤获取事件信息
            };
        }
        
        // 如果是批量执行模式，确保 batchFilePath 被保存
        // 这是关键：即使 state.originalPath 被主界面修改，batchFilePath 也会保持不变
        if (options.batchFilePath && state.workflowExecutionState) {
            state.workflowExecutionState.batchFilePath = options.batchFilePath;
            console.log(`[executeWorkflow] 批量执行模式，已保存 batchFilePath: ${options.batchFilePath}`);
        }
        
        // 验证：如果 options 中有 batchFilePath，但 workflowExecutionState 中没有，说明有问题
        if (options.batchFilePath && !state.workflowExecutionState?.batchFilePath) {
            console.error(`[executeWorkflow] 警告：batchFilePath 未正确保存到 workflowExecutionState`);
            // 强制设置
            if (state.workflowExecutionState) {
                state.workflowExecutionState.batchFilePath = options.batchFilePath;
            }
        }
        
        // 更新状态显示
        updateWorkflowExecutionStatus();
        
        // 找到所有起始步骤（没有前置步骤的步骤）
        // 改进版：支持多步骤输出到同一节点的情况
        // 关键理解：工作流格式中，self是步骤的唯一标识符
        // 如果有多个步骤的self相同，它们实际上是同一个步骤的多次执行
        // 但更常见的情况是：多个步骤输出到同一个节点（next中包含相同的节点ID）
        // 当前格式中，self应该是唯一的，但我们需要支持：
        // 1. 多个步骤的前置条件不同，但都输出到同一个节点（通过next字段）
        // 2. 后续步骤需要等待所有输出到该节点的步骤都完成
        steps.forEach((step, index) => {
            const nextIds = getStepNext(step);
            if (nextIds && nextIds.length > 0) {
                nextIds.forEach(nextId => {
                    if (!nodeOutputSteps.has(nextId)) {
                        nodeOutputSteps.set(nextId, new Set());
                    }
                    nodeOutputSteps.get(nextId).add(index);
                });
            }
        });
        
        // 获取节点的等待状态信息（用于显示等待提示）
        const getNodeWaitingInfo = (nodeId) => {
            if (!nodeOutputSteps.has(nodeId)) {
                return null;
            }
            
            const outputStepIndices = nodeOutputSteps.get(nodeId);
            const waitingSteps = [];
            const completedSteps = [];
            
            Array.from(outputStepIndices).forEach(stepIndex => {
                const step = steps[stepIndex];
                const stepId = getStepId(step);
                const stepResult = stepResults[stepId];
                const executedStep = executedSteps.find(es => es.step === stepId);
                const stepIndexNumber = executedStep ? executedStep.stepIndex : null;
                const isExecuting = executingSteps.has(stepId);
                
                if (stepResult) {
                    completedSteps.push({
                        stepIndex: stepIndexNumber,
                        viewId: stepId,
                        isExecuting: isExecuting
                    });
                } else {
                    waitingSteps.push({
                        stepIndex: stepIndexNumber,
                        viewId: stepId,
                        isExecuting: isExecuting
                    });
                }
            });
            
            if (waitingSteps.length === 0) {
                return null; // 所有步骤都已完成，不需要等待
            }
            
            return {
                nodeId: nodeId,
                waitingSteps: waitingSteps,
                completedSteps: completedSteps,
                totalSteps: outputStepIndices.size,
                completedCount: completedSteps.length,
                waitingCount: waitingSteps.length
            };
        };
        
        // 检查节点是否真正就绪（所有输出到该节点的步骤都已完成）
        // 使用visited集合避免循环依赖导致的无限递归
        // 关键修复：如果是嵌套工作流，需要检查父工作流的状态，而不是当前工作流的状态
        const isNodeReady = (nodeId, visited = new Set(), useParentState = false) => {
            // 防止循环依赖
            if (visited.has(nodeId)) {
                // 如果已经在访问路径中，检查是否有结果（可能是循环依赖，但已有结果）
                return !!stepResults[nodeId];
            }
            visited.add(nodeId);
            
            // 关键修复：如果是嵌套工作流，检查父工作流的状态
            // 对于工作流节点，它的依赖应该基于本体工作流的结果，而不是子工作流的结果
            let stateStepResults = {};
            if (useParentState && options.parentWorkflowState) {
                // 使用父工作流的状态来检查依赖
                stateStepResults = options.parentWorkflowState.stepResults || {};
                console.log(`[isNodeReady] 使用父工作流状态检查节点 ${nodeId} 的依赖（父工作流: ${options.parentWorkflowState.workflowName}）`);
            } else {
                // 使用当前工作流的状态
                stateStepResults = state.workflowExecutionState?.stepResults || {};
            }
            
            // 关键修复：优先检查内存中的stepResults，这是最可靠的判定方式
            // 如果内存中有结果，直接返回true，不依赖状态机或文件
            // 同时检查本地stepResults和state中的stepResults
            const hasResultInMemory = stepResults[nodeId] !== undefined || stateStepResults[nodeId] !== undefined;
            if (hasResultInMemory) {
                visited.delete(nodeId);
                return true;
            }
            
            // 关键修复：如果内存中没有结果，需要检查状态机状态来判定节点是否完成
            // 但最终判定还是要看内存中是否有stepResults，因为状态机状态可能更新了但stepResults还没更新
            // 获取状态机映射（优先使用父工作流的状态机，如果是嵌套工作流）
            let stepStatusMap = state.workflowExecutionState?.stepStatusMap;
            if (useParentState && options.parentWorkflowState && options.parentWorkflowState.stepStatusMap) {
                stepStatusMap = options.parentWorkflowState.stepStatusMap;
            }
            
            // 关键修复：首先检查节点对应的步骤是否完成
            // 如果 nodeId 对应一个步骤，直接检查这个步骤的状态
            // 这是修复工作流节点前置依赖检查的关键
            if (nodeToStepIndex.has(nodeId)) {
                const stepIndex = nodeToStepIndex.get(nodeId);
                const stepUniqueId = `step_${stepIndex}`;
                
                // 关键修复：优先检查内存中的stepResults，这是最可靠的判定方式
                const step = steps[stepIndex];
                const stepId = getStepId(step);
                const hasResultInMemoryForStep = stepResults[stepId] !== undefined || 
                                                 stepResults[stepUniqueId] !== undefined ||
                                                 stateStepResults[stepId] !== undefined ||
                                                 stateStepResults[stepUniqueId] !== undefined;
                
                if (hasResultInMemoryForStep) {
                    visited.delete(nodeId);
                    // 关键修复：取消显示节点就绪检测日志，避免日志过多
                    // console.log(`[isNodeReady] 节点 ${nodeId} 对应的步骤 ${stepUniqueId} 在内存中已有结果，已就绪`);
                    return true;
                }
                
                // 如果内存中没有结果，检查状态机状态
                // 关键修复：状态机状态为completed不代表内存中已经有结果，需要等待内存中的结果
                if (stepStatusMap && stepStatusMap.has(stepUniqueId)) {
                    const currentStatus = stepStatusMap.get(stepUniqueId);
                    // 关键修复：即使状态机显示completed，如果内存中没有stepResults，也认为未就绪
                    // 因为等待应该基于内存中的stepResults，而不是状态机状态
                    if (currentStatus === 'completed') {
                        // 状态机显示已完成，但内存中还没有结果，需要等待内存中的结果
                        visited.delete(nodeId);
                        return false;
                    }
                }
                
                visited.delete(nodeId);
                return false;
            }
            
            // 如果节点不对应步骤，检查是否有步骤输出到这个节点
            // 这是原有的逻辑，用于处理多步骤输出到同一节点的情况
            let viewReady = true;
            if (nodeOutputSteps.has(nodeId)) {
                const outputStepIndices = nodeOutputSteps.get(nodeId);
                viewReady = Array.from(outputStepIndices).every(stepIndex => {
                    const stepUniqueId = `step_${stepIndex}`;
                    // 关键修复：优先检查内存中的stepResults，这是最可靠的判定方式
                    const step = steps[stepIndex];
                    const stepId = getStepId(step);
                    const hasResultInMemory = stepResults[stepId] !== undefined || 
                                             stepResults[stepUniqueId] !== undefined ||
                                             stateStepResults[stepId] !== undefined ||
                                             stateStepResults[stepUniqueId] !== undefined;
                    
                    // 关键修复：只有内存中有结果时才认为就绪，不依赖状态机状态
                    // 因为状态机状态可能更新了但stepResults还没更新到内存中
                    return hasResultInMemory;
                });
            }
            
            // 检查工作流节点的依赖（如果当前节点是工作流节点，基于状态机状态）
            let workflowReady = true;
            // 检查是否有步骤的工作流输出指向这个节点
            if (workflowOutputSteps.has(nodeId)) {
                const outputStepIndices = workflowOutputSteps.get(nodeId);
                workflowReady = Array.from(outputStepIndices).every(stepIndex => {
                    const stepUniqueId = `step_${stepIndex}`;
                    // 关键修复：优先检查内存中的stepResults，这是最可靠的判定方式
                    const step = steps[stepIndex];
                    const stepId = getStepId(step);
                    const hasResultInMemory = stepResults[stepId] !== undefined || 
                                             stepResults[stepUniqueId] !== undefined ||
                                             stateStepResults[stepId] !== undefined ||
                                             stateStepResults[stepUniqueId] !== undefined;
                    
                    // 关键修复：只有内存中有结果时才认为就绪，不依赖状态机状态
                    return hasResultInMemory;
                });
            }
            
            visited.delete(nodeId);
            // 只有当view依赖和工作流依赖都满足时，节点才就绪
            const isReady = viewReady && workflowReady;
            // 关键修复：取消显示节点就绪检测日志，避免日志过多
            // if (isReady) {
            //     console.log(`[isNodeReady] 节点 ${nodeId} 已就绪: viewReady=${viewReady}, workflowReady=${workflowReady}`);
            // }
            return isReady;
        };
        
        // 获取就绪的步骤（只要依赖满足就可以执行，不受y轴限制）
        // 关键修复：只要满足前置依赖条件就可以执行，不受y轴限制
        const getReadySteps = () => {
            // 筛选出可以执行的步骤：只要满足前置依赖条件就可以执行，不受y轴限制
            const readySteps = steps.filter((step, stepIndex) => {
                // 使用步骤在数组中的索引作为唯一标识，而不是viewId，以支持同名视图ID
                const stepUniqueId = `step_${stepIndex}`;
                
                // 如果已经在执行，跳过
                if (executingSteps.has(stepUniqueId)) {
                    return false;
                }
                
                // 如果这个步骤已经完成，跳过（使用stepUniqueId来检查）
                if (stepResults[stepUniqueId] !== undefined) {
                    return false;
                }
                
                // 检查所有前置步骤是否都已完成（只要满足依赖条件就可以执行，不受y轴限制）
                const prevIds = getStepPrev(step);
                const workflowPrevIds = step.workflowPrev || [];
                
                // 关键修复：工作流节点步骤的依赖判定逻辑
                // 1. 对于本体工作流中的工作流节点步骤：使用当前工作流（本体工作流）的状态来检查依赖
                // 2. 对于嵌套工作流中的工作流节点步骤：使用父工作流的状态来检查依赖
                // 检查当前步骤是否是工作流节点
                const isWorkflowNodeStep = step.workflowId || (state.workflows && state.workflows.some(w => w.name === (step.viewId || step.self)));
                
                // 关键修复：工作流节点步骤应该使用当前工作流的状态来检查依赖（不是父状态）
                // 因为工作流节点步骤本身属于当前工作流，它的前置步骤也在当前工作流中
                // 只有当嵌套工作流执行时，如果它的步骤是工作流节点，才需要使用父状态（但这种情况在嵌套工作流内部不应该发生）
                // 实际上，对于工作流节点步骤，我们应该始终使用当前工作流的状态来检查依赖
                const useParentState = false; // 工作流节点步骤使用当前工作流状态检查依赖，不使用父状态
                
                // 检查view节点的前置依赖（使用当前工作流状态）
                const viewPrevReady = !prevIds || prevIds.length === 0 || prevIds.every(prevId => isNodeReady(prevId, new Set(), useParentState));
                
                // 检查工作流节点的前置依赖（使用当前工作流状态）
                const workflowPrevReady = !workflowPrevIds || workflowPrevIds.length === 0 || workflowPrevIds.every(prevWorkflowId => isNodeReady(prevWorkflowId, new Set(), useParentState));
                
                // 只有当view依赖和工作流依赖都满足时，步骤才就绪
                return viewPrevReady && workflowPrevReady;
            });
            
            // 注意：不再基于viewId去重，因为步骤应该基于xy坐标来区分
            // 相同viewId的步骤在不同xy位置应该是不同的步骤，都应该被执行
            const uniqueReadySteps = readySteps;
            
            // 按照y轴排序（时间轴），然后按照x轴排序（同一时间的顺序）
            // y轴小的先执行，同一y轴内x轴小的先执行（仅用于排序，不影响执行）
            uniqueReadySteps.sort((a, b) => {
                const aY = a.y !== undefined ? a.y : 0;
                const bY = b.y !== undefined ? b.y : 0;
                const aX = a.x !== undefined ? a.x : 0;
                const bX = b.x !== undefined ? b.x : 0;
                
                // 先按y轴排序（时间轴）
                if (aY !== bY) {
                    return aY - bY;
                }
                
                // 同一y轴内按x轴排序（同一时间的顺序）
                return aX - bX;
            });
            
            return uniqueReadySteps;
        };
        
        // 设置工作流执行状态（用于锁定）
        state.isWorkflowExecuting = true;
        
        // 获取执行选项（从外部传入）
        // 关键修复：如果 options 中没有 stepOptions，直接从 options 获取参数（用于嵌套工作流）
        const stepOptions = options.stepOptions || {
            eventName: options.eventName,
            eventTimestamp: options.eventTimestamp,
            batchFilePath: options.batchFilePath,
            batchExecutionId: options.batchExecutionId,
            isNestedWorkflow: options.isNestedWorkflow,
            parentWorkflowName: options.parentWorkflowName,
            parentWorkflowViewId: options.parentWorkflowViewId,
            parentWorkflowState: options.parentWorkflowState,
            workflowName: options.workflowName
        };
        
        // 顺序执行模式
        if (sequential) {
            // 关键修复：顺序执行模式也需要检查依赖，不能简单按索引顺序执行
            // 需要使用getReadySteps来获取可以执行的步骤
            const executedStepIndices = new Set();
            
            while (executedStepIndices.size < steps.length) {
                // 检查是否被取消
                if (state.workflowExecutionState && state.workflowExecutionState.isCancelled) {
                    throw new Error('工作流执行已终止');
                }
                
                // 检查是否被暂停
                while (state.workflowExecutionState && state.workflowExecutionState.isPaused) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    // 关键修复：只有在工作流执行状态存在时才触发状态更新
                    if (state.workflowExecutionState) {
                        updateWorkflowExecutionStatus();
                    }
                }
                
                // 检查是否被取消（暂停后可能被取消）
                if (state.workflowExecutionState && state.workflowExecutionState.isCancelled) {
                    throw new Error('工作流执行已终止');
                }
                
                // 获取就绪的步骤（基于内存中的stepResults判定）
                const readySteps = getReadySteps().filter((step, index) => {
                    const originalIndex = steps.indexOf(step);
                    return !executedStepIndices.has(originalIndex);
                });
                
                if (readySteps.length === 0) {
                    // 没有就绪的步骤，等待一段时间后再次检查
                    console.log(`[顺序执行] 没有就绪的步骤，等待100ms后再次检查...`);
                    await new Promise(resolve => setTimeout(resolve, 100));
                    continue;
                }
                
                // 按y、x坐标排序，选择第一个就绪的步骤执行
                readySteps.sort((a, b) => {
                    const aY = a.y !== undefined ? a.y : 0;
                    const bY = b.y !== undefined ? b.y : 0;
                    const aX = a.x !== undefined ? a.x : 0;
                    const bX = b.x !== undefined ? b.x : 0;
                    if (aY !== bY) return aY - bY;
                    return aX - bX;
                });
                
                const step = readySteps[0];
                const stepIndex = steps.indexOf(step);
                const viewId = getStepId(step);
                
                // 标记为已执行
                executedStepIndices.add(stepIndex);
                
                // 更新状态
                // 使用安全更新函数，确保在并发执行时只更新属于当前文件的状态
                if (safeUpdateWorkflowState(stepResults, executedSteps, undefined, options)) {
                    updateWorkflowExecutionStatus();
                }
                
                let result;
                
                // 关键修复：使用独立的工作流节点执行器
                // 先尝试执行工作流节点，如果不是工作流节点，返回null，继续执行普通步骤
                // 关键修复：传递stepUniqueId给工作流节点执行器，用于存储结果
                const stepUniqueIdForNode = `step_${stepIndex}`;
                
                // 关键修复：在工作流节点执行前，记录开始执行的日志
                if (state.workflowExecutionState && !stepOptions.isNestedWorkflow) {
                    const viewId = step.viewId || step.self;
                    // 检查是否是工作流节点（通过检查workflowId或在工作流列表中查找）
                    const isWorkflowNode = step.workflowId || (state.workflows && state.workflows.some(w => w.name === viewId));
                    if (isWorkflowNode) {
                        const executionId = state.workflowExecutionState.executionId || state.workflowExecutionState.batchExecutionId || '';
                        const eventName = stepOptions.eventName || state.workflowExecutionState.options?.eventName || '';
                        const currentWorkflowName = state.workflowExecutionState.workflowName || '';
                        const workflowNodeName = step.workflowId || viewId;
                        
                        // 尝试获取内部步骤数（如果可能）
                        let internalStepCount = 0;
                        if (state.workflows) {
                            const nestedWorkflow = state.workflows.find(w => w.name === workflowNodeName);
                            if (nestedWorkflow && nestedWorkflow.content) {
                                try {
                                    const nestedSteps = parseWorkflowFormat(nestedWorkflow.content);
                                    internalStepCount = nestedSteps.length;
                                } catch (e) {
                                    // 解析失败，使用默认值0
                                }
                            }
                        }
                        
                        if (executionId && eventName && currentWorkflowName) {
                            appendWorkflowNodeStartLog(
                                executionId,
                                eventName,
                                currentWorkflowName,
                                stepIndex + 1,
                                workflowNodeName,
                                internalStepCount
                            );
                        }
                    }
                }
                
                const workflowNodeResult = await executeWorkflowNode(step, stepOptions, stepIndex + 1, workflowName, stepUniqueIdForNode);
                
                if (workflowNodeResult) {
                    // 是工作流节点，使用执行器的结果
                    result = workflowNodeResult;
                    
                    // 关键修复：工作流节点执行器已经将结果存储到了state.workflowExecutionState.stepResults中
                    // 需要同步到本地的stepResults对象，以便getReadySteps()能正确检查步骤是否完成
                    if (state.workflowExecutionState && state.workflowExecutionState.stepResults) {
                        // 同步stepUniqueId的结果到本地stepResults
                        if (state.workflowExecutionState.stepResults[stepUniqueIdForNode] !== undefined) {
                            stepResults[stepUniqueIdForNode] = state.workflowExecutionState.stepResults[stepUniqueIdForNode];
                        }
                        // 同步viewId的结果
                        if (state.workflowExecutionState.stepResults[result.viewId] !== undefined) {
                            stepResults[result.viewId] = state.workflowExecutionState.stepResults[result.viewId];
                        }
                        // 同步workflowId的结果（如果是工作流节点）
                        if (result.isWorkflowNode && result.workflowNodeName) {
                            if (state.workflowExecutionState.stepResults[result.workflowNodeName] !== undefined) {
                                stepResults[result.workflowNodeName] = state.workflowExecutionState.stepResults[result.workflowNodeName];
                            }
                        }
                    }
                } else {
                    // 普通节点，使用executeWorkflowStep执行
                    result = await executeWorkflowStep(step, stepResults, {
                        ...stepOptions,
                        stepIndex: stepIndex + 1,
                        nodeOutputSteps: nodeOutputSteps,
                        allSteps: steps
                    });
                    
                    // 关键修复：使用新的日志系统记录普通节点执行完成的日志
                    if (state.workflowExecutionState && !stepOptions.isNestedWorkflow) {
                        const executionId = state.workflowExecutionState.executionId || state.workflowExecutionState.batchExecutionId || '';
                        const eventName = stepOptions.eventName || state.workflowExecutionState.options?.eventName || '';
                        const workflowName = state.workflowExecutionState.workflowName || '';
                        const viewId = result.viewId || getStepId(step);
                        
                        if (executionId && eventName && workflowName) {
                            // 构建日志消息（简化版，详细日志已经在executeWorkflowStep中记录到executionLogs）
                            const logMessage = `${viewId} -> 执行完成`;
                            appendDetailLog(
                                executionId,
                                eventName,
                                workflowName,
                                stepIndex + 1,
                                '普通节点',
                                viewId,
                                logMessage,
                                {
                                    isWorkflowNode: false,
                                    workflowNodeName: null
                                }
                            );
                        }
                    }
                }
                
                // 在AI回复完毕后，执行下一工作流前，检测工作流控制指令
                const workflowControl = detectWorkflowControl(result.content);
                
                // 检测关键字识别并执行相应函数
                let keywordExecutionResults = [];
                try {
                    const { detectKeywordRecognition } = await import('./usage/keywordRecognitionManager.js');
                    const detectionResult = await detectKeywordRecognition(result.content);
                    
                    if (detectionResult && detectionResult.detected && detectionResult.results && detectionResult.results.length > 0) {
                        console.log(`[关键字识别] 在工作流步骤 ${stepIndex + 1} (${step.viewId || step.self}) 中检测到 ${detectionResult.results.length} 个规则的关键字`);
                        
                        // 执行每个规则对应的处理函数
                        for (const ruleResult of detectionResult.results) {
                            const ruleId = ruleResult.ruleId;
                            const keywords = ruleResult.keywords || [];
                            
                            if (keywords.length === 0) continue;
                            
                            try {
                                // 动态导入关键字识别管理模块，尝试执行对应的处理函数
                                const keywordManager = await import('./usage/keywordRecognitionManager.js');
                                
                                // 构建函数名：process + 规则标题（去除特殊字符）
                                const { getAllRecognitionRules } = await import('./usage/keywordRecognitionManager.js');
                                const rules = await getAllRecognitionRules();
                                const rule = rules.find(r => r.id === ruleId);
                                
                                if (!rule) {
                                    console.warn(`[关键字识别] 规则 ${ruleId} 不存在，跳过执行`);
                                    continue;
                                }
                                
                                // 尝试查找并执行处理函数
                                // 函数命名规范：process + 规则标题（去除特殊字符）+ Recognition
                                const functionNameBase = (rule.title || 'Keyword').replace(/[^a-zA-Z0-9]/g, '');
                                const processFunctionName = `process${functionNameBase}Recognition`;
                                
                                // 智能查找处理函数：先找标准函数，找不到则扫描用户代码块
                                const { findProcessFunction } = await import('./usage/keywordRecognitionManager.js');
                                const functionInfo = await findProcessFunction(keywordManager, ruleId, processFunctionName);
                                
                                if (functionInfo) {
                                    const sourceLabel = functionInfo.source === 'standard' ? '标准函数' : '用户代码块';
                                    console.log(`[关键字识别] 执行函数: ${functionInfo.functionName} (${sourceLabel}, 规则: ${rule.title}, 关键字: ${keywords.join(', ')})`);
                                    
                                    // 构建执行结果提示信息
                                    const executionStartPrompt = formatPromptContent(
                                        `[关键字识别函数执行开始] 规则: ${rule.title}, 关键字: ${keywords.join(', ')}, 函数: ${functionInfo.functionName}`,
                                        '关键字识别函数执行'
                                    );
                                    
                                    // 执行函数
                                    const functionResult = await functionInfo.function(
                                        result.content,
                                        ruleId,
                                        keywords,
                                        ruleResult.matches || []
                                    );
                                    
                                    // 构建执行结果
                                    const executionResult = {
                                        ruleId: ruleId,
                                        ruleTitle: rule.title,
                                        keywords: keywords,
                                        functionName: functionInfo.functionName,
                                        functionSource: functionInfo.source,
                                        result: functionResult,
                                        success: functionResult && (functionResult.success !== false)
                                    };
                                    
                                    keywordExecutionResults.push(executionResult);
                                    
                                    // 构建执行结束提示信息
                                    const executionEndPrompt = formatPromptContent(
                                        `[关键字识别函数执行结束] 规则: ${rule.title}, 执行结果: ${executionResult.success ? '成功' : '失败'}`,
                                        '关键字识别函数执行'
                                    );
                                    
                                    // 关键修复：将执行结果添加到下一步的提示词中
                                    // 确保等待所有函数执行完毕后再记录结果
                                    if (stepIndex + 1 < steps.length) {
                                        // 记录到状态中，在下一步执行时使用
                                        if (!state.workflowExecutionState.keywordExecutionResults) {
                                            state.workflowExecutionState.keywordExecutionResults = [];
                                        }
                                        // 查找是否已有该步骤的结果记录
                                        const existingIndex = state.workflowExecutionState.keywordExecutionResults.findIndex(
                                            r => r.stepIndex === stepIndex + 1
                                        );
                                        if (existingIndex >= 0) {
                                            // 合并结果（可能有多个规则）
                                            state.workflowExecutionState.keywordExecutionResults[existingIndex].results.push(...keywordExecutionResults);
                                        } else {
                                            // 新建结果记录
                                            state.workflowExecutionState.keywordExecutionResults.push({
                                                stepIndex: stepIndex + 1,
                                                results: [...keywordExecutionResults] // 复制数组，避免引用问题
                                            });
                                        }
                                    }
                                    
                                    console.log(`[关键字识别] 函数 ${functionInfo.functionName} 执行完成:`, executionResult.success ? '成功' : '失败');
                                } else {
                                    console.log(`[关键字识别] 未找到处理函数 ${processFunctionName}，跳过执行 (规则: ${rule.title})`);
                                }
                            } catch (funcErr) {
                                console.error(`[关键字识别] 执行处理函数失败 (规则: ${ruleId}):`, funcErr);
                                keywordExecutionResults.push({
                                    ruleId: ruleId,
                                    success: false,
                                    error: funcErr.message
                                });
                            }
                        }
                        
                        // 如果有执行结果，记录日志
                        if (keywordExecutionResults.length > 0) {
                            console.log(`[关键字识别] 共执行了 ${keywordExecutionResults.length} 个关键字处理函数`);
                        }
                    }
                } catch (err) {
                    console.warn('[关键字识别] 检测关键字失败:', err);
                }
                
                if (workflowControl) {
                    if (workflowControl.action === 'terminate') {
                        // 终止当前工作流
                        if (state.workflowExecutionState) {
                            state.workflowExecutionState.isCancelled = true;
                            state.workflowExecutionState.isPaused = false;
                            updateWorkflowExecutionStatus();
                            console.log(`[工作流控制] AI请求终止工作流`);
                        }
                        throw new Error('工作流执行已终止');
                    } else if (workflowControl.action === 'continue' && workflowControl.workflowName) {
                        // 继续执行指定的工作流
                        const nextWorkflowName = workflowControl.workflowName;
                        console.log(`[工作流控制] AI请求继续执行工作流: ${nextWorkflowName}`);
                        
                        // 先检查工作流是否在列表中（在执行前验证）
                        const matchedWorkflowName = findWorkflowInList(nextWorkflowName);
                        if (!matchedWorkflowName) {
                            // 工作流不在列表中，记录错误但继续执行当前工作流
                            console.error(`[工作流控制] 指定的工作流不在工作流列表中: ${nextWorkflowName}`);
                            const errorMsg = `警告：AI请求继续执行工作流"${nextWorkflowName}"，但该工作流不在可用工作流列表中。已忽略此指令，继续执行当前工作流。`;
                            console.warn(errorMsg);
                            // 不执行继续操作，继续执行当前工作流的后续步骤
                        } else {
                            // 工作流在列表中，使用匹配的工作流名称，再次通过API验证（双重验证）
                            const finalWorkflowName = matchedWorkflowName;
                            let workflowExists = false;
                            try {
                                await getWorkflow(finalWorkflowName);
                                workflowExists = true;
                            } catch (err) {
                                // API验证失败，记录错误但继续执行当前工作流
                                console.error(`[工作流控制] API验证失败，指定的工作流不存在: ${finalWorkflowName}`, err);
                                const errorMsg = `警告：AI请求继续执行工作流"${finalWorkflowName}"，但API验证失败。已忽略此指令，继续执行当前工作流。`;
                                console.warn(errorMsg);
                            }
                            
                            // 只有工作流存在时才执行继续操作
                            if (workflowExists) {
                                // 检查指定的工作流是否与当前工作流相同（避免无限循环）
                                if (finalWorkflowName === workflowName) {
                                    console.warn(`[工作流控制] 检测到继续工作流指令，但指定的工作流"${finalWorkflowName}"与当前工作流相同，已忽略此指令以避免无限循环。`);
                                    const errorMsg = `警告：AI请求继续执行工作流"${finalWorkflowName}"，但该工作流与当前工作流相同。已忽略此指令以避免无限循环，继续执行当前工作流。`;
                                    console.warn(errorMsg);
                                    // 不执行继续操作，继续执行当前工作流的后续步骤
                                } else {
                                    // 保存当前工作流状态
                                    // 使用安全更新函数，确保在并发执行时只更新属于当前文件的状态
                                    safeUpdateWorkflowState(stepResults, executedSteps, undefined, options);
                                    // 执行新的工作流（新工作流会创建新的状态，不会影响当前工作流的步骤计数）
                                    const continuedResult = await executeWorkflow(finalWorkflowName, null, options);
                                    // 累加新工作流的步骤到当前工作流的步骤中，以便正确统计总步骤数
                                    const allSteps = [...executedSteps, ...(continuedResult.steps || [])];
                                    const allResults = { ...stepResults, ...(continuedResult.results || {}) };
                                    return { success: true, steps: allSteps, results: allResults, continuedTo: finalWorkflowName };
                                }
                            }
                        }
                        // 如果工作流不存在，继续执行当前工作流的后续步骤（不return，继续循环）
                    }
                }
                
                // 关键修复：同时更新stepResults[viewId]和stepResults[stepUniqueId]
                // 因为getReadySteps()检查的是stepResults[stepUniqueId]来判断步骤是否已完成
                const stepUniqueId = `step_${stepIndex}`;
                stepResults[result.viewId] = result.content;
                stepResults[stepUniqueId] = result.content; // 关键修复：同时更新stepUniqueId，防止无限循环
                
                // 更新状态机状态，标记步骤为已完成
                if (state.workflowExecutionState && state.workflowExecutionState.stepStatusMap) {
                    state.workflowExecutionState.stepStatusMap.set(stepUniqueId, 'completed');
                }
                
                // 构建步骤信息对象
                const stepInfo = {
                    step: result.viewId,
                    aiFilePath: result.aiFilePath,
                    stepFilePath: result.stepFilePath,
                    content: result.content,
                    stepIndex: stepIndex + 1
                };
                
                // 如果是工作流节点，保存额外的标识信息和内部步骤信息
                if (result.isWorkflowNode) {
                    stepInfo.isWorkflowNode = true;
                    stepInfo.workflowNodeName = result.workflowNodeName || result.viewId;
                    stepInfo.workflowNodeStepDisplay = result.workflowNodeStepDisplay || `${stepIndex + 1}+${result.viewId}`;
                    stepInfo.workflowNodeInternalSteps = result.workflowNodeInternalSteps || [];
                    stepInfo.workflowNodeInternalResults = result.workflowNodeInternalResults || {};
                    
                    // 关键修复：使用新的日志系统记录工作流节点执行完成的日志
                    if (state.workflowExecutionState && !options.isNestedWorkflow) {
                        const executionId = state.workflowExecutionState.executionId || state.workflowExecutionState.batchExecutionId || '';
                        const eventName = options.eventName || state.workflowExecutionState.options?.eventName || '';
                        const workflowName = state.workflowExecutionState.workflowName || '';
                        const internalSteps = result.workflowNodeInternalSteps || [];
                        const completedInternalSteps = internalSteps.length;
                        const totalInternalSteps = internalSteps.length;
                        
                        if (executionId && eventName && workflowName) {
                            appendWorkflowNodeCompleteLog(
                                executionId,
                                eventName,
                                workflowName,
                                stepIndex + 1,
                                result.workflowNodeName || result.viewId,
                                completedInternalSteps,
                                totalInternalSteps
                            );
                        }
                    }
                }
                
                executedSteps.push(stepInfo);
                
                // 更新状态
                // 使用安全更新函数，确保在并发执行时只更新属于当前文件的状态
                if (safeUpdateWorkflowState(stepResults, executedSteps, undefined, options)) {
                    updateWorkflowExecutionStatus();
                }
                
                // 关键修复：使用新的日志系统更新进度日志
                if (state.workflowExecutionState && !options.isNestedWorkflow) {
                    const executionId = state.workflowExecutionState.executionId || state.workflowExecutionState.batchExecutionId || '';
                    const eventName = options.eventName || state.workflowExecutionState.options?.eventName || '';
                    const workflowName = state.workflowExecutionState.workflowName || '';
                    const fileName = state.workflowExecutionState.batchFilePath ? state.workflowExecutionState.batchFilePath.split(/[/\\]/).pop() : '';
                    const totalSteps = state.workflowExecutionState.totalSteps || executedSteps.length;
                    const completedSteps = executedSteps.length;
                    const currentStepName = result.viewId || '';
                    
                    if (executionId && eventName && workflowName) {
                        updateProgressLog(
                            executionId,
                            eventName,
                            workflowName,
                            fileName,
                            totalSteps,
                            completedSteps,
                            currentStepName
                        );
                        
                        // 性能优化：限制日志行数
                        limitLogLines(1000);
                    }
                }
            }
        } else {
            // 并发执行模式 - 使用执行队列，完成一个步骤立即启动下一个
            // 这样可以充分利用资源，不需要等待整组完成
            const stepIndexMap = new Map(); // 记录每个步骤的执行顺序
            const executing = []; // 正在执行的步骤 Promise 队列
            
            // 启动步骤的函数
            const startStep = (step, stepArrayIndex) => {
                // 使用步骤在数组中的索引作为唯一标识，而不是viewId，以支持同名视图ID
                // 因为步骤应该基于xy坐标来区分，而不是viewId
                const stepId = `step_${stepArrayIndex}`;
                const viewId = getStepId(step);
                
                // 检查是否已经在执行或已完成
                // 关键修复：使用 !== undefined 而不是 truthy 检查，因为空字符串 '' 也应该被认为是已完成
                // 注意：检查时需要同时考虑stepId（步骤唯一标识）和viewId（节点标识）
                const stateStepResults = state.workflowExecutionState?.stepResults || {};
                if (executingSteps.has(stepId) || stepResults[stepId] !== undefined || stateStepResults[stepId] !== undefined) {
                    return null;
                }
                
                // 立即添加到执行集合
                executingSteps.add(stepId);
                const currentStepIndex = stepIndexCounter++;
                stepIndexMap.set(stepId, currentStepIndex);
                
                // 关键修复：更新状态机状态为 'executing'
                if (state.workflowExecutionState && state.workflowExecutionState.stepStatusMap) {
                    state.workflowExecutionState.stepStatusMap.set(stepId, 'executing');
                }
                
                console.log(`[工作流并发] 立即启动步骤 ${stepId} (索引: ${currentStepIndex})，当前并发数: ${executingSteps.size}/${concurrency}`);
                
                // 立即更新执行状态（只更新 executingSteps）
                // stepResults 和 executedSteps 会在步骤完成时通过直接更新内存状态的方式更新
                if (state.workflowExecutionState) {
                    state.workflowExecutionState.executingSteps = new Set(executingSteps);
                    updateWorkflowExecutionStatus();
                }
                
                // 创建执行 Promise
                const stepStartTime = Date.now();
                const stepPromise = (async () => {
                    try {
                        // 在执行前检查是否被取消
                        if (state.workflowExecutionState && state.workflowExecutionState.isCancelled) {
                            console.log(`[工作流终止] 步骤 ${stepId} 在执行前检测到取消标志，跳过执行`);
                            throw new Error('工作流执行已终止');
                        }
                        
                        let result;
                        
                        // 关键修复：在工作流节点执行前，记录开始执行的日志
                        if (state.workflowExecutionState && !stepOptions.isNestedWorkflow) {
                            const viewId = getStepId(step);
                            // 检查是否是工作流节点（通过检查workflowId或在工作流列表中查找）
                            const isWorkflowNode = step.workflowId || (state.workflows && state.workflows.some(w => w.name === viewId));
                            if (isWorkflowNode) {
                                const executionId = state.workflowExecutionState.executionId || state.workflowExecutionState.batchExecutionId || '';
                                const eventName = stepOptions.eventName || state.workflowExecutionState.options?.eventName || '';
                                const currentWorkflowName = state.workflowExecutionState.workflowName || '';
                                const workflowNodeName = step.workflowId || viewId;
                                
                                // 尝试获取内部步骤数（如果可能）
                                let internalStepCount = 0;
                                if (state.workflows) {
                                    const nestedWorkflow = state.workflows.find(w => w.name === workflowNodeName);
                                    if (nestedWorkflow && nestedWorkflow.content) {
                                        try {
                                            const nestedSteps = parseWorkflowFormat(nestedWorkflow.content);
                                            internalStepCount = nestedSteps.length;
                                        } catch (e) {
                                            // 解析失败，使用默认值0
                                        }
                                    }
                                }
                                
                                if (executionId && eventName && currentWorkflowName) {
                                    appendWorkflowNodeStartLog(
                                        executionId,
                                        eventName,
                                        currentWorkflowName,
                                        currentStepIndex,
                                        workflowNodeName,
                                        internalStepCount
                                    );
                                }
                            }
                        }
                        
                        // 关键修复：使用独立的工作流节点执行器
                        // 先尝试执行工作流节点，如果不是工作流节点，返回null，继续执行普通步骤
                        // 关键修复：传递stepId（stepUniqueId）给工作流节点执行器，用于存储结果
                        const workflowNodeResult = await executeWorkflowNode(step, stepOptions, currentStepIndex, workflowName, stepId);
                        
                        if (workflowNodeResult) {
                            // 是工作流节点，使用执行器的结果
                            result = workflowNodeResult;
                            
                            // 关键修复：工作流节点执行器已经将结果存储到了state.workflowExecutionState.stepResults中
                            // 需要同步到本地的stepResults对象，以便getReadySteps()能正确检查步骤是否完成
                            if (state.workflowExecutionState && state.workflowExecutionState.stepResults) {
                                // 同步stepUniqueId的结果到本地stepResults
                                if (state.workflowExecutionState.stepResults[stepId] !== undefined) {
                                    stepResults[stepId] = state.workflowExecutionState.stepResults[stepId];
                                }
                                // 同步viewId的结果
                                if (state.workflowExecutionState.stepResults[result.viewId] !== undefined) {
                                    stepResults[result.viewId] = state.workflowExecutionState.stepResults[result.viewId];
                                }
                                // 同步workflowId的结果（如果是工作流节点）
                                if (result.isWorkflowNode && result.workflowNodeName) {
                                    if (state.workflowExecutionState.stepResults[result.workflowNodeName] !== undefined) {
                                        stepResults[result.workflowNodeName] = state.workflowExecutionState.stepResults[result.workflowNodeName];
                                    }
                                }
                            }
                            
                            // 关键修复：从workflowNodeResult中获取workflowNodeName，或者从step.workflowId中获取
                            const actualWorkflowId = workflowNodeResult.workflowNodeName || step.workflowId || viewId;
                            console.log(`[工作流节点] 步骤 ${stepId} (viewId: ${viewId}) 是工作流节点，将直接执行工作流: ${actualWorkflowId}`);
                            
                            // 获取工作流的总结视图内容
                            // 关键：优先从工作流的总结视图读取（如果配置了），否则使用最后一个步骤的结果
                            let workflowSummaryContent = '';
                            
                            // 首先尝试从工作流的总结视图读取（如果事件配置了总结视图）
                            // 注意：这里需要从事件配置中获取总结视图ID，但工作流节点执行时可能没有事件配置
                            // 所以优先使用工作流执行结果中的内容
                            
                            // 尝试从工作流执行结果中获取总结内容
                            // 1. 如果有配置的总结视图，从results中获取
                            // 2. 否则，使用工作流最后一个步骤的结果
                            if (workflowResult.results && Object.keys(workflowResult.results).length > 0) {
                                // 获取最后一个步骤的结果（按步骤索引排序）
                                const sortedSteps = workflowResult.steps.sort((a, b) => (a.stepIndex || 0) - (b.stepIndex || 0));
                                if (sortedSteps.length > 0) {
                                    const lastStep = sortedSteps[sortedSteps.length - 1];
                                    workflowSummaryContent = workflowResult.results[lastStep.step] || '';
                                }
                                
                                // 如果最后一个步骤的结果为空，尝试使用viewId对应的结果
                                if (!workflowSummaryContent && workflowResult.results[viewId]) {
                                    workflowSummaryContent = workflowResult.results[viewId];
                                }
                                
                                // 如果还是没有，使用results中的第一个结果
                                if (!workflowSummaryContent) {
                                    const firstResultKey = Object.keys(workflowResult.results)[0];
                                    workflowSummaryContent = workflowResult.results[firstResultKey] || '';
                                }
                            }
                            
                            // 关键修复：如果工作流执行完成后，总结视图内容已经写入文件，从文件读取
                            // 这样可以获取完整的步骤信息（包括步骤标记等）
                            if (stepOptions.eventName && stepOptions.batchFilePath) {
                                try {
                                    // 尝试从工作流的总结视图读取（如果事件配置了总结视图）
                                    // 注意：这里需要知道总结视图ID，但工作流节点执行时可能没有事件配置
                                    // 所以先尝试从工作流执行结果中获取，如果失败再从文件读取
                                    
                                    // 如果工作流执行完成后，总结视图内容已经写入，尝试读取
                                    // 但这里我们不知道总结视图ID，所以先使用工作流执行结果中的内容
                                    // 如果内容为空，再尝试从文件读取
                                    
                                    if (!workflowSummaryContent) {
                                        // 尝试从工作流的最后一个步骤文件读取
                                        if (workflowResult.steps && workflowResult.steps.length > 0) {
                                            const sortedSteps = workflowResult.steps.sort((a, b) => (a.stepIndex || 0) - (b.stepIndex || 0));
                                            const lastStep = sortedSteps[sortedSteps.length - 1];
                                            if (lastStep.stepFilePath) {
                                                try {
                                                    const { getFile } = await import('../core/api.js');
                                                    const fileContent = await getFile(lastStep.stepFilePath);
                                                    if (fileContent && !fileContent.trim().startsWith('{') && !fileContent.includes('"error"')) {
                                                        // 解析文件内容，获取步骤的实际内容（跳过头部信息）
                                                        const lines = fileContent.split('\n');
                                                        const stepMarker = /步骤：[\dN]+\+.*/;
                                                        let contentStartIndex = 0;
                                                        for (let i = lines.length - 1; i >= 0; i--) {
                                                            if (stepMarker.test(lines[i])) {
                                                                contentStartIndex = i + 1;
                                                                break;
                                                            }
                                                        }
                                                        if (contentStartIndex > 0 && contentStartIndex < lines.length) {
                                                            workflowSummaryContent = lines.slice(contentStartIndex).join('\n').trim();
                                                        } else if (lines.length > 3) {
                                                            workflowSummaryContent = lines.slice(3).join('\n').trim();
                                                        } else {
                                                            workflowSummaryContent = fileContent.trim();
                                                        }
                                                    }
                                                } catch (readError) {
                                                    console.warn(`[工作流节点] 从步骤文件读取内容失败 (${lastStep.stepFilePath}):`, readError);
                                                }
                                            }
                                        }
                                    }
                                } catch (summaryReadError) {
                                    console.warn(`[工作流节点] 读取总结内容失败 (${viewId}):`, summaryReadError);
                                }
                            }
                            
                            // 如果工作流执行成功但没有内容，使用默认提示
                            if (!workflowSummaryContent) {
                                workflowSummaryContent = `工作流"${actualWorkflowId}"执行完成，共执行 ${workflowResult.steps.length} 个步骤。`;
                            }
                            
                            // 关键修复：工作流节点不写入文件，直接在内存中传递内容给下一个节点
                            // 这样可以让工作流节点作为临时的中间结果，不需要单独保存文件
                            // 但是会在工作流总结文件中记录工作流节点的信息
                            // 关键修复：确保actualWorkflowId已定义
                            const workflowName = actualWorkflowId || viewId;
                            const stepDisplay = `${currentStepIndex || 'N'}+${viewId}`;
                            
                            // 工作流节点不写入文件，直接使用内存中的内容
                            // aiFilePath 和 stepFilePath 都设为 null，表示没有文件
                            const stepFilePath = null;
                            const aiFilePath = null;
                            
                            console.log(`[工作流节点] 步骤 ${viewId} 执行完成，内容已存储在内存中，将直接传递给下一个节点`);
                            
                            // 工作流节点不写入文件，直接构建结果对象
                            // 内容直接存储在内存中，供下一个节点使用
                            // 关键修复：保存工作流节点内部的所有步骤信息，用于在总结文件中显示
                            result = {
                                viewId: viewId,
                                content: workflowSummaryContent, // 直接使用内存中的内容，不读取文件（传递给下一个节点）
                                aiFilePath: null, // 工作流节点不写入文件
                                stepFilePath: null, // 工作流节点不写入文件
                                nodeFeedbackPath: null,
                                isWorkflowNode: true, // 标识这是工作流节点
                                workflowNodeName: workflowName, // 保存工作流节点名称
                                workflowNodeStepDisplay: stepDisplay, // 保存步骤显示格式
                                workflowNodeInternalSteps: workflowResult.steps || [], // 保存工作流节点内部的所有步骤信息
                                workflowNodeInternalResults: workflowResult.results || {} // 保存工作流节点内部的所有步骤结果
                            };
                            
                            // 关键修复：使用新的日志系统记录工作流节点执行完成的日志
                            if (state.workflowExecutionState && !stepOptions.isNestedWorkflow) {
                                const executionId = state.workflowExecutionState.executionId || state.workflowExecutionState.batchExecutionId || '';
                                const eventName = stepOptions.eventName || state.workflowExecutionState.options?.eventName || '';
                                const currentWorkflowName = state.workflowExecutionState.workflowName || '';
                                const internalSteps = workflowResult.steps || [];
                                const completedInternalSteps = internalSteps.length;
                                const totalInternalSteps = internalSteps.length;
                                
                                if (executionId && eventName && currentWorkflowName) {
                                    appendWorkflowNodeCompleteLog(
                                        executionId,
                                        eventName,
                                        currentWorkflowName,
                                        currentStepIndex,
                                        workflowName,
                                        completedInternalSteps,
                                        totalInternalSteps
                                    );
                                }
                                
                                // 同时保留旧的日志系统（向后兼容）
                                const endLogMessage = `${viewId} -> [工作流执行完成: ${workflowName}]`;
                                state.workflowExecutionState.executionLogs.push({
                                    stepIndex: currentStepIndex,
                                    viewId: viewId,
                                    log: endLogMessage,
                                    timestamp: new Date().toISOString(),
                                    status: 'completed',
                                    prompt: null,
                                    sentContent: workflowSummaryContent.substring(0, 200),
                                    nextViews: step.viewNext || step.next || [],
                                    isWorkflowNode: true,
                                    workflowNodeName: workflowName
                                });
                                updateWorkflowExecutionStatus();
                            }
                        } else {
                            // 普通节点，使用executeWorkflowStep执行
                            // executeWorkflowStep内部会立即发起AI API调用（streamOpenAI是异步的）
                            result = await executeWorkflowStep(step, stepResults, {
                                ...stepOptions,
                                stepIndex: currentStepIndex,
                                nodeOutputSteps: nodeOutputSteps,
                                allSteps: steps
                            });
                            
                            // 关键修复：使用新的日志系统记录普通节点执行完成的日志
                            if (state.workflowExecutionState && !stepOptions.isNestedWorkflow) {
                                const executionId = state.workflowExecutionState.executionId || state.workflowExecutionState.batchExecutionId || '';
                                const eventName = stepOptions.eventName || state.workflowExecutionState.options?.eventName || '';
                                const currentWorkflowName = state.workflowExecutionState.workflowName || '';
                                const viewId = result.viewId || getStepId(step);
                                
                                if (executionId && eventName && currentWorkflowName) {
                                    // 构建日志消息（简化版，详细日志已经在executeWorkflowStep中记录到executionLogs）
                                    const logMessage = `${viewId} -> 执行完成`;
                                    appendDetailLog(
                                        executionId,
                                        eventName,
                                        currentWorkflowName,
                                        currentStepIndex,
                                        '普通节点',
                                        viewId,
                                        logMessage,
                                        {
                                            isWorkflowNode: false,
                                            workflowNodeName: null
                                        }
                                    );
                                }
                            }
                        }
                        
                        // 执行后再次检查是否被取消
                        if (state.workflowExecutionState && state.workflowExecutionState.isCancelled) {
                            console.log(`[工作流终止] 步骤 ${stepId} 在执行后检测到取消标志，终止执行`);
                            throw new Error('工作流执行已终止');
                        }
                        
                        const stepDuration = Date.now() - stepStartTime;
                        console.log(`[并发] 步骤 ${stepId} 完成 (耗时: ${stepDuration}ms)`);
                        
                        // 在AI回复完毕后，执行下一工作流前，检测工作流控制指令
                        const workflowControl = detectWorkflowControl(result.content);
                        
                        // 检测关键字识别并执行相应函数
                        let keywordExecutionResults = [];
                        try {
                            const { detectKeywordRecognition } = await import('./usage/keywordRecognitionManager.js');
                            const detectionResult = await detectKeywordRecognition(result.content);
                            
                            if (detectionResult && detectionResult.detected && detectionResult.results && detectionResult.results.length > 0) {
                                console.log(`[关键字识别] 在工作流步骤 ${currentStepIndex} (${stepId}) 中检测到 ${detectionResult.results.length} 个规则的关键字`);
                                
                                // 并发执行每个规则对应的处理函数
                                const keywordManager = await import('./usage/keywordRecognitionManager.js');
                                const { getAllRecognitionRules } = await import('./usage/keywordRecognitionManager.js');
                                const rules = await getAllRecognitionRules();
                                
                                // 构建所有规则的执行任务
                                const executionTasks = detectionResult.results
                                    .filter(ruleResult => (ruleResult.keywords || []).length > 0)
                                    .map(ruleResult => {
                                        const ruleId = ruleResult.ruleId;
                                        const keywords = ruleResult.keywords || [];
                                        const rule = rules.find(r => r.id === ruleId);
                                        
                                        if (!rule) {
                                            console.warn(`[关键字识别] 规则 ${ruleId} 不存在，跳过执行`);
                                            return null;
                                        }
                                        
                                        // 构建函数名
                                        const functionNameBase = (rule.title || 'Keyword').replace(/[^a-zA-Z0-9]/g, '');
                                        const processFunctionName = `process${functionNameBase}Recognition`;
                                        
                                        // 检查函数是否存在
                                        if (typeof keywordManager[processFunctionName] !== 'function') {
                                            console.log(`[关键字识别] 未找到处理函数 ${processFunctionName}，跳过执行 (规则: ${rule.title})`);
                                            return null;
                                        }
                                        
                                        return {
                                            ruleId,
                                            ruleTitle: rule.title,
                                            keywords,
                                            functionName: processFunctionName,
                                            matches: ruleResult.matches || []
                                        };
                                    })
                                    .filter(task => task !== null);
                                
                                // 并发执行所有处理函数
                                if (executionTasks.length > 0) {
                                    console.log(`[关键字识别] 并发执行 ${executionTasks.length} 个关键字处理函数`);
                                    
                                    const executionPromises = executionTasks.map(async (task) => {
                                        try {
                                            console.log(`[关键字识别] 开始执行函数: ${task.functionName} (规则: ${task.ruleTitle}, 关键字: ${task.keywords.join(', ')})`);
                                            
                                            // 执行函数
                                            const functionResult = await keywordManager[task.functionName](
                                                result.content,
                                                task.ruleId,
                                                task.keywords,
                                                task.matches
                                            );
                                            
                                            // 构建执行结果
                                            return {
                                                ruleId: task.ruleId,
                                                ruleTitle: task.ruleTitle,
                                                keywords: task.keywords,
                                                functionName: task.functionName,
                                                result: functionResult,
                                                success: functionResult && (functionResult.success !== false)
                                            };
                                        } catch (funcErr) {
                                            console.error(`[关键字识别] 执行处理函数失败 (规则: ${task.ruleId}):`, funcErr);
                                            return {
                                                ruleId: task.ruleId,
                                                ruleTitle: task.ruleTitle,
                                                keywords: task.keywords,
                                                functionName: task.functionName,
                                                success: false,
                                                error: funcErr.message
                                            };
                                        }
                                    });
                                    
                                    // 等待所有函数执行完成
                                    keywordExecutionResults = await Promise.all(executionPromises);
                                    
                                    // 记录到状态中，供下一步使用
                                    if (currentStepIndex + 1 < steps.length && keywordExecutionResults.length > 0) {
                                        if (!state.workflowExecutionState.keywordExecutionResults) {
                                            state.workflowExecutionState.keywordExecutionResults = [];
                                        }
                                        state.workflowExecutionState.keywordExecutionResults.push({
                                            stepIndex: currentStepIndex + 1,
                                            results: keywordExecutionResults
                                        });
                                    }
                                    
                                    // 记录执行结果
                                    const successCount = keywordExecutionResults.filter(r => r.success).length;
                                    console.log(`[关键字识别] 并发执行完成: ${successCount}/${keywordExecutionResults.length} 个函数执行成功`);
                                }
                            }
                        } catch (err) {
                            console.warn('[关键字识别] 检测关键字失败:', err);
                        }
                        
                        if (workflowControl) {
                            if (workflowControl.action === 'terminate') {
                                // 终止当前工作流
                                if (state.workflowExecutionState) {
                                    state.workflowExecutionState.isCancelled = true;
                                    state.workflowExecutionState.isPaused = false;
                                    updateWorkflowExecutionStatus();
                                    console.log(`[并发] 步骤 ${stepId} 请求终止工作流`);
                                }
                                // 抛出错误以终止并发执行
                                throw new Error('工作流执行已终止');
                            } else if (workflowControl.action === 'continue' && workflowControl.workflowName) {
                                const nextWorkflowName = workflowControl.workflowName;
                                console.log(`[并发] 步骤 ${stepId} (viewId: ${viewId}) 请求继续执行工作流: ${nextWorkflowName}`);
                                
                                // 先检查工作流是否在列表中（在执行前验证）
                                const matchedWorkflowName = findWorkflowInList(nextWorkflowName);
                                if (!matchedWorkflowName) {
                                    // 工作流不在列表中，记录错误但继续执行当前工作流
                                    console.error(`[并发] 步骤 ${stepId} 指定的工作流不在工作流列表中: ${nextWorkflowName}`);
                                    const errorMsg = `警告：AI请求继续执行工作流"${nextWorkflowName}"，但该工作流不在可用工作流列表中。已忽略此指令。`;
                                    console.warn(errorMsg);
                                    // 不记录到状态中，继续执行当前工作流
                                } else {
                                    // 工作流在列表中，使用匹配的工作流名称，再次通过API验证（双重验证）
                                    const finalWorkflowName = matchedWorkflowName;
                                    try {
                                        await getWorkflow(finalWorkflowName);
                                        // 检查指定的工作流是否与当前工作流相同（避免无限循环）
                                        if (finalWorkflowName === workflowName) {
                                            console.warn(`[并发] 步骤 ${stepId} (viewId: ${viewId}) 检测到继续工作流指令，但指定的工作流"${finalWorkflowName}"与当前工作流相同，已忽略此指令以避免无限循环。`);
                                            const errorMsg = `警告：AI请求继续执行工作流"${finalWorkflowName}"，但该工作流与当前工作流相同。已忽略此指令以避免无限循环。`;
                                            console.warn(errorMsg);
                                            // 不记录到状态中，继续执行当前工作流
                                        } else {
                                            // 工作流存在且与当前工作流不同，记录到状态中，等待所有并发步骤完成后再处理
                                            if (state.workflowExecutionState) {
                                                state.workflowExecutionState._pendingContinueWorkflow = finalWorkflowName;
                                            }
                                        }
                                    } catch (err) {
                                        // API验证失败，记录错误但继续执行当前工作流
                                        console.error(`[并发] 步骤 ${stepId} (viewId: ${viewId}) API验证失败，指定的工作流不存在: ${finalWorkflowName}`, err);
                                        const errorMsg = `警告：AI请求继续执行工作流"${finalWorkflowName}"，但API验证失败。已忽略此指令。`;
                                        console.warn(errorMsg);
                                        // 不记录到状态中，继续执行当前工作流
                                    }
                                }
                            }
                        }
                        
                        // stepResults使用viewId作为key，用于后续步骤读取前置节点的内容
                        // 如果有多个步骤输出到同一个节点（相同viewId），需要合并它们的内容
                        const existingContent = stepResults[result.viewId];
                        if (existingContent && existingContent !== result.content) {
                            // 如果已有内容，合并两个结果（用分隔符分开）
                            const separator = `\n\n--- 来自步骤 ${currentStepIndex} ---\n\n`;
                            stepResults[result.viewId] = `${existingContent}${separator}${result.content}`;
                        } else {
                            stepResults[result.viewId] = result.content;
                        }
                        
                        // 关键修复：如果是工作流节点，还需要使用workflowId作为key存储结果
                        // 因为后续步骤可能通过workflowPrev等待工作流节点的结果
                        if (result.isWorkflowNode && result.workflowNodeName) {
                            const workflowId = result.workflowNodeName;
                            const existingWorkflowContent = stepResults[workflowId];
                            if (existingWorkflowContent && existingWorkflowContent !== result.content) {
                                const separator = `\n\n--- 来自步骤 ${currentStepIndex} ---\n\n`;
                                stepResults[workflowId] = `${existingWorkflowContent}${separator}${result.content}`;
                            } else {
                                stepResults[workflowId] = result.content;
                            }
                        }
                        
                        // 同时更新内存中的状态（增量更新，确保并发安全）
                        // state.workflowExecutionState.stepResults使用viewId作为key，用于后续步骤读取
                        if (state.workflowExecutionState) {
                            if (!state.workflowExecutionState.stepResults) {
                                state.workflowExecutionState.stepResults = {};
                            }
                            const stateExistingContent = state.workflowExecutionState.stepResults[result.viewId];
                            if (stateExistingContent && stateExistingContent !== result.content) {
                                const separator = `\n\n--- 来自步骤 ${currentStepIndex} ---\n\n`;
                                state.workflowExecutionState.stepResults[result.viewId] = `${stateExistingContent}${separator}${result.content}`;
                            } else {
                                state.workflowExecutionState.stepResults[result.viewId] = result.content;
                            }
                            
                            // 关键修复：如果是工作流节点，还需要使用workflowId作为key存储结果到state中
                            if (result.isWorkflowNode && result.workflowNodeName) {
                                const workflowId = result.workflowNodeName;
                                const stateExistingWorkflowContent = state.workflowExecutionState.stepResults[workflowId];
                                if (stateExistingWorkflowContent && stateExistingWorkflowContent !== result.content) {
                                    const separator = `\n\n--- 来自步骤 ${currentStepIndex} ---\n\n`;
                                    state.workflowExecutionState.stepResults[workflowId] = `${stateExistingWorkflowContent}${separator}${result.content}`;
                                } else {
                                    state.workflowExecutionState.stepResults[workflowId] = result.content;
                                }
                            }
                        }
                        
                        // 使用步骤唯一标识来跟踪已完成的步骤（用于检查步骤是否已完成）
                        stepResults[stepId] = result.content;
                        
                        // 关键修复：如果是工作流节点，还需要使用workflowId作为stepId存储结果
                        if (result.isWorkflowNode && result.workflowNodeName) {
                            stepResults[result.workflowNodeName] = result.content;
                        }
                        
                        // 关键修复：更新状态机状态为 'completed'
                        if (state.workflowExecutionState && state.workflowExecutionState.stepStatusMap) {
                            state.workflowExecutionState.stepStatusMap.set(stepId, 'completed');
                            console.log(`[并发] 步骤 ${stepId} 状态机状态更新为 completed`);
                        }
                        
                        // 关键修复：保存工作流节点的标识信息，用于在总结文件中记录
                        const stepInfo = {
                            step: result.viewId,
                            aiFilePath: result.aiFilePath,
                            stepFilePath: result.stepFilePath,
                            content: result.content,
                            stepIndex: currentStepIndex
                        };
                        
                        // 如果是工作流节点，保存额外的标识信息和内部步骤信息
                        if (result.isWorkflowNode) {
                            stepInfo.isWorkflowNode = true;
                            stepInfo.workflowNodeName = result.workflowNodeName || result.viewId;
                            stepInfo.workflowNodeStepDisplay = result.workflowNodeStepDisplay || `${currentStepIndex}+${result.viewId}`;
                            // 关键修复：保存工作流节点内部的所有步骤信息，用于统计和展示
                            stepInfo.workflowNodeInternalSteps = result.workflowNodeInternalSteps || [];
                            stepInfo.workflowNodeInternalResults = result.workflowNodeInternalResults || {};
                        }
                        
                        executedSteps.push(stepInfo);
                        
                        // 同时更新内存中的 executedSteps（增量更新，确保并发安全）
                        // 注意：不能基于viewId去重，因为不同xy坐标的步骤可能有相同的viewId
                        // 应该基于步骤的唯一标识（stepId + stepIndex）来区分
                        if (state.workflowExecutionState) {
                            if (!state.workflowExecutionState.executedSteps) {
                                state.workflowExecutionState.executedSteps = [];
                            }
                            // 使用stepIndex来标识步骤，而不是viewId，因为不同位置的步骤可能有相同的viewId
                            const existingStepIndices = new Set(state.workflowExecutionState.executedSteps.map(es => es.stepIndex));
                            if (!existingStepIndices.has(currentStepIndex)) {
                                state.workflowExecutionState.executedSteps.push(stepInfo);
                            }
                        }
                        
                        // 关键修复：使用新的日志系统更新进度日志
                        if (state.workflowExecutionState && !stepOptions.isNestedWorkflow) {
                            const executionId = state.workflowExecutionState.executionId || state.workflowExecutionState.batchExecutionId || '';
                            const eventName = stepOptions.eventName || state.workflowExecutionState.options?.eventName || '';
                            const workflowName = state.workflowExecutionState.workflowName || '';
                            const fileName = state.workflowExecutionState.batchFilePath ? state.workflowExecutionState.batchFilePath.split(/[/\\]/).pop() : '';
                            const totalSteps = state.workflowExecutionState.totalSteps || (state.workflowExecutionState.executedSteps ? state.workflowExecutionState.executedSteps.length : 0);
                            const completedSteps = state.workflowExecutionState.executedSteps ? state.workflowExecutionState.executedSteps.length : 0;
                            const currentStepName = result.viewId || '';
                            
                            if (executionId && eventName && workflowName) {
                                updateProgressLog(
                                    executionId,
                                    eventName,
                                    workflowName,
                                    fileName,
                                    totalSteps,
                                    completedSteps,
                                    currentStepName
                                );
                                
                                // 性能优化：限制日志行数
                                limitLogLines(1000);
                            }
                        }
                        
                        // 步骤完成后，立即检查是否有新的就绪步骤可以启动
                        // 这确保同一y轴的后续步骤能够立即并发启动，而不需要等待循环
                        console.log(`[并发] 步骤 ${stepId} 完成，立即检查是否有新的就绪步骤`);
                        
                        return result;
                    } catch (error) {
                        console.error(`[并发] 步骤 ${stepId} (viewId: ${viewId}) 执行失败:`, error);
                        // 关键修复：步骤执行失败时，需要标记为已完成（即使失败），避免无限循环
                        // 将错误信息作为步骤结果存储，标记步骤已完成
                        stepResults[stepId] = `[执行失败] ${error.message || error.toString()}`;
                        // 关键修复：更新状态机状态为 'failed'
                        if (state.workflowExecutionState && state.workflowExecutionState.stepStatusMap) {
                            state.workflowExecutionState.stepStatusMap.set(stepId, 'failed');
                            console.log(`[并发] 步骤 ${stepId} 状态机状态更新为 failed`);
                        }
                        if (state.workflowExecutionState) {
                            if (!state.workflowExecutionState.stepResults) {
                                state.workflowExecutionState.stepResults = {};
                            }
                            state.workflowExecutionState.stepResults[stepId] = stepResults[stepId];
                        }
                        throw error;
                    } finally {
                        executingSteps.delete(stepId);
                        // 从执行队列中移除
                        const index = executing.indexOf(stepPromise);
                        if (index > -1) {
                            executing.splice(index, 1);
                        }
                        // 更新 executingSteps（这个需要立即更新，因为它会影响其他步骤的就绪判断）
                        if (state.workflowExecutionState) {
                            state.workflowExecutionState.executingSteps = new Set(executingSteps);
                            updateWorkflowExecutionStatus();
                        }
                    }
                })();
                    
                    // 将 Promise 添加到执行队列
                    executing.push(stepPromise);
                    
                    return stepPromise;
                };
                
                // 使用执行队列持续监控，完成一个步骤立即启动下一个
                while (executedSteps.length < steps.length) {
                    // 检查是否被取消（在循环开始和每次等待后都检查）
                    if (state.workflowExecutionState && state.workflowExecutionState.isCancelled) {
                        console.log('[工作流终止] 检测到取消标志，终止工作流执行');
                        // 取消所有正在执行的步骤
                        executing.forEach(promise => {
                            // Promise 会在 finally 中清理
                        });
                        executing.length = 0;
                        executingSteps.clear();
                        // 清除工作流执行锁定
                        state.isWorkflowExecuting = false;
                        throw new Error('工作流执行已终止');
                    }
                    
                // 检查是否被暂停
                while (state.workflowExecutionState && state.workflowExecutionState.isPaused) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    // 关键修复：只有在工作流执行状态存在时才触发状态更新
                    if (state.workflowExecutionState) {
                        updateWorkflowExecutionStatus();
                    }
                }
                
                // 检查是否被取消（暂停后可能被取消）
                    if (state.workflowExecutionState && state.workflowExecutionState.isCancelled) {
                        executing.length = 0;
                        executingSteps.clear();
                        throw new Error('工作流执行已终止');
                    }
                    
                    // 获取就绪的步骤
                    const readySteps = getReadySteps();
                    
                    // 添加调试日志
                    if (readySteps.length > 0) {
                        const readyIds = readySteps.map(s => getStepId(s)).join(', ');
                        console.log(`[工作流并发] 发现 ${readySteps.length} 个就绪步骤: ${readyIds}, 当前并发: ${executing.length}/${concurrency}`);
                    }
                    
                    // 检查是否有死锁
                    // 关键修复：工作流节点应该像普通步骤一样，通过getReadySteps检查前置依赖
                    // 只有当前置步骤都完成后，工作流节点才会被标记为就绪并执行
                    if (readySteps.length === 0 && executing.length === 0) {
                        const pendingSteps = steps.filter(step => {
                            const stepId = getStepId(step);
                            const stepUniqueId = `step_${steps.indexOf(step)}`;
                            return stepResults[stepUniqueId] === undefined;
                        });
                        if (pendingSteps.length > 0) {
                            const pendingIds = pendingSteps.map(s => getStepId(s)).join(', ');
                            // 检查是否有步骤正在等待前置依赖完成
                            const waitingSteps = pendingSteps.filter(step => {
                                const prevIds = getStepPrev(step);
                                if (prevIds && prevIds.length > 0) {
                                    // 检查前置依赖是否都已完成
                                    return !prevIds.every(prevId => isNodeReady(prevId));
                                }
                                return false;
                            });
                            
                            if (waitingSteps.length > 0) {
                                // 有步骤在等待前置依赖，继续等待
                                // 关键修复：取消显示等待检测日志，避免日志过多
                                // console.log(`[工作流并发] 检测到等待状态：以下步骤等待前置步骤完成: ${waitingSteps.map(s => getStepId(s)).join(', ')}`);
                                await new Promise(resolve => setTimeout(resolve, 200));
                                // 继续循环，等待前置步骤完成
                                continue;
                            } else {
                                // 没有步骤在等待，说明是真正的死锁
                                throw new Error(`工作流执行死锁：以下步骤无法执行（前置步骤未完成）: ${pendingIds}`);
                            }
                        }
                        break;
                    }
                    
                    // 启动新的就绪步骤（只要依赖满足就可以执行，不受y轴限制）
                    // 关键修复：只要满足前置依赖条件就可以执行，不受y轴限制
                    if (readySteps.length > 0) {
                        // 立即启动所有就绪步骤，不受y轴限制
                        const stepsToExecute = [];
                        const stateStepResults = state.workflowExecutionState?.stepResults || {};
                        readySteps.forEach((step) => {
                            // 关键修复：使用原始steps数组的索引，而不是readySteps数组的索引
                            const originalStepIndex = steps.findIndex(s => s === step);
                            if (originalStepIndex === -1) {
                                console.error('[工作流并发] 无法找到步骤在原始数组中的索引', step);
                                return;
                            }
                            // 使用步骤在原始数组中的索引作为唯一标识
                            const stepUniqueId = `step_${originalStepIndex}`;
                            // 检查是否已经在执行或已完成（双重检查，防止重复启动）
                            // 关键修复：使用 !== undefined 检查，同时检查本地stepResults和state中的stepResults
                            if (!executingSteps.has(stepUniqueId) && stepResults[stepUniqueId] === undefined && stateStepResults[stepUniqueId] === undefined) {
                                stepsToExecute.push({ step, stepIndex: originalStepIndex });
                            }
                        });
                        
                        if (stepsToExecute.length > 0) {
                            // 关键修复：立即启动所有就绪步骤，只要依赖满足就可以执行
                            const stepIds = stepsToExecute.map(item => getStepId(item.step));
                            const stepYAxes = stepsToExecute.map(item => item.step.y !== undefined ? item.step.y : 0);
                            console.log(`[工作流并发] 立即启动 ${stepsToExecute.length} 个就绪步骤（依赖满足即可执行，无y轴限制）: ${stepIds.join(', ')}, y轴: ${stepYAxes.join(', ')}`);
                            // 立即启动所有步骤，不等待，确保它们并发执行
                            // 关键：forEach会立即执行每个回调，不会等待，所以所有步骤会并发启动
                            stepsToExecute.forEach(({ step, stepIndex }) => {
                                startStep(step, stepIndex);
                            });
                            // 启动后立即继续循环，不等待，让它们并发执行
                            continue;
                        }
                    }
                    
                    // 如果有正在执行的步骤，等待其中一个完成
                    // 关键修复：只要依赖满足就可以执行，不受y轴限制
                    if (executing.length > 0) {
                        try {
                            // 定期更新状态显示（用于显示等待状态），但不会阻塞执行
                            const updateStatusPromise = new Promise(resolve => setTimeout(() => {
                                updateWorkflowExecutionStatus();
                                resolve('status_updated');
                            }, 500)); // 每500ms更新一次状态显示
                            
                            // 等待任意一个步骤完成（只要依赖满足就可以执行，不受y轴限制）
                            await Promise.race([
                                Promise.race(executing), // 等待任意一个步骤完成
                                updateStatusPromise // 定期更新状态
                            ]);
                            
                            // 步骤完成后，立即检查是否有新的就绪步骤并启动
                            // 这样只要依赖满足的步骤就可以继续并发执行
                            continue;
                        } catch (error) {
                            // 如果检测到终止指令，取消所有正在执行的步骤
                            if (error.message === '工作流执行已终止') {
                                executing.length = 0;
                                executingSteps.clear();
                                throw error;
                            }
                            // 其他错误，继续执行其他步骤（不中断整个工作流）
                            console.error('步骤执行失败，继续执行其他步骤:', error);
                            // 错误后也继续循环，检查是否有新的就绪步骤
                            continue;
                        }
                    } else {
                        // 如果没有正在执行的步骤，说明所有步骤都已执行或等待中
                        // 短暂等待后重试，并更新状态显示
                        // 关键修复：只有在工作流执行状态存在时才触发状态更新
                        await new Promise(resolve => setTimeout(() => {
                            if (state.workflowExecutionState) {
                                updateWorkflowExecutionStatus();
                            }
                            resolve();
                        }, 100));
                    }
                }
                
                // 等待所有剩余的步骤完成
                if (executing.length > 0) {
                    console.log(`[工作流并发] 等待剩余 ${executing.length} 个步骤完成...`);
                    try {
                        await Promise.all(executing);
                    } catch (error) {
                        // 如果检测到终止指令，清理状态
                        if (error.message === '工作流执行已终止') {
                            executing.length = 0;
                            executingSteps.clear();
                            throw error;
                        }
                        // 其他错误继续处理
                    }
                }
                
                // 并发执行完成后，按步骤索引排序
                executedSteps.sort((a, b) => (a.stepIndex || 0) - (b.stepIndex || 0));
            
                // 检查是否有待处理的继续工作流指令
                // 注意：工作流名称已经在步骤执行时验证过（在执行前验证），这里直接使用
                if (state.workflowExecutionState && state.workflowExecutionState._pendingContinueWorkflow) {
                    const finalWorkflowName = state.workflowExecutionState._pendingContinueWorkflow;
                    delete state.workflowExecutionState._pendingContinueWorkflow;
                    console.log(`[并发] 工作流完成，执行继续工作流: ${finalWorkflowName}`);
                    
                    // 工作流已经在步骤执行时验证过，这里再次通过API验证（双重验证）
                    try {
                        await getWorkflow(finalWorkflowName);
                        // 再次检查指定的工作流是否与当前工作流相同（双重保险，避免无限循环）
                        if (finalWorkflowName === workflowName) {
                            console.warn(`[并发] 检测到继续工作流指令，但指定的工作流"${finalWorkflowName}"与当前工作流相同，已忽略此指令以避免无限循环。`);
                            const errorMsg = `警告：AI请求继续执行工作流"${finalWorkflowName}"，但该工作流与当前工作流相同。已忽略此指令以避免无限循环。`;
                            console.warn(errorMsg);
                            // 不执行继续操作，返回当前工作流的完成结果
                        } else {
                            // 工作流存在且与当前工作流不同，执行新的工作流（新工作流会创建新的状态，不会影响当前工作流的步骤计数）
                            const continuedResult = await executeWorkflow(finalWorkflowName, null, options);
                            // 累加新工作流的步骤到当前工作流的步骤中，以便正确统计总步骤数
                            const allSteps = [...executedSteps, ...(continuedResult.steps || [])];
                            const allResults = { ...stepResults, ...(continuedResult.results || {}) };
                            return { success: true, steps: allSteps, results: allResults, continuedTo: finalWorkflowName };
                        }
                    } catch (err) {
                        // API验证失败，记录错误但完成当前工作流
                        console.error(`[并发] API验证失败，指定的工作流不存在: ${finalWorkflowName}`, err);
                        const errorMsg = `警告：AI请求继续执行工作流"${finalWorkflowName}"，但API验证失败。已忽略此指令。`;
                        console.warn(errorMsg);
                        // 继续执行，返回当前工作流的完成结果
                    }
                }
            }
        
        // 执行完成，标记为已完成（用于最后的状态更新）
        if (state.workflowExecutionState && !options.isNestedWorkflow) {
            state.workflowExecutionState.isCompleted = true;
            state.workflowExecutionState.isCancelled = false;
            state.workflowExecutionState.isPaused = false;
            state.workflowExecutionState.executingSteps = new Set(); // 清除执行中标记
        }
        // 关键修复：只有在工作流执行状态存在时才触发状态更新
        if (state.workflowExecutionState) {
            updateWorkflowExecutionStatus();
        }

        // 显示工作流执行完毕的消息
        console.log(`工作流 "${workflowName}" 执行完毕，共执行 ${executedSteps.length} 个步骤`);

        // 生成工作流反馈（如果是在事件执行模式下，且有事件名和时间戳）
        // 关键修复：从 options 或 stepOptions 中获取事件信息
        const eventName = options.eventName || options.stepOptions?.eventName;
        const eventTimestamp = options.eventTimestamp || options.stepOptions?.eventTimestamp;
        const batchFilePath = options.batchFilePath || options.stepOptions?.batchFilePath;
        
        if (eventName && eventTimestamp && batchFilePath) {
            console.log(`[executeWorkflow] 准备生成工作流反馈: eventName=${eventName}, eventTimestamp=${eventTimestamp}, batchFilePath=${batchFilePath}, workflowName=${workflowName}, steps=${executedSteps.length}`);
            // 异步生成，不等待完成
            (async () => {
                try {
                    const { generateWorkflowFeedback } = await import('./feedbackManager.js');
                    const workflowFeedbackPath = await generateWorkflowFeedback(
                        eventName,
                        eventTimestamp,
                        batchFilePath,
                        workflowName,
                        executedSteps,
                        stepResults
                    );
                    if (workflowFeedbackPath) {
                        console.log(`[executeWorkflow] 工作流反馈已生成: ${workflowFeedbackPath}`);
                    } else {
                        console.warn(`[executeWorkflow] 工作流反馈生成返回null，可能未配置反馈提示词`);
                    }
                } catch (feedbackError) {
                    console.error('[executeWorkflow] 生成工作流反馈失败:', feedbackError);
                    // 生成失败不影响执行，继续执行
                }
            })();
        } else {
            console.log(`[executeWorkflow] 跳过工作流反馈生成: eventName=${eventName}, eventTimestamp=${eventTimestamp}, batchFilePath=${batchFilePath}`);
        }

        // 清除工作流执行锁定（在更新状态后）
        state.isWorkflowExecuting = false;
        
        // 关键修复：工作流执行完成后，不立即标记为已完成
        // 只有在总结视图生成后才标记为已完成（在executeEventForFile中处理）
        // 但要注意：如果是嵌套工作流，不应该清空状态（由工作流节点执行器管理状态）
        // 批量执行模式下，状态会在 executeEventForFile 中恢复
        if (!options.isNestedWorkflow) {
            // 关键修复：不清空工作流执行状态，保留在事件面板中显示
            // 不标记为已完成，等待总结视图生成后再标记（在executeEventForFile中处理）
            if (state.workflowExecutionState) {
                // 清除执行中标记，但不标记为已完成
                state.workflowExecutionState.executingSteps = new Set();
                
                // 最后更新一次状态显示
                updateWorkflowExecutionStatus();
                
                console.log('[executeWorkflow] 工作流执行完成，等待总结视图生成后再标记为已完成');
            }
        }
        
        // 注意：不在这里更新导航栏的执行指示器，等待总结视图生成后再更新

        return {
            success: true,
            steps: executedSteps,
            results: stepResults
        };
    } catch (err) {
        // 如果是因为取消导致的错误，确保正确清理状态
        if (err.message === '工作流执行已终止') {
            console.log('[工作流终止] 工作流执行已终止，清理状态');
            if (state.workflowExecutionState) {
                state.workflowExecutionState.isCancelled = true;
                state.workflowExecutionState.isCompleted = false;
                state.workflowExecutionState.isPaused = false;
            }
            state.isWorkflowExecuting = false;
            updateWorkflowExecutionStatus();
        }
        if (err.message && err.message.includes('workflowName is not defined')) {
            // 如果是workflowName未定义错误，在控制台显示错误，不弹窗
            console.error('执行工作流失败:', err);
            console.error('错误详情: workflowName is not defined');
            console.trace('调用堆栈:');
            // 清除工作流执行锁定
            state.isWorkflowExecuting = false;
            // 如果是因为取消导致的错误，清除状态
            if (err.message === '工作流执行已终止') {
                state.workflowExecutionState = null;
                updateWorkflowExecutionStatus();
            }
        } else {
            console.error('执行工作流失败:', err);
            // 清除工作流执行锁定
            state.isWorkflowExecuting = false;
            // 如果是因为取消导致的错误，清除状态
            if (err.message === '工作流执行已终止') {
                state.workflowExecutionState = null;
                updateWorkflowExecutionStatus();
            }
            throw err;
        }
    }
}

/**
 * 暂停工作流执行
 */
export function pauseWorkflow() {
    if (state.workflowExecutionState) {
        state.workflowExecutionState.isPaused = true;
        updateWorkflowExecutionStatus();
    }
}

/**
 * 继续工作流执行
 */
export async function resumeWorkflow() {
    if (state.workflowExecutionState && state.workflowExecutionState.isPaused) {
        const execState = state.workflowExecutionState;
        const options = execState.options || {};
        
        // 继续执行工作流
        try {
            await executeWorkflow(execState.workflowName, null, options);
        } catch (err) {
            console.error('继续工作流执行失败:', err);
            throw err;
        }
    }
}

/**
 * 终止工作流执行
 */
export function cancelWorkflow() {
    if (state.workflowExecutionState) {
        console.log('[工作流终止] 用户请求终止工作流');
        state.workflowExecutionState.isCancelled = true;
        state.workflowExecutionState.isPaused = false;
        // 注意：不立即清除 isWorkflowExecuting，让工作流执行循环自己处理终止
        // 这样可以确保正在执行的步骤能够正确清理
        updateWorkflowExecutionStatus();
    } else {
        console.warn('[工作流终止] 没有正在执行的工作流');
    }
}

/**
 * 生成工作流控制提示词，包含工作流列表信息
 * @param {string} placeholder - 占位符变量名，默认为'{gongzuoliu}'
 * @returns {string} 提示词模板
 */
export function generateWorkflowControlPrompt(placeholder = '{gongzuoliu}') {
    const workflows = state.workflows || [];
    
    let workflowList = '';
    if (workflows.length === 0) {
        workflowList = '当前没有可用的工作流。';
    } else {
        workflowList = '当前可用的工作流列表：\n\n';
        workflows.forEach((workflow, index) => {
            workflowList += `${index + 1}. 工作流名称：${workflow.name}\n`;
            if (workflow.description) {
                workflowList += `   功能描述：${workflow.description}\n`;
            }
            workflowList += '\n';
        });
        workflowList += '\n你可以根据当前任务的需要，选择合适的工作流来继续执行。';
    }
    
    const prompt = `## 工作流控制指令

你可以在回复中使用以下格式来控制工作流的执行：

### 终止当前工作流

**终止工作流的标准（必须满足以下任一条件）：**

1. 当前任务已无法继续执行：当前步骤完成后，无法满足后续步骤的执行条件或前置要求
2. 检测到无法修复的错误：遇到了数据错误、格式错误或其他技术性问题，且无法通过当前工作流解决
3. 任务目标已完成：当前工作流的目标已经达成，不需要继续执行后续步骤
4. 资源或时间限制：由于资源不足、时间限制或其他外部约束，无法继续执行工作流
5. 用户明确要求终止：用户通过某种方式明确表达了终止当前工作流的意愿

公理化： 标准必须基于一组明确的、不容妥协的前提（公理）进行推演。
可判定： 每一条标准都必须对应一个可观察、可测量或可逻辑推断的判定条件。 
标准之间应存在清晰的层次、优先级或互斥关系，构成一个决策网络。
最终去决定要不要终止工作流、还是重新规划工作流；

**只有当满足上述标准时，才应该终止工作流。** 如果只是遇到临时性问题或需要调整策略，应该继续执行并尝试解决。

如果需要终止当前工作流，请在回复中使用以下任一格式：

1. 文本格式：
   终止工作流

2. 代码块格式：
\`\`\`workflow-control
terminate
\`\`\`

### 继续执行下一个工作流

**重要提示：如果认为应该继续执行当前工作流（不切换到其他工作流），则不能使用此指令。** 此指令仅用于切换到另一个不同的工作流。

如果需要继续执行另一个工作流，请在回复中使用以下任一格式：

1. 文本格式：
   继续工作流：<工作流名称>

2. 代码块格式：
\`\`\`workflow-control
continue <工作流名称>
\`\`\`

### 可用工作流列表

${workflowList}
    需要注意：不要随意变更工作流名称；
### 使用建议

- 当你完成当前步骤，并确定需要执行下一个工作流时，使用"继续工作流"指令
- 当你发现当前工作流无法继续执行或出现错误时，使用"终止工作流"指令
- 选择工作流时，请参考工作流的功能描述，确保选择的工作流适合当前任务需求`;

    return prompt.replace(placeholder, workflowList);
}

/**
 * 获取包含工作流控制提示词的系统消息
 * @param {string} originalPrompt - 原始系统提示词
 * @returns {string} 增强后的系统提示词
 */
export function enhancePromptWithWorkflowControl(originalPrompt = '') {
    const workflowControlPrompt = generateWorkflowControlPrompt();
    if (originalPrompt) {
        return `${originalPrompt}\n\n---\n\n${workflowControlPrompt}`;
    }
    return workflowControlPrompt;
}

/**
 * 生成关键字识别规则提示词
 * 从关键字识别管理模块获取所有启用的识别规则，转换为提示词格式
 * @returns {Promise<string>} 关键字识别规则提示词
 */
export async function generateKeywordRecognitionPrompt() {
    try {
        // 动态导入关键字识别管理模块
        const { getAllRecognitionRules } = await import('./usage/keywordRecognitionManager.js');
        const rules = await getAllRecognitionRules();
        
        // 只获取启用的规则
        const enabledRules = rules.filter(rule => {
            return rule.enabled === true || rule.enabled === 'true' || rule.enabled === '是' || rule.enabled === '1' || rule.enabled === 'yes';
        });
        
        if (enabledRules.length === 0) {
            return '';
        }
        
        let prompt = '## 关键字识别规则\n\n';
        prompt += '你可以在回复中使用以下格式来标识关键字：\n\n';
        
        enabledRules.forEach((rule, index) => {
            prompt += `### ${rule.title || `规则 ${index + 1}`}\n\n`;
            prompt += `**格式**: ${escapeMarkdown(rule.startSymbol || '')}关键字${escapeMarkdown(rule.endSymbol || '')}\n\n`;
            
            if (rule.functionDescription) {
                prompt += `**说明**: ${rule.functionDescription}\n\n`;
            }
            
            prompt += `**示例**: ${escapeMarkdown(rule.startSymbol || '')}示例关键字${escapeMarkdown(rule.endSymbol || '')}\n\n`;
        });
        
        prompt += '### 使用建议\n\n';
        prompt += '- 根据上下文选择合适的识别格式\n';
        prompt += '- 确保关键字清晰明确\n';
        prompt += '- 避免嵌套使用不同的识别格式\n';
        
        return prompt;
    } catch (err) {
        console.error('[工作流管理器] 生成关键字识别提示词失败:', err);
        return '';
    }
}

/**
 * 转义Markdown特殊字符
 * @param {string} str - 待转义的字符串
 * @returns {string} 转义后的字符串
 */
function escapeMarkdown(str) {
    if (!str) return '';
    return str.replace(/([\\`*_{}[\]()#+\-.!])/g, '\\$1');
}

/**
 * 格式化关键字识别后的处理函数执行结果，用于拼接发送给AI
 * 供模板使用，用于将关键字识别后执行的处理函数结果拼接发送给AI
 * @param {Array} functionResults - 处理函数执行结果数组，每个元素包含 {ruleTitle, keywords, functionName, result, success, error}
 * @returns {string} 格式化后的结果内容
 */
export function formatKeywordFunctionResults(functionResults) {
    if (!functionResults || functionResults.length === 0) {
        return '';
    }
    
    let executionResultsContent = '\n## 关键字识别处理函数执行结果\n\n';
    functionResults.forEach((result, index) => {
        executionResultsContent += `### ${result.ruleTitle || '未知规则'}\n\n`;
        executionResultsContent += `**关键字**: ${result.keywords ? result.keywords.join(', ') : '无'}\n\n`;
        executionResultsContent += `**处理函数**: ${result.functionName || '未知函数'}\n\n`;
        executionResultsContent += `**执行状态**: ${result.success ? '成功' : '失败'}\n\n`;
        
        // 关键：处理函数执行结果（这是最重要的部分）
        if (result.result !== undefined && result.result !== null) {
            if (typeof result.result === 'string') {
                executionResultsContent += `**执行结果**:\n${result.result}\n\n`;
            } else if (typeof result.result === 'object') {
                // 如果是对象，尝试转换为可读格式
                if (result.result.success !== undefined) {
                    executionResultsContent += `**执行结果**:\n${JSON.stringify(result.result, null, 2)}\n\n`;
                } else {
                    executionResultsContent += `**执行结果**:\n${JSON.stringify(result.result, null, 2)}\n\n`;
                }
            } else {
                executionResultsContent += `**执行结果**: ${String(result.result)}\n\n`;
            }
        }
        
        if (result.error) {
            executionResultsContent += `**错误信息**: ${result.error}\n\n`;
        }
        
        if (index < functionResults.length - 1) {
            executionResultsContent += '---\n\n';
        }
    });
    
    return executionResultsContent;
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.parseWorkflowFormat = parseWorkflowFormat;
    window.generateWorkflowFormat = generateWorkflowFormat;
    window.executeWorkflow = executeWorkflow;
    window.pauseWorkflow = pauseWorkflow;
    window.resumeWorkflow = resumeWorkflow;
    window.cancelWorkflow = cancelWorkflow;
    window.updateWorkflowExecutionStatus = updateWorkflowExecutionStatus;
    window.generateWorkflowControlPrompt = generateWorkflowControlPrompt;
    window.enhancePromptWithWorkflowControl = enhancePromptWithWorkflowControl;
    window.generateKeywordRecognitionPrompt = generateKeywordRecognitionPrompt;
    window.formatKeywordFunctionResults = formatKeywordFunctionResults; // 导出格式化函数供模板使用
}
