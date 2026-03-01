/**
 * 日志管理模块
 * 负责记录和读取工作流、事件的使用情况
 */

import { state } from '../core/state.js';

/**
 * 记录工作流执行日志
 * @param {string} workflowName - 工作流名称
 * @param {string} viewId - 视图ID
 * @param {string} timestamp - 执行时间戳
 * @param {object} options - 额外选项 {eventName, stepIndex, content, stepFilePath}
 */
export async function logWorkflowExecution(workflowName, viewId, timestamp, options = {}) {
    try {
        const logData = {
            type: 'workflow',
            workflowName: workflowName,
            viewId: viewId,
            timestamp: timestamp,
            eventName: options.eventName || null,
            stepIndex: options.stepIndex || null,
            content: options.content || null,
            stepFilePath: options.stepFilePath || null,
            originalPath: state.originalPath || null
        };
        
        await writeLogEntry(logData);
    } catch (error) {
        console.error('记录工作流日志失败:', error);
    }
}

/**
 * 记录事件执行日志
 * @param {string} eventName - 事件名称
 * @param {string} workflowName - 工作流名称
 * @param {string} timestamp - 执行时间戳
 * @param {object} options - 额外选项 {viewId, steps, mergedFilePath}
 */
export async function logEventExecution(eventName, workflowName, timestamp, options = {}) {
    try {
        const logData = {
            type: 'event',
            eventName: eventName,
            workflowName: workflowName,
            timestamp: timestamp,
            viewId: options.viewId || null,
            steps: options.steps || [],
            mergedFilePath: options.mergedFilePath || null,
            originalPath: state.originalPath || null
        };
        
        await writeLogEntry(logData);
    } catch (error) {
        console.error('记录事件日志失败:', error);
    }
}

/**
 * 写入日志条目到文件
 * @param {object} logData - 日志数据
 */
async function writeLogEntry(logData) {
    try {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const timeStr = now.toISOString().replace(/[:.]/g, '-').split('.')[0];
        
        // 日志文件路径：log/年月/年月日+时间戳+_log
        const logDir = `log/${year}${month}`;
        const logFileName = `${year}${month}${day}_${timeStr}_log.json`;
        const logFilePath = `${logDir}/${logFileName}`;
        
        // 调用后端API写入日志
        const response = await fetch('/api/log/write', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: logFilePath,
                data: logData
            })
        });
        
        if (!response.ok) {
            throw new Error(`写入日志失败: ${response.status}`);
        }
    } catch (error) {
        console.error('写入日志条目失败:', error);
    }
}

/**
 * 读取日志数据
 * @param {object} query - 查询条件 {eventName, workflowName, viewId, startDate, endDate}
 * @returns {Promise<Array>} 日志条目数组
 */
export async function readLogs(query = {}) {
    try {
        const response = await fetch('/api/log/read', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(query)
        });
        
        if (!response.ok) {
            throw new Error(`读取日志失败: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('读取日志失败:', error);
        return [];
    }
}

/**
 * 从文件系统扫描并统计使用情况
 * @param {string} projectRootPath - 项目根目录路径
 * @returns {Promise<object>} 统计结果
 */
export async function scanFileSystem(projectRootPath) {
    try {
        const response = await fetch('/api/log/scan', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ rootPath: projectRootPath })
        });
        
        if (!response.ok) {
            throw new Error(`扫描文件系统失败: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('扫描文件系统失败:', error);
        return { workflows: [], events: [], views: [] };
    }
}

