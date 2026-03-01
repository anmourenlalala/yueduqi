/**
 * 反馈向量存储管理模块
 * 负责管理反馈文件的向量索引，实现向量相似度搜索
 * 使用后端SQLite数据库存储向量数据
 */

import { getVectorModelConfig, getQueryConfig } from './feedbackVectorConfig.js';

/**
 * 调用后端API
 */
async function callVectorAPI(endpoint, method = 'GET', body = null) {
    try {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json'
            }
        };
        
        if (body) {
            options.body = JSON.stringify(body);
        }
        
        const response = await fetch(`/api/vector/${endpoint}`, options);
        
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(error.error || `API请求失败: ${response.status}`);
        }
        
        return await response.json();
    } catch (err) {
        console.error(`[向量存储] API调用失败: ${endpoint}`, err);
        throw err;
    }
}

/**
 * 添加或更新反馈向量索引
 * @param {string} type - 类型 ('node' 或 'workflow')
 * @param {string} filePath - 反馈文件路径
 * @param {Array<number>} vector - 向量
 * @param {object} metadata - 元数据（包含timestamp、eventName、viewId等）
 * @returns {Promise<boolean>}
 */
export async function addFeedbackVector(type, filePath, vector, metadata = {}) {
    try {
        const result = await callVectorAPI('add', 'POST', {
            type,
            filePath,
            vector,
            metadata: {
                timestamp: metadata.timestamp || new Date().toISOString(),
                eventName: metadata.eventName || '',
                viewId: metadata.viewId || '',
                workflowName: metadata.workflowName || '',
                fileName: metadata.fileName || '',
                filePathOriginal: metadata.filePathOriginal || ''
            }
        });
        
        if (result.success) {
            console.log(`[向量化] 向量索引已保存: ${type} - ${filePath} (维度: ${vector?.length || 0})`);
        }
        return result.success || false;
    } catch (err) {
        console.error('[向量化] 添加反馈向量失败:', err);
        return false;
    }
}

/**
 * 删除反馈向量索引
 * @param {string} type - 类型 ('node' 或 'workflow')
 * @param {string} filePath - 反馈文件路径
 * @returns {Promise<boolean>}
 */
export async function removeFeedbackVector(type, filePath) {
    try {
        const result = await callVectorAPI(`${type}?filePath=${encodeURIComponent(filePath)}`, 'DELETE');
        return result.success || false;
    } catch (err) {
        console.error('[反馈向量存储] 删除反馈向量失败:', err);
        return false;
    }
}

/**
 * 根据向量相似度搜索反馈
 * @param {string} type - 类型 ('node' 或 'workflow')
 * @param {Array<number>} queryVector - 查询向量
 * @param {object} filters - 过滤条件 {workflowName, viewId, fileName, eventName, filePathOriginal}
 * @param {number} maxResults - 最大返回数量
 * @param {number} threshold - 相似度阈值
 * @returns {Promise<Array>} 搜索结果 [{filePath, similarity, metadata}, ...]
 */
export async function searchSimilarFeedbacks(type, queryVector, filters = {}, maxResults = 3, threshold = 0.5) {
    try {
        // 验证查询向量维度
        const config = getVectorModelConfig();
        if (config && queryVector.length !== config.dimensions) {
            console.warn(`[向量化] 查询向量维度不匹配: 期望 ${config.dimensions}, 实际 ${queryVector.length}`);
        }
        
        console.log(`[向量化] 开始向量搜索: ${type} - 过滤条件:`, filters);
        
        const results = await callVectorAPI('search', 'POST', {
            type,
            queryVector,
            limit: maxResults,
            workflowName: filters.workflowName || null,
            viewId: filters.viewId || null,
            fileName: filters.fileName || null
        });
        
        // 后端已经按相似度排序，这里只需要过滤阈值
        const filteredResults = results.filter(item => item.similarity >= threshold);
        
        console.log(`[向量化] 向量搜索完成: ${type} - 找到 ${filteredResults.length} 个结果 (阈值: ${threshold})`);
        if (filteredResults.length > 0) {
            filteredResults.forEach((r, i) => {
                console.log(`[向量化] 结果 ${i + 1}: ${r.filePath} (相似度: ${r.similarity.toFixed(4)})`);
            });
        }
        
        return filteredResults;
    } catch (err) {
        console.error('[反馈向量存储] 搜索相似反馈失败:', err);
        return [];
    }
}

/**
 * 检查反馈文件是否已有向量索引
 * @param {string} type - 类型 ('node' 或 'workflow')
 * @param {string} filePath - 反馈文件路径
 * @returns {Promise<boolean>}
 */
export async function hasFeedbackVector(type, filePath) {
    try {
        const result = await callVectorAPI(`exists/${type}?filePath=${encodeURIComponent(filePath)}`);
        return result.exists || false;
    } catch (err) {
        console.warn(`[向量化] 检查向量是否存在失败: ${type} - ${filePath}`, err);
        return false;
    }
}

/**
 * 获取所有已向量化的文件路径列表
 * @param {string} type - 类型 ('node' 或 'workflow')
 * @returns {Promise<Array<string>>} 文件路径数组
 */
export async function getAllVectorizedFiles(type) {
    try {
        const filePaths = await callVectorAPI(`files/${type}`);
        return Array.isArray(filePaths) ? filePaths : [];
    } catch (err) {
        console.error(`[向量化] 获取已向量化文件列表失败 (${type}):`, err);
        return [];
    }
}

/**
 * 获取向量索引统计信息
 * @param {string} type - 类型 ('node' 或 'workflow')
 * @returns {Promise<object>}
 */
export async function getIndexStats(type) {
    try {
        const filePaths = await getAllVectorizedFiles(type);
        return {
            count: filePaths.length,
            type
        };
    } catch (err) {
        return {
            count: 0,
            type
        };
    }
}

// 暴露到全局（用于调试）
if (typeof window !== 'undefined') {
    window.addFeedbackVector = addFeedbackVector;
    window.searchSimilarFeedbacks = searchSimilarFeedbacks;
    window.getFeedbackVectorIndexStats = getIndexStats;
    window.getAllVectorizedFiles = getAllVectorizedFiles;
    window.hasFeedbackVector = hasFeedbackVector;
}
