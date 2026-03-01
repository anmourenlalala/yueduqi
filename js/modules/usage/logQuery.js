/**
 * 日志查询模块
 * 负责从日志文件读取和查询工作流、事件、视图的使用记录
 */

import { readLogs } from '../logManager.js';

/**
 * 查询工作流使用记录
 * @param {string} workflowName - 工作流名称（可选）
 * @param {string} startDate - 开始日期（可选）
 * @param {string} endDate - 结束日期（可选）
 * @returns {Promise<Array>} 工作流使用记录
 */
export async function queryWorkflowUsage(workflowName = null, startDate = null, endDate = null) {
    try {
        const logs = await readLogs({
            workflowName: workflowName,
            startDate: startDate,
            endDate: endDate
        });
        
        // 过滤出工作流类型的日志
        const workflowLogs = logs.filter(log => log.type === 'workflow');
        
        // 按工作流名称分组统计
        const stats = new Map();
        workflowLogs.forEach(log => {
            const key = log.workflowName;
            if (!stats.has(key)) {
                stats.set(key, {
                    workflowName: key,
                    count: 0,
                    firstUsed: null,
                    lastUsed: null,
                    records: []
                });
            }
            
            const stat = stats.get(key);
            stat.count++;
            stat.records.push(log);
            
            const logTime = new Date(log.timestamp);
            if (!stat.firstUsed || logTime < stat.firstUsed) {
                stat.firstUsed = logTime;
            }
            if (!stat.lastUsed || logTime > stat.lastUsed) {
                stat.lastUsed = logTime;
            }
        });
        
        return Array.from(stats.values()).map(stat => ({
            ...stat,
            firstUsed: stat.firstUsed ? stat.firstUsed.toISOString() : null,
            lastUsed: stat.lastUsed ? stat.lastUsed.toISOString() : null
        }));
    } catch (error) {
        console.error('查询工作流使用记录失败:', error);
        return [];
    }
}

/**
 * 查询事件使用记录
 * @param {string} eventName - 事件名称（可选）
 * @param {string} startDate - 开始日期（可选）
 * @param {string} endDate - 结束日期（可选）
 * @returns {Promise<Array>} 事件使用记录
 */
export async function queryEventUsage(eventName = null, startDate = null, endDate = null) {
    try {
        const logs = await readLogs({
            eventName: eventName,
            startDate: startDate,
            endDate: endDate
        });
        
        // 过滤出事件类型的日志
        const eventLogs = logs.filter(log => log.type === 'event');
        
        // 按事件名称分组统计（事件统计以事件名为检索结果显示）
        const stats = new Map();
        eventLogs.forEach(log => {
            const key = log.eventName;
            if (!stats.has(key)) {
                stats.set(key, {
                    eventName: key,
                    workflowName: log.workflowName,
                    count: 0,
                    directoryCount: 0, // 目录执行次数
                    fileCount: 0, // 单文件执行次数
                    totalFilesProcessed: 0, // 总处理文件数（目录执行时）
                    totalStepsExecuted: 0, // 总执行步骤数
                    firstUsed: null,
                    lastUsed: null,
                    records: []
                });
            }
            
            const stat = stats.get(key);
            stat.count++;
            
            // 统计目录执行和单文件执行
            if (log.isDirectory) {
                stat.directoryCount++;
                stat.totalFilesProcessed += (log.totalFiles || 0);
            } else {
                stat.fileCount++;
            }
            
            // 累计总步骤数
            stat.totalStepsExecuted += (log.totalSteps || 0);
            
            stat.records.push(log);
            
            const logTime = new Date(log.timestamp);
            if (!stat.firstUsed || logTime < stat.firstUsed) {
                stat.firstUsed = logTime;
            }
            if (!stat.lastUsed || logTime > stat.lastUsed) {
                stat.lastUsed = logTime;
            }
        });
        
        return Array.from(stats.values()).map(stat => ({
            ...stat,
            firstUsed: stat.firstUsed ? stat.firstUsed.toISOString() : null,
            lastUsed: stat.lastUsed ? stat.lastUsed.toISOString() : null
        }));
    } catch (error) {
        console.error('查询事件使用记录失败:', error);
        return [];
    }
}

/**
 * 查询视图使用记录
 * @param {string} viewId - 视图ID（可选）
 * @param {string} startDate - 开始日期（可选）
 * @param {string} endDate - 结束日期（可选）
 * @returns {Promise<Array>} 视图使用记录
 */
export async function queryViewUsage(viewId = null, startDate = null, endDate = null) {
    try {
        const logs = await readLogs({
            viewId: viewId,
            startDate: startDate,
            endDate: endDate
        });
        
        // 统计视图使用（从工作流和事件日志中提取）
        const viewStats = new Map();
        
        logs.forEach(log => {
            let viewIds = [];
            
            if (log.type === 'workflow' && log.viewId) {
                viewIds.push(log.viewId);
            } else if (log.type === 'event' && log.steps) {
                viewIds = log.steps.map(s => s.viewId).filter(Boolean);
            }
            
            viewIds.forEach(vId => {
                if (!viewStats.has(vId)) {
                    viewStats.set(vId, {
                        viewId: vId,
                        count: 0,
                        firstUsed: null,
                        lastUsed: null,
                        records: []
                    });
                }
                
                const stat = viewStats.get(vId);
                stat.count++;
                stat.records.push(log);
                
                const logTime = new Date(log.timestamp);
                if (!stat.firstUsed || logTime < stat.firstUsed) {
                    stat.firstUsed = logTime;
                }
                if (!stat.lastUsed || logTime > stat.lastUsed) {
                    stat.lastUsed = logTime;
                }
            });
        });
        
        return Array.from(viewStats.values()).map(stat => ({
            ...stat,
            firstUsed: stat.firstUsed ? stat.firstUsed.toISOString() : null,
            lastUsed: stat.lastUsed ? stat.lastUsed.toISOString() : null
        }));
    } catch (error) {
        console.error('查询视图使用记录失败:', error);
        return [];
    }
}

/**
 * 综合查询（支持多条件）
 * @param {object} query - 查询条件 {eventName, workflowName, viewId, startDate, endDate}
 * @returns {Promise<object>} 查询结果 {workflows, events, views}
 */
export async function queryAllUsage(query = {}) {
    try {
        const [workflows, events, views] = await Promise.all([
            queryWorkflowUsage(query.workflowName, query.startDate, query.endDate),
            queryEventUsage(query.eventName, query.startDate, query.endDate),
            queryViewUsage(query.viewId, query.startDate, query.endDate)
        ]);
        
        return {
            workflows,
            events,
            views,
            source: 'log'
        };
    } catch (error) {
        console.error('综合查询失败:', error);
        return {
            workflows: [],
            events: [],
            views: [],
            source: 'log'
        };
    }
}

