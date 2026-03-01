/**
 * 批量执行管理器模块
 * 负责目录批量执行工作流的管理和执行
 */

import { state } from '../core/state.js';
import { loadEvents } from './eventManager.js';
import { executeEvent } from './eventManager.js';
import { getAllFilesInDirectory } from '../utils/fileUtils.js';
import { getEvent } from '../core/api.js';
import { getWorkflow } from '../core/api.js';
import { parseWorkflowFormat } from './workflowManager.js';
import { getDirectory } from '../core/api.js';
import { isFileFolder, isTableFile, isChapterFile, getTableSortKey, getChapterSortNumber, cleanFileName } from '../utils/fileUtils.js';

/**
 * 批量执行面板的目录状态（独立于主界面）
 */
const batchDirState = {
    currentDir: null,
    files: [],
    selectedIndex: -1,
    currentFileItem: null,
    dirStack: [],
    folderStack: []
};

/**
 * 批量执行详细日志存储（用于详细日志查看界面）
 * 结构：{ executionId: { filePath, eventName, workflowName, executionLogs, timestamp, ... } }
 */
const batchExecutionLogs = {};

/**
 * 加载事件列表（用于下拉选择器）
 */
export async function loadEventsForBatch() {
    await loadEvents();
    await renderEventsListForBatch();
    
    // 初始化并发数量输入框，并绑定保存事件
    const concurrencyInput = document.getElementById('batch-concurrency-input');
    if (concurrencyInput) {
        // 从localStorage读取保存的值
        const savedConcurrency = localStorage.getItem('batchConcurrency');
        if (savedConcurrency) {
            const savedValue = parseInt(savedConcurrency);
            if (!isNaN(savedValue) && savedValue >= 1 && savedValue <= 10) {
                concurrencyInput.value = savedValue;
            }
        }
        
        // 绑定blur事件，用户点击其他部分时保存
        concurrencyInput.addEventListener('blur', () => {
            const value = parseInt(concurrencyInput.value);
            if (!isNaN(value) && value >= 1 && value <= 10) {
                localStorage.setItem('batchConcurrency', value.toString());
            }
        });
        
        // 绑定change事件，用户输入时也保存
        concurrencyInput.addEventListener('change', () => {
            const value = parseInt(concurrencyInput.value);
            if (!isNaN(value) && value >= 1 && value <= 10) {
                localStorage.setItem('batchConcurrency', value.toString());
            }
        });
    }
}

/**
 * 渲染事件列表到批量执行面板的下拉选择器
 */
/**
 * 检查工作流是否包含工作流节点
 * @param {string} workflowName - 工作流名称
 * @returns {Promise<boolean>} 是否包含工作流节点
 */
async function checkWorkflowHasWorkflowNode(workflowName) {
    if (!workflowName) return false;
    
    try {
        const { getWorkflow, getWorkflows } = await import('../core/api.js');
        const { parseWorkflowFormat } = await import('./workflowManager.js');
        const workflow = await getWorkflow(workflowName);
        if (!workflow || !workflow.content) return false;
        
        const steps = parseWorkflowFormat(workflow.content);
        
        // 加载工作流列表，用于检查viewId是否是工作流名称
        let workflows = state.workflows || [];
        if (!workflows || workflows.length === 0) {
            try {
                const data = await getWorkflows();
                workflows = data.workflows || [];
                state.workflows = workflows;
            } catch (err) {
                console.warn(`[checkWorkflowHasWorkflowNode] 加载工作流列表失败:`, err);
            }
        }
        
        // 检查是否有步骤包含工作流节点
        // 方式1：检查workflowId字段是否存在且不为空
        // 方式2：检查viewId是否是工作流名称（因为有些工作流节点可能没有显式的workflowId）
        return steps.some(step => {
            // 检查workflowId字段
            if (step.workflowId && step.workflowId.trim() !== '' && step.workflowId !== '无') {
                return true;
            }
            // 检查viewId是否是工作流名称
            if (step.viewId && workflows.length > 0) {
                const isWorkflowName = workflows.some(w => w.name === step.viewId);
                if (isWorkflowName) {
                    return true;
                }
            }
            return false;
        });
    } catch (err) {
        console.warn(`[renderEventsListForBatch] 检查工作流节点失败:`, err);
        return false;
    }
}

/**
 * 渲染事件列表到批量执行面板的下拉选择器
 */
export async function renderEventsListForBatch() {
    const eventSelect = document.getElementById('batch-event-select');
    if (!eventSelect) return;

    // 保存当前选中的值
    const currentValue = eventSelect.value;

    // 清空并重新填充
    eventSelect.innerHTML = '<option value="">请选择事件</option>';

    if (state.events && state.events.length > 0) {
        // 并行检查所有事件的工作流是否包含工作流节点
        const eventChecks = await Promise.all(
            state.events.map(async (event) => {
                const hasWorkflowNode = event.workflowName 
                    ? await checkWorkflowHasWorkflowNode(event.workflowName)
                    : false;
                return { event, hasWorkflowNode };
            })
        );
        
        eventChecks.forEach(({ event, hasWorkflowNode }) => {
            const option = document.createElement('option');
            option.value = event.name;
            let textContent = `${event.name} (工作流: ${event.workflowName || '无'})`;
            if (hasWorkflowNode) {
                textContent += ' ⚠️ 包含工作流节点（电脑配置不是顶尖，不要在批量执行中使用这个）';
            }
            option.textContent = textContent;
            eventSelect.appendChild(option);
        });

        // 恢复之前选中的值
        if (currentValue) {
            eventSelect.value = currentValue;
        }
    }
}

/**
 * 加载批量执行面板的目录
 */
export async function loadBatchDir(path) {
    try {
        const data = await getDirectory(path || '.');
        batchDirState.currentDir = data.path;
        
        // 同步到输入框
        const batchDirectoryPathInput = document.getElementById('batch-directory-path');
        if (batchDirectoryPathInput) {
            batchDirectoryPathInput.value = data.path;
        }
        
        renderBatchList(data);
        
        return new Promise(resolve => {
            setTimeout(resolve, 50);
        });
    } catch (e) {
        console.error('Error loading batch directory:', e);
        alert('错误: ' + e.message);
        return Promise.reject(e);
    }
}

/**
 * 渲染批量执行面板的文件列表
 */
function renderBatchList(data) {
    const list = document.getElementById('batch-file-list');
    if (!list) return;
    
    list.innerHTML = '';
    batchDirState.files = [];
    batchDirState.selectedIndex = -1;
    batchDirState.currentFileItem = null;

    // 渲染目录
    data.directories.forEach(dir => {
        if (dir.name.endsWith('.deleted')) return;
        if (isFileFolder(dir.name, data.files)) {
            return;
        }

        const li = createBatchLi(dir.name, 'type-dir', dir.path, true);
        li.dataset.path = dir.path;
        li.ondblclick = () => {
            selectBatchFolder(li, dir.path);
            enterBatchDirectory();
        };
        list.appendChild(li);
    });

    // 分离表文件、章文件和其他文件
    const tableFiles = [];
    const chapterFiles = [];
    const otherFiles = [];
    
    data.files.forEach(file => {
        if (file.name.endsWith('.deleted')) return;

        const fileName = file.name.toLowerCase();
        const isMdFile = fileName.endsWith('.md');
        const isTxtFile = fileName.endsWith('.txt');
        if (!isMdFile && !isTxtFile) {
            return;
        }

        // 检查是否应该隐藏（基于视图后缀）
        let shouldHide = false;
        if (state.views) {
            for (const view of state.views) {
                if (view.suffix && view.suffix.trim() !== '') {
                    const suffix = view.suffix;
                    if ((file.name.toLowerCase().endsWith(suffix.toLowerCase() + '.md') ||
                         file.name.toLowerCase().endsWith(suffix.toLowerCase() + '.txt'))) {
                        const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.'));
                        const potentialBaseName = nameWithoutExt.slice(0, -suffix.length);
                        const hasMainFile = data.files.some(f => {
                            const mainNameWithoutExt = f.name.substring(0, f.name.lastIndexOf('.'));
                            return mainNameWithoutExt === potentialBaseName &&
                                   f.name !== file.name &&
                                   (f.name.toLowerCase().endsWith('.md') || f.name.toLowerCase().endsWith('.txt'));
                        });
                        if (hasMainFile) {
                            shouldHide = true;
                            break;
                        }
                    }
                }
            }
        }
        if (shouldHide) return;

        if (isTableFile(file.name)) {
            tableFiles.push(file);
        } else if (isChapterFile(file.name)) {
            chapterFiles.push(file);
        } else {
            otherFiles.push(file);
        }
    });
    
    // 排序
    tableFiles.sort((a, b) => {
        const keyA = getTableSortKey(a.name);
        const keyB = getTableSortKey(b.name);
        if (keyA[0] !== keyB[0]) {
            return keyA[0] - keyB[0];
        }
        if (keyA.length > 1 && keyB.length > 1) {
            return keyA[1] - keyB[1];
        }
        if (keyA.length === 1 && keyB.length > 1) return -1;
        if (keyA.length > 1 && keyB.length === 1) return 1;
        return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
    });
    
    chapterFiles.sort((a, b) => {
        const numA = getChapterSortNumber(a.name);
        const numB = getChapterSortNumber(b.name);
        return numA - numB;
    });
    
    otherFiles.sort((a, b) => {
        return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
    });
    
    // 渲染文件
    [...tableFiles, ...chapterFiles, ...otherFiles].forEach(file => {
        const displayName = cleanFileName(file.name);
        const li = createBatchLi(displayName, 'type-file', file.path, false);
        li.title = file.name;
        list.appendChild(li);
    });
}

/**
 * 创建批量执行面板的列表项
 */
function createBatchLi(text, typeClass, path, isDir) {
    const li = document.createElement('li');
    li.className = `file-item ${typeClass}`;
    
    const iconNormal = isDir ? '📁' : '📄';
    const iconHover = isDir ? '📂' : '📃';
    const iconSelected = isDir ? '📂' : '📄';
    
    li.innerHTML = `
        <div style="display: flex; align-items: center; width: 100%;">
            <span class="file-item-icon" style="display: inline-block; width: 20px; text-align: center; flex-shrink: 0;" data-icon-normal="${iconNormal}" data-icon-hover="${iconHover}" data-icon-selected="${iconSelected}">${iconNormal}</span>
            <span class="item-name" style="flex: 1;">${text}</span>
        </div>
    `;
    
    const iconEl = li.querySelector('.file-item-icon');
    
    li.addEventListener('mouseenter', () => {
        if (li.classList.contains('selected')) {
            iconEl.textContent = iconSelected;
        } else {
            iconEl.textContent = iconHover;
        }
    });
    
    li.addEventListener('mouseleave', () => {
        if (li.classList.contains('selected')) {
            iconEl.textContent = iconSelected;
        } else {
            iconEl.textContent = iconNormal;
        }
    });

    li.onclick = () => {
        if (isDir) {
            selectBatchFolder(li, path);
        }
    };
    
    batchDirState.files.push({ el: li, path: path, isDir });
    return li;
}

/**
 * 选择批量执行面板的文件夹
 */
export function selectBatchFolder(el, path) {
    batchDirState.files.forEach(f => {
        f.el.classList.remove('selected');
        const iconEl = f.el.querySelector('.file-item-icon');
        if (iconEl) {
            iconEl.textContent = iconEl.dataset.iconNormal;
        }
    });
    
    el.classList.add('selected');
    const iconEl = el.querySelector('.file-item-icon');
    if (iconEl) {
        iconEl.textContent = iconEl.dataset.iconSelected;
    }
    
    batchDirState.selectedIndex = batchDirState.files.findIndex(f => f.el === el);
    batchDirState.currentFileItem = batchDirState.files[batchDirState.selectedIndex];
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/**
 * 进入批量执行面板的目录
 */
export function enterBatchDirectory() {
    if (batchDirState.currentFileItem && batchDirState.currentFileItem.isDir) {
        if (!batchDirState.dirStack) batchDirState.dirStack = [];
        if (!batchDirState.folderStack) batchDirState.folderStack = [];
        
        batchDirState.dirStack.push(batchDirState.currentDir);
        batchDirState.folderStack.push(batchDirState.currentFileItem.path);
        loadBatchDir(batchDirState.currentFileItem.path);
    }
}

/**
 * 在批量执行面板中移动选择
 */
export function moveBatchSelection(step) {
    if (batchDirState.files.length === 0) return;
    
    // 如果没有选中的项目，初始化选择第一个项目
    if (batchDirState.selectedIndex < 0 && batchDirState.files.length > 0) {
        batchDirState.selectedIndex = 0;
        batchDirState.currentFileItem = batchDirState.files[0];
        const firstEl = batchDirState.files[0].el;
        firstEl.classList.add('selected');
        const iconEl = firstEl.querySelector('.file-item-icon');
        if (iconEl) {
            iconEl.textContent = iconEl.dataset.iconSelected;
        }
        firstEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
    }
    
    let newIndex = batchDirState.selectedIndex + step;
    if (newIndex < 0) newIndex = batchDirState.files.length - 1;
    if (newIndex >= batchDirState.files.length) newIndex = 0;
    
    batchDirState.selectedIndex = newIndex;
    batchDirState.currentFileItem = batchDirState.files[newIndex];
    
    const selectedEl = batchDirState.files[newIndex].el;
    batchDirState.files.forEach(f => {
        f.el.classList.remove('selected');
        const iconEl = f.el.querySelector('.file-item-icon');
        if (iconEl) {
            iconEl.textContent = iconEl.dataset.iconNormal;
        }
    });
    
    selectedEl.classList.add('selected');
    const iconEl = selectedEl.querySelector('.file-item-icon');
    if (iconEl) {
        iconEl.textContent = iconEl.dataset.iconSelected;
    }
    selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/**
 * 批量执行面板返回上一级目录
 */
export function goBackBatchDirectory() {
    if (batchDirState.dirStack && batchDirState.dirStack.length > 0) {
        const previousDir = batchDirState.dirStack.pop();
        const previousFolder = batchDirState.folderStack ? batchDirState.folderStack.pop() : null;
        
        loadBatchDir(previousDir).then(() => {
            setTimeout(() => {
                if (previousFolder) {
                    const folderItem = Array.from(document.querySelectorAll('#batch-file-list .file-item.type-dir')).find(item =>
                        item.dataset.path === previousFolder
                    );
                    if (folderItem) {
                        selectBatchFolder(folderItem, previousFolder);
                        folderItem.scrollIntoView({ block: 'nearest' });
                    }
                }
            }, 100);
        });
    } else {
        // 如果没有历史记录，返回到父目录
        const currentPath = batchDirState.currentDir || '.';
        const pathParts = currentPath.replace(/\\/g, '/').split('/').filter(p => p);
        if (pathParts.length > 1) {
            pathParts.pop();
            loadBatchDir(pathParts.join('/') || '/');
        }
    }
}

/**
 * 清理批量执行面板的状态（关闭面板时调用）
 */
export function clearBatchState() {
    // 清空目录状态
    batchDirState.currentDir = null;
    batchDirState.files = [];
    batchDirState.selectedIndex = -1;
    batchDirState.currentFileItem = null;
    batchDirState.dirStack = [];
    batchDirState.folderStack = [];
    
    // 清空输入框
    const batchDirectoryPathInput = document.getElementById('batch-directory-path');
    if (batchDirectoryPathInput) {
        batchDirectoryPathInput.value = '';
    }
    
    // 清空文件列表
    const list = document.getElementById('batch-file-list');
    if (list) {
        list.innerHTML = '';
    }
}

/**
 * 更新批量执行日志
 * @param {string} logText - 日志文本
 */
function updateBatchLog(logText) {
    const logElement = document.getElementById('batch-execution-log');
    if (logElement) {
        logElement.textContent = logText || '暂无执行日志';
        // 自动滚动到底部
        logElement.scrollTop = logElement.scrollHeight;
    }
}

/**
 * 追加批量执行日志
 * @param {string} logText - 要追加的日志文本
 */
function appendBatchLog(logText) {
    const logElement = document.getElementById('batch-execution-log');
    if (logElement) {
        const currentLog = logElement.textContent;
        if (currentLog === '暂无执行日志') {
            logElement.textContent = logText;
        } else {
            logElement.textContent = currentLog + '\n' + logText;
        }
        // 自动滚动到底部
        logElement.scrollTop = logElement.scrollHeight;
    }
}

/**
 * 更新批量执行进度日志（用于实时显示当前文件的执行进度）
 * @param {string} fileName - 文件名
 * @param {string} eventName - 事件名
 * @param {string} workflowName - 工作流名称
 * @param {number} totalSteps - 总步骤数
 * @param {number} completedSteps - 已完成步骤数
 * @param {string} currentStep - 当前步骤名称（可选）
 * @param {string} executionId - 执行ID（时间戳，用于区分相同事件的多次执行）
 */
export function updateBatchProgressLog(fileName, eventName, workflowName, totalSteps, completedSteps, currentStep = '', executionId = '', isWorkflowNode = false) {
    const logElement = document.getElementById('batch-execution-log');
    if (!logElement) return;
    
    // 获取当前日志内容
    let currentLog = logElement.textContent || '';
    const lines = currentLog.split('\n');
    
    // 关键修复：使用executionId来区分相同事件的多次执行
    // 格式：文件名+事件名+工作流名称+[执行ID]+共x步已完成x步当前步骤：步骤某某
    const progressLinePrefix = executionId 
        ? `${fileName}+${eventName}+${workflowName}+[${executionId}]`
        : `${fileName}+${eventName}+${workflowName}`;
    let found = false;
    
    // 关键修复：如果是工作流节点，在步骤名称后添加"（工作流节点）"标识
    let currentStepText = currentStep || '';
    if (currentStepText && isWorkflowNode) {
        // 检查是否已经包含"（工作流节点）"标识，避免重复添加
        if (!currentStepText.includes('（工作流节点）') && !currentStepText.includes('(工作流节点)')) {
            currentStepText = `${currentStepText}（工作流节点）`;
        }
    }
    const formattedCurrentStep = currentStepText ? `当前步骤：${currentStepText}` : '';
    
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(progressLinePrefix)) {
            // 更新现有进度行
            lines[i] = `${progressLinePrefix}+共${totalSteps}步已完成${completedSteps}步${formattedCurrentStep ? ' ' + formattedCurrentStep : ''}`;
            found = true;
            break;
        }
    }
    
    // 如果没找到，在最后添加新的进度行
    if (!found && fileName && eventName && workflowName) {
        lines.push(`${progressLinePrefix}+共${totalSteps}步已完成${completedSteps}步${formattedCurrentStep ? ' ' + formattedCurrentStep : ''}`);
    }
    
    // 更新日志内容
    logElement.textContent = lines.join('\n');
    // 关键修复：取消自动滚动，让用户可以查看历史日志
    // logElement.scrollTop = logElement.scrollHeight;
}

/**
 * 清空批量执行日志
 */
export function clearBatchLog() {
    updateBatchLog('');
}

/**
 * 执行批量处理
 * 工作流程：
 * 1. 一次性递归查找目录下所有文件（包括所有子目录）
 * 2. 对每个文件逐个执行事件（支持顺序执行和并发执行）
 */
export async function executeBatch() {
    const directoryPathInput = document.getElementById('batch-directory-path');
    const eventSelect = document.getElementById('batch-event-select');
    const executeBtn = document.getElementById('batch-execute-btn');

    if (!directoryPathInput || !eventSelect || !executeBtn) {
        alert('批量执行面板元素未找到');
        return;
    }

    const directoryPath = directoryPathInput.value.trim();
    const eventName = eventSelect.value;

    if (!directoryPath) {
        alert('请先选择要执行的目录');
        return;
    }

    if (!eventName) {
        alert('请先选择要执行的事件');
        return;
    }

    // 关键修复：从输入框获取并发数量，让用户可以自定义
    const concurrencyInput = document.getElementById('batch-concurrency-input');
    let concurrency = 3; // 默认值
    if (concurrencyInput) {
        const savedConcurrency = localStorage.getItem('batchConcurrency');
        if (savedConcurrency) {
            const savedValue = parseInt(savedConcurrency);
            if (!isNaN(savedValue) && savedValue >= 1 && savedValue <= 10) {
                concurrency = savedValue;
                concurrencyInput.value = savedValue;
            }
        }
        const inputValue = parseInt(concurrencyInput.value);
        if (!isNaN(inputValue) && inputValue >= 1 && inputValue <= 10) {
            concurrency = inputValue;
        }
    }
    
    // 如果并发数量为1，使用顺序执行；否则使用并发执行
    const sequential = concurrency === 1;

    try {
        executeBtn.disabled = true;
        executeBtn.textContent = '正在查找文件...';

        // 一次性递归查找目录下的所有文件（包括所有子目录）
        const filesToProcess = await getAllFilesInDirectory(directoryPath);

        if (filesToProcess.length === 0) {
            alert('目录下没有找到可处理的文件（仅处理.md文件）');
            executeBtn.disabled = false;
            executeBtn.textContent = '执行';
            return;
        }

        // 确认执行
        const confirmMessage = `找到 ${filesToProcess.length} 个文件（包括所有子目录）\n\n目录：${directoryPath}\n事件：${eventName}\n执行模式：${sequential ? '顺序执行' : `并发执行（并发数：${concurrency}）`}\n\n确定要执行吗？`;
        if (!confirm(confirmMessage)) {
            executeBtn.disabled = false;
            executeBtn.textContent = '执行';
            return;
        }

        executeBtn.textContent = `执行中... (0/${filesToProcess.length})`;

        // 获取事件和工作流信息，用于日志显示
        const event = await getEvent(eventName);
        const workflow = event.workflowName ? await getWorkflow(event.workflowName) : null;
        const workflowSteps = workflow ? parseWorkflowFormat(workflow.content) : [];
        
        // 关键修复：为本次批量执行生成唯一的执行ID（时间戳）
        const batchExecutionId = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
        
        // 初始化日志
        let logText = `${directoryPath}\n事件：${eventName} [执行ID: ${batchExecutionId}]`;
        if (workflowSteps.length > 0) {
            const stepNames = workflowSteps.map((step, index) => {
                const stepId = step.viewId || step.self || `步骤${index + 1}`;
                return `${index + 1}：${stepId}`;
            }).join('、');
            logText += `+${workflowSteps.length}：${stepNames}`;
        }
        updateBatchLog(logText);

        // 存储所有文件的执行结果
        const allResults = [];
        const allSummaries = [];
        let totalSteps = 0;
        let successCount = 0;
        let failCount = 0;
        
        // 初始化批量执行日志存储
        batchExecutionLogs[batchExecutionId] = {
            directoryPath: directoryPath,
            eventName: eventName,
            workflowName: event.workflowName || '',
            timestamp: batchExecutionId,
            files: []
        };

        // 注意：不在这里初始化workflowExecutionState，因为每个文件的executeEventForFile会创建自己的状态
        // 批量执行的整体进度通过executeBtn的textContent显示，不需要使用workflowExecutionState

        // 检查事件是否关联工作流（event已在第147行获取）
        if (!event.workflowName) {
            alert('事件未关联工作流');
            executeBtn.disabled = false;
            executeBtn.textContent = '执行';
            return;
        }
        
        // 对每个文件执行事件
        // 关键设计：每个文件都是完全独立的执行单元
        // 使用队列处理，确保状态完全隔离
        if (sequential) {
            // 顺序执行：一个文件一个文件排队执行
            for (let i = 0; i < filesToProcess.length; i++) {
                const filePath = filesToProcess[i];
                const fileIndex = i + 1;
                
                console.log(`[批量执行] 开始处理文件 ${fileIndex}/${filesToProcess.length}: ${filePath}`);
                
                // 更新执行状态显示
                executeBtn.textContent = `执行中... (${fileIndex}/${filesToProcess.length})`;
                
                // 注意：不要在批量执行时更新 workflowExecutionState，因为每个文件会创建自己的状态
                // 等 executeEventForFile 执行时，会创建新的 workflowExecutionState

                try {
                    // 直接调用 executeEventForFile，而不是 executeEvent
                    // 这样可以避免 executeEvent 中的目录处理逻辑干扰
                    // 每个文件使用独立的时间戳，确保生成的文件名不会冲突
                    const fileTimestamp = new Date().toISOString();
                    
                    // 从 eventManager 导入 executeEventForFile
                    const { executeEventForFile: execFile } = await import('./eventManager.js');
                    
                    // 执行单个文件的工作流
                    // 关键修复：传递batchExecutionId，用于在工作流执行状态中区分相同事件的多次执行
                    const result = await execFile(eventName, event, filePath, fileTimestamp, {
                        sequential: true,
                        concurrency: 1,
                        useStream: true,
                        batchExecutionId: batchExecutionId
                    });

                    // 更新日志：添加文件名（初始化进度日志行）
                    const fileName = filePath.split(/[/\\]/).pop();
                    const workflowName = event.workflowName || '';
                    const workflowSteps = workflow ? parseWorkflowFormat(workflow.content) : [];
                    // 关键修复：批量执行面板需要兼容工作流节点
                    // 优先使用result中的totalSteps（如果存在），否则使用workflowSteps.length
                    // result.summary.totalSteps已经包含了工作流节点内部的步骤数
                    const totalSteps = (result && result.summary && result.summary.totalSteps) 
                        ? result.summary.totalSteps 
                        : workflowSteps.length;
                    
                    // 关键修复：使用executionId来区分相同事件的多次执行
                    // 初始化进度日志行
                    updateBatchProgressLog(fileName, eventName, workflowName, totalSteps, 0, '', batchExecutionId);
                    appendBatchLog(fileName);
                    
                    // 关键修复：保存每个文件的详细执行日志（包括工作流执行状态日志）
                    const fileExecutionLog = {
                        filePath: filePath,
                        fileName: fileName,
                        success: result && result.success,
                        totalSteps: totalSteps,
                        executionLogs: state.workflowExecutionState?.executionLogs || [],
                        timestamp: fileTimestamp,
                        result: result
                    };
                    if (batchExecutionLogs[batchExecutionId]) {
                        batchExecutionLogs[batchExecutionId].files.push(fileExecutionLog);
                    }

                    if (result && result.success) {
                        successCount++;
                        if (result.summary) {
                            allSummaries.push(result.summary);
                            totalSteps += result.summary.totalSteps || 0;
                        }
                    } else {
                        failCount++;
                    }
                    allResults.push(result);
                } catch (err) {
                    console.error(`文件 ${filePath} 执行失败:`, err);
                    // 更新日志：添加失败的文件名
                    const fileName = filePath.split(/[/\\]/).pop();
                    appendBatchLog(`${fileName} (执行失败: ${err.message})`);
                    failCount++;
                    allResults.push({
                        success: false,
                        filePath: filePath,
                        error: err.message
                    });
                }
            }
        } else {
            // 并发执行：使用执行队列控制并发数，完成一个文件立即启动下一个
            // 这样可以充分利用资源，不需要等待整组完成
            const executing = []; // 正在执行的文件 Promise
            let completedCount = 0;
            let fileIndex = 0;
            
            // 关键修复：使用循环控制并发，而不是map立即启动所有任务
            // 这样可以确保同时只有concurrency个文件在执行
            const executeFile = async (filePath) => {
                const currentFileIndex = ++fileIndex;
                
                try {
                    // 关键修复：在批量并发执行时，不应该在调用executeEventForFile之前访问state.workflowExecutionState
                    // 因为每个文件的executeEventForFile会创建和恢复自己的状态，提前访问可能导致状态冲突
                    // 状态显示由executeEventForFile内部管理，不需要在这里更新

                    // 直接调用 executeEventForFile，确保每个文件独立执行
                    // 使用外部已获取的event对象，避免重复API调用
                    const { executeEventForFile: execFile } = await import('./eventManager.js');
                    const fileTimestamp = new Date().toISOString();
                    
                    console.log(`[批量并发] 开始执行文件 ${currentFileIndex}/${filesToProcess.length}: ${filePath}`);
                    
                    const result = await execFile(eventName, event, filePath, fileTimestamp, {
                        sequential: true,
                        concurrency: 1,
                        useStream: true,
                        batchExecutionId: batchExecutionId
                    });

                    // 更新日志：添加文件名（初始化进度日志行）
                    const fileName = filePath.split(/[/\\]/).pop();
                    const workflowName = event.workflowName || '';
                    // 关键修复：批量执行面板需要兼容工作流节点
                    // 使用result中的实际步骤数（包括工作流节点内部的步骤），而不是从workflow.content解析的步骤数
                    // 因为工作流节点内部的步骤数无法从workflow.content中获取
                    const workflowSteps = workflow ? parseWorkflowFormat(workflow.content) : [];
                    // 优先使用result中的totalSteps（如果存在），否则使用workflowSteps.length
                    // result.summary.totalSteps已经包含了工作流节点内部的步骤数
                    // 关键修复：使用let而不是const，因为后面需要累加
                    let fileTotalSteps = (result && result.summary && result.summary.totalSteps) 
                        ? result.summary.totalSteps 
                        : workflowSteps.length;
                    
                    // 关键修复：使用executionId来区分相同事件的多次执行
                    // 初始化进度日志行
                    updateBatchProgressLog(fileName, eventName, workflowName, fileTotalSteps, 0, '', batchExecutionId);
                    appendBatchLog(fileName);
                    
                    // 关键修复：保存每个文件的详细执行日志（包括工作流执行状态日志）
                    // 注意：在并发执行时，需要等待当前文件执行完成后再保存日志
                    const fileExecutionLog = {
                        filePath: filePath,
                        fileName: fileName,
                        success: result && result.success,
                        totalSteps: fileTotalSteps,
                        executionLogs: state.workflowExecutionState?.executionLogs || [],
                        timestamp: fileTimestamp,
                        result: result
                    };
                    // 使用同步方式更新，避免并发冲突
                    if (batchExecutionLogs[batchExecutionId]) {
                        batchExecutionLogs[batchExecutionId].files.push(fileExecutionLog);
                    }

                    // 更新完成计数
                    completedCount++;
                    executeBtn.textContent = `执行中... (${completedCount}/${filesToProcess.length})`;

                    if (result && result.success) {
                        successCount++;
                        if (result.summary) {
                            allSummaries.push(result.summary);
                            // 关键修复：累加到外部的totalSteps变量，而不是本地的fileTotalSteps
                            totalSteps += result.summary.totalSteps || 0;
                        }
                    } else {
                        failCount++;
                    }
                    
                    console.log(`[批量并发] 文件 ${currentFileIndex}/${filesToProcess.length} 执行完成: ${filePath}`);
                    return result;
                } catch (err) {
                    console.error(`文件 ${filePath} 执行失败:`, err);
                    // 更新日志：添加失败的文件名
                    const fileName = filePath.split(/[/\\]/).pop();
                    appendBatchLog(`${fileName} (执行失败: ${err.message})`);
                    completedCount++;
                    executeBtn.textContent = `执行中... (${completedCount}/${filesToProcess.length})`;
                    failCount++;
                    const errorResult = {
                        success: false,
                        filePath: filePath,
                        error: err.message
                    };
                    allResults.push(errorResult);
                    return errorResult;
                }
            };
            
            // 关键修复：使用循环控制并发，确保同时只有concurrency个文件在执行
            for (let i = 0; i < filesToProcess.length; i++) {
                const filePath = filesToProcess[i];
                
                // 创建执行Promise
                const executePromise = executeFile(filePath);
                
                // 将Promise添加到执行队列
                executing.push(executePromise);
                
                // 关键修复：当达到并发限制时，等待其中一个完成
                // 这样可以确保同时只有concurrency个文件在执行
                if (executing.length >= concurrency) {
                    // 等待其中一个完成
                    await Promise.race(executing);
                    // 移除已完成的Promise（通过过滤掉已完成的）
                    // 使用Promise.allSettled来检查哪些已完成
                    const executingCopy = [...executing];
                    const settled = await Promise.allSettled(executingCopy);
                    executing.length = 0;
                    // 只保留还在执行的Promise（status为pending的）
                    for (let j = 0; j < settled.length; j++) {
                        if (settled[j].status === 'pending') {
                            executing.push(executingCopy[j]);
                        }
                    }
                }
            }
            
            // 等待所有剩余的文件执行完成
            if (executing.length > 0) {
                await Promise.all(executing);
            }
        }

        // 显示执行结果
        const message = `批量执行完成！\n\n` +
            `总文件数：${filesToProcess.length}\n` +
            `成功：${successCount}\n` +
            `失败：${failCount}\n` +
            `执行步骤数：${totalSteps}`;
        alert(message);
        
        // 关键修复：保存批量执行结果，供详细日志查看界面使用
        if (batchExecutionLogs[batchExecutionId]) {
            batchExecutionLogs[batchExecutionId].totalFiles = filesToProcess.length;
            batchExecutionLogs[batchExecutionId].successCount = successCount;
            batchExecutionLogs[batchExecutionId].failCount = failCount;
            batchExecutionLogs[batchExecutionId].totalSteps = totalSteps;
        }

    } catch (err) {
        console.error('批量执行失败:', err);
        alert('批量执行失败: ' + err.message);
    } finally {
        executeBtn.disabled = false;
        executeBtn.textContent = '执行';
    }
}

/**
 * 显示批量执行详细日志查看界面
 */
export function showBatchExecutionDetailLogs() {
    // 获取所有批量执行记录
    const executionIds = Object.keys(batchExecutionLogs).sort().reverse(); // 最新的在前
    
    if (executionIds.length === 0) {
        alert('暂无批量执行日志');
        return;
    }
    
    // 关键修复：如果模态框不存在，创建它
    let modal = document.getElementById('batch-execution-detail-modal');
    if (!modal) {
        // 创建模态框
        modal = document.createElement('div');
        modal.id = 'batch-execution-detail-modal';
        modal.style.cssText = `
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 10000;
            justify-content: center;
            align-items: center;
        `;
        modal.innerHTML = `
            <div style="background: var(--bg-pane); border-radius: var(--border-radius); padding: 20px; width: 90%; max-width: 1200px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: var(--shadow-hover);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid var(--border); padding-bottom: 12px;">
                    <h3 style="margin: 0; color: var(--text-primary);">批量执行详细日志</h3>
                    <button id="close-batch-execution-detail-modal" class="btn btn-secondary" style="padding: 6px 12px;">关闭</button>
                </div>
                <div id="batch-execution-detail-info" style="margin-bottom: 16px; padding: 12px; background: var(--bg-1); border-radius: var(--border-radius); font-size: 12px;"></div>
                <div style="display: flex; flex: 1; gap: 16px; min-height: 0;">
                    <div id="batch-execution-detail-file-list" style="width: 200px; overflow-y: auto; border-right: 1px solid var(--border); padding-right: 12px;"></div>
                    <div id="batch-execution-detail-content" style="flex: 1; overflow-y: auto; font-family: var(--font-code); font-size: 12px; white-space: pre-wrap; word-break: break-all;"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // 绑定关闭按钮事件
        const closeBtn = modal.querySelector('#close-batch-execution-detail-modal');
        if (closeBtn) {
            closeBtn.onclick = () => {
                modal.style.display = 'none';
            };
        }
        
        // 点击背景关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    }
    
    modal.style.display = 'flex';
    
    // 渲染文件列表和日志内容
    renderBatchExecutionDetailLogs(executionIds[0]);
}

/**
 * 渲染批量执行详细日志
 * @param {string} executionId - 执行ID
 */
function renderBatchExecutionDetailLogs(executionId) {
    const executionLog = batchExecutionLogs[executionId];
    if (!executionLog) return;
    
    // 渲染文件列表（左下角）
    const fileListEl = document.getElementById('batch-execution-detail-file-list');
    if (fileListEl) {
        fileListEl.innerHTML = '';
        
        executionLog.files.forEach((fileLog, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'batch-execution-detail-file-item';
            fileItem.dataset.index = index;
            fileItem.innerHTML = `
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">
                    ${fileLog.success ? '✅' : '❌'} ${index + 1}/${executionLog.files.length}
                </div>
                <div style="font-size: 13px; color: var(--text-primary); word-break: break-all;">
                    ${fileLog.fileName}
                </div>
                <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px;">
                    ${fileLog.totalSteps}步
                </div>
            `;
            
            fileItem.addEventListener('click', () => {
                // 移除其他选中状态
                fileListEl.querySelectorAll('.batch-execution-detail-file-item').forEach(item => {
                    item.classList.remove('selected');
                });
                // 添加选中状态
                fileItem.classList.add('selected');
                // 显示该文件的详细日志
                renderFileExecutionLog(fileLog);
            });
            
            // 默认选中第一个文件
            if (index === 0) {
                fileItem.classList.add('selected');
                renderFileExecutionLog(fileLog);
            }
            
            fileListEl.appendChild(fileItem);
        });
    }
    
    // 渲染执行信息（顶部）
    const infoEl = document.getElementById('batch-execution-detail-info');
    if (infoEl) {
        infoEl.innerHTML = `
            <div style="font-size: 14px; color: var(--text-primary); margin-bottom: 8px;">
                <strong>事件：</strong>${executionLog.eventName} | 
                <strong>工作流：</strong>${executionLog.workflowName} | 
                <strong>目录：</strong>${executionLog.directoryPath}
            </div>
            <div style="font-size: 12px; color: var(--text-secondary);">
                总文件数：${executionLog.totalFiles || executionLog.files.length} | 
                成功：${executionLog.successCount || 0} | 
                失败：${executionLog.failCount || 0} | 
                总步骤数：${executionLog.totalSteps || 0}
            </div>
        `;
    }
}

/**
 * 渲染单个文件的执行日志
 * @param {object} fileLog - 文件执行日志
 */
function renderFileExecutionLog(fileLog) {
    const logContentEl = document.getElementById('batch-execution-detail-log-content');
    if (!logContentEl) return;
    
    // 构建日志内容
    let logContent = `文件：${fileLog.fileName}\n`;
    logContent += `路径：${fileLog.filePath}\n`;
    logContent += `状态：${fileLog.success ? '✅ 成功' : '❌ 失败'}\n`;
    logContent += `总步骤数：${fileLog.totalSteps}\n`;
    logContent += `执行时间：${new Date(fileLog.timestamp).toLocaleString('zh-CN')}\n\n`;
    logContent += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    // 添加工作流执行状态日志
    if (fileLog.executionLogs && fileLog.executionLogs.length > 0) {
        logContent += `执行日志:\n`;
        logContent += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        fileLog.executionLogs.forEach((log) => {
            const displayStepIndex = (log.stepIndex && log.stepIndex > 0) ? log.stepIndex : 1;
            
            if (log.isWorkflowNode && log.workflowNodeName) {
                logContent += `[工作流：${log.workflowNodeName}] ${log.log}\n`;
            } else {
                logContent += `[步骤${displayStepIndex}] ${log.log}\n`;
            }
        });
        logContent += `\n`;
    } else {
        logContent += `暂无执行日志\n\n`;
    }
    
    logContentEl.textContent = logContent;
    logContentEl.scrollTop = 0; // 滚动到顶部
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.executeBatch = executeBatch;
    window.loadEventsForBatch = loadEventsForBatch;
    window.clearBatchLog = clearBatchLog;
    window.showBatchExecutionDetailLogs = showBatchExecutionDetailLogs;
}

