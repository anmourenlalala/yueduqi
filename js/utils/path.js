/**
 * 路径工具函数
 * 提供跨平台的路径处理功能
 */

export const pathUtils = {
    /**
     * 连接路径
     */
    join(...paths) {
        let result = paths.join('/');
        // 替换多个斜杠为单个斜杠
        result = result.replace(/\/+/g, '/');
        // 处理 .. 和 . 路径
        const parts = result.split('/');
        const normalized = [];
        for (const part of parts) {
            if (part === '..') {
                normalized.pop();
            } else if (part !== '.' && part !== '') {
                normalized.push(part);
            }
        }
        return normalized.join('/');
    },
    
    /**
     * 获取文件名
     */
    basename(filePath) {
        const parts = filePath.replace(/\\/g, '/').split('/');
        return parts[parts.length - 1] || '';
    },
    
    /**
     * 获取目录名
     */
    dirname(filePath) {
        const parts = filePath.replace(/\\/g, '/').split('/');
        parts.pop();
        return parts.join('/') || '.';
    },
    
    /**
     * 标准化路径（统一使用正斜杠）
     */
    normalize(filePath) {
        return filePath.replace(/\\/g, '/');
    }
};

// 为了向后兼容，也暴露到window对象
if (typeof window !== 'undefined') {
    window.path = pathUtils;
}
