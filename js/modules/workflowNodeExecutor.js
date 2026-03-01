/**
 * 工作流节点执行模块
 * 专门处理工作流节点的执行，与本体工作流完全分离
 * 确保工作流节点执行时不会影响本体工作流的状态和日志
 */

import { state } from '../core/state.js';
import { getWorkflows, getWorkflow, getFile } from '../core/api.js';
import { executeWorkflow } from './workflowManager.js';

/**
 * 深拷贝工作流执行状态，正确处理 Map 对象
 * @param {object} state - 工作流执行状态
 * @returns {object} 深拷贝的状态
 */
function deepCloneWorkflowState(state) {
    if (!state) return null;
    
    // 创建新的状态对象
    const cloned = {
        ...state,
        // 特殊处理 Map 对象
        stepStatusMap: state.stepStatusMap ? new Map(state.stepStatusMap) : new Map(),
        // 特殊处理 Set 对象
        executingSteps: state.executingSteps ? new Set(state.executingSteps) : new Set(),
        // 深拷贝数组和对象
        executionLogs: state.executionLogs ? JSON.parse(JSON.stringify(state.executionLogs)) : [],
        stepResults: state.stepResults ? JSON.parse(JSON.stringify(state.stepResults)) : {},
        executedSteps: state.executedSteps ? JSON.parse(JSON.stringify(state.executedSteps)) : []
    };
    
    return cloned;
}

// updateWorkflowExecutionStatus 是全局函数，不需要导入

/**
 * 检查viewId是否是工作流节点
 * @param {string} viewId - 视图ID
 * @param {string} workflowId - 工作流ID（可选）
 * @returns {Promise<string|null>} 如果是工作流节点，返回工作流名称，否则返回null
 */
async function checkIfWorkflowNode(viewId, workflowId = null) {
    // 如果已经有workflowId，直接返回
    if (workflowId) {
        return workflowId;
    }
    
    // 如果state.workflows未加载，尝试加载
    if (!state.workflows || state.workflows.length === 0) {
        try {
            const { getWorkflows } = await import('../core/api.js');
            const data = await getWorkflows();
            state.workflows = data.workflows || [];
            console.log(`[工作流节点执行器] 已加载工作流列表，共 ${state.workflows.length} 个工作流`);
        } catch (err) {
            console.warn(`[工作流节点执行器] 加载工作流列表失败:`, err);
            return null;
        }
    }
    
    // 检查viewId是否是工作流名称
    if (state.workflows && state.workflows.length > 0) {
        const workflowExists = state.workflows.some(w => w.name === viewId);
        if (workflowExists) {
            console.log(`[工作流节点执行器] 识别到工作流节点: viewId="${viewId}" 是工作流名称`);
            return viewId;
        }
    }
    
    return null;
}

/**
 * 执行工作流节点
 * 完全独立于本体工作流的执行逻辑，确保状态隔离
 * 
 * @param {object} step - 工作流步骤
 * @param {object} options - 执行选项
 * @param {number} currentStepIndex - 当前步骤索引
 * @param {string} workflowName - 本体工作流名称
 * @returns {Promise<object>} 执行结果 {viewId, content, isWorkflowNode, workflowNodeName, ...}
 */
export async function executeWorkflowNode(step, options, currentStepIndex, workflowName, stepUniqueId = null) {
    const viewId = step.viewId || step.self;
    // 关键修复：如果提供了stepUniqueId，使用它；否则使用currentStepIndex计算
    const stepId = stepUniqueId || `step_${currentStepIndex - 1}`;
    
    console.log(`[工作流节点执行器] 开始执行工作流节点: ${viewId} (步骤索引: ${currentStepIndex})`);
    
    // 检查是否是工作流节点
    const actualWorkflowId = await checkIfWorkflowNode(viewId, step.workflowId);
    if (!actualWorkflowId) {
        // 不是工作流节点，返回null，让调用者知道这不是工作流节点
        return null;
    }
    
    console.log(`[工作流节点执行器] 确认是工作流节点: ${viewId} -> ${actualWorkflowId}`);
    
    // 关键修复：执行工作流节点前，先保存本体工作流的完整状态
    // 必须在写入日志之前保存，因为日志写入会修改状态
    // 使用深拷贝函数，正确处理 Map 对象
    const parentWorkflowState = state.workflowExecutionState ? deepCloneWorkflowState(state.workflowExecutionState) : null;
    if (!parentWorkflowState) {
        console.error(`[工作流节点执行器] 无法保存本体工作流状态，工作流节点执行失败`);
        throw new Error('无法保存本体工作流状态');
    }
    
    console.log(`[工作流节点执行器] 已保存本体工作流状态: ${parentWorkflowState.workflowName}`);
    
    // 关键修复：更新状态机状态为 'executing'
    // 确保 stepStatusMap 是 Map 对象
    if (!parentWorkflowState.stepStatusMap || !(parentWorkflowState.stepStatusMap instanceof Map)) {
        // 如果 stepStatusMap 不存在或不是 Map，从原始状态重新创建
        if (state.workflowExecutionState?.stepStatusMap instanceof Map) {
            parentWorkflowState.stepStatusMap = new Map(state.workflowExecutionState.stepStatusMap);
        } else {
            parentWorkflowState.stepStatusMap = new Map();
        }
    }
    parentWorkflowState.stepStatusMap.set(stepId, 'executing');
    console.log(`[工作流节点执行器] 状态机状态更新为 executing: ${stepId}`);
    
    // 在步骤开始时立即写入日志到本体工作流状态
    // 关键修复：使用保存的父状态来写入日志，确保日志写入到正确的状态中
    const stepStartTimestamp = new Date().toISOString();
    if (!parentWorkflowState.executionLogs) {
        parentWorkflowState.executionLogs = [];
    }
    const startLogMessage = `${viewId} -> [开始执行工作流: ${actualWorkflowId}]`;
    parentWorkflowState.executionLogs.push({
        stepIndex: currentStepIndex,
        viewId: viewId,
        log: startLogMessage,
        timestamp: stepStartTimestamp,
        status: 'executing',
        prompt: null,
        sentContent: null,
        nextViews: step.viewNext || step.next || [],
        isWorkflowNode: true,
        workflowNodeName: actualWorkflowId
    });
    
    // 关键修复：将日志同步回当前状态（如果当前状态是本体工作流状态）
    if (state.workflowExecutionState && 
        state.workflowExecutionState.workflowName === parentWorkflowState.workflowName) {
        state.workflowExecutionState.executionLogs = parentWorkflowState.executionLogs;
    }
    // 关键修复：只有在工作流执行状态存在时才触发状态更新
    if (state.workflowExecutionState) {
        updateWorkflowExecutionStatus();
    }
    
    // 关键修复：从父工作流状态中获取前置视图节点的stepResults，传递给嵌套工作流
    // 这样嵌套工作流的步骤就能访问前置视图节点的结果
    const viewPrev = step.viewPrev || step.prev || [];
    const workflowPrev = step.workflowPrev || [];
    const allPrevIds = [...(viewPrev || []), ...(workflowPrev || [])];
    const initialStepResults = {};
    
    // 关键修复：优先从实时状态获取前置节点结果，如果实时状态中没有，再从保存的快照中获取
    // 这样可以确保获取到最新的前置节点结果
    const currentState = state.workflowExecutionState;
    const currentStepResults = currentState && currentState.workflowName === parentWorkflowState.workflowName 
        ? currentState.stepResults 
        : null;
    
    if (allPrevIds.length > 0) {
        // 关键修复：等待所有前置节点完成，只需要检查内存中的 stepResults 是否有结果
        // 工作流节点执行器不需要检测文件写入，只检测内存中的消息即可
        // 文件写入是异步的，不应该阻塞工作流节点的执行判断
        const checkInterval = 100; // 每100ms检查一次
        let checkCount = 0;
        
        while (true) {
            let allPrevReady = true;
            const missingPrevIds = [];
            
            // 关键修复：更新当前状态引用（每次循环都更新，确保获取最新状态）
            // 重新获取实时状态的stepResults引用（因为状态可能在等待期间更新）
            const latestState = state.workflowExecutionState;
            const latestStepResults = latestState && latestState.workflowName === parentWorkflowState.workflowName
                ? latestState.stepResults 
                : null;
            
            // 同步最新的stepResults到父状态快照（用于后续获取）
            if (latestStepResults) {
                parentWorkflowState.stepResults = { ...parentWorkflowState.stepResults, ...latestStepResults };
            }
            
            // 检查所有前置节点是否在内存中有结果
            for (const prevId of allPrevIds) {
                // 只检查内存中的stepResults是否有结果
                const hasResultInMemory = (latestStepResults && latestStepResults[prevId] !== undefined) ||
                                         (parentWorkflowState.stepResults && parentWorkflowState.stepResults[prevId] !== undefined);
                
                if (!hasResultInMemory) {
                    allPrevReady = false;
                    missingPrevIds.push(prevId);
                }
            }
            
            if (allPrevReady) {
                // 所有前置节点都在内存中有结果，获取结果
                allPrevIds.forEach(prevId => {
                    // 优先从实时状态获取，如果没有则从保存的快照获取
                    const result = (latestStepResults && latestStepResults[prevId] !== undefined) 
                        ? latestStepResults[prevId]
                        : (parentWorkflowState.stepResults && parentWorkflowState.stepResults[prevId] !== undefined
                            ? parentWorkflowState.stepResults[prevId]
                            : null);
                    
                    if (result !== undefined && result !== null) {
                        initialStepResults[prevId] = result;
                        console.log(`[工作流节点执行器] 获取前置节点结果: ${prevId} (长度: ${result.length} 字符)`);
                    }
                });
                break; // 所有前置节点都已在内存中完成，退出等待循环
            }
            
            // 还有前置节点未完成，等待一段时间后再次检查
            checkCount++;
            if (checkCount % 10 === 0) { // 每1秒输出一次日志，避免日志过多
                const missingDetails = missingPrevIds.join(', ');
                console.log(`[工作流节点执行器] 等待前置节点完成: ${missingDetails} (已检查 ${checkCount * checkInterval}ms)`);
            }
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }
        
        console.log(`[工作流节点执行器] 所有前置节点已在内存中完成，共检查 ${checkCount * checkInterval}ms`);
    }
    
    // 构建步骤选项，确保包含所有必要信息
    // 关键修复：工作流节点应该使用本体的事件名和执行ID，而不是嵌套工作流的事件名
    // 优先从 parentWorkflowState.eventName 获取（新保存的字段），其次从 options.eventName 获取
    const parentEventName = parentWorkflowState.eventName || parentWorkflowState.options?.eventName || options.eventName || '';
    const parentExecutionId = parentWorkflowState.executionId || parentWorkflowState.batchExecutionId || '';
    const stepOptionsForNested = {
        ...options,
        stepIndex: currentStepIndex,
        eventTimestamp: options.eventTimestamp || parentWorkflowState.options?.eventTimestamp || parentWorkflowState.eventTimestamp,
        eventName: parentEventName, // 关键修复：优先使用本体事件名
        workflowName: options.workflowName || parentWorkflowState.workflowName,
        batchFilePath: options.batchFilePath || parentWorkflowState.batchFilePath,
        batchExecutionId: parentExecutionId, // 关键修复：传递本体的执行ID给嵌套工作流
        isNestedWorkflow: true, // 标识这是嵌套工作流，日志应该写入到本体工作流
        parentWorkflowName: parentWorkflowState.workflowName || workflowName,
        parentWorkflowViewId: viewId,
        parentWorkflowState: parentWorkflowState, // 传递父状态，用于依赖判定和事件信息获取
        initialStepResults: initialStepResults // 传递前置节点的stepResults给嵌套工作流
    };
    
    // 关键修复：更新 workflowExecutionState 中的 currentStepIndex，用于追加写入
    if (state.workflowExecutionState && 
        state.workflowExecutionState.workflowName === parentWorkflowState.workflowName) {
        state.workflowExecutionState.currentStepIndex = currentStepIndex;
    }
    
    try {
        // 执行工作流
        // 关键修复：传递isNestedWorkflow选项，防止嵌套工作流的日志混入主工作流
        console.log(`[工作流节点执行器] 开始执行嵌套工作流: ${actualWorkflowId}，传递初始stepResults: ${Object.keys(initialStepResults).join(', ')}`);
        const workflowResult = await executeWorkflow(actualWorkflowId, null, stepOptionsForNested);
        console.log(`[工作流节点执行器] 嵌套工作流执行完成: ${actualWorkflowId}`);
        
        // 获取工作流的总结视图内容
        // 关键：优先从工作流的总结视图读取（如果配置了），否则使用最后一个步骤的结果
        let workflowSummaryContent = '';
        
        // 尝试从工作流执行结果中获取总结内容
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
        if (stepOptionsForNested.eventName && stepOptionsForNested.batchFilePath) {
            try {
                if (!workflowSummaryContent) {
                    // 尝试从工作流的最后一个步骤文件读取
                    if (workflowResult.steps && workflowResult.steps.length > 0) {
                        const sortedSteps = workflowResult.steps.sort((a, b) => (a.stepIndex || 0) - (b.stepIndex || 0));
                        const lastStep = sortedSteps[sortedSteps.length - 1];
                        if (lastStep.stepFilePath) {
                            try {
                                const fileContent = await getFile(lastStep.stepFilePath);
                                if (fileContent && !fileContent.trim().startsWith('{') && !fileContent.includes('"error"')) {
                                    // 解析文件内容，提取实际内容（跳过头部信息）
                                    const lines = fileContent.split('\n');
                                    let contentStartIndex = 0;
                                    for (let i = 0; i < lines.length; i++) {
                                        if (lines[i].includes('步骤:') || lines[i].includes('步骤：')) {
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
                                console.warn(`[工作流节点执行器] 从步骤文件读取内容失败 (${lastStep.stepFilePath}):`, readError);
                            }
                        }
                    }
                }
            } catch (summaryReadError) {
                console.warn(`[工作流节点执行器] 读取总结内容失败 (${viewId}):`, summaryReadError);
            }
        }
        
        // 如果工作流执行成功但没有内容，使用默认提示
        if (!workflowSummaryContent) {
            workflowSummaryContent = `工作流"${actualWorkflowId}"执行完成，共执行 ${workflowResult.steps.length} 个步骤。`;
        }
        
        // 工作流节点执行完成后，使用和普通步骤相同的逻辑创建步骤文件
        const workflowNameForDisplay = actualWorkflowId || viewId;
        const stepDisplay = `${currentStepIndex || 'N'}+${viewId}`;
        let workflowNodeStepFilePath = null;
        
        // 使用和普通步骤相同的逻辑创建步骤文件
        if (stepOptionsForNested.eventName && stepOptionsForNested.eventTimestamp && stepOptionsForNested.batchFilePath) {
            try {
                const { createStreamFileWriter } = await import('./editor.js');
                const targetFilePath = stepOptionsForNested.batchFilePath;
                const lastSeparatorIndex = Math.max(targetFilePath.lastIndexOf('\\'), targetFilePath.lastIndexOf('/'));
                const fileName = lastSeparatorIndex >= 0 ? targetFilePath.substring(lastSeparatorIndex + 1) : targetFilePath;
                const lastDotIndex = fileName.lastIndexOf('.');
                const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
                const ext = lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1).trim() : '';
                const timestampStr = stepOptionsForNested.eventTimestamp.replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
                const eventSuffix = `_${stepOptionsForNested.eventName}`;
                const stepFileName = `${timestampStr}_${baseName}_${stepDisplay}${eventSuffix}.${ext || 'md'}`;
                const { getFileInFolderPath } = await import('../utils/fileUtils.js');
                workflowNodeStepFilePath = getFileInFolderPath(targetFilePath, stepFileName);
                
                // 检查文件是否已存在（相同视图名在不同y轴时）
                let isAppendMode = false;
                try {
                    await getFile(workflowNodeStepFilePath);
                    isAppendMode = true;
                    console.log('[工作流节点执行器] 步骤文件已存在，使用追加模式:', workflowNodeStepFilePath);
                } catch (err) {
                    isAppendMode = false;
                }
                
                // 创建流式写入器并写入内容
                const writer = createStreamFileWriter(workflowNodeStepFilePath, viewId, isAppendMode, currentStepIndex, stepOptionsForNested.eventName, stepOptionsForNested.eventTimestamp, workflowNameForDisplay, {
                    isNestedWorkflow: false, // 工作流节点本身不是嵌套工作流
                    parentWorkflowName: null,
                    parentWorkflowViewId: null
                });
                
                // 写入工作流节点的内容
                await writer.write(workflowSummaryContent);
                await writer.close();
                
                console.log('[工作流节点执行器] 步骤文件已创建:', workflowNodeStepFilePath);
            } catch (fileError) {
                console.warn(`[工作流节点执行器] 创建步骤文件失败 (${viewId}):`, fileError);
            }
        }
        
        // 工作流节点构建结果对象
        // 保存工作流节点内部的所有步骤信息，用于在总结文件中显示
        const result = {
            viewId: viewId,
            content: workflowSummaryContent,
            aiFilePath: null, // 工作流节点不生成AI文件（嵌套工作流内部的步骤会生成）
            stepFilePath: workflowNodeStepFilePath, // 使用和普通步骤相同的逻辑创建的步骤文件路径
            isWorkflowNode: true,
            workflowNodeName: actualWorkflowId,
            workflowNodeStepDisplay: stepDisplay,
            workflowNodeInternalSteps: workflowResult.steps || [],
            workflowNodeInternalResults: workflowResult.results || {}
        };
        
        console.log(`[工作流节点执行器] 工作流节点执行完成: ${viewId}，内容长度: ${workflowSummaryContent.length} 字符`);
        
        // 关键修复：执行工作流节点后，恢复本体工作流的状态
        // 必须在返回结果之前恢复，确保后续步骤使用正确的状态
        if (parentWorkflowState) {
            // 更新状态机状态为 completed
            // 确保 stepStatusMap 是 Map 对象
            if (!parentWorkflowState.stepStatusMap || !(parentWorkflowState.stepStatusMap instanceof Map)) {
                // 如果 stepStatusMap 不存在或不是 Map，从原始状态重新创建
                if (state.workflowExecutionState?.stepStatusMap instanceof Map) {
                    parentWorkflowState.stepStatusMap = new Map(state.workflowExecutionState.stepStatusMap);
                } else {
                    parentWorkflowState.stepStatusMap = new Map();
                }
            }
            parentWorkflowState.stepStatusMap.set(stepId, 'completed');
            console.log(`[工作流节点执行器] 状态机状态更新为 completed: ${stepId}`);
            
            // 更新执行日志为完成状态
            const logIndex = parentWorkflowState.executionLogs.findIndex(
                log => log.viewId === viewId && log.status === 'executing' && log.stepIndex === currentStepIndex
            );
            if (logIndex >= 0) {
                const timestamp = new Date().toISOString();
                const completedLogMessage = `${viewId} -> [工作流节点执行完成: ${actualWorkflowId}]`;
                parentWorkflowState.executionLogs[logIndex] = {
                    ...parentWorkflowState.executionLogs[logIndex],
                    log: completedLogMessage,
                    timestamp: timestamp,
                    status: 'completed'
                };
            }
            
            // 关键修复：将工作流节点的结果存储到父工作流状态的stepResults中
            // 使用viewId、workflowId和stepUniqueId作为key，这样后续步骤就能访问工作流节点的结果
            if (!parentWorkflowState.stepResults) {
                parentWorkflowState.stepResults = {};
            }
            // 使用viewId作为key存储结果
            parentWorkflowState.stepResults[viewId] = workflowSummaryContent;
            // 使用workflowId作为key存储结果（用于工作流节点之间的状态传递）
            parentWorkflowState.stepResults[actualWorkflowId] = workflowSummaryContent;
            // 关键修复：使用stepUniqueId作为key存储结果（用于工作流执行时判断步骤是否完成）
            if (stepUniqueId) {
                parentWorkflowState.stepResults[stepUniqueId] = workflowSummaryContent;
            }
            console.log(`[工作流节点执行器] 已将工作流节点结果存储到父状态: viewId=${viewId}, workflowId=${actualWorkflowId}, stepUniqueId=${stepUniqueId || 'null'}, 内容长度=${workflowSummaryContent.length} 字符`);
            
            // 关键修复：恢复状态时，合并当前状态和父状态，而不是完全覆盖
            // 这样可以保留工作流执行过程中新完成的步骤结果
            const currentStepResults = state.workflowExecutionState?.stepResults || {};
            const mergedStepResults = { ...parentWorkflowState.stepResults, ...currentStepResults };
            
            // 恢复状态
            // 关键修复：确保 stepStatusMap 也被正确恢复（因为它是 Map 对象，需要特殊处理）
            // 关键修复：确保 isNestedWorkflow 标志被清除，这样下一个步骤会被识别为本体工作流的节点
            state.workflowExecutionState = {
                ...parentWorkflowState,
                stepStatusMap: parentWorkflowState.stepStatusMap instanceof Map 
                    ? new Map(parentWorkflowState.stepStatusMap) 
                    : (state.workflowExecutionState?.stepStatusMap instanceof Map 
                        ? new Map(state.workflowExecutionState.stepStatusMap) 
                        : new Map()),
                isNestedWorkflow: false, // 关键修复：恢复状态后，清除嵌套工作流标志，确保下一个步骤被识别为本体工作流的节点
                stepResults: mergedStepResults // 关键修复：使用合并后的stepResults，保留工作流执行过程中的新结果
            };
            console.log(`[工作流节点执行器] 已恢复本体工作流状态: ${parentWorkflowState.workflowName}，isNestedWorkflow已清除`);
            updateWorkflowExecutionStatus();
        }
        
        return result;
        
    } catch (error) {
        console.error(`[工作流节点执行器] 工作流节点执行失败: ${viewId}`, error);
        
        // 关键修复：即使执行失败，也要恢复本体工作流的状态
        if (parentWorkflowState) {
            // 更新状态机状态为 failed
            // 确保 stepStatusMap 是 Map 对象
            if (!parentWorkflowState.stepStatusMap || !(parentWorkflowState.stepStatusMap instanceof Map)) {
                // 如果 stepStatusMap 不存在或不是 Map，从原始状态重新创建
                if (state.workflowExecutionState?.stepStatusMap instanceof Map) {
                    parentWorkflowState.stepStatusMap = new Map(state.workflowExecutionState.stepStatusMap);
                } else {
                    parentWorkflowState.stepStatusMap = new Map();
                }
            }
            parentWorkflowState.stepStatusMap.set(stepId, 'failed');
            console.log(`[工作流节点执行器] 状态机状态更新为 failed: ${stepId}`);
            
            // 更新执行日志为失败状态
            const logIndex = parentWorkflowState.executionLogs.findIndex(
                log => log.viewId === viewId && log.status === 'executing' && log.stepIndex === currentStepIndex
            );
            if (logIndex >= 0) {
                const timestamp = new Date().toISOString();
                const failedLogMessage = `${viewId} -> [工作流节点执行失败: ${actualWorkflowId}] - ${error.message}`;
                parentWorkflowState.executionLogs[logIndex] = {
                    ...parentWorkflowState.executionLogs[logIndex],
                    log: failedLogMessage,
                    timestamp: timestamp,
                    status: 'failed'
                };
            }
            
            // 关键修复：恢复状态时，合并当前状态和父状态，而不是完全覆盖
            // 这样可以保留工作流执行过程中新完成的步骤结果
            const currentStepResults = state.workflowExecutionState?.stepResults || {};
            const mergedStepResults = { ...parentWorkflowState.stepResults, ...currentStepResults };
            
            // 恢复状态
            // 关键修复：确保 stepStatusMap 也被正确恢复（因为它是 Map 对象，需要特殊处理）
            // 关键修复：确保 isNestedWorkflow 标志被清除，这样下一个步骤会被识别为本体工作流的节点
            state.workflowExecutionState = {
                ...parentWorkflowState,
                stepStatusMap: parentWorkflowState.stepStatusMap instanceof Map 
                    ? new Map(parentWorkflowState.stepStatusMap) 
                    : (state.workflowExecutionState?.stepStatusMap instanceof Map 
                        ? new Map(state.workflowExecutionState.stepStatusMap) 
                        : new Map()),
                isNestedWorkflow: false, // 关键修复：恢复状态后，清除嵌套工作流标志，确保下一个步骤被识别为本体工作流的节点
                stepResults: mergedStepResults // 关键修复：使用合并后的stepResults，保留工作流执行过程中的新结果
            };
            console.log(`[工作流节点执行器] 执行失败，已恢复本体工作流状态: ${parentWorkflowState.workflowName}，isNestedWorkflow已清除`);
            updateWorkflowExecutionStatus();
        }
        
        throw error;
    }
}

