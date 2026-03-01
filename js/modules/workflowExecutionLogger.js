/**
 * 工作流执行日志管理模块
 * 实现永久保存、追加模式、结构化展示的日志系统
 * 支持日志分层、折叠、导出、搜索、过滤等功能
 */

// 日志展示状态管理
const logDisplayState = {
    expandedExecutions: new Set(), // 展开的执行ID集合
    searchKeyword: '', // 当前搜索关键词
    filterType: 'all', // 过滤类型：all, progress, detail, workflowNode, f12
    showF12Logs: true // 是否显示F12日志
};

/**
 * 生成执行ID（时间戳格式）
 * @returns {string} 执行ID，格式为 YYYY-MM-DD_HH-mm-ss-sss
 */
export function generateExecutionId() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}-${milliseconds}`;
}

/**
 * 格式化时间戳为 HH:mm:ss
 * @param {Date|string} timestamp - 时间戳
 * @returns {string} 格式化的时间字符串
 */
function formatTimestamp(timestamp) {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

/**
 * 获取或创建日志容器元素
 * @returns {HTMLElement|null} 日志容器元素
 */
function getLogElement() {
    let logElement = document.getElementById('workflow-execution-status');
    if (!logElement) {
        // 如果不存在，尝试创建（但通常应该已经存在）
        console.warn('[工作流日志] 日志容器元素不存在');
        return null;
    }
    return logElement;
}

/**
 * 更新进度行（追加模式，通过前缀匹配更新）
 * @param {string} executionId - 执行ID
 * @param {string} eventName - 事件名
 * @param {string} workflowName - 工作流名
 * @param {string} fileName - 文件名（可选）
 * @param {number} totalSteps - 总步骤数
 * @param {number} completedSteps - 已完成步骤数
 * @param {string} currentStepName - 当前步骤名称（可选）
 */
export function updateProgressLog(executionId, eventName, workflowName, fileName = '', totalSteps = 0, completedSteps = 0, currentStepName = '') {
    const logElement = getLogElement();
    if (!logElement) return;
    
    // 获取原始文本内容（如果使用增强显示，需要从隐藏的文本区域获取）
    let textContent = '';
    if (logElement.dataset.enhanced === 'true') {
        // 增强显示模式下，从隐藏的文本区域获取原始内容
        const hiddenTextArea = logElement.querySelector('#workflow-execution-status-text-hidden');
        if (hiddenTextArea) {
            textContent = hiddenTextArea.value || '';
        } else {
            // 如果没有隐藏文本区域，创建一个
            const hiddenTextArea = document.createElement('textarea');
            hiddenTextArea.id = 'workflow-execution-status-text-hidden';
            hiddenTextArea.style.display = 'none';
            logElement.appendChild(hiddenTextArea);
            textContent = '';
        }
    } else {
        textContent = logElement.textContent || '';
    }
    
    const lines = textContent.split('\n').filter(line => line.trim() !== '');
    
    // 构建进度行前缀（用于查找）
    const progressLinePrefix = executionId 
        ? `[${executionId}] ${eventName} | ${workflowName}${fileName ? ' | ' + fileName : ''}`
        : `${eventName} | ${workflowName}${fileName ? ' | ' + fileName : ''}`;
    
    let found = false;
    
    // 查找并更新现有的进度行
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(progressLinePrefix)) {
            // 更新现有进度行
            const currentStepText = currentStepName ? ` | 当前步骤：${currentStepName}` : '';
            lines[i] = `${progressLinePrefix} | 共${totalSteps}步已完成${completedSteps}步${currentStepText}`;
            found = true;
            break;
        }
    }
    
    // 如果没找到，在最后添加新的进度行
    if (!found && eventName && workflowName) {
        const currentStepText = currentStepName ? ` | 当前步骤：${currentStepName}` : '';
        lines.push(`${progressLinePrefix} | 共${totalSteps}步已完成${completedSteps}步${currentStepText}`);
    }
    
    // 更新日志内容（永久保存，不清空）
    const newContent = lines.join('\n');
    
    if (logElement.dataset.enhanced === 'true') {
        // 增强显示模式下，更新隐藏的文本区域
        const hiddenTextArea = logElement.querySelector('#workflow-execution-status-text-hidden');
        if (hiddenTextArea) {
            hiddenTextArea.value = newContent;
        }
        // 重新渲染增强的日志
        renderEnhancedLogOnUpdate();
    } else {
        logElement.textContent = newContent;
    }
    
    // 注意：不自动滚动，让用户可以查看历史日志
}

/**
 * 追加详细日志行
 * @param {string} executionId - 执行ID
 * @param {string} eventName - 事件名
 * @param {string} workflowName - 工作流名
 * @param {number} stepIndex - 步骤索引（从1开始）
 * @param {string} nodeType - 节点类型（普通节点/工作流节点）
 * @param {string} nodeName - 节点名称
 * @param {string} logMessage - 日志消息
 * @param {object} options - 额外选项 {isWorkflowNode, workflowNodeName, workflowNodeInternalSteps}
 */
export function appendDetailLog(executionId, eventName, workflowName, stepIndex, nodeType, nodeName, logMessage, options = {}) {
    const logElement = getLogElement();
    if (!logElement) return;
    
    const timestamp = formatTimestamp(new Date());
    const isWorkflowNode = options.isWorkflowNode || false;
    const workflowNodeName = options.workflowNodeName || null;
    
    // 构建日志行
    // 关键改进：在日志行中添加类型标记，用于筛选
    // 格式：[执行ID] [时间戳] [事件名] [工作流名] [步骤X] [类型标记] [节点类型/工作流节点] [节点名] | 消息
    let logLine = `[${executionId}] [${timestamp}] [${eventName}] [${workflowName}] [步骤${stepIndex}]`;
    
    if (isWorkflowNode && workflowNodeName) {
        // 工作流节点特殊格式：添加明确的类型标记
        logLine += ` [类型:工作流节点] [工作流节点] [${workflowNodeName}]`;
        if (options.workflowNodeInternalSteps && options.workflowNodeInternalSteps.length > 0) {
            logLine += ` | 内部步骤：${options.workflowNodeInternalSteps.length}步`;
        }
    } else {
        // 普通节点格式：添加类型标记
        logLine += ` [类型:详细] [${nodeType}] [${nodeName}]`;
    }
    
    logLine += ` | ${logMessage}`;
    
    // 获取原始文本内容
    let textContent = '';
    if (logElement.dataset.enhanced === 'true') {
        const hiddenTextArea = logElement.querySelector('#workflow-execution-status-text-hidden');
        if (hiddenTextArea) {
            textContent = hiddenTextArea.value || '';
        } else {
            const hiddenTextArea = document.createElement('textarea');
            hiddenTextArea.id = 'workflow-execution-status-text-hidden';
            hiddenTextArea.style.display = 'none';
            logElement.appendChild(hiddenTextArea);
            textContent = '';
        }
    } else {
        textContent = logElement.textContent || '';
    }
    
    // 追加到日志容器末尾
    const newLog = textContent + (textContent ? '\n' : '') + logLine;
    
    if (logElement.dataset.enhanced === 'true') {
        const hiddenTextArea = logElement.querySelector('#workflow-execution-status-text-hidden');
        if (hiddenTextArea) {
            hiddenTextArea.value = newLog;
        }
        renderEnhancedLogOnUpdate();
    } else {
        logElement.textContent = newLog;
    }
    
    // 注意：不自动滚动，让用户可以查看历史日志
}

/**
 * 追加工作流节点开始执行的日志
 * @param {string} executionId - 执行ID
 * @param {string} eventName - 事件名
 * @param {string} workflowName - 工作流名
 * @param {number} stepIndex - 步骤索引
 * @param {string} workflowNodeName - 工作流节点名称
 * @param {number} internalStepCount - 内部步骤数
 */
export function appendWorkflowNodeStartLog(executionId, eventName, workflowName, stepIndex, workflowNodeName, internalStepCount = 0) {
    const logElement = getLogElement();
    if (!logElement) return;
    
    const timestamp = formatTimestamp(new Date());
    // 关键改进：添加明确的类型标记
    const logLine = `[${executionId}] [${timestamp}] [${eventName}] [${workflowName}] [步骤${stepIndex}] [类型:工作流节点] [工作流节点] [${workflowNodeName}] | 开始执行，内部步骤数：${internalStepCount}`;
    
    let textContent = '';
    if (logElement.dataset.enhanced === 'true') {
        const hiddenTextArea = logElement.querySelector('#workflow-execution-status-text-hidden');
        if (hiddenTextArea) {
            textContent = hiddenTextArea.value || '';
        }
    } else {
        textContent = logElement.textContent || '';
    }
    
    const newLog = textContent + (textContent ? '\n' : '') + logLine;
    
    if (logElement.dataset.enhanced === 'true') {
        const hiddenTextArea = logElement.querySelector('#workflow-execution-status-text-hidden');
        if (hiddenTextArea) {
            hiddenTextArea.value = newLog;
        }
        renderEnhancedLogOnUpdate();
    } else {
        logElement.textContent = newLog;
    }
}

/**
 * 追加工作流节点执行完成的日志
 * @param {string} executionId - 执行ID
 * @param {string} eventName - 事件名
 * @param {string} workflowName - 工作流名
 * @param {number} stepIndex - 步骤索引
 * @param {string} workflowNodeName - 工作流节点名称
 * @param {number} completedInternalSteps - 已完成的内部步骤数
 * @param {number} totalInternalSteps - 总内部步骤数
 */
export function appendWorkflowNodeCompleteLog(executionId, eventName, workflowName, stepIndex, workflowNodeName, completedInternalSteps = 0, totalInternalSteps = 0) {
    const logElement = getLogElement();
    if (!logElement) return;
    
    const timestamp = formatTimestamp(new Date());
    // 关键改进：添加明确的类型标记
    const logLine = `[${executionId}] [${timestamp}] [${eventName}] [${workflowName}] [步骤${stepIndex}] [类型:工作流节点] [工作流节点] [${workflowNodeName}] | 执行完成，内部已完成：${completedInternalSteps}/${totalInternalSteps}步`;
    
    let textContent = '';
    if (logElement.dataset.enhanced === 'true') {
        const hiddenTextArea = logElement.querySelector('#workflow-execution-status-text-hidden');
        if (hiddenTextArea) {
            textContent = hiddenTextArea.value || '';
        }
    } else {
        textContent = logElement.textContent || '';
    }
    
    const newLog = textContent + (textContent ? '\n' : '') + logLine;
    
    if (logElement.dataset.enhanced === 'true') {
        const hiddenTextArea = logElement.querySelector('#workflow-execution-status-text-hidden');
        if (hiddenTextArea) {
            hiddenTextArea.value = newLog;
        }
        renderEnhancedLogOnUpdate();
    } else {
        logElement.textContent = newLog;
    }
}

/**
 * 限制日志容器的最大行数（性能优化）
 * @param {number} maxLines - 最大行数，默认1000
 */
export function limitLogLines(maxLines = 1000) {
    const logElement = getLogElement();
    if (!logElement) return;
    
    let textContent = '';
    if (logElement.dataset.enhanced === 'true') {
        const hiddenTextArea = logElement.querySelector('#workflow-execution-status-text-hidden');
        if (hiddenTextArea) {
            textContent = hiddenTextArea.value || '';
        }
    } else {
        textContent = logElement.textContent || '';
    }
    
    const lines = textContent.split('\n');
    
    if (lines.length > maxLines) {
        // 删除最旧的日志行，保留最新的
        const keepLines = lines.slice(-maxLines);
        const newContent = keepLines.join('\n');
        
        if (logElement.dataset.enhanced === 'true') {
            const hiddenTextArea = logElement.querySelector('#workflow-execution-status-text-hidden');
            if (hiddenTextArea) {
                hiddenTextArea.value = newContent;
            }
            renderEnhancedLogOnUpdate();
        } else {
            logElement.textContent = newContent;
        }
    }
}

/**
 * 清空日志（可选功能）
 */
export function clearLog() {
    const logElement = getLogElement();
    if (!logElement) return;
    
    if (logElement.dataset.enhanced === 'true') {
        const hiddenTextArea = logElement.querySelector('#workflow-execution-status-text-hidden');
        if (hiddenTextArea) {
            hiddenTextArea.value = '';
        }
        renderEnhancedLogOnUpdate();
    } else {
        logElement.textContent = '';
    }
    
    // 清空展开状态
    logDisplayState.expandedExecutions.clear();
}

/**
 * 导出日志（复制到剪贴板）
 * @returns {Promise<boolean>} 是否成功
 */
export async function exportLog() {
    const logElement = getLogElement();
    if (!logElement) return false;
    
    try {
        let textContent = '';
        if (logElement.dataset.enhanced === 'true') {
            const hiddenTextArea = logElement.querySelector('#workflow-execution-status-text-hidden');
            if (hiddenTextArea) {
                textContent = hiddenTextArea.value || '';
            }
        } else {
            textContent = logElement.textContent || '';
        }
        
        await navigator.clipboard.writeText(textContent);
        return true;
    } catch (err) {
        console.error('[工作流日志] 导出日志失败:', err);
        return false;
    }
}

/**
 * 搜索日志（按关键词过滤）
 * @param {string} keyword - 搜索关键词
 * @returns {Array<string>} 匹配的日志行
 */
export function searchLog(keyword) {
    const logElement = getLogElement();
    if (!logElement) return [];
    
    const currentLog = logElement.textContent || '';
    const lines = currentLog.split('\n');
    
    if (!keyword) return lines;
    
    const lowerKeyword = keyword.toLowerCase();
    return lines.filter(line => line.toLowerCase().includes(lowerKeyword));
}

/**
 * 初始化增强的日志展示UI（支持分层、折叠、搜索、过滤）
 */
export function initEnhancedLogDisplay() {
    const logElement = getLogElement();
    if (!logElement) return;
    
    // 检查是否已经初始化过
    if (logElement.dataset.enhanced === 'true') return;
    logElement.dataset.enhanced = 'true';
    
    // 保存原始内容
    const originalContent = logElement.textContent || '';
    
    // 创建增强的UI结构
    const enhancedContainer = document.createElement('div');
    enhancedContainer.id = 'workflow-execution-status-enhanced';
    enhancedContainer.style.cssText = `
        display: flex;
        flex-direction: column;
        height: 100%;
        max-height: 100%;
    `;
    
    // 关键修复：导出和清空按钮已移到HTML中（全屏日志按钮左边），不再在工具栏中创建
    // 直接创建日志内容容器，不需要工具栏
    const logContentContainer = document.createElement('div');
    logContentContainer.id = 'workflow-execution-status-content-enhanced';
    logContentContainer.style.cssText = `
        flex: 1;
        overflow-y: auto;
        padding: 8px;
        font-family: var(--font-code);
        font-size: 12px;
        line-height: 1.5;
    `;
    
    // 关键修复：不再添加工具栏，直接添加日志内容容器
    enhancedContainer.appendChild(logContentContainer);
    
    // 创建隐藏的文本区域用于存储原始日志内容
    const hiddenTextArea = document.createElement('textarea');
    hiddenTextArea.id = 'workflow-execution-status-text-hidden';
    hiddenTextArea.style.display = 'none';
    hiddenTextArea.value = originalContent;
    
    // 替换原始元素的内容
    logElement.innerHTML = '';
    logElement.appendChild(enhancedContainer);
    logElement.appendChild(hiddenTextArea);
    
    // 渲染增强的日志
    renderEnhancedLog();
}

/**
 * 渲染增强的日志（支持分层、折叠、搜索、过滤）
 */
function renderEnhancedLog() {
    const logElement = getLogElement();
    if (!logElement) return;
    
    const contentContainer = document.getElementById('workflow-execution-status-content-enhanced');
    if (!contentContainer) return;
    
    // 关键修复：从隐藏的文本区域读取内容，而不是从textContent
    let currentLog = '';
    const hiddenTextArea = logElement.querySelector('#workflow-execution-status-text-hidden');
    if (hiddenTextArea) {
        currentLog = hiddenTextArea.value || '';
    } else {
        // 如果没有隐藏文本区域，从textContent读取（向后兼容）
        currentLog = logElement.textContent || '';
    }
    
    // 关键修复：简化日志显示，只显示进度行，减少内存占用
    // 查找进度行（格式：[执行ID] 事件名 | 工作流名 | 文件名 | ...）
    const lines = currentLog.split('\n').filter(line => line.trim() !== '');
    const progressLines = [];
    
    lines.forEach(line => {
        const trimmedLine = line.trim();
        // 检测进度行格式：[执行ID] 事件名 | 工作流名 | ...
        if (trimmedLine.match(/^\[[^\]]+\]\s+[^|]+\s+\|\s+[^|]+/)) {
            progressLines.push(trimmedLine);
        }
    });
    
    // 只渲染进度行
    let html = '';
    progressLines.forEach(progressLine => {
        html += `<div class="log-progress-line" style="
            padding: 8px;
            background: var(--bg-1);
            border-radius: var(--border-radius);
            margin-bottom: 4px;
        ">`;
        
        // 高亮搜索关键词（如果启用搜索）
        let displayLine = escapeHtml(progressLine);
        if (logDisplayState.searchKeyword) {
            const keyword = escapeHtml(logDisplayState.searchKeyword);
            const regex = new RegExp(`(${keyword})`, 'gi');
            displayLine = displayLine.replace(regex, '<mark>$1</mark>');
        }
        
        html += `<span>${displayLine}</span>`;
        html += `</div>`;
    });
    
    // 如果没有进度行，显示提示
    if (progressLines.length === 0) {
        html = '<div style="padding: 8px; color: var(--text-muted);">暂无执行日志</div>';
    }
    
    contentContainer.innerHTML = html || '<div style="padding: 16px; text-align: center; color: var(--text-muted);">暂无日志</div>';
}

/**
 * 切换执行组展开/折叠状态
 * @param {string} executionId - 执行ID
 */
window.toggleExecutionGroup = function(executionId) {
    if (logDisplayState.expandedExecutions.has(executionId)) {
        logDisplayState.expandedExecutions.delete(executionId);
    } else {
        logDisplayState.expandedExecutions.add(executionId);
    }
    renderEnhancedLog();
};

/**
 * HTML转义
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 在日志更新时自动渲染增强的日志
 */
export function renderEnhancedLogOnUpdate() {
    const logElement = getLogElement();
    if (!logElement) return;
    
    // 如果已经初始化了增强显示，则重新渲染
    if (logElement.dataset.enhanced === 'true') {
        renderEnhancedLog();
    }
}

