/**
 * 向量化工具模块
 * 负责文本向量化和向量相似度计算
 * 参考VCP向量项目的EmbeddingUtils.js实现
 */

/**
 * 获取文本的向量表示
 * @param {string} text - 要向量化的文本
 * @param {object} config - 向量化配置 {apiUrl, apiKey, model}
 * @returns {Promise<Array<number>>} 向量数组
 */
export async function getEmbedding(text, config) {
    if (!text || !text.trim()) {
        throw new Error('文本不能为空');
    }
    
    if (!config || !config.apiUrl || !config.apiKey || !config.model) {
        throw new Error('向量化配置不完整，需要apiUrl、apiKey和model');
    }
    
    try {
        // 处理URL：如果只输入了基础URL（如http://127.0.0.1:3000），自动拼接/v1/embeddings
        let apiUrl = config.apiUrl.trim();
        if (apiUrl.endsWith('/')) {
            apiUrl = apiUrl.slice(0, -1);
        }
        
        // 如果URL不包含/v1/embeddings路径，自动添加
        if (!apiUrl.includes('/v1/embeddings')) {
            // 检查是否已经有/v1路径
            if (!apiUrl.includes('/v1')) {
                apiUrl = `${apiUrl}/v1/embeddings`;
            } else {
                apiUrl = `${apiUrl}/embeddings`;
            }
        }
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
                model: config.model,
                input: text
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`向量化API错误 ${response.status}: ${errorText.substring(0, 500)}`);
        }
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(`向量化API错误: ${data.error.message || JSON.stringify(data.error)}`);
        }
        
        if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
            throw new Error('向量化API返回数据格式错误');
        }
        
        // 返回第一个向量的embedding数组
        return data.data[0].embedding;
        
    } catch (error) {
        console.error('[向量化] 获取向量失败:', error);
        throw error;
    }
}

/**
 * 批量获取文本的向量表示
 * @param {Array<string>} texts - 要向量化的文本数组
 * @param {object} config - 向量化配置 {apiUrl, apiKey, model}
 * @returns {Promise<Array<Array<number>>>} 向量数组的数组
 */
export async function getEmbeddingsBatch(texts, config) {
    if (!texts || texts.length === 0) {
        return [];
    }
    
    if (!config || !config.apiUrl || !config.apiKey || !config.model) {
        throw new Error('向量化配置不完整，需要apiUrl、apiKey和model');
    }
    
    try {
        // 处理URL：如果只输入了基础URL（如http://127.0.0.1:3000），自动拼接/v1/embeddings
        let apiUrl = config.apiUrl.trim();
        if (apiUrl.endsWith('/')) {
            apiUrl = apiUrl.slice(0, -1);
        }
        
        // 如果URL不包含/v1/embeddings路径，自动添加
        if (!apiUrl.includes('/v1/embeddings')) {
            // 检查是否已经有/v1路径
            if (!apiUrl.includes('/v1')) {
                apiUrl = `${apiUrl}/v1/embeddings`;
            } else {
                apiUrl = `${apiUrl}/embeddings`;
            }
        }
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
                model: config.model,
                input: texts
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`向量化API错误 ${response.status}: ${errorText.substring(0, 500)}`);
        }
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(`向量化API错误: ${data.error.message || JSON.stringify(data.error)}`);
        }
        
        if (!data.data || !Array.isArray(data.data)) {
            throw new Error('向量化API返回数据格式错误');
        }
        
        // 按index排序，然后返回embedding数组
        return data.data
            .sort((a, b) => (a.index || 0) - (b.index || 0))
            .map(item => item.embedding);
        
    } catch (error) {
        console.error('[向量化] 批量获取向量失败:', error);
        throw error;
    }
}

/**
 * 计算两个向量的余弦相似度
 * @param {Array<number>} vec1 - 向量1
 * @param {Array<number>} vec2 - 向量2
 * @returns {number} 相似度分数（0-1之间，1表示完全相同）
 */
export function cosineSimilarity(vec1, vec2) {
    if (!vec1 || !vec2 || vec1.length !== vec2.length) {
        return 0;
    }
    
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < vec1.length; i++) {
        dotProduct += vec1[i] * vec2[i];
        norm1 += vec1[i] * vec1[i];
        norm2 += vec2[i] * vec2[i];
    }
    
    if (norm1 === 0 || norm2 === 0) {
        return 0;
    }
    
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * 计算向量之间的欧氏距离
 * @param {Array<number>} vec1 - 向量1
 * @param {Array<number>} vec2 - 向量2
 * @returns {number} 距离（越小越相似）
 */
export function euclideanDistance(vec1, vec2) {
    if (!vec1 || !vec2 || vec1.length !== vec2.length) {
        return Infinity;
    }
    
    let sum = 0;
    for (let i = 0; i < vec1.length; i++) {
        const diff = vec1[i] - vec2[i];
        sum += diff * diff;
    }
    
    return Math.sqrt(sum);
}





















































































