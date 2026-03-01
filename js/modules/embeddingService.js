/**
 * 向量化服务模块
 * 负责调用向量化API将文本转换为向量
 * 参考VCP项目的EmbeddingUtils.js实现
 */

import { getVectorModelConfig } from './feedbackVectorConfig.js';

// 向量缓存（内存缓存，避免重复计算）
const embeddingCache = new Map();
const CACHE_MAX_SIZE = 1000; // 最大缓存数量

// 批量处理配置
const MAX_BATCH_ITEMS = 100; // 单次批量请求的最大项数
const DEFAULT_CONCURRENCY = 3; // 并发请求数（前端环境降低并发）

/**
 * 计算文本的简单哈希（用于缓存键）
 * @param {string} text - 文本内容
 * @returns {string} 哈希值
 */
function simpleHash(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
}

/**
 * 获取缓存键
 * @param {string} text - 文本内容
 * @param {string} model - 模型名称
 * @returns {string} 缓存键
 */
function getCacheKey(text, model) {
    return `${model}:${simpleHash(text)}`;
}

/**
 * 清理缓存（保持缓存大小在限制内）
 */
function trimCache() {
    if (embeddingCache.size > CACHE_MAX_SIZE) {
        // 删除最旧的50%缓存
        const entriesToDelete = Math.floor(CACHE_MAX_SIZE / 2);
        const keys = Array.from(embeddingCache.keys());
        for (let i = 0; i < entriesToDelete; i++) {
            embeddingCache.delete(keys[i]);
        }
    }
}

/**
 * 发送单个向量化请求
 * @param {string|string[]} input - 输入文本或文本数组
 * @param {object} config - 向量模型配置
 * @returns {Promise<Array>} 向量数组
 */
async function _sendEmbeddingRequest(input, config) {
    const retryAttempts = 3;
    const baseDelay = 1000;
    
    const inputs = Array.isArray(input) ? input : [input];
    
    for (let attempt = 1; attempt <= retryAttempts; attempt++) {
        try {
            const response = await fetch(config.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey || 'dummy'}`
                },
                body: JSON.stringify({
                    model: config.model,
                    input: inputs
                })
            });
            
            const responseText = await response.text();
            
            if (!response.ok) {
                if (response.status === 429) {
                    // 429 限流时，增加等待时间
                    const waitTime = baseDelay * attempt * 2;
                    console.warn(`[向量化] API限流 (429)，等待 ${waitTime/1000} 秒后重试... (尝试 ${attempt}/${retryAttempts})`);
                    await new Promise(r => setTimeout(r, waitTime));
                    continue;
                }
                throw new Error(`API Error ${response.status}: ${responseText.substring(0, 500)}`);
            }
            
            let data;
            try {
                data = JSON.parse(responseText);
            } catch (parseError) {
                console.error('[Embedding] JSON Parse Error:', parseError);
                console.error('Response (first 500 chars):', responseText.substring(0, 500));
                throw new Error(`Failed to parse API response as JSON: ${parseError.message}`);
            }
            
            // 验证响应结构
            if (!data) {
                throw new Error('API returned empty/null response');
            }
            
            if (data.error) {
                const errorMsg = data.error.message || JSON.stringify(data.error);
                const errorCode = data.error.code || response.status;
                console.error(`[Embedding] API Error: ${errorCode} - ${errorMsg}`);
                throw new Error(`API Error ${errorCode}: ${errorMsg}`);
            }
            
            if (!data.data || !Array.isArray(data.data)) {
                console.error('[Embedding] Invalid API response structure: missing or invalid data field');
                throw new Error('Invalid API response structure: data field is missing or not an array');
            }
            
            // 提取向量并按index排序
            const embeddings = data.data
                .sort((a, b) => (a.index || 0) - (b.index || 0))
                .map(item => item.embedding)
                .filter(Boolean);
            
            if (embeddings.length === 0) {
                console.warn('[Embedding] No valid embeddings in response');
                throw new Error('No valid embeddings in API response');
            }
            
            // 验证向量维度
            const firstDim = embeddings[0]?.length;
            if (firstDim && config.dimensions && firstDim !== config.dimensions) {
                console.warn(`[Embedding] 向量维度不匹配: 期望 ${config.dimensions}, 实际 ${firstDim}`);
                // 不抛出错误，只警告，因为某些模型可能返回不同维度
            }
            
            return embeddings;
            
        } catch (e) {
            console.warn(`[向量化] 请求失败 (尝试 ${attempt}/${retryAttempts}):`, e.message);
            if (attempt === retryAttempts) {
                console.error(`[向量化] 所有重试均失败:`, e);
                throw e;
            }
            const delay = baseDelay * Math.pow(2, attempt - 1);
            console.log(`[向量化] 等待 ${delay/1000} 秒后重试...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
    
    return null;
}

/**
 * 获取单个文本的向量（带缓存）
 * @param {string} text - 文本内容
 * @returns {Promise<Array<number>|null>} 向量数组或null
 */
export async function getEmbedding(text) {
    if (!text || !text.trim()) {
        console.warn('[向量化] getEmbedding: 文本为空');
        return null;
    }
    
    const config = getVectorModelConfig();
    if (!config) {
        console.warn('[向量化] 向量化未启用或配置无效');
        return null;
    }
    
    // 检查缓存
    const cacheKey = getCacheKey(text, config.model);
    if (embeddingCache.has(cacheKey)) {
        const cached = embeddingCache.get(cacheKey);
        console.log(`[向量化] 使用缓存向量 (文本长度: ${text.length}, 维度: ${cached?.length || 0})`);
        return cached;
    }
    
    try {
        const textPreview = text.length > 100 ? text.substring(0, 100) + '...' : text;
        console.log(`[向量化] 开始获取向量 (模型: ${config.model}, 文本长度: ${text.length}, 预览: ${textPreview})`);
        
        const embeddings = await _sendEmbeddingRequest(text, config);
        if (embeddings && embeddings.length > 0) {
            const vector = embeddings[0];
            
            // 保存到缓存
            trimCache();
            embeddingCache.set(cacheKey, vector);
            
            console.log(`[向量化] 向量获取成功 (维度: ${vector.length})`);
            return vector;
        }
    } catch (err) {
        console.error('[向量化] 获取向量失败:', err);
    }
    
    return null;
}

/**
 * 批量获取向量（用于多个文本）
 * @param {string[]} texts - 文本数组
 * @returns {Promise<Array<Array<number>|null>>} 向量数组
 */
export async function getEmbeddingsBatch(texts) {
    if (!texts || texts.length === 0) {
        return [];
    }
    
    const config = getVectorModelConfig();
    if (!config) {
        console.warn('[Embedding] 向量化未启用或配置无效');
        return texts.map(() => null);
    }
    
    const results = [];
    
    // 将文本数组分成批次
    const batches = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH_ITEMS) {
        batches.push(texts.slice(i, i + MAX_BATCH_ITEMS));
    }
    
    // 并发处理批次
    const batchPromises = batches.map(async (batch) => {
        try {
            // 检查缓存，只请求未缓存的文本
            const uncachedTexts = [];
            const uncachedIndices = [];
            const cachedVectors = [];
            
            batch.forEach((text, idx) => {
                const cacheKey = getCacheKey(text, config.model);
                if (embeddingCache.has(cacheKey)) {
                    cachedVectors[idx] = embeddingCache.get(cacheKey);
                } else {
                    uncachedTexts.push(text);
                    uncachedIndices.push(idx);
                }
            });
            
            // 如果有未缓存的文本，批量请求
            if (uncachedTexts.length > 0) {
                const embeddings = await _sendEmbeddingRequest(uncachedTexts, config);
                
                // 将结果填充到对应位置
                if (embeddings) {
                    embeddings.forEach((embedding, embIdx) => {
                        const originalIdx = uncachedIndices[embIdx];
                        const text = uncachedTexts[embIdx];
                        
                        // 保存到缓存
                        const cacheKey = getCacheKey(text, config.model);
                        trimCache();
                        embeddingCache.set(cacheKey, embedding);
                        
                        cachedVectors[originalIdx] = embedding;
                    });
                }
            }
            
            return cachedVectors;
        } catch (err) {
            console.error('[Embedding] 批量获取向量失败:', err);
            return batch.map(() => null);
        }
    });
    
    // 限制并发数
    const concurrencyLimit = DEFAULT_CONCURRENCY;
    for (let i = 0; i < batchPromises.length; i += concurrencyLimit) {
        const batchResults = await Promise.all(
            batchPromises.slice(i, i + concurrencyLimit)
        );
        results.push(...batchResults);
    }
    
    return results.flat();
}

/**
 * 清除缓存
 */
export function clearEmbeddingCache() {
    embeddingCache.clear();
}

/**
 * 获取缓存统计信息
 * @returns {object}
 */
export function getCacheStats() {
    return {
        size: embeddingCache.size,
        maxSize: CACHE_MAX_SIZE
    };
}

// 暴露到全局（用于调试）
if (typeof window !== 'undefined') {
    window.getEmbedding = getEmbedding;
    window.getEmbeddingsBatch = getEmbeddingsBatch;
    window.clearEmbeddingCache = clearEmbeddingCache;
    window.getEmbeddingCacheStats = getCacheStats;
}

