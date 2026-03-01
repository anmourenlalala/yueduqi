/**
 * 反馈向量化配置管理模块
 * 负责管理向量模型配置和查询参数配置
 */

// 默认配置
const DEFAULT_CONFIG = {
    vectorModel: {
        enabled: false,  // 默认禁用，需要用户显式启用
        apiUrl: '',
        apiKey: '',
        model: '',
        dimensions: 1536  // text-embedding-3-small的默认维度
    },
    queryConfig: {
        maxResults: 3,  // 默认3个，与原系统保持一致
        similarityThreshold: 0.5,  // 相似度阈值
        queryMode: 'vector'  // 'vector' | 'time' | 'hybrid'
    }
};

// 配置存储键名
const CONFIG_STORAGE_KEY = 'feedbackVectorConfig';

/**
 * 规范化API URL（支持oneapi自动拼接）
 * @param {string} url - 原始URL
 * @returns {string} 规范化后的URL
 */
function normalizeApiUrl(url) {
    if (!url) return '';
    
    url = url.trim();
    // 移除末尾的斜杠
    url = url.replace(/\/+$/, '');
    
    // 如果已经包含 /v1/embeddings，直接返回
    if (url.includes('/v1/embeddings')) {
        return url;
    }
    
    // 否则自动拼接
    return `${url}/v1/embeddings`;
}

/**
 * 验证配置
 * @param {object} config - 待验证的配置
 * @returns {object} {valid: boolean, errors: string[]}
 */
function validateConfig(config) {
    const errors = [];
    
    if (!config.vectorModel) {
        errors.push('vectorModel配置缺失');
        return { valid: false, errors };
    }
    
    const vm = config.vectorModel;
    
    // 如果未启用，跳过验证
    if (!vm.enabled) {
        return { valid: true, errors: [] };
    }
    
    // API URL验证
    if (!vm.apiUrl || !vm.apiUrl.trim()) {
        errors.push('API地址不能为空');
    } else {
        try {
            const url = new URL(vm.apiUrl.replace(/\/v1\/embeddings.*$/, ''));
            if (!['http:', 'https:'].includes(url.protocol)) {
                errors.push('API地址必须是有效的HTTP或HTTPS地址');
            }
        } catch (e) {
            errors.push('API地址格式不正确');
        }
    }
    
    // 模型名称验证
    if (!vm.model || !vm.model.trim()) {
        errors.push('模型名称不能为空');
    }
    
    // 向量维度验证
    if (!vm.dimensions || !Number.isInteger(vm.dimensions) || vm.dimensions <= 0) {
        errors.push('向量维度必须是正整数');
    }
    
    // 查询配置验证
    if (config.queryConfig) {
        const qc = config.queryConfig;
        
        if (qc.maxResults !== undefined) {
            if (!Number.isInteger(qc.maxResults) || qc.maxResults < 1 || qc.maxResults > 20) {
                errors.push('返回数量必须在1-20之间');
            }
        }
        
        if (qc.similarityThreshold !== undefined) {
            if (typeof qc.similarityThreshold !== 'number' || qc.similarityThreshold < 0 || qc.similarityThreshold > 1) {
                errors.push('相似度阈值必须在0-1之间');
            }
        }
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * 加载配置
 * @returns {object} 配置对象
 */
export function loadVectorConfig() {
    try {
        const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
        if (saved) {
            const config = JSON.parse(saved);
            // 合并默认配置，确保所有字段都存在
            return mergeConfig(DEFAULT_CONFIG, config);
        }
    } catch (err) {
        console.error('[反馈向量化配置] 加载配置失败:', err);
    }
    
    return { ...DEFAULT_CONFIG };
}

/**
 * 保存配置
 * @param {object} config - 配置对象
 * @returns {boolean} 是否保存成功
 */
export function saveVectorConfig(config) {
    try {
        // 验证配置
        const validation = validateConfig(config);
        if (!validation.valid) {
            console.error('[反馈向量化配置] 配置验证失败:', validation.errors);
            return false;
        }
        
        // 规范化API URL
        if (config.vectorModel && config.vectorModel.apiUrl) {
            config.vectorModel.apiUrl = normalizeApiUrl(config.vectorModel.apiUrl);
        }
        
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
        return true;
    } catch (err) {
        console.error('[反馈向量化配置] 保存配置失败:', err);
        return false;
    }
}

/**
 * 合并配置（深拷贝合并）
 * @param {object} defaultConfig - 默认配置
 * @param {object} userConfig - 用户配置
 * @returns {object} 合并后的配置
 */
function mergeConfig(defaultConfig, userConfig) {
    const merged = JSON.parse(JSON.stringify(defaultConfig));
    
    if (userConfig.vectorModel) {
        merged.vectorModel = {
            ...merged.vectorModel,
            ...userConfig.vectorModel
        };
    }
    
    if (userConfig.queryConfig) {
        merged.queryConfig = {
            ...merged.queryConfig,
            ...userConfig.queryConfig
        };
    }
    
    return merged;
}

/**
 * 获取当前配置
 * @returns {object} 配置对象
 */
export function getVectorConfig() {
    return loadVectorConfig();
}

/**
 * 检查向量化是否启用
 * @returns {boolean}
 */
export function isVectorEnabled() {
    const config = loadVectorConfig();
    return config.vectorModel && config.vectorModel.enabled === true;
}

/**
 * 获取向量模型配置
 * @returns {object|null}
 */
export function getVectorModelConfig() {
    const config = loadVectorConfig();
    if (!config.vectorModel || !config.vectorModel.enabled) {
        return null;
    }
    
    return {
        apiUrl: normalizeApiUrl(config.vectorModel.apiUrl),
        apiKey: config.vectorModel.apiKey || '',
        model: config.vectorModel.model,
        dimensions: config.vectorModel.dimensions
    };
}

/**
 * 获取查询配置
 * @returns {object}
 */
export function getQueryConfig() {
    const config = loadVectorConfig();
    return config.queryConfig || DEFAULT_CONFIG.queryConfig;
}

// 暴露到全局（用于调试）
if (typeof window !== 'undefined') {
    window.loadVectorConfig = loadVectorConfig;
    window.saveVectorConfig = saveVectorConfig;
    window.getVectorConfig = getVectorConfig;
    window.isVectorEnabled = isVectorEnabled;
}

















































































