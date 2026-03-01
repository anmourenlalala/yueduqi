/**
 * 视图容器包装工具
 * 
 * 作用：为视图DOM元素添加容器包装，便于后续的分离和恢复操作
 * 
 * 使用场景：
 * - 在创建视图DOM后，调用此函数包装
 * - 包装后，可以通过容器ID控制视图的显示/隐藏
 * 
 * @param {HTMLElement} paneElement - 原始的pane元素（视图内容）
 * @param {string} viewId - 视图ID（用于生成容器ID）
 * @returns {HTMLElement} 包装后的容器元素
 */
export function wrapViewInContainer(paneElement, viewId) {
    // 参数检查：确保输入有效
    if (!paneElement) {
        console.error('wrapViewInContainer: paneElement 不能为空');
        return null;
    }
    
    if (!viewId || typeof viewId !== 'string') {
        console.error('wrapViewInContainer: viewId 必须是有效的字符串');
        return null;
    }
    
    // 检查是否已经包装过（避免重复包装）
    if (paneElement.parentElement && 
        paneElement.parentElement.classList.contains('view-container')) {
        console.warn(`视图 ${viewId} 已经被包装过了`);
        return paneElement.parentElement;
    }
    
    try {
        // 第一步：创建一个新的容器div
        // 这个容器就是我们说的"外层盒子"
        const container = document.createElement('div');
        container.className = 'view-container';  // CSS类名，用于样式控制
        container.id = `view-container-${viewId}`;  // 唯一ID，用于查找
        container.dataset.viewId = viewId;  // 存储视图ID，方便后续查找
        
        // 第二步：将原始的pane元素放入容器
        // 就像把内层盒子放进外层盒子
        container.appendChild(paneElement);
        
        // 第三步：返回容器元素
        // 这样调用者就可以使用这个容器了
        return container;
        
    } catch (error) {
        // 错误处理：如果包装过程中出错，记录错误但不影响原有功能
        console.error(`包装视图 ${viewId} 失败:`, error);
        return null;
    }
}

/**
 * 获取视图容器元素
 * 
 * 作用：通过视图ID快速找到对应的容器元素
 * 
 * @param {string} viewId - 视图ID
 * @returns {HTMLElement|null} 容器元素，如果不存在返回null
 */
export function getViewContainer(viewId) {
    if (!viewId) {
        return null;
    }
    
    const containerId = `view-container-${viewId}`;
    return document.getElementById(containerId);
}

/**
 * 隐藏视图容器
 * 
 * 作用：隐藏整个视图（通过隐藏容器实现）
 * 注意：这只是隐藏，不删除DOM，所以可以快速恢复
 * 
 * @param {string} viewId - 视图ID
 * @returns {boolean} 是否成功隐藏
 */
export function hideViewContainer(viewId) {
    const container = getViewContainer(viewId);
    
    if (!container) {
        console.warn(`视图容器 ${viewId} 不存在，无法隐藏`);
        return false;
    }
    
    try {
        // 隐藏容器（display: none）
        container.style.display = 'none';
        
        // 标记为已分离（用于后续判断）
        container.dataset.separated = 'true';
        
        return true;
    } catch (error) {
        console.error(`隐藏视图 ${viewId} 失败:`, error);
        return false;
    }
}

/**
 * 显示视图容器
 * 
 * 作用：显示之前隐藏的视图（通过显示容器实现）
 * 
 * @param {string} viewId - 视图ID
 * @returns {boolean} 是否成功显示
 */
export function showViewContainer(viewId) {
    const container = getViewContainer(viewId);
    
    if (!container) {
        console.warn(`视图容器 ${viewId} 不存在，无法显示`);
        return false;
    }
    
    try {
        // 显示容器（恢复默认display）
        container.style.display = '';
        
        // 清除分离标记
        container.dataset.separated = 'false';
        
        return true;
    } catch (error) {
        console.error(`显示视图 ${viewId} 失败:`, error);
        return false;
    }
}

/**
 * 检查视图是否已分离
 * 
 * 作用：判断视图当前是否处于分离状态（已隐藏）
 * 
 * @param {string} viewId - 视图ID
 * @returns {boolean} 是否已分离
 */
export function isViewSeparated(viewId) {
    const container = getViewContainer(viewId);
    
    if (!container) {
        return false;
    }
    
    // 检查分离标记或display样式
    return container.dataset.separated === 'true' || 
           container.style.display === 'none';
}










