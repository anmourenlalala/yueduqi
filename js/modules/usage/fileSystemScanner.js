/**
 * 文件系统扫描模块
 * 负责扫描项目目录，统计工作流、事件、视图的使用情况
 */

import { scanFileSystem } from '../logManager.js';

/**
 * 扫描文件系统并统计使用情况
 * @param {string} projectRootPath - 项目根目录路径
 * @returns {Promise<object>} 统计结果 {workflows, events, views, source}
 */
export async function scanProjectFiles(projectRootPath) {
    try {
        const stats = await scanFileSystem(projectRootPath);
        return stats;
    } catch (error) {
        console.error('扫描文件系统失败:', error);
        return {
            workflows: [],
            events: [],
            views: [],
            source: 'filesystem'
        };
    }
}

/**
 * 合并日志数据和文件系统扫描数据
 * @param {object} logData - 日志数据
 * @param {object} scanData - 扫描数据
 * @returns {object} 合并后的数据
 */
export function mergeUsageData(logData, scanData) {
    // 合并视图数据（日志和扫描可能都有视图数据）
    const mergedViews = new Map();
    
    // 添加日志中的视图数据
    if (logData.views) {
        logData.views.forEach(view => {
            const key = view.viewId;
            if (!mergedViews.has(key)) {
                mergedViews.set(key, {
                    ...view,
                    source: 'log'
                });
            } else {
                // 合并计数
                const existing = mergedViews.get(key);
                existing.count += view.count;
                existing.source = 'both';
            }
        });
    }
    
    // 添加扫描中的视图数据
    if (scanData.views) {
        scanData.views.forEach(view => {
            const key = view.viewId;
            if (!mergedViews.has(key)) {
                mergedViews.set(key, {
                    ...view,
                    source: 'filesystem'
                });
            } else {
                // 合并计数
                const existing = mergedViews.get(key);
                existing.count += view.count;
                existing.source = 'both';
            }
        });
    }
    
    return {
        workflows: logData.workflows || [],
        events: [...(logData.events || []), ...(scanData.events || [])],
        views: Array.from(mergedViews.values()),
        source: 'merged'
    };
}

